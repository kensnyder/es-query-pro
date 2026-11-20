import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { createTestKit } from '../testFixtures/esTestKit';
import IndexManager from './IndexManager';
import {
  MIGRATION_META_KEY,
  type MigrationParams,
  type MigrationProgressDetails,
} from './migrate';

setDefaultTimeout(120_000);
const kit = await createTestKit('im5-migration');
const client = kit.client;

/** Every reindex task a test saw, so none is left running */
const seenTasks = new Set<string>();

afterAll(async () => {
  await releaseTasks([...seenTasks]);
  await kit.cleanup();
});

type Doc = { id: string; title: string; n?: number | string };

function docsCreate(label: string, nType: 'integer' | 'keyword' = 'integer') {
  return {
    index: label,
    mappings: {
      properties: {
        id: { type: 'keyword' },
        title: { type: 'keyword' },
        n: { type: nType },
      },
    },
  } as const;
}

function manager(
  label: string,
  version: number,
  nType: 'integer' | 'keyword' = 'integer',
) {
  return new IndexManager(
    { client, prefix: kit.prefix, version },
    docsCreate(label, nType),
  );
}

function makeDocs(count: number, title = 'old'): Doc[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    title: `${title} ${i}`,
    n: i,
  }));
}

async function seed(index: IndexManager, docs: Doc[]) {
  const created = await index.create();
  expect(created.success).toBe(true);
  if (docs.length === 0) {
    return;
  }
  const operations: object[] = [];
  for (const doc of docs) {
    operations.push({ index: { _index: index.getAliasName(), _id: doc.id } });
    operations.push(doc);
  }
  const res = await client.bulk({ operations, refresh: true });
  expect(res.errors).toBe(false);
}

async function aliasIndexes(index: IndexManager) {
  const meta = await index.getAliasMetadata();
  expect(meta.error).toBe(null);
  return [...meta.indexes].sort();
}

async function indexExists(name: string) {
  return client.indices.exists({ index: name });
}

/** Every document in `index` by `_id` (fails on duplicates) */
async function allDocs(index: string) {
  await client.indices.refresh({ index });
  const res = await client.search<Doc>({
    index,
    size: 1000,
    query: { match_all: {} },
  });
  const byId = new Map<string, Doc>();
  for (const hit of res.hits.hits) {
    expect(byId.has(hit._id as string)).toBe(false);
    byId.set(hit._id as string, hit._source as Doc);
  }
  return byId;
}

/**
 * Callbacks that record everything, plus the task ids seen (released in
 * `afterAll`)
 */
function track(extra: MigrationParams = {}) {
  const progress: MigrationProgressDetails[] = [];
  const completed: MigrationProgressDetails[] = [];
  const errors: Error[] = [];
  const params: MigrationParams = {
    pollInterval: 200,
    ...extra,
    onProgress: (details) => {
      progress.push(details);
      if (details.taskId) {
        seenTasks.add(details.taskId);
      }
    },
    onComplete: (details) => {
      completed.push(details);
    },
    onError: (error) => {
      errors.push(error);
    },
  };
  return { params, progress, completed, errors };
}

/** Wait until the first copy has processed at least `count` documents */
async function copiedAtLeast(
  progress: MigrationProgressDetails[],
  count: number,
) {
  await kit.waitFor(
    () =>
      progress.some((p) => p.phase === 'reindex' && p.done >= count) ||
      progress.some((p) => p.phase !== 'reindex'),
    { timeout: 30_000, message: `${count} documents copied` },
  );
}

async function isRunning(taskId: string) {
  const task = await client.tasks.get({ task_id: taskId });
  return !task.completed;
}

/**
 * Throttle that holds the first copy open: one document per batch, 5 s
 * between batches, so a 6-10 document copy would take 25-45 s. Tests act
 * mid-flight, then `release()` it, so they do not depend on timing.
 */
const HOLD: MigrationParams = { requestsPerSecond: 0.2, batchSize: 1 };

