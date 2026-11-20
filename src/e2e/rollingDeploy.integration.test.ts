import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { IndexManager } from '../../index';
import { createTestKit } from '../testFixtures/esTestKit';
import {
  aliasTargets,
  allDocs,
  copiedAtLeast,
  HOLD,
  isRunning,
  release,
  releaseTasks,
  track,
} from './helpers';

/**
 * Scenario 3 — rolling deploy: v1 and v2 app instances (separate
 * `IndexManager`s, as separate processes would have) call
 * `migrateIfNeeded()` in turns while the v2 copy runs. Old instances must
 * never undo or block the migration, new ones must join it, and the run
 * ends on v2 with all data. A second test starts two v2 instances at the
 * same moment.
 */

setDefaultTimeout(60_000);
const SCENARIO_MS = 300_000;

const kit = await createTestKit('e2e-rolling');
const seenTasks = new Set<string>();
afterAll(async () => {
  await releaseTasks(kit, seenTasks);
  await kit.cleanup();
});

type Doc = { id: string; title: string; year?: number };

/** An app instance at `version` (v2 adds the `year` field) */
function instance(label: string, version: 1 | 2) {
  const properties = {
    id: { type: 'keyword' },
    title: { type: 'keyword' },
    ...(version === 2 ? { year: { type: 'integer' as const } } : {}),
  } as const;
  return new IndexManager(
    { client: kit.client, prefix: kit.prefix, version },
    { index: label, mappings: { properties } },
  );
}

function makeDocs(count: number): Doc[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    title: `doc ${i}`,
  }));
}

async function exists(index: IndexManager) {
  return kit.client.indices.exists({ index: index.getFullName() });
}

describe('E2E scenario 3: rolling deploy', () => {
  it(
    'v1 and v2 instances alternate migrateIfNeeded(); ends on v2 with all data',
    async () => {
      const oldA = instance('rolling', 1);
      const oldB = instance('rolling', 1);
      const newA = instance('rolling', 2);
      const newB = instance('rolling', 2);

      // the v1 fleet boots
      expect((await oldA.migrateIfNeeded()).code).toBe('CREATED');
      expect((await oldB.migrateIfNeeded()).code).toBe('CURRENT');
      const loaded = await oldA.putBulk(makeDocs(8), { refresh: true });
      expect(loaded.error).toBe(null);

      // the first v2 instance starts the copy (held open)
      const first = track(seenTasks, HOLD);
      const runA = await newA.migrateIfNeeded(first.params);
      expect(runA).toMatchObject({
        success: true,
        code: 'MIGRATION_STARTED',
        recordsToMigrate: 8,
      });
      const taskId = runA.taskId as string;
      seenTasks.add(taskId);
      await copiedAtLeast(kit, first.progress, 1);

      // an old instance restarts: from v1's view nothing is to do, and it
      // must not touch the new index or the alias
      const oldRestart = await oldA.migrateIfNeeded();
      expect(oldRestart).toMatchObject({
        success: true,
        code: 'CURRENT',
        error: null,
      });
      expect(await exists(newA)).toBe(true);
      expect(await aliasTargets(kit, oldA.getAliasName())).toEqual([
        oldA.getFullName(),
      ]);

      // both generations keep writing through the alias
      const putOld = await oldA.put('during-v1', {
        id: 'during-v1',
        title: 'from v1',
      });
      const putNew = await newA.put('during-v2', {
        id: 'during-v2',
        title: 'from v2',
        year: 2025,
      });
      expect(putOld.error).toBe(null);
      expect(putNew.error).toBe(null);

      // the second v2 instance joins the running copy
      const second = track(seenTasks);
      const runB = await newB.migrateIfNeeded(second.params);
      expect(runB).toMatchObject({
        success: true,
        code: 'MIGRATION_RESUMED',
        resumed: true,
        attached: true,
        taskId,
        createdIndex: false,
      });

      // another old instance restarts while the copy is still held
      expect((await oldB.migrateIfNeeded()).code).toBe('CURRENT');
      expect(await isRunning(kit, taskId)).toBe(true);

      await release(kit, taskId);
      const [outcomeA, outcomeB] = await Promise.all([
        runA.completion,
        runB.completion,
      ]);
      expect(outcomeA).toMatchObject({ success: true, code: 'MIGRATED' });
      expect(outcomeB).toMatchObject({ success: true, code: 'MIGRATED' });
      expect(first.errors).toEqual([]);
      expect(second.errors).toEqual([]);

      // old instances now refuse to go back, and change nothing
      const oldAfter = await oldA.migrateIfNeeded();
      expect(oldAfter).toMatchObject({
        success: false,
        code: 'NEWER_VERSION_PRESENT',
        error: null,
        createdIndex: false,
      });
      expect(await exists(oldA)).toBe(false);
      // ... but still read and write through the alias
      const lateOld = await oldB.put('after-v1', {
        id: 'after-v1',
        title: 'late v1',
      });
      expect(lateOld.error).toBe(null);
      expect((await oldB.findById('during-v2')).record).toMatchObject({
        year: 2025,
      });
      expect((await newA.migrateIfNeeded()).code).toBe('CURRENT');
      expect((await newB.migrateIfNeeded()).code).toBe('CURRENT');

      expect(await aliasTargets(kit, newA.getAliasName())).toEqual([
        newA.getFullName(),
      ]);
      const { byId, duplicates } = await allDocs<Doc>(kit, newA.getAliasName());
      expect(duplicates).toEqual([]);
      expect([...byId.keys()].sort()).toEqual(
        [
          ...makeDocs(8).map((doc) => doc.id),
          'during-v1',
          'during-v2',
          'after-v1',
        ].sort(),
      );
      expect(byId.get('during-v1')?.title).toBe('from v1');
      expect(byId.get('3')?.title).toBe('doc 3');
      expect((await newB.count((qb) => qb.term('year', 2025))).total).toBe(1);
    },
    SCENARIO_MS,
  );

  it(
    'two v2 instances starting at the same moment end on v2 with all data',
    async () => {
      const old = instance('race', 1);
      expect((await old.migrateIfNeeded()).code).toBe('CREATED');
      expect((await old.putBulk(makeDocs(12), { refresh: true })).error).toBe(
        null,
      );
      const newA = instance('race', 2);
      const newB = instance('race', 2);
      const a = track(seenTasks);
      const b = track(seenTasks);
      const [runA, runB] = await Promise.all([
        newA.migrateIfNeeded(a.params),
        newB.migrateIfNeeded(b.params),
      ]);
      for (const run of [runA, runB]) {
        if (run.taskId) {
          seenTasks.add(run.taskId);
        }
      }
      expect(runA.error).toBe(null);
      expect(runB.error).toBe(null);
      expect([runA.code, runB.code].sort()).toEqual([
        'MIGRATION_RESUMED',
        'MIGRATION_STARTED',
      ]);
      const [outcomeA, outcomeB] = await Promise.all([
        runA.completion,
        runB.completion,
      ]);
      expect(outcomeA.error).toBe(null);
      expect(outcomeB.error).toBe(null);
      expect(outcomeA).toMatchObject({ success: true, code: 'MIGRATED' });
      expect(outcomeB).toMatchObject({ success: true, code: 'MIGRATED' });
      expect(await aliasTargets(kit, newA.getAliasName())).toEqual([
        newA.getFullName(),
      ]);
      expect(await exists(old)).toBe(false);
      const { byId, duplicates } = await allDocs<Doc>(kit, newA.getAliasName());
      expect(duplicates).toEqual([]);
      expect(byId.size).toBe(12);
    },
    SCENARIO_MS,
  );
});
