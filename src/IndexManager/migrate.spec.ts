import { describe, expect, it } from 'bun:test';
import {
  connectionError,
  getRecordingClient,
  responseError,
  type SentRequest,
} from '../testFixtures/recordingClient';
import IndexManager from './IndexManager';
import {
  findReindexInto,
  MIGRATION_META_KEY,
  type MigrationParams,
  type MigrationProgressDetails,
} from './migrate';

const V1 = 'test~english~books~v1';
const V2 = 'test~english~books~v2';
const V3 = 'test~english~books~v3';
const ALIAS = 'test~english~books';

type TaskState = {
  completed: boolean;
  total?: number;
  created?: number;
  failures?: unknown[];
  error?: { type: string; reason: string };
  canceled?: string;
};

function aliasBody(indexes: string[]) {
  const body: Record<string, unknown> = {};
  for (const name of indexes) {
    body[name] = { aliases: { [ALIAS]: {} } };
  }
  return body;
}

function taskBody(state: TaskState) {
  const stats = {
    total: state.total ?? 3,
    created: state.created ?? state.total ?? 3,
    updated: 0,
    deleted: 0,
    version_conflicts: 0,
    noops: 0,
  };
  const body: Record<string, unknown> = {
    completed: state.completed,
    task: { node: 'n', id: 1, status: stats },
  };
  if (state.completed) {
    body.response = {
      ...stats,
      timed_out: false,
      failures: state.failures ?? [],
    };
    if (state.canceled) {
      (body.response as Record<string, unknown>).canceled = state.canceled;
    }
  }
  if (state.error) {
    body.error = state.error;
  }
  return body;
}