/** Let a held copy run at full speed */
async function release(taskId: string) {
  await client
    .reindexRethrottle({ task_id: taskId, requests_per_second: -1 })
    .catch(() => {});
}

/**
 * Whether the alias still points at `index` only. The swap is atomic and
 * one-way, so if this holds after a read, that read was served by `index`.
 */
async function stillOn(alias: IndexManager, index: IndexManager) {
  return (await aliasIndexes(alias)).join() === index.getFullName();
}

/** Whether a task's result can still be read (running or stored) */
async function taskResultExists(taskId: string) {
  try {
    await client.tasks.get({ task_id: taskId });
    return true;
  } catch (e) {
    if ((e as { meta?: { statusCode?: number } }).meta?.statusCode === 404) {
      return false;
    }
    throw e;
  }
}

/** Unthrottle (and where possible cancel) tasks, then wait for them */
async function releaseTasks(taskIds: string[]) {
  for (const taskId of taskIds) {
    try {
      await client.reindexRethrottle({
        task_id: taskId,
        requests_per_second: -1,
      });
    } catch {
      // finished already
    }
    try {
      await client.tasks.cancel({ task_id: taskId });
    } catch {
      // not available on serverless, or finished
    }
  }
  for (const taskId of taskIds) {
    await kit
      .waitFor(
        async () => {
          try {
            return (await client.tasks.get({ task_id: taskId })).completed;
          } catch {
            return true;
          }
        },
        { timeout: 30_000, message: `task ${taskId} to finish` },
      )
      .catch(() => {});
  }
}

