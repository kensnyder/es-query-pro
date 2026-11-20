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
 * Scenario 2 — version bump under load: a writer loop runs `put`, `patch`,
 * `findById` and `count` through the alias, alternating between the v1 and
 * v2 managers (old and new app instances), while a v1 → v2 migration runs.
 * No operation may fail, and afterwards every document is there once with
 * its last written value.
 *
 * Every document is written at most once after seeding (a new `w-<i>` put,
 * or one patch of `s-<i>`), so the documented post-swap window, where two
 * writes to the old index can win over one to the new index, cannot decide
 * the outcome. Reads in that window may be stale (the final catch-up pass
 * copies the newest value); they are counted, not failed, and must not
 * happen while the copy is held or after the migration completed.
 */

setDefaultTimeout(60_000);
const SCENARIO_MS = 300_000;

const kit = await createTestKit('e2e-bump');
const seenTasks = new Set<string>();
afterAll(async () => {
  await releaseTasks(kit, seenTasks);
  await kit.cleanup();
});

type Doc = { id: string; title: string; n: number; tag?: string };

const properties = {
  id: { type: 'keyword' },
  title: { type: 'keyword' },
  n: { type: 'integer' },
} as const;

const v1 = new IndexManager(
  { client: kit.client, prefix: kit.prefix, version: 1 },
  { index: 'load', mappings: { properties } },
);
const v2 = new IndexManager(
  { client: kit.client, prefix: kit.prefix, version: 2 },
  {
    index: 'load',
    mappings: { properties: { ...properties, tag: { type: 'keyword' } } },
  },
);

/**
 * Seeded documents; also the most iterations that patch one. Kept small:
 * `batchSize: 1` (from `HOLD`) applies to every pass, so on serverless each
 * pass copies about 4 documents a second, and the writer adds to each pass.
 */
const SEEDED = 40;
/** Stop the writer after this many iterations, whatever happens */
const MAX_ITERATIONS = 2_000;

type Phase = 'held' | 'running' | 'after';

/** What the writer did and saw */
const state = {
  expected: new Map<string, Doc>(),
  iterations: 0,
  byPhase: { held: 0, running: 0, after: 0 } as Record<Phase, number>,
  v2Puts: 0,
  opErrors: [] as { op: string; id: string; phase: Phase; error: Error }[],
  staleReads: [] as {
    id: string;
    phase: Phase;
    title: string | string[] | null;
  }[],
};

/**
 * One writer iteration: put a new document, patch a seeded one, read it
 * back and count, through v1 or v2 by turns
 */
async function step(phase: Phase) {
  const i = state.iterations++;
  state.byPhase[phase]++;
  const viaV2 = i % 2 === 1;
  const fail = (op: string, id: string, error: Error | null) => {
    if (error) {
      state.opErrors.push({ op, id, phase, error });
    }
  };
  const newId = `w-${i}`;
  const doc: Doc = { id: newId, title: `written ${i}`, n: i };
  let put: { error: Error | null };
  if (viaV2) {
    put = await v2.put(newId, { ...doc, tag: 'v2' });
    state.expected.set(newId, { ...doc, tag: 'v2' });
    state.v2Puts++;
  } else {
    put = await v1.put(newId, doc);
    state.expected.set(newId, doc);
  }
  fail('put', newId, put.error);
  if (i >= SEEDED) {
    return;
  }
  const seededId = `s-${i}`;
  const title = `patched ${i}`;
  const manager = viaV2 ? v2 : v1;
  const patched = await manager.patch(seededId, { title });
  fail('patch', seededId, patched.error);
  if (!patched.error && patched.result !== 'updated') {
    fail('patch', seededId, new Error(`result ${patched.result}`));
  }
  state.expected.set(seededId, { id: seededId, title, n: i });
  const read = await manager.findById(seededId);
  fail('findById', seededId, read.error);
  if (!read.found || read.record?.title !== title) {
    state.staleReads.push({
      id: seededId,
      phase,
      title: read.record?.title ?? null,
    });
  }
  const counted = await manager.count();
  fail('count', '*', counted.error);
}

describe('E2E scenario 2: version bump under load', () => {
  it(
    'keeps every put, patch and read working through a v1 → v2 migration',
    async () => {
      const created = await v1.migrateIfNeeded();
      expect(created.code).toBe('CREATED');
      const seeded = Array.from({ length: SEEDED }, (_, i) => ({
        id: `s-${i}`,
        title: `seeded ${i}`,
        n: i,
      }));
      const bulk = await v1.putBulk(seeded, { refresh: true });
      expect(bulk.error).toBe(null);
      for (const doc of seeded) {
        state.expected.set(doc.id, doc);
      }

      const { params, progress, errors, completed } = track(seenTasks, HOLD);
      const result = await v2.migrateIfNeeded(params);
      expect(result).toMatchObject({
        success: true,
        code: 'MIGRATION_STARTED',
        oldNames: [v1.getFullName()],
        recordsToMigrate: SEEDED,
        error: null,
      });
      const taskId = result.taskId as string;
      seenTasks.add(taskId);
      let settled = false;
      const completion = result.completion.then((outcome) => {
        settled = true;
        return outcome;
      });

      // writes while the copy is held: all of them go to v1
      await copiedAtLeast(kit, progress, 1);
      for (let n = 0; n < 5; n++) {
        await step('held');
      }
      expect(await isRunning(kit, taskId)).toBe(true);
      expect(await aliasTargets(kit, v1.getAliasName())).toEqual([
        v1.getFullName(),
      ]);

      // let the copy go and keep writing through the swap and cleanup
      await release(kit, taskId);
      while (!settled && state.iterations < MAX_ITERATIONS) {
        await step('running');
      }
      const outcome = await completion;
      for (let n = 0; n < 5; n++) {
        await step('after');
      }

      expect(state.opErrors).toEqual([]);
      expect(outcome.error).toBe(null);
      expect(outcome).toMatchObject({
        success: true,
        code: 'MIGRATED',
        swapped: true,
        removedIndexes: [v1.getFullName()],
      });
      expect(errors).toEqual([]);
      expect(completed).toHaveLength(1);
      // stale reads only in the brief post-swap window
      const outside = state.staleReads.filter((r) => r.phase !== 'running');
      expect(outside).toEqual([]);
      console.log(
        `[e2e-bump] writer iterations ${JSON.stringify(state.byPhase)}; ` +
          `${state.staleReads.length} stale read(s) in the post-swap ` +
          'window (documented; final values checked below)',
      );

      expect(await aliasTargets(kit, v2.getAliasName())).toEqual([
        v2.getFullName(),
      ]);
      expect(await kit.client.indices.exists({ index: v1.getFullName() })).toBe(
        false,
      );
      const { byId, duplicates, total } = await allDocs<Doc>(
        kit,
        v2.getAliasName(),
      );
      expect(duplicates).toEqual([]);
      expect(total).toBe(state.expected.size);
      expect(state.expected.size).toBe(SEEDED + state.iterations);
      const wrong = [...state.expected].filter(
        ([id, doc]) => !Bun.deepEquals(byId.get(id), doc),
      );
      expect(wrong.map(([id]) => [id, byId.get(id)?.title ?? null])).toEqual(
        [],
      );
      // the field only v2 maps is searchable on every v2 write
      const tagged = await v2.count((qb) => qb.term('tag', 'v2'));
      expect(tagged.total).toBe(state.v2Puts);
      expect((await v2.migrateIfNeeded()).code).toBe('CURRENT');
    },
    SCENARIO_MS,
  );
});
