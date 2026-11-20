import type { estypes } from '@elastic/elasticsearch';
import type { MigrationParams, MigrationProgressDetails } from '../../index';
import type { EsTestKit } from '../testFixtures/esTestKit';

/**
 * Shared helpers for the cross-module scenarios in `src/e2e`. Test-only:
 * nothing here is part of the library.
 */

/**
 * Throttle that holds the first copy of a migration open: one document per
 * batch, 5 s between batches. Scenarios act while the copy is held, then
 * `release()` it, so they never depend on how fast the server copies.
 */
export const HOLD: MigrationParams = { requestsPerSecond: 0.2, batchSize: 1 };

/** Let a held copy run at full speed (a finished task is ignored) */
export async function release(kit: EsTestKit, taskId: string) {
  await kit.client
    .reindexRethrottle({ task_id: taskId, requests_per_second: -1 })
    .catch(() => {});
}

/**
 * Unthrottle (and where the tasks API allows it, cancel) reindex tasks, then
 * wait for them to finish, so no copy outlives the test file
 */
export async function releaseTasks(kit: EsTestKit, taskIds: Iterable<string>) {
  const ids = [...taskIds];
  for (const taskId of ids) {
    await release(kit, taskId);
    await kit.client.tasks.cancel({ task_id: taskId }).catch(() => {});
  }
  for (const taskId of ids) {
    await kit
      .waitFor(
        async () => {
          try {
            return (await kit.client.tasks.get({ task_id: taskId })).completed;
          } catch {
            return true;
          }
        },
        { timeout: 30_000, message: `task ${taskId} to finish` },
      )
      .catch(() => {});
  }
}

/** Whether a reindex task is still running */
export async function isRunning(kit: EsTestKit, taskId: string) {
  const task = await kit.client.tasks.get({ task_id: taskId });
  return !task.completed;
}

/**
 * Migration callbacks that record every event, adding each task id seen to
 * `seenTasks` (release them in `afterAll`)
 */
export function track(seenTasks: Set<string>, extra: MigrationParams = {}) {
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
export async function copiedAtLeast(
  kit: EsTestKit,
  progress: MigrationProgressDetails[],
  count: number,
) {
  await kit.waitFor(
    () =>
      progress.some((p) => p.phase === 'reindex' && p.done >= count) ||
      progress.some((p) => p.phase !== 'reindex'),
    { timeout: 60_000, message: `${count} documents copied` },
  );
}

/** The indexes an alias points at, sorted ([] when it does not exist) */
export async function aliasTargets(kit: EsTestKit, alias: string) {
  try {
    const res = await kit.client.indices.getAlias({ name: alias });
    return Object.keys(res).sort();
  } catch (e) {
    if ((e as { meta?: { statusCode?: number } }).meta?.statusCode === 404) {
      return [];
    }
    throw e;
  }
}

/**
 * Every document of `index` (refreshed first), keyed by `_id`, plus the ids
 * returned more than once (an alias on two indexes would show them)
 */
export async function allDocs<Doc>(kit: EsTestKit, index: string) {
  await kit.client.indices.refresh({ index });
  const res = await kit.client.search<Doc>({
    index,
    size: 10_000,
    query: { match_all: {} },
  });
  const byId = new Map<string, Doc>();
  const duplicates: string[] = [];
  for (const hit of res.hits.hits) {
    const id = hit._id as string;
    if (byId.has(id)) {
      duplicates.push(id);
    }
    byId.set(id, hit._source as Doc);
  }
  return { byId, duplicates, total: totalOf(res.hits.total) };
}

function totalOf(total: estypes.SearchTotalHits | number | undefined) {
  if (typeof total === 'number') {
    return total;
  }
  return total?.value ?? null;
}

/** The ids of search records, in order */
export function idsOf(records: readonly { _id: string }[]) {
  return records.map((record) => record._id);
}