describe('migrateIfNeeded() - Integration', () => {
  it('migrates v1 → v2: every document, alias on v2 only, v1 gone', async () => {
    const v1 = manager('basic', 1);
    const v2 = manager('basic', 2);
    await seed(v1, makeDocs(20));
    const { params, completed, errors, progress } = track();
    const result = await v2.migrateIfNeeded(params);
    expect(result).toMatchObject({
      success: true,
      code: 'MIGRATION_STARTED',
      oldNames: [v1.getFullName()],
      newName: v2.getFullName(),
      recordsToMigrate: 20,
      createdIndex: true,
      error: null,
    });
    const outcome = await result.completion;
    expect(outcome).toMatchObject({
      success: true,
      code: 'MIGRATED',
      swapped: true,
      removedIndexes: [v1.getFullName()],
      counts: { old: { [v1.getFullName()]: 20 }, new: 20 },
      error: null,
    });
    expect(outcome.passes[0]).toMatchObject({ total: 20, created: 20 });
    // the catch-up passes skip what is already there
    expect(outcome.passes[1]).toMatchObject({
      created: 0,
      versionConflicts: 20,
    });
    expect(await aliasIndexes(v2)).toEqual([v2.getFullName()]);
    expect(await indexExists(v1.getFullName())).toBe(false);
    const docs = await allDocs(v2.getAliasName());
    expect(docs.size).toBe(20);
    expect(docs.get('7')?.title).toBe('old 7');
    expect(completed).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(progress[progress.length - 1]).toMatchObject({
      percent: 100,
      phase: 'done',
      done: 20,
      total: 20,
    });
    // writes go to the new index
    const put = await v2.put('new', { id: 'new', title: 'after' });
    expect(put.error).toBe(null);
    // the task marker is gone from the mapping
    const mapping = await client.indices.getMapping({
      index: v2.getFullName(),
    });
    const meta = mapping[v2.getFullName()]?.mappings?._meta ?? {};
    expect(meta[MIGRATION_META_KEY]).toBeUndefined();
    // running again changes nothing
    const again = await v2.migrateIfNeeded({ pollInterval: 200 });
    expect(again.code).toBe('CURRENT');
    // stored task results are deleted where allowed (stateful); serverless
    // refuses the delete (403), which is ignored
    expect(outcome.taskIds).toHaveLength(3);
    for (const taskId of outcome.taskIds) {
      expect(await taskResultExists(taskId)).toBe(!kit.caps.tasksApi);
    }
  });

  it('keeps the old index and alias when the new mapping rejects documents (B-001)', async () => {
    const v1 = manager('rejects', 1, 'keyword');
    const v2 = manager('rejects', 2, 'integer');
    const docs = makeDocs(6);
    docs[3].n = 'not a number';
    await seed(v1, docs);
    const { params, completed, errors } = track();
    const result = await v2.migrateIfNeeded(params);
    expect(result.code).toBe('MIGRATION_STARTED');
    const outcome = await result.completion;
    expect(outcome).toMatchObject({
      success: false,
      code: 'REINDEX_FAILED',
      phase: 'reindex',
      swapped: false,
      errorKind: 'response',
    });
    expect(outcome.failures.length).toBeGreaterThan(0);
    expect(outcome.failures[0].cause.type).toBe('document_parsing_exception');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(outcome.error as Error);
    expect(completed).toEqual([]);
    // old index and alias untouched; the new index is left for inspection
    expect(await aliasIndexes(v1)).toEqual([v1.getFullName()]);
    expect((await allDocs(v1.getFullName())).size).toBe(6);
    expect(await indexExists(v2.getFullName())).toBe(true);
    const found = await v1.findById('3');
    expect(found.record?.n).toBe('not a number');
  });

  it('serves reads and accepts writes during a throttled copy (B-002, B-037, B-083)', async () => {
    const v1 = manager('during', 1);
    const v2 = manager('during', 2);
    await seed(v1, makeDocs(10));
    // B-083: writes while migrateIfNeeded() sets up must never fail
    let settingUp = true;
    let setupWrites = 0;
    const setupErrors: Error[] = [];
    const writer = (async () => {
      while (settingUp) {
        const id = `setup-${setupWrites++}`;
        const res = await v2.put(id, { id, title: 'setup' });
        if (res.error) {
          setupErrors.push(res.error);
        }
      }
    })();
    const { params, progress, errors } = track(HOLD);
    const result = await v2.migrateIfNeeded(params);
    settingUp = false;
    await writer;
    expect(result.code).toBe('MIGRATION_STARTED');
    expect(setupErrors).toEqual([]);
    const taskId = result.taskId as string;
    seenTasks.add(taskId);
    await copiedAtLeast(progress, 1);
    expect(await isRunning(taskId)).toBe(true);
    const expected = 10 + setupWrites;
    // make the setup writes searchable (they were sent without refresh)
    await client.indices.refresh({ index: v1.getFullName() });

    // B-037: reads see one copy of each document
    const byId = await v2.findById('9');
    expect(byId.error).toBe(null);
    expect(byId.record?.title).toBe('old 9');
    const many = await v2.findMany((qb) => qb.limit(100));
    expect(many.error).toBe(null);
    const ids = many.records.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(expected);
    expect((await v2.count()).total).toBe(expected);

    // B-002: writes land and survive the copy
    const [putLate, putEarly, patched, putNew] = await Promise.all([
      v2.put('9', { id: '9', title: 'put during 9' }),
      v2.put('0', { id: '0', title: 'put during 0' }),
      v2.patch('8', { title: 'patched during 8' }),
      v2.put('brand-new', { id: 'brand-new', title: 'new during' }),
    ]);
    expect(putLate.error).toBe(null);
    expect(putEarly.error).toBe(null);
    expect(patched.error).toBe(null);
    expect(patched.result).toBe('updated');
    expect(putNew.error).toBe(null);
    // the copy was still running and the alias not yet moved, so every
    // read and write above went to the old index
    expect(await isRunning(taskId)).toBe(true);
    expect(await stillOn(v2, v1)).toBe(true);

    await release(taskId);
    const outcome = await result.completion;
    expect(outcome).toMatchObject({ success: true, code: 'MIGRATED' });
    expect(errors).toEqual([]);
    const docs = await allDocs(v2.getAliasName());
    expect(docs.size).toBe(expected + 1);
    expect(docs.get('9')?.title).toBe('put during 9');
    expect(docs.get('0')?.title).toBe('put during 0');
    expect(docs.get('8')).toMatchObject({ title: 'patched during 8', n: 8 });
    expect(docs.get('brand-new')?.title).toBe('new during');
    expect(docs.get('setup-0')?.title).toBe('setup');
    expect(await aliasIndexes(v2)).toEqual([v2.getFullName()]);
  });

  it('brings back documents deleted during the copy (D2, known limitation)', async () => {
    const v1 = manager('deletes', 1);
    const v2 = manager('deletes', 2);
    await seed(v1, makeDocs(6));
    const { params, progress } = track(HOLD);
    const result = await v2.migrateIfNeeded(params);
    const taskId = result.taskId as string;
    seenTasks.add(taskId);
    await copiedAtLeast(progress, 1);
    expect(await isRunning(taskId)).toBe(true);
    // '0' is already copied; '5' is not yet
    const early = await v2.deleteById('0', { refresh: true });
    const late = await v2.deleteById('5', { refresh: true });
    expect(early.result).toBe('deleted');
    expect(late.result).toBe('deleted');
    const gone = await v2.findById('0');
    // the read went to the old index: the alias had not moved yet
    expect(await stillOn(v2, v1)).toBe(true);
    expect(gone.found).toBe(false);
    await release(taskId);
    const outcome = await result.completion;
    expect(outcome.code).toBe('MIGRATED');
    const docs = await allDocs(v2.getAliasName());
    // both reappear: there are no tombstones, and the first copy reads a
    // snapshot taken when it started
    expect(docs.has('0')).toBe(true);
    expect(docs.has('5')).toBe(true);
    expect(docs.size).toBe(6);
  });

  it('resumes when run a second time mid-flight: one copy of each document (B-010)', async () => {
    const v1 = manager('rerun', 1);
    await seed(v1, makeDocs(8));
    const first = track(HOLD);
    const runA = await manager('rerun', 2).migrateIfNeeded(first.params);
    expect(runA.code).toBe('MIGRATION_STARTED');
    seenTasks.add(runA.taskId as string);
    await copiedAtLeast(first.progress, 1);
    // a second process (another manager instance) boots meanwhile
    const second = track();
    const v2b = manager('rerun', 2);
    const runB = await v2b.migrateIfNeeded(second.params);
    expect(runB).toMatchObject({
      success: true,
      code: 'MIGRATION_RESUMED',
      resumed: true,
      createdIndex: false,
    });
    // found through the task recorded in the new index's mapping _meta
    expect(runB.attached).toBe(true);
    expect(runB.taskId).toBe(runA.taskId);
    await release(runA.taskId as string);
    const [outcomeA, outcomeB] = await Promise.all([
      runA.completion,
      runB.completion,
    ]);
    expect(outcomeA).toMatchObject({ success: true, code: 'MIGRATED' });
    expect(outcomeB).toMatchObject({ success: true, code: 'MIGRATED' });
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
    expect(await aliasIndexes(v2b)).toEqual([v2b.getFullName()]);
    expect(await indexExists(v1.getFullName())).toBe(false);
    const docs = await allDocs(v2b.getAliasName());
    expect([...docs.keys()].sort()).toEqual(
      ['0', '1', '2', '3', '4', '5', '6', '7'].sort(),
    );
  });

  it('refuses to migrate down: a v1 manager against an alias on v2 (B-008)', async () => {
    const v1 = manager('downgrade', 1);
    const v2 = manager('downgrade', 2);
    await seed(v2, makeDocs(3));
    const { params, completed, errors } = track();
    const result = await v1.migrateIfNeeded(params);
    expect(result).toMatchObject({
      success: false,
      code: 'NEWER_VERSION_PRESENT',
      error: null,
      createdIndex: false,
    });
    expect((await result.completion).code).toBe('NEWER_VERSION_PRESENT');
    expect(completed).toEqual([]);
    expect(errors).toEqual([]);
    expect(await indexExists(v1.getFullName())).toBe(false);
    expect(await aliasIndexes(v2)).toEqual([v2.getFullName()]);
    expect((await allDocs(v2.getFullName())).size).toBe(3);
  });

  it('refuses a version that cannot be ordered', async () => {
    const odd = new IndexManager(
      { client, prefix: kit.prefix, version: '2024a' },
      docsCreate('odd'),
    );
    const v3 = manager('odd', 3);
    await seed(odd, makeDocs(2));
    const result = await v3.migrateIfNeeded({ pollInterval: 200 });
    expect(result).toMatchObject({
      success: false,
      code: 'INCOMPARABLE_VERSION',
      error: null,
    });
    expect(await indexExists(v3.getFullName())).toBe(false);
    expect(await aliasIndexes(odd)).toEqual([odd.getFullName()]);
  });

  it('creates index and alias from scratch with success: true (B-009)', async () => {
    const v1 = manager('fresh', 1);
    const { params, completed } = track();
    const result = await v1.migrateIfNeeded(params);
    expect(result).toMatchObject({
      success: true,
      code: 'CREATED',
      createdIndex: true,
      createdAlias: true,
      error: null,
    });
    expect((await result.completion).success).toBe(true);
    expect(completed).toHaveLength(1);
    expect(await aliasIndexes(v1)).toEqual([v1.getFullName()]);
  });

  it('repairs an index without its alias (B-036)', async () => {
    const v1 = manager('noalias', 1);
    expect((await v1.createOnly()).error).toBe(null);
    const result = await v1.migrateIfNeeded({ pollInterval: 200 });
    expect(result).toMatchObject({
      success: true,
      code: 'ALIAS_CREATED',
      createdIndex: false,
      createdAlias: true,
    });
    expect(await aliasIndexes(v1)).toEqual([v1.getFullName()]);
    // a write through the alias reaches the versioned index
    const put = await v1.put('1', { id: '1', title: 'x' }, { refresh: true });
    expect(put.error).toBe(null);
    expect((await allDocs(v1.getFullName())).size).toBe(1);
  });

  it('migrates an empty old index and fires onComplete (B-082)', async () => {
    const v1 = manager('empty', 1);
    const v2 = manager('empty', 2);
    await seed(v1, []);
    const { params, completed, progress } = track();
    const result = await v2.migrateIfNeeded(params);
    expect(result).toMatchObject({
      code: 'MIGRATION_STARTED',
      recordsToMigrate: 0,
    });
    const outcome = await result.completion;
    expect(outcome).toMatchObject({ success: true, code: 'MIGRATED' });
    expect(completed).toHaveLength(1);
    for (const details of progress) {
      expect(Number.isNaN(details.percent)).toBe(false);
    }
    expect(await aliasIndexes(v2)).toEqual([v2.getFullName()]);
    expect(await indexExists(v1.getFullName())).toBe(false);
  });

  it('leaves a consistent, resumable state when the timeout expires (B-032)', async () => {
    const v1 = manager('timeout', 1);
    const v2 = manager('timeout', 2);
    await seed(v1, makeDocs(10));
    const { params, errors, completed } = track({
      requestsPerSecond: 1,
      batchSize: 1,
      timeout: 2_500,
    });
    const result = await v2.migrateIfNeeded(params);
    const taskId = result.taskId as string;
    seenTasks.add(taskId);
    const outcome = await result.completion;
    expect(outcome).toMatchObject({
      success: false,
      code: 'TIMEOUT',
      phase: 'reindex',
      errorKind: 'timeout',
      swapped: false,
    });
    // cancelling is not available on serverless
    expect(outcome.cancelled).toBe(kit.caps.tasksApi);
    if (kit.caps.tasksApi) {
      // the cancelled task ends with `canceled` in its stored result
      const ended = await kit.waitFor(
        async () => {
          const task = await client.tasks.get({ task_id: taskId });
          return task.completed ? task : null;
        },
        { timeout: 30_000, message: 'the cancelled task to end' },
      );
      expect(ended?.response?.canceled).toBe('by user request');
    }
    expect(errors).toHaveLength(1);
    expect(completed).toEqual([]);
    // reads and writes still use the old index
    expect(await aliasIndexes(v1)).toEqual([v1.getFullName()]);
    expect((await v1.findById('4')).record?.title).toBe('old 4');
    expect((await allDocs(v1.getFullName())).size).toBe(10);
    expect(await indexExists(v2.getFullName())).toBe(true);

    // let a still-running copy finish quickly, then resume
    await client
      .reindexRethrottle({ task_id: taskId, requests_per_second: -1 })
      .catch(() => {});
    const resumed = await v2.migrateIfNeeded({ pollInterval: 200 });
    expect(resumed).toMatchObject({
      success: true,
      code: 'MIGRATION_RESUMED',
      resumed: true,
    });
    if (kit.caps.tasksApi) {
      // the cancelled task is not attached to; a new copy starts
      expect(resumed.attached).toBe(false);
      expect(resumed.taskId).not.toBe(taskId);
    }
    if (resumed.taskId) {
      seenTasks.add(resumed.taskId);
    }
    const final = await resumed.completion;
    expect(final).toMatchObject({ success: true, code: 'MIGRATED' });
    const docs = await allDocs(v2.getAliasName());
    expect(docs.size).toBe(10);
    expect(await aliasIndexes(v2)).toEqual([v2.getFullName()]);
  });
});