/** Poll a condition without fixed sleeps (unit tests have no kit) */
async function kitlessWait(probe: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!probe()) {
    if (Date.now() > deadline) {
      throw new Error('kitlessWait timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function decodedPath(req: SentRequest) {
  return decodeURIComponent(req.path);
}

/**
 * A recording client scripted for a v1 → v2 migration that succeeds:
 * the alias is on v1 (3 docs), v2 does not exist, every reindex task is
 * complete on its first check, counts match.
 */
function scenario(
  options: { aliasIndexes?: string[]; indexExists?: boolean } = {},
) {
  const rec = getRecordingClient();
  const { script } = rec;
  const aliasIndexes = options.aliasIndexes ?? [V1];
  script(`HEAD /${V2}`, { status: options.indexExists ? 200 : 404 });
  if (aliasIndexes.length === 0) {
    script(`GET /_alias/${ALIAS}`, {
      status: 404,
      body: { error: `alias [${ALIAS}] missing`, status: 404 },
    });
  } else {
    script(`GET /_alias/${ALIAS}`, { body: aliasBody(aliasIndexes) });
  }
  script(/_count$/, { body: { count: 3 } });
  script(`PUT /${V2}`, {
    body: { acknowledged: true, shards_acknowledged: true, index: V2 },
  });
  script(
    'POST /_reindex',
    { body: { task: 'n:1' } },
    { body: { task: 'n:2' } },
    { body: { task: 'n:3' } },
  );
  script('GET /_tasks/*', { body: taskBody({ completed: true }) });
  script('POST /_aliases', { body: { acknowledged: true } });
  script(`DELETE /${V1}`, { body: { acknowledged: true } });
  const manager = new IndexManager(
    { client: rec.client, prefix: 'test', version: 2 },
    {
      index: 'books',
      mappings: { _meta: { owner: 'me' }, properties: { t: { type: 'text' } } },
    },
  );
  return { ...rec, manager };
}

function recorder() {
  const events: string[] = [];
  const progress: MigrationProgressDetails[] = [];
  const errors: Error[] = [];
  const params: MigrationParams = {
    pollInterval: 10,
    onProgress: (details) => {
      progress.push(details);
    },
    onComplete: (details) => {
      events.push(`complete ${details.oldIndex}`);
    },
    onError: (error) => {
      errors.push(error);
      events.push('error');
    },
  };
  return { events, progress, errors, params };
}

function writes(sent: SentRequest[]) {
  return sent
    .filter((req) => req.method !== 'GET' && req.method !== 'HEAD')
    .filter((req) => !req.path.endsWith('/_count'))
    .map((req) => `${req.method} ${decodedPath(req)}`);
}

describe('migrateIfNeeded() - decisions before any change', () => {
  it('aborts on a failed status check (B-035) and calls onError', async () => {
    const { manager, script, sent } = scenario();
    script(`GET /_alias/${ALIAS}`, connectionError());
    const { params, errors } = recorder();
    const result = await manager.migrateIfNeeded(params);
    expect(result).toMatchObject({
      success: false,
      code: 'STATUS_ERROR',
      errorKind: 'connection',
    });
    expect(writes(sent)).toEqual([]);
    expect(errors).toHaveLength(1);
    const outcome = await result.completion;
    expect(outcome).toMatchObject({ success: false, code: 'STATUS_ERROR' });
  });

  it('refuses to migrate down from a newer version (B-008)', async () => {
    const { manager, sent } = scenario({ aliasIndexes: [V3] });
    const { params, errors, events } = recorder();
    const result = await manager.migrateIfNeeded(params);
    expect(result).toMatchObject({
      success: false,
      code: 'NEWER_VERSION_PRESENT',
      error: null,
      errorKind: null,
    });
    expect(writes(sent)).toEqual([]);
    expect(errors).toEqual([]);
    expect(events).toEqual([]);
    expect((await result.completion).code).toBe('NEWER_VERSION_PRESENT');
  });

  it('refuses a newer version even when an older one is also present', async () => {
    const { manager, sent } = scenario({ aliasIndexes: [V1, V3] });
    const result = await manager.migrateIfNeeded({ pollInterval: 10 });
    expect(result.code).toBe('NEWER_VERSION_PRESENT');
    expect(writes(sent)).toEqual([]);
  });

  it('refuses a version that cannot be ordered', async () => {
    const { manager, sent } = scenario({
      aliasIndexes: ['test~english~books~v2024a'],
    });
    const result = await manager.migrateIfNeeded({ pollInterval: 10 });
    expect(result).toMatchObject({
      success: false,
      code: 'INCOMPARABLE_VERSION',
      error: null,
    });
    expect(writes(sent)).toEqual([]);
  });

  it('refuses when the alias holds only unrelated indexes', async () => {
    const { manager, sent } = scenario({ aliasIndexes: ['other-index'] });
    const result = await manager.migrateIfNeeded({ pollInterval: 10 });
    expect(result).toMatchObject({ success: false, code: 'ALIAS_CONFLICT' });
    expect(writes(sent)).toEqual([]);
  });

  it('creates index and alias from scratch with success: true (B-009)', async () => {
    const { manager, sent } = scenario({ aliasIndexes: [] });
    const { params, events, errors } = recorder();
    const result = await manager.migrateIfNeeded(params);
    expect(result).toMatchObject({
      success: true,
      code: 'CREATED',
      createdIndex: true,
      createdAlias: true,
      error: null,
      errorKind: null,
    });
    expect(writes(sent)).toEqual([`PUT /${V2}`, `PUT /${V2}/_alias/${ALIAS}`]);
    expect(events).toEqual(['complete ']);
    expect(errors).toEqual([]);
    expect(await result.completion).toMatchObject({
      success: true,
      code: 'CREATED',
      phase: 'done',
    });
  });

  it('still adds the alias when another process created the index first', async () => {
    const { manager, script, sent } = scenario({ aliasIndexes: [] });
    script(
      `PUT /${V2}`,
      responseError(400, 'resource_already_exists_exception'),
    );
    const result = await manager.migrateIfNeeded({ pollInterval: 10 });
    expect(result).toMatchObject({
      success: true,
      code: 'ALIAS_CREATED',
      createdIndex: false,
    });
    expect(writes(sent)).toContain(`PUT /${V2}/_alias/${ALIAS}`);
  });

  it('reports CREATE_ERROR and ALIAS_ERROR', async () => {
    const a = scenario({ aliasIndexes: [] });
    a.script(`PUT /${V2}`, responseError(400, 'illegal_argument_exception'));
    const created = await a.manager.migrateIfNeeded({ pollInterval: 10 });
    expect(created).toMatchObject({
      success: false,
      code: 'CREATE_ERROR',
      errorKind: 'response',
    });
    const b = scenario({ aliasIndexes: [] });
    b.script(`PUT /${V2}/_alias/${ALIAS}`, connectionError());
    const aliased = await b.manager.migrateIfNeeded({ pollInterval: 10 });
    expect(aliased).toMatchObject({
      success: false,
      code: 'ALIAS_ERROR',
      errorKind: 'connection',
    });
    expect((await aliased.completion).success).toBe(false);
  });

  it('adds the missing alias to an existing index (B-036)', async () => {
    const { manager, sent } = scenario({ aliasIndexes: [], indexExists: true });
    const { params, events } = recorder();
    const result = await manager.migrateIfNeeded(params);
    expect(result).toMatchObject({
      success: true,
      code: 'ALIAS_CREATED',
      createdIndex: false,
      createdAlias: true,
    });
    expect(writes(sent)).toEqual([`PUT /${V2}/_alias/${ALIAS}`]);
    expect(events).toEqual(['complete ']);
  });

  it('sends nothing when already current', async () => {
    const { manager, sent } = scenario({
      aliasIndexes: [V2],
      indexExists: true,
    });
    const { params, events } = recorder();
    const result = await manager.migrateIfNeeded(params);
    expect(result).toMatchObject({ success: true, code: 'CURRENT' });
    expect(writes(sent)).toEqual([]);
    expect(events).toEqual([]);
  });

  it('never rejects, even if getStatus() throws', async () => {
    const { manager } = scenario();
    manager.getStatus = () => {
      throw new Error('boom');
    };
    const result = await manager.migrateIfNeeded({ pollInterval: 10 });
    expect(result).toMatchObject({ success: false, code: 'STATUS_ERROR' });
    expect(result.error?.message).toBe('boom');
  });
});

describe('migrateIfNeeded() - the migration flow (D1)', () => {
  it('copies, catches up, swaps atomically, catches up, verifies, removes', async () => {
    const { manager, sent } = scenario();
    const { params, events, errors, progress } = recorder();
    const result = await manager.migrateIfNeeded(params);
    expect(result).toMatchObject({
      success: true,
      code: 'MIGRATION_STARTED',
      oldNames: [V1],
      newName: V2,
      recordsToMigrate: 3,
      createdIndex: true,
      createdAlias: false,
      resumed: false,
      attached: false,
      taskId: 'n:1',
      error: null,
    });
    const outcome = await result.completion;
    expect(outcome).toMatchObject({
      success: true,
      code: 'MIGRATED',
      phase: 'done',
      swapped: true,
      removedIndexes: [V1],
      taskIds: ['n:1', 'n:2', 'n:3'],
      counts: { old: { [V1]: 3 }, new: 3 },
      error: null,
    });
    expect(outcome.passes.map((pass) => pass.phase)).toEqual([
      'reindex',
      'catchUp',
      'finalCatchUp',
    ]);
    expect(writes(sent)).toEqual([
      `PUT /${V2}`,
      'POST /_reindex',
      `PUT /${V2}/_mapping`,
      'POST /_reindex',
      'POST /_aliases',
      'POST /_reindex',
      `DELETE /${V1}`,
      'DELETE /.tasks/_doc/n:1',
      'DELETE /.tasks/_doc/n:2',
      'DELETE /.tasks/_doc/n:3',
      `PUT /${V2}/_mapping`,
    ]);
    expect(sent.map((req) => decodedPath(req))).toContain(`/${V1}/_refresh`);
    expect(events).toEqual([`complete ${V1}`]);
    expect(errors).toEqual([]);
    const last = progress[progress.length - 1];
    expect(last).toMatchObject({
      percent: 100,
      phase: 'done',
      done: 3,
      total: 3,
      oldIndex: V1,
    });
    // percent 100 appears only in the final event
    expect(progress.filter((p) => p.percent === 100)).toHaveLength(1);
  });

  it('creates the new index without the alias (no window without a write index, B-083)', async () => {
    const { manager, sent } = scenario();
    await (await manager.migrateIfNeeded({ pollInterval: 10 })).completion;
    const create = sent.find(
      (req) => req.method === 'PUT' && req.path === `/${V2}`,
    );
    expect(JSON.stringify(create?.body)).not.toContain(ALIAS);
    // the alias changes exactly once: no put-alias, one atomic update
    const aliasWrites = sent.filter((req) => req.path.includes('/_alias/'));
    expect(aliasWrites.filter((req) => req.method !== 'GET')).toEqual([]);
    expect(sent.filter((req) => req.path === '/_aliases')).toHaveLength(1);
  });

  it('reindexes with external versions, proceed on conflicts, in the background (B-002)', async () => {
    const { manager, sent } = scenario();
    await (
      await manager.migrateIfNeeded({
        pollInterval: 10,
        slices: 2,
        requestsPerSecond: 5,
        batchSize: 50,
      })
    ).completion;
    const reindexes = sent.filter((req) => req.path === '/_reindex');
    expect(reindexes).toHaveLength(3);
    for (const req of reindexes) {
      expect(req.body).toEqual({
        conflicts: 'proceed',
        source: { index: [V1], size: 50 },
        dest: { index: V2, version_type: 'external' },
      });
      const query = new URLSearchParams(req.querystring);
      expect(query.get('wait_for_completion')).toBe('false');
      expect(query.get('refresh')).toBe('true');
      expect(query.get('slices')).toBe('2');
    }
    // only the first copy is throttled
    const throttle = reindexes.map((req) =>
      new URLSearchParams(req.querystring).get('requests_per_second'),
    );
    expect(throttle).toEqual(['5', null, null]);
  });

  it('refreshes the old index once, right before the final pass', async () => {
    const { manager, sent } = scenario();
    await (await manager.migrateIfNeeded({ pollInterval: 10 })).completion;
    const paths = sent.map((req) => decodedPath(req));
    const refreshes = paths.filter((path) => path.endsWith('/_refresh'));
    expect(refreshes).toEqual([`/${V1}/_refresh`]);
    const passes = paths
      .map((path, i) => (path === '/_reindex' ? i : -1))
      .filter((i) => i >= 0);
    expect(passes).toHaveLength(3);
    // after the swap, immediately before the final pass
    expect(paths[passes[2] - 1]).toBe(`/${V1}/_refresh`);
    expect(paths.indexOf('/_aliases')).toBeLessThan(passes[2]);
  });

  it('keeps the old index when it cannot be refreshed for the final pass', async () => {
    const { manager, script, sent } = scenario();
    script(`/${V1}/_refresh`, connectionError());
    const outcome = await (await manager.migrateIfNeeded({ pollInterval: 10 }))
      .completion;
    expect(outcome).toMatchObject({
      success: false,
      code: 'REINDEX_ERROR',
      phase: 'finalCatchUp',
      swapped: true,
    });
    expect(sent.filter((req) => req.path === '/_reindex')).toHaveLength(2);
    expect(writes(sent)).not.toContain(`DELETE /${V1}`);
  });

  it('checks the first status quickly, then backs off to pollInterval', async () => {
    const { manager, script, sent } = scenario();
    const times: number[] = [];
    script('GET /_tasks/*', () => {
      times.push(performance.now());
      const done = times.length >= 4;
      return { body: taskBody({ completed: done }) };
    });
    const start = performance.now();
    await manager.migrateIfNeeded({ pollInterval: 1000 });
    await kitlessWait(() => times.length >= 4);
    const gaps = times.map((t, i) => t - (i === 0 ? start : times[i - 1]));
    // 100, 200, 400, 800 ms (with slack), not 1000 ms each
    expect(gaps[0]).toBeLessThan(400);
    expect(gaps[1]).toBeLessThan(600);
    expect(times[3] - start).toBeLessThan(2500);
    expect(sent.length).toBeGreaterThan(0);
  });

  it('swaps in one updateAliases: remove old (must exist), add new as write index', async () => {
    const { manager, sent } = scenario();
    await (await manager.migrateIfNeeded({ pollInterval: 10 })).completion;
    const swap = sent.find((req) => req.path === '/_aliases');
    expect(swap?.body).toEqual({
      actions: [
        { remove: { index: V1, alias: ALIAS, must_exist: true } },
        { add: { index: V2, alias: ALIAS, is_write_index: true } },
      ],
    });
  });

  it('fetches the alias once (S-041)', async () => {
    const { manager, sent } = scenario();
    await (await manager.migrateIfNeeded({ pollInterval: 10 })).completion;
    const lookups = sent.filter((req) => req.path.startsWith('/_alias/'));
    expect(lookups).toHaveLength(1);
  });

  it('records the task in the mapping _meta, then restores the _meta', async () => {
    const { manager, sent } = scenario();
    await (await manager.migrateIfNeeded({ pollInterval: 10 })).completion;
    const mappings = sent.filter((req) => req.path === `/${V2}/_mapping`);
    expect(mappings).toHaveLength(2);
    expect(mappings[0].body).toMatchObject({
      _meta: {
        owner: 'me',
        [MIGRATION_META_KEY]: { taskId: 'n:1', from: [V1] },
      },
    });
    expect(mappings[1].body).toEqual({ _meta: { owner: 'me' } });
  });

  it('migrates every older version at once and leaves unrelated indexes alone', async () => {
    const V0 = 'test~english~books~v0';
    const { manager, sent, script } = scenario({
      aliasIndexes: [V1, 'other-index', V0],
    });
    // 1 + 2 documents; every pass reads both (total 3)
    script(/_count$/, (req) => {
      const path = decodedPath(req);
      if (path === `/${V0}/_count`) {
        return { body: { count: 1 } };
      }
      if (path === `/${V1}/_count`) {
        return { body: { count: 2 } };
      }
      return { body: { count: 3 } };
    });
    const result = await manager.migrateIfNeeded({ pollInterval: 10 });
    expect(result.oldNames).toEqual([V0, V1]);
    const outcome = await result.completion;
    expect(outcome.removedIndexes).toEqual([V0, V1]);
    const reindex = sent.find((req) => req.path === '/_reindex');
    expect(reindex?.body).toMatchObject({ source: { index: [V0, V1] } });
    const swap = sent.find((req) => req.path === '/_aliases');
    expect(JSON.stringify(swap?.body)).not.toContain('other-index');
    expect(writes(sent)).not.toContain('DELETE /other-index');
  });

  it('fires onComplete for an empty old index (B-082)', async () => {
    const { manager, script } = scenario();
    script(/_count$/, { body: { count: 0 } });
    script('GET /_tasks/*', {
      body: taskBody({ completed: true, total: 0, created: 0 }),
    });
    const { params, events, progress } = recorder();
    const result = await manager.migrateIfNeeded(params);
    expect(result.recordsToMigrate).toBe(0);
    const outcome = await result.completion;
    expect(outcome.code).toBe('MIGRATED');
    expect(events).toEqual([`complete ${V1}`]);
    for (const details of progress) {
      expect(Number.isNaN(details.percent)).toBe(false);
    }
  });

  it('reports percent 0, never NaN, while total is 0 (B-084)', async () => {
    const { manager, script } = scenario();
    script(
      'GET /_tasks/*',
      { body: taskBody({ completed: false, total: 0, created: 0 }) },
      { body: taskBody({ completed: false, total: 4, created: 2 }) },
      { body: taskBody({ completed: true }) },
    );
    const { params, progress } = recorder();
    await (await manager.migrateIfNeeded(params)).completion;
    const running = progress.filter((p) => p.phase === 'reindex');
    expect(running[0]).toMatchObject({ percent: 0, total: 0, done: 0 });
    expect(running[1]).toMatchObject({ percent: 50, total: 4, done: 2 });
  });

  it('keeps going when a callback throws', async () => {
    const { manager } = scenario();
    const result = await manager.migrateIfNeeded({
      pollInterval: 10,
      onProgress: () => {
        throw new Error('callback bug');
      },
      onComplete: () => {
        throw new Error('callback bug');
      },
    });
    expect((await result.completion).code).toBe('MIGRATED');
  });
});

describe('migrateIfNeeded() - failures keep the old index (B-001)', () => {
  function expectOldUntouched(sent: SentRequest[]) {
    const paths = writes(sent);
    expect(paths).not.toContain('POST /_aliases');
    expect(paths).not.toContain(`DELETE /${V1}`);
    expect(paths.filter((p) => p.startsWith('DELETE'))).toEqual([]);
  }

  it('stops on bulk failures: onError, no swap, no delete', async () => {
    const { manager, script, sent } = scenario();
    const failure = {
      index: V2,
      id: '7',
      status: 400,
      cause: { type: 'mapper_parsing_exception', reason: 'failed to parse' },
    };
    script('GET /_tasks/*', {
      body: taskBody({ completed: true, created: 2, failures: [failure] }),
    });
    const { params, events, errors } = recorder();
    const result = await manager.migrateIfNeeded(params);
    const outcome = await result.completion;
    expect(outcome).toMatchObject({
      success: false,
      code: 'REINDEX_FAILED',
      phase: 'reindex',
      swapped: false,
      errorKind: 'response',
      failures: [failure],
    });
    expect(outcome.error).toBeInstanceOf(AggregateError);
    expect(outcome.error?.message).toContain('failed to parse');
    expect(errors).toHaveLength(1);
    expect(events).toEqual(['error']);
    expectOldUntouched(sent);
    // only the first pass ran
    expect(sent.filter((req) => req.path === '/_reindex')).toHaveLength(1);
  });

  it('stops on a task error', async () => {
    const { manager, script, sent } = scenario();
    script('GET /_tasks/*', {
      body: taskBody({
        completed: true,
        error: { type: 'task_cancelled_exception', reason: 'cancelled' },
      }),
    });
    const outcome = await (await manager.migrateIfNeeded({ pollInterval: 10 }))
      .completion;
    expect(outcome).toMatchObject({ success: false, code: 'REINDEX_FAILED' });
    expect(outcome.error?.message).toContain('cancelled');
    expectOldUntouched(sent);
  });

  it('stops when the task was cancelled', async () => {
    const { manager, script, sent } = scenario();
    script('GET /_tasks/*', {
      body: taskBody({ completed: true, canceled: 'by user request' }),
    });
    const outcome = await (await manager.migrateIfNeeded({ pollInterval: 10 }))
      .completion;
    expect(outcome.code).toBe('REINDEX_FAILED');
    expect(outcome.error?.message).toContain('by user request');
    expectOldUntouched(sent);
  });

  it('stops when a catch-up pass fails', async () => {
    const { manager, script, sent } = scenario();
    script(
      'POST /_reindex',
      { body: { task: 'n:1' } },
      responseError(503, 'unavailable_shards_exception'),
    );
    const outcome = await (await manager.migrateIfNeeded({ pollInterval: 10 }))
      .completion;
    expect(outcome).toMatchObject({
      success: false,
      code: 'REINDEX_ERROR',
      phase: 'catchUp',
    });
    expectOldUntouched(sent);
  });

  it('reports REINDEX_ERROR when the first copy cannot start', async () => {
    const { manager, script } = scenario();
    script('POST /_reindex', responseError(400, 'illegal_argument_exception'));
    const { params, errors } = recorder();
    const result = await manager.migrateIfNeeded(params);
    expect(result).toMatchObject({ success: false, code: 'REINDEX_ERROR' });
    expect(errors).toHaveLength(1);
  });

  it('reports COUNT_ERROR before creating anything', async () => {
    const { manager, script, sent } = scenario();
    script(/_count$/, connectionError());
    const result = await manager.migrateIfNeeded({ pollInterval: 10 });
    expect(result).toMatchObject({ success: false, code: 'COUNT_ERROR' });
    expect(writes(sent)).toEqual([]);
  });

  it('keeps the old index when the swap fails', async () => {
    const { manager, script, sent } = scenario();
    script('POST /_aliases', responseError(500, 'exception'));
    const outcome = await (await manager.migrateIfNeeded({ pollInterval: 10 }))
      .completion;
    expect(outcome).toMatchObject({
      success: false,
      code: 'SWAP_ERROR',
      phase: 'swap',
      swapped: false,
    });
    expect(writes(sent)).not.toContain(`DELETE /${V1}`);
  });

  it('carries on when another run swapped first', async () => {
    const { manager, script } = scenario();
    script('POST /_aliases', responseError(404, 'aliases_not_found_exception'));
    script(
      `GET /_alias/${ALIAS}`,
      { body: aliasBody([V1]) },
      { body: aliasBody([V2]) },
    );
    const outcome = await (await manager.migrateIfNeeded({ pollInterval: 10 }))
      .completion;
    expect(outcome).toMatchObject({ success: true, code: 'MIGRATED' });
  });

  it('succeeds when another run already removed the old index', async () => {
    const { manager, script, sent } = scenario();
    script(
      'POST /_reindex',
      { body: { task: 'n:1' } },
      { body: { task: 'n:2' } },
      responseError(404, 'index_not_found_exception'),
    );
    script(`HEAD /${V1}`, { status: 404 });
    script(
      `GET /_alias/${ALIAS}`,
      { body: aliasBody([V1]) },
      { body: aliasBody([V2]) },
    );
    const outcome = await (await manager.migrateIfNeeded({ pollInterval: 10 }))
      .completion;
    expect(outcome).toMatchObject({
      success: true,
      code: 'MIGRATED',
      removedIndexes: [],
    });
    expect(writes(sent)).not.toContain(`DELETE /${V1}`);
  });

  it('succeeds when another run removed the old index during verify', async () => {
    const { manager, script } = scenario();
    let counts = 0;
    script(/_count$/, () => {
      counts++;
      // the first count is before the copy; the old one is gone at verify
      if (counts > 2) {
        return responseError(404, 'index_not_found_exception');
      }
      return { body: { count: 3 } };
    });
    script(`HEAD /${V1}`, { status: 404 });
    script(
      `GET /_alias/${ALIAS}`,
      { body: aliasBody([V1]) },
      { body: aliasBody([V2]) },
    );
    const outcome = await (await manager.migrateIfNeeded({ pollInterval: 10 }))
      .completion;
    expect(outcome).toMatchObject({ success: true, code: 'MIGRATED' });
  });

  it('keeps the old index when the final pass did not read every document', async () => {
    const { manager, script, sent } = scenario();
    let counts = 0;
    script(/_count$/, () => {
      counts++;
      // 3 before the copy; at verify the old index holds 4, the pass read 3
      return { body: { count: counts === 1 ? 3 : 4 } };
    });
    const { params, errors, events } = recorder();
    const outcome = await (await manager.migrateIfNeeded(params)).completion;
    expect(outcome).toMatchObject({
      success: false,
      code: 'VERIFY_FAILED',
      phase: 'verify',
      swapped: true,
      counts: { old: { [V1]: 4 }, new: 4 },
    });
    expect(outcome.error?.message).toContain('read 3 documents');
    expect(errors).toHaveLength(1);
    expect(events).toEqual(['error']);
    expect(writes(sent)).not.toContain(`DELETE /${V1}`);
  });
});

describe('migrateIfNeeded() - polling, timeout, cleanup (B-032)', () => {
  it('retries failed status checks with backoff', async () => {
    const { manager, script } = scenario();
    script(
      'GET /_tasks/*',
      connectionError(),
      responseError(503, 'unavailable'),
      { body: taskBody({ completed: true }) },
    );
    const outcome = await (
      await manager.migrateIfNeeded({ pollInterval: 10, maxPollErrors: 3 })
    ).completion;
    expect(outcome.code).toBe('MIGRATED');
  });

  it('gives up after maxPollErrors failed checks in a row, alias untouched', async () => {
    const { manager, script, sent } = scenario();
    script('GET /_tasks/*', connectionError());
    const { params, errors } = recorder();
    const outcome = await (
      await manager.migrateIfNeeded({ ...params, maxPollErrors: 3 })
    ).completion;
    expect(outcome).toMatchObject({
      success: false,
      code: 'POLL_ERROR',
      phase: 'reindex',
      errorKind: 'connection',
      swapped: false,
    });
    expect(outcome.error?.message).toContain('3 times in a row');
    expect(errors).toHaveLength(1);
    expect(sent.filter((req) => req.path.startsWith('/_tasks/'))).toHaveLength(
      3,
    );
    expect(writes(sent)).not.toContain('POST /_aliases');
  });

  it('times out, cancels the task, leaves the alias on the old index', async () => {
    const { manager, script, sent } = scenario();
    script('GET /_tasks/*', { body: taskBody({ completed: false }) });
    script('POST /_tasks/*/_cancel', { body: { nodes: {} } });
    const { params, errors } = recorder();
    const outcome = await (
      await manager.migrateIfNeeded({ ...params, timeout: 80 })
    ).completion;
    expect(outcome).toMatchObject({
      success: false,
      code: 'TIMEOUT',
      errorKind: 'timeout',
      cancelled: true,
      swapped: false,
    });
    expect(outcome.error?.name).toBe('MigrationTimeoutError');
    expect(errors).toHaveLength(1);
    expect(writes(sent)).toContain('POST /_tasks/n:1/_cancel');
    expect(writes(sent)).not.toContain('POST /_aliases');
  });

  it('times out cleanly where cancel is unavailable (serverless)', async () => {
    const { manager, script } = scenario();
    script('GET /_tasks/*', { body: taskBody({ completed: false }) });
    script(
      'POST /_tasks/*/_cancel',
      responseError(410, 'api_not_available_exception'),
    );
    const outcome = await (
      await manager.migrateIfNeeded({ pollInterval: 10, timeout: 50 })
    ).completion;
    expect(outcome).toMatchObject({ code: 'TIMEOUT', cancelled: false });
  });

  it('swallows a failed task-result delete', async () => {
    const { manager, script } = scenario();
    script('DELETE /.tasks/*', responseError(403, 'security_exception'));
    const outcome = await (await manager.migrateIfNeeded({ pollInterval: 10 }))
      .completion;
    expect(outcome).toMatchObject({
      success: true,
      code: 'MIGRATED',
      cleanupErrors: [],
    });
  });

  it('reports an old index that could not be deleted, still migrated', async () => {
    const { manager, script } = scenario();
    script(`DELETE /${V1}`, responseError(500, 'exception'));
    const outcome = await (await manager.migrateIfNeeded({ pollInterval: 10 }))
      .completion;
    expect(outcome).toMatchObject({
      success: true,
      code: 'MIGRATED',
      removedIndexes: [],
    });
    expect(outcome.cleanupErrors).toHaveLength(1);
  });

  it('treats an old index already deleted (404) as removed elsewhere', async () => {
    const { manager, script } = scenario();
    script(`DELETE /${V1}`, responseError(404, 'index_not_found_exception'));
    const outcome = await (await manager.migrateIfNeeded({ pollInterval: 10 }))
      .completion;
    expect(outcome).toMatchObject({
      code: 'MIGRATED',
      removedIndexes: [],
      cleanupErrors: [],
    });
  });

  it('swallows failed marker writes', async () => {
    const { manager, script } = scenario();
    script(
      `PUT /${V2}/_mapping`,
      responseError(400, 'illegal_argument_exception'),
    );
    const outcome = await (await manager.migrateIfNeeded({ pollInterval: 10 }))
      .completion;
    expect(outcome.code).toBe('MIGRATED');
  });
});

describe('migrateIfNeeded() - resuming an interrupted run (B-010)', () => {
  function resumable() {
    const s = scenario({ aliasIndexes: [V1], indexExists: true });
    s.script(
      `PUT /${V2}`,
      responseError(400, 'resource_already_exists_exception'),
    );
    s.script(`GET /${V2}/_mapping`, {
      body: { [V2]: { mappings: { properties: {} } } },
    });
    s.script('GET /_tasks', responseError(410, 'api_not_available_exception'));
    return s;
  }

  it('attaches to the task recorded in the mapping _meta', async () => {
    const s = resumable();
    s.script(`GET /${V2}/_mapping`, {
      body: {
        [V2]: {
          mappings: { _meta: { [MIGRATION_META_KEY]: { taskId: 'n:9' } } },
        },
      },
    });
    s.script('GET /_tasks/n:9', { body: taskBody({ completed: false }) });
    const result = await s.manager.migrateIfNeeded({ pollInterval: 10 });
    expect(result).toMatchObject({
      success: true,
      code: 'MIGRATION_RESUMED',
      resumed: true,
      attached: true,
      createdIndex: false,
      taskId: 'n:9',
      request: null,
    });
    s.script('GET /_tasks/n:9', { body: taskBody({ completed: true }) });
    const outcome = await result.completion;
    expect(outcome.code).toBe('MIGRATED');
    expect(outcome.taskIds[0]).toBe('n:9');
    // only the two catch-up passes were started
    expect(s.sent.filter((req) => req.path === '/_reindex')).toHaveLength(2);
  });

  it('attaches to a running reindex found in the tasks list (stateful)', async () => {
    const s = resumable();
    s.script('GET /_tasks', {
      body: {
        tasks: [
          {
            node: 'a',
            id: 5,
            action: 'indices:data/write/reindex',
            description: `reindex from [${V1}] to [other]`,
          },
          {
            node: 'a',
            id: 6,
            action: 'indices:data/write/reindex',
            parent_task_id: 'a:7',
            description: `reindex from [${V1}] to [${V2}]`,
          },
          {
            node: 'a',
            id: 7,
            action: 'indices:data/write/reindex',
            description: `reindex from [${V1}] to [${V2}]`,
          },
        ],
      },
    });
    const result = await s.manager.migrateIfNeeded({ pollInterval: 10 });
    expect(result).toMatchObject({ attached: true, taskId: 'a:7' });
    const list = s.sent.find((req) => req.path === '/_tasks');
    const query = new URLSearchParams(list?.querystring);
    expect(query.get('actions')).toBe('*reindex');
    expect(query.get('detailed')).toBe('true');
    expect((await result.completion).code).toBe('MIGRATED');
  });

  it('does not attach to a recorded task that is being cancelled', async () => {
    const s = resumable();
    s.script(`GET /${V2}/_mapping`, {
      body: {
        [V2]: {
          mappings: { _meta: { [MIGRATION_META_KEY]: { taskId: 'n:9' } } },
        },
      },
    });
    const cancelling = taskBody({ completed: false }) as {
      task: Record<string, unknown>;
    };
    cancelling.task.cancelled = true;
    s.script('GET /_tasks/n:9', { body: cancelling });
    const result = await s.manager.migrateIfNeeded({ pollInterval: 10 });
    expect(result).toMatchObject({
      code: 'MIGRATION_RESUMED',
      attached: false,
      taskId: 'n:1',
    });
    expect((await result.completion).code).toBe('MIGRATED');
  });

  it('starts a new copy when no running task is found', async () => {
    const s = resumable();
    s.script(`GET /${V2}/_mapping`, {
      body: {
        [V2]: {
          mappings: { _meta: { [MIGRATION_META_KEY]: { taskId: 'n:9' } } },
        },
      },
    });
    // the recorded task already finished
    s.script('GET /_tasks/n:9', { body: taskBody({ completed: true }) });
    const result = await s.manager.migrateIfNeeded({ pollInterval: 10 });
    expect(result).toMatchObject({
      code: 'MIGRATION_RESUMED',
      resumed: true,
      attached: false,
      taskId: 'n:1',
    });
    expect((await result.completion).code).toBe('MIGRATED');
    expect(s.sent.filter((req) => req.path === '/_reindex')).toHaveLength(3);
  });

  it('resumes when the new index is already on the alias (old half-migration)', async () => {
    const s = resumable();
    s.script(`GET /_alias/${ALIAS}`, { body: aliasBody([V1, V2]) });
    const result = await s.manager.migrateIfNeeded({ pollInterval: 10 });
    expect(result).toMatchObject({ code: 'MIGRATION_RESUMED', oldNames: [V1] });
    const outcome = await result.completion;
    expect(outcome.code).toBe('MIGRATED');
    // never reindexes the new index into itself
    const reindex = s.sent.find((req) => req.path === '/_reindex');
    expect(reindex?.body).toMatchObject({ source: { index: [V1] } });
  });
});

describe('findReindexInto()', () => {
  it('reads tasks grouped by node too', () => {
    const id = findReindexInto(
      {
        nodes: {
          n: {
            tasks: {
              'n:3': {
                node: 'n',
                id: 3,
                action: 'indices:data/write/reindex',
                cancellable: true,
                running_time_in_nanos: 1,
                start_time_in_millis: 1,
                type: 'transport',
                headers: {},
                description: `reindex from [${V1}] to [${V2}]`,
              },
            },
          },
        },
      },
      V2,
    );
    expect(id).toBe('n:3');
    expect(findReindexInto({}, V2)).toBe(null);
  });
});