describe('migrateIfNeeded() - stateful task API', () => {
  kit.testIf('tasksApi')(
    'attaches to a running copy found in the tasks list (no marker)',
    async () => {
      const v1 = manager('listed', 1);
      const v2 = manager('listed', 2);
      await seed(v1, makeDocs(6));
      expect((await v2.createOnly()).error).toBe(null);
      // a copy started elsewhere: no task marker in the mapping _meta
      const started = await client.reindex({
        wait_for_completion: false,
        conflicts: 'proceed',
        requests_per_second: 0.2,
        source: { index: v1.getFullName(), size: 1 },
        dest: { index: v2.getFullName(), version_type: 'external' },
      });
      const taskId = String(started.task);
      seenTasks.add(taskId);
      const { params, errors } = track();
      const result = await v2.migrateIfNeeded(params);
      expect(result).toMatchObject({
        success: true,
        code: 'MIGRATION_RESUMED',
        resumed: true,
        attached: true,
        taskId,
        request: null,
      });
      await release(taskId);
      const outcome = await result.completion;
      expect(outcome).toMatchObject({ success: true, code: 'MIGRATED' });
      expect(outcome.taskIds[0]).toBe(taskId);
      expect(errors).toEqual([]);
      // only the two catch-up passes were started by this run
      expect(outcome.passes.map((pass) => pass.phase)).toEqual([
        'reindex',
        'catchUp',
        'finalCatchUp',
      ]);
      expect((await allDocs(v2.getAliasName())).size).toBe(6);
      expect(await aliasIndexes(v2)).toEqual([v2.getFullName()]);
    },
  );
});

describe('migrateIfNeeded() - task API on this target', () => {
  it('reads reindex tasks; lists and cancels them only on stateful', async () => {
    const source = await kit.makeIndex(docsCreate('probe'), makeDocs(3));
    const dest = await kit.makeIndex(docsCreate('probe'));
    const started = await client.reindex({
      wait_for_completion: false,
      requests_per_second: 1,
      source: { index: source, size: 1 },
      dest: { index: dest, version_type: 'external' },
    });
    const taskId = String(started.task);
    seenTasks.add(taskId);
    const task = await client.tasks.get({ task_id: taskId });
    expect(task.task.description).toBe(`reindex from [${source}] to [${dest}]`);
    let listed: estypes.TasksListResponse | null = null;
    try {
      listed = await client.tasks.list({
        actions: '*reindex',
        detailed: true,
        group_by: 'none',
      });
    } catch {
      listed = null;
    }
    expect(listed !== null).toBe(kit.caps.tasksApi);
    await releaseTasks([taskId]);
  });
});
