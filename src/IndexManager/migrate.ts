import type { estypes } from "@elastic/elasticsearch";
import type {
  IndexErrorKind,
  IndexErrorShape,
  default as IndexManager,
  StatusReport,
} from "./IndexManager";

/**
 * Where a migration is, in order. Progress events use `reindex`, `catchUp`,
 * `finalCatchUp` and `done`; a failed `MigrationOutcome` names the step that
 * failed.
 * - `start`: checks, creating the new index, starting the first copy
 * - `reindex`: the first copy, old index(es) → new index
 * - `catchUp`: a second copy picking up writes made during the first
 * - `swap`: the one atomic alias update (old removed, new added as the write
 *   index)
 * - `finalCatchUp`: a last copy picking up writes that reached the old index
 *   just before the swap
 * - `verify`: comparing document counts
 * - `cleanup`: removing the old index(es) and task results
 * - `done`: finished
 */
export type MigrationPhase =
  | "start"
  | "reindex"
  | "catchUp"
  | "swap"
  | "finalCatchUp"
  | "verify"
  | "cleanup"
  | "done";

/** The phases that run a reindex task */
export type MigrationPassPhase = "reindex" | "catchUp" | "finalCatchUp";

export type MigrationParams = {
  /**
   * Called while each reindex pass runs, and once per old index with
   * `percent: 100` and `phase: 'done'` when the migration succeeded
   */
  onProgress?: (details: MigrationProgressDetails) => void;
  /** Called once, only when the migration (or creation) succeeded */
  onComplete?: (details: MigrationProgressDetails) => void;
  /** Called once with the error when the migration fails */
  onError?: (error: Error) => void;
  /** Reindex `slices`: a number or `'auto'` (default 1) */
  slices?: number | "auto";
  /**
   * Longest wait between task status checks (default 1000, at least 10).
   * Each pass is checked first after 100 ms, then 200, 400, ... up to this.
   */
  pollInterval?: number;
  /**
   * Give up after this many milliseconds from the call (default: no limit).
   * A running reindex task is cancelled where the server allows it; the old
   * index and the alias are left as they were, so a later call resumes.
   */
  timeout?: number;
  /**
   * How many task status checks in a row may fail (with backoff) before the
   * migration gives up (default 5). The reindex keeps running on the server;
   * a later call attaches to it or starts again.
   */
  maxPollErrors?: number;
  /**
   * Throttle the first copy to this many documents per second (reindex
   * `requests_per_second`; default unlimited). The catch-up passes, which
   * mostly skip documents, are not throttled.
   */
  requestsPerSecond?: number;
  /**
   * Documents per reindex batch (`source.size`; default 1000). Applies to
   * every pass, including the catch-up passes, which scan the whole old
   * index: a small value slows the entire migration, not only the first copy.
   */
  batchSize?: number;
};

export type MigrationProgressDetails = {
  /** Source documents processed by the current pass (copied or skipped) */
  done: number;
  /** Source documents the current pass will process (0 until known) */
  total: number;
  /** 0 to 99 while running; 100 only in the final `done` events */
  percent: number;
  taskId: string;
  /** The old index (several are joined with `,` while a pass runs) */
  oldIndex: string;
  newIndex: string;
  alias: string;
  phase: MigrationPhase;
  /** Bulk failures reported by a finished pass (empty while running) */
  failures: estypes.BulkIndexByScrollFailure[];
};

/** What one reindex pass did */
export type MigrationPassReport = {
  phase: MigrationPassPhase;
  taskId: string;
  /** Source documents the pass read */
  total: number;
  created: number;
  updated: number;
  deleted: number;
  /**
   * Documents skipped because the new index already held that version or a
   * newer one (`version_type: 'external'`)
   */
  versionConflicts: number;
  noops: number;
  failures: estypes.BulkIndexByScrollFailure[];
};

/**
 * What `migrateIfNeeded()` did before returning. `success` is true for:
 * - `CREATED`: neither index nor alias existed; both were created
 * - `ALIAS_CREATED`: the index existed without its alias; the alias was added
 * - `CURRENT`: the alias already points at this index; nothing was sent
 * - `MIGRATION_STARTED`: the new index was created and the first copy
 *   started; follow `completion`
 * - `MIGRATION_RESUMED`: the new index already existed (an earlier run was
 *   interrupted); `attached` says whether a running copy into it was found
 *   and followed, else a new copy was started; follow `completion`
 *
 * `success` is false, with `error: null` and nothing changed, for:
 * - `NEWER_VERSION_PRESENT`: the alias points at a newer version (a rollback
 *   or rolling deploy); migrating backwards is refused
 * - `INCOMPARABLE_VERSION`: the alias points at a version that cannot be
 *   ordered against this one (e.g. `v2024a` vs `v3`); no order is guessed
 * - `ALIAS_CONFLICT`: the alias points only at indexes that are not versions
 *   of this one
 *
 * `success` is false with `error` set when a request failed:
 * `STATUS_ERROR` (`getStatus()`), `COUNT_ERROR`, `CREATE_ERROR`,
 * `ALIAS_ERROR`, `REINDEX_ERROR` (starting the first copy).
 */
export type MigrationCode =
  | "CREATED"
  | "ALIAS_CREATED"
  | "CURRENT"
  | "MIGRATION_STARTED"
  | "MIGRATION_RESUMED"
  | "NEWER_VERSION_PRESENT"
  | "INCOMPARABLE_VERSION"
  | "ALIAS_CONFLICT"
  | "STATUS_ERROR"
  | "COUNT_ERROR"
  | "CREATE_ERROR"
  | "ALIAS_ERROR"
  | "REINDEX_ERROR";

/**
 * How a migration ended (`completion`). When `migrateIfNeeded()` did not
 * start a migration, this is its own code. Otherwise:
 * - `MIGRATED`: copied, alias swapped, counts verified, old index(es)
 *   removed (see `cleanupErrors` for removals that failed)
 * - `REINDEX_FAILED`: a pass finished with an error, bulk failures, a server
 *   timeout or a cancellation
 * - `REINDEX_ERROR`: a catch-up pass could not be started
 * - `POLL_ERROR`: `maxPollErrors` status checks in a row failed
 * - `TIMEOUT`: `timeout` expired
 * - `SWAP_ERROR`: the alias update failed
 * - `VERIFY_FAILED`: the final pass did not read or account for every
 *   document of the old index(es), or they could not be counted
 *
 * On every failure before the swap the old index and the alias are left
 * untouched and the new index is kept for inspection. After the swap
 * (`swapped: true`) the old index is kept.
 */
export type MigrationOutcomeCode =
  | Exclude<MigrationCode, "MIGRATION_STARTED" | "MIGRATION_RESUMED">
  | "MIGRATED"
  | "REINDEX_FAILED"
  | "POLL_ERROR"
  | "TIMEOUT"
  | "SWAP_ERROR"
  | "VERIFY_FAILED";

/** What `completion` resolves to. It never rejects. */
export type MigrationOutcome = {
  success: boolean;
  code: MigrationOutcomeCode;
  /** The step that failed; `done` on success */
  phase: MigrationPhase;
  oldIndexes: string[];
  newIndex: string;
  alias: string;
  /** Whether the alias was moved to the new index */
  swapped: boolean;
  /** Old indexes this run deleted */
  removedIndexes: string[];
  /** One entry per reindex pass that finished */
  passes: MigrationPassReport[];
  /** Every reindex task followed, in order */
  taskIds: string[];
  /** Whether a timed-out task was cancelled (not possible on serverless) */
  cancelled: boolean;
  /**
   * Counts read in `verify`; null when not reached. `old` must equal the
   * final pass's `total`; `new` is informational (not refreshed, so it can
   * lag writes made just before)
   */
  counts: { old: Record<string, number>; new: number } | null;
  /** Bulk failures of the pass that failed */
  failures: estypes.BulkIndexByScrollFailure[];
  /** Old indexes that could not be deleted after a successful migration */
  cleanupErrors: Error[];
  took: number;
  error: Error | null;
  errorKind: IndexErrorKind | null;
};

/** A request descriptor, as in the other `IndexManager` results */
export type MigrationRequest = {
  method: string;
  endpoint: string;
  body: estypes.ReindexRequest;
};

/** What `migrateIfNeeded()` resolves to */
export type MigrationResult = {
  success: boolean;
  code: MigrationCode;
  /** The status the decision was based on; null if it could not be read */
  status: StatusReport | null;
  newName: string;
  aliasName: string;
  /** The older versions being migrated from (empty when not migrating) */
  oldNames: string[];
  /** Documents in the old index(es) when the migration started */
  recordsToMigrate: number;
  /** Whether this call created the (new) index */
  createdIndex: boolean;
  /** Whether this call added the alias (creation branches only) */
  createdAlias: boolean;
  /** Whether the new index already existed (an interrupted run) */
  resumed: boolean;
  /** Whether a running reindex into the new index was found and followed */
  attached: boolean;
  /** The first-copy task followed by `completion`, if any */
  taskId: string | null;
  /** The reindex request sent, when this call started one */
  request: MigrationRequest | null;
  /** Settles when the migration ends; resolves at once for other codes */
  completion: Promise<MigrationOutcome>;
  took: number;
  error: Error | null;
  errorKind: IndexErrorKind | null;
  /** The last response (or error metadata) of the step reported */
  response: unknown;
};

/** The parts of `IndexManager` a migration uses */
export type MigratingIndex = Pick<
  IndexManager,
  | "client"
  | "createSpec"
  | "getStatus"
  | "createOnly"
  | "createAlias"
  | "getAliasMetadata"
  | "getFullName"
  | "getAliasName"
  | "_formatError"
>;

/** Key under the new index's mapping `_meta` that records the copy task */
export const MIGRATION_META_KEY = "es-query-pro-migration";

const POLL_FLOOR_MS = 10;
const DEFAULT_POLL_MS = 1000;
const FIRST_POLL_MS = 100;
const MAX_BACKOFF_MS = 30_000;
const DEFAULT_MAX_POLL_ERRORS = 5;

type Failure = IndexErrorShape;

export type PassResult =
  | { ok: true; report: MigrationPassReport }
  | {
      ok: false;
      code: "REINDEX_FAILED" | "REINDEX_ERROR" | "POLL_ERROR" | "TIMEOUT";
      failure: Failure;
      report: MigrationPassReport | null;
      cancelled: boolean;
    };

export type TaskStats = {
  total: number;
  created: number;
  updated: number;
  deleted: number;
  version_conflicts: number;
  noops: number;
};

export type MigrationOptions = {
  onProgress?: (details: MigrationProgressDetails) => void;
  onComplete?: (details: MigrationProgressDetails) => void;
  onError?: (error: Error) => void;
  slices: number | "auto";
  pollInterval: number;
  deadline: number;
  timeout: number | null;
  maxPollErrors: number;
  requestsPerSecond: number | null;
  batchSize: number | null;
};

/**
 * Bring the index up to date (see `IndexManager.migrateIfNeeded()`). Never
 * rejects; `completion` never rejects either.
 *
 * Design (zero downtime): the new index is filled while it is *not* in the
 * alias, so reads and writes keep using the old index throughout. Copies use
 * `version_type: 'external'`, so a pass never overwrites a document the new
 * index already holds at the same or a newer version, and running a pass
 * again is harmless. After the first copy, a catch-up pass picks up writes
 * made meanwhile; then one atomic alias update moves reads and writes to the
 * new index; a final catch-up pass picks up writes that reached the old
 * index just before the swap (it first refreshes the old index, as reindex
 * sees only refreshed documents); the old count is checked against that
 * pass; the old index is removed.
 *
 * Known limitation: a document deleted from the old index after the first
 * copy started is present in the new index afterwards (there are no
 * tombstones).
 */
export async function migrateIndex(
  manager: MigratingIndex,
  params: MigrationParams = {},
): Promise<MigrationResult> {
  return new Migration(manager, params).run();
}

class Migration {
  private readonly start = Date.now();
  private readonly options: MigrationOptions;
  private readonly newIndex: string;
  private readonly alias: string;
  private status: StatusReport | null = null;
  private oldIndexes: string[] = [];
  private recordsToMigrate = 0;
  private createdIndex = false;
  private createdAlias = false;
  private resumed = false;
  private attached = false;
  private taskId: string | null = null;
  private request: MigrationRequest | null = null;
  // state of the background part
  private readonly passes: MigrationPassReport[] = [];
  private readonly taskIds: string[] = [];
  private swapped = false;
  private cancelled = false;

  constructor(
    private readonly manager: MigratingIndex,
    params: MigrationParams,
  ) {
    this.options = normalizeParams(params, this.start);
    this.newIndex = manager.getFullName();
    this.alias = manager.getAliasName();
  }

  private get client() {
    return this.manager.client;
  }

  async run(): Promise<MigrationResult> {
    try {
      return await this.decide();
    } catch (e) {
      // only reachable through a bug; still honor the never-throw contract
      return this.immediate("STATUS_ERROR", this.manager._formatError(e));
    }
  }

  private async decide(): Promise<MigrationResult> {
    const status = await this.manager.getStatus();
    this.status = status;
    if (status.error) {
      return this.immediate("STATUS_ERROR", {
        error: status.error,
        errorKind: status.errorKind ?? "javascript",
        response: null,
      });
    }
    const { siblings } = status;
    if (siblings.newer.length > 0) {
      return this.immediate("NEWER_VERSION_PRESENT");
    }
    if (siblings.incomparable.length > 0) {
      return this.immediate("INCOMPARABLE_VERSION");
    }
    if (siblings.older.length > 0) {
      // indexes on the alias that are not versions of this one are ignored:
      // never copied, never removed
      return this.startMigration(siblings.older);
    }
    if (siblings.unrelated.length > 0) {
      return this.immediate("ALIAS_CONFLICT");
    }
    if (!status.indexExists) {
      return this.createFresh();
    }
    if (!status.aliasAttached) {
      return this.attachAlias("ALIAS_CREATED");
    }
    return this.immediate("CURRENT");
  }

  /** Neither the index nor the alias exists */
  private async createFresh(): Promise<MigrationResult> {
    const created = await this.manager.createOnly();
    const failure = getFailure(created);
    if (failure && !isAlreadyExists(failure)) {
      return this.immediate("CREATE_ERROR", failure, created.response);
    }
    // another process may have created it first; adding the alias is
    // idempotent
    this.createdIndex = failure === null;
    return this.attachAlias(failure ? "ALIAS_CREATED" : "CREATED");
  }

  private async attachAlias(code: "CREATED" | "ALIAS_CREATED") {
    const added = await this.manager.createAlias();
    const failure = getFailure(added);
    if (failure) {
      return this.immediate("ALIAS_ERROR", failure, added.response);
    }
    this.createdAlias = true;
    const details = this.details("done", 100, emptyStats(), "");
    safeCall(this.options.onProgress, details);
    safeCall(this.options.onComplete, details);
    return this.immediate(code, null, added.response);
  }

  private async startMigration(older: string[]): Promise<MigrationResult> {
    this.oldIndexes = older;
    try {
      const counted = await this.client.count({ index: older });
      this.recordsToMigrate = counted.count;
    } catch (e) {
      return this.immediate("COUNT_ERROR", this.manager._formatError(e));
    }
    const created = await this.manager.createOnly();
    const createFailure = getFailure(created);
    if (createFailure && !isAlreadyExists(createFailure)) {
      return this.immediate("CREATE_ERROR", createFailure, created.response);
    }
    this.createdIndex = createFailure === null;
    this.resumed = createFailure !== null;
    if (this.resumed) {
      this.taskId = await this.findRunningCopy();
      this.attached = this.taskId !== null;
    }
    let response: unknown = created.response;
    if (!this.taskId) {
      const started = await this.startPass("reindex");
      if (!started.ok) {
        return this.immediate("REINDEX_ERROR", started.failure);
      }
      this.taskId = started.taskId;
      this.request = started.request;
      response = started.response;
      await this.writeMarker(started.taskId);
    }
    const taskId = this.taskId;
    const completion = this.complete(taskId).catch((e: unknown) =>
      // complete() handles its own errors; this guards against bugs
      this.fail("REINDEX_FAILED", "done", this.manager._formatError(e)),
    );
    const code = this.resumed ? "MIGRATION_RESUMED" : "MIGRATION_STARTED";
    return this.result(code, null, response, completion);
  }

  /** The background part: wait, catch up, swap, catch up, verify, clean */
  private async complete(firstTaskId: string): Promise<MigrationOutcome> {
    const first = await this.waitForPass(firstTaskId, "reindex");
    if (!first.ok) {
      return this.failPass(first, "reindex");
    }
    const catchUp = await this.runPass("catchUp");
    if (!catchUp.ok) {
      return this.failPass(catchUp, "catchUp");
    }
    const swap = await this.swap();
    if (swap) {
      return this.fail("SWAP_ERROR", "swap", swap);
    }
    const final = await this.runPass("finalCatchUp");
    if (!final.ok) {
      if (await this.removedElsewhere()) {
        return this.succeed(first.report, [], []);
      }
      return this.failPass(final, "finalCatchUp");
    }
    const counts = await this.verify(final.report);
    if ("failure" in counts) {
      if (await this.removedElsewhere()) {
        return this.succeed(first.report, [], []);
      }
      return this.fail("VERIFY_FAILED", "verify", counts.failure, {
        counts: counts.counts,
      });
    }
    const { removed, errors } = await this.cleanup();
    return this.succeed(first.report, removed, errors, counts.counts);
  }

  /** Start a pass and wait for it */
  private async runPass(phase: MigrationPassPhase): Promise<PassResult> {
    const started = await this.startPass(phase);
    if (!started.ok) {
      return {
        ok: false,
        code: "REINDEX_ERROR",
        failure: started.failure,
        report: null,
        cancelled: false,
      };
    }
    return this.waitForPass(started.taskId, phase);
  }

  private async startPass(phase: MigrationPassPhase) {
    const source: estypes.ReindexSource = { index: this.oldIndexes };
    if (this.options.batchSize !== null) {
      source.size = this.options.batchSize;
    }
    const body: estypes.ReindexRequest = {
      wait_for_completion: false,
      // make copied documents searchable as soon as the pass ends
      refresh: true,
      // a skipped document (new index already newer) is not an error
      conflicts: "proceed",
      slices: this.options.slices,
      source,
      dest: { index: this.newIndex, version_type: "external" },
    };
    if (phase === "reindex" && this.options.requestsPerSecond !== null) {
      body.requests_per_second = this.options.requestsPerSecond;
    }
    const request = { method: "POST", endpoint: "/_reindex", body };
    try {
      if (phase === "finalCatchUp") {
        // reindex reads through search, which sees only refreshed documents.
        // After the swap nothing writes to the old index, so refreshing it
        // once here lets this pass see every write. Earlier passes skip it
        // (it takes ~5 s on serverless): what they miss, this pass copies.
        await this.client.indices.refresh({ index: this.oldIndexes });
      }
      const response = await this.client.reindex(body);
      if (response.task === undefined || response.task === null) {
        throw new Error(
          `Reindexing ${this.oldIndexes.join(", ")} did not return a task id`,
        );
      }
      const taskId = String(response.task);
      return { ok: true as const, taskId, request, response };
    } catch (e) {
      return { ok: false as const, failure: this.manager._formatError(e) };
    }
  }

  /** Poll a reindex task until it finishes, fails, or time runs out */
  private async waitForPass(
    taskId: string,
    phase: MigrationPassPhase,
  ): Promise<PassResult> {
    this.taskIds.push(taskId);
    let errors = 0;
    let polls = 0;
    let lastFailure: Failure | null = null;
    while (true) {
      const wait = pollDelay(this.options.pollInterval, polls++, errors);
      if (!(await this.sleepUntilDeadline(wait))) {
        return this.timedOut(taskId);
      }
      let task: estypes.TasksGetResponse;
      try {
        task = await this.client.tasks.get({ task_id: taskId });
      } catch (e) {
        errors++;
        lastFailure = this.manager._formatError(e);
        if (errors >= this.options.maxPollErrors) {
          return {
            ok: false,
            code: "POLL_ERROR",
            failure: withMessage(
              lastFailure,
              `Checking reindex task ${taskId} failed ${errors} times in a row`,
            ),
            report: null,
            cancelled: false,
          };
        }
        continue;
      }
      errors = 0;
      const stats = readStats(task.task?.status);
      if (!task.completed) {
        this.progress(phase, taskId, stats, []);
        continue;
      }
      return this.finishedPass(task, taskId, phase);
    }
  }

  private finishedPass(
    task: estypes.TasksGetResponse,
    taskId: string,
    phase: MigrationPassPhase,
  ): PassResult {
    const response = (task.response ?? {}) as Partial<estypes.ReindexResponse>;
    const failures = response.failures ?? [];
    const stats = readStats(task.response ?? task.task?.status);
    const report: MigrationPassReport = {
      phase,
      taskId,
      total: stats.total,
      created: stats.created,
      updated: stats.updated,
      deleted: stats.deleted,
      versionConflicts: stats.version_conflicts,
      noops: stats.noops,
      failures,
    };
    this.passes.push(report);
    this.progress(phase, taskId, stats, failures);
    const problem = describeTaskProblem(task, failures, this.describe(phase));
    if (!problem) {
      return { ok: true, report };
    }
    return {
      ok: false,
      code: "REINDEX_FAILED",
      failure: {
        error: problem,
        errorKind: "response",
        response: { statusCode: 200, body: task },
      },
      report,
      cancelled: false,
    };
  }

  private describe(phase: MigrationPassPhase) {
    const from = this.oldIndexes.join(", ");
    return `Reindex (${phase}) from ${from} to ${this.newIndex}`;
  }

  private async timedOut(taskId: string): Promise<PassResult> {
    try {
      await this.client.tasks.cancel({ task_id: taskId });
      this.cancelled = true;
    } catch {
      // not available on serverless; the task finishes on its own and a
      // later run attaches to it or copies again
    }
    const error = new Error(
      `Migration to ${this.newIndex} timed out after ${this.options.timeout}ms`,
    );
    error.name = "MigrationTimeoutError";
    return {
      ok: false,
      code: "TIMEOUT",
      failure: { error, errorKind: "timeout", response: null },
      report: null,
      cancelled: this.cancelled,
    };
  }

  /**
   * Wait `ms`, but not past the deadline. Resolves false when the deadline
   * has passed.
   */
  private async sleepUntilDeadline(ms: number) {
    const left = this.options.deadline - Date.now();
    if (left <= 0) {
      return false;
    }
    await sleep(Math.min(ms, left));
    return Date.now() < this.options.deadline;
  }

  /**
   * Move the alias: remove every old index and add the new one as the write
   * index, in one atomic request. Null on success.
   */
  private async swap(): Promise<Failure | null> {
    const actions: estypes.IndicesUpdateAliasesAction[] = this.oldIndexes.map(
      (index) => ({
        remove: { index, alias: this.alias, must_exist: true },
      }),
    );
    actions.push({
      add: { index: this.newIndex, alias: this.alias, is_write_index: true },
    });
    try {
      await this.client.indices.updateAliases({ actions });
      this.swapped = true;
      return null;
    } catch (e) {
      const failure = this.manager._formatError(e);
      if (await this.finishedElsewhere()) {
        // a concurrent run swapped first
        this.swapped = true;
        return null;
      }
      return failure;
    }
  }

  /**
   * Whether the alias already points at the new index and at none of the
   * old ones (another run got there first)
   */
  /**
   * After the swap: whether a concurrent run (same version) already
   * verified and deleted every old index, so this run has nothing left to do
   */
  private async removedElsewhere() {
    for (const index of this.oldIndexes) {
      try {
        if (await this.client.indices.exists({ index })) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return this.finishedElsewhere();
  }

  private async finishedElsewhere() {
    const meta = await this.manager.getAliasMetadata();
    if (!meta.success) {
      return false;
    }
    const indexes: string[] = meta.indexes;
    if (!indexes.includes(this.newIndex)) {
      return false;
    }
    this.swapped = true;
    return !this.oldIndexes.some((name) => indexes.includes(name));
  }

  /**
   * Check that the final pass copied or skipped every document of the old
   * index(es). The old index was refreshed right before that pass and gets
   * no writes after the swap, so its count needs no further refresh: it must
   * equal what the pass read, and the pass must account for each document
   * (copied, or skipped because the new index holds that version, a newer
   * one, or a newer delete).
   */
  private async verify(final: MigrationPassReport): Promise<
    | { counts: { old: Record<string, number>; new: number } }
    | {
        failure: Failure;
        counts: { old: Record<string, number>; new: number } | null;
      }
  > {
    let counts: { old: Record<string, number>; new: number };
    try {
      const old: Record<string, number> = {};
      for (const name of this.oldIndexes) {
        old[name] = (await this.client.count({ index: name })).count;
      }
      const newCount = await this.client.count({ index: this.newIndex });
      counts = { old, new: newCount.count };
    } catch (e) {
      return { failure: this.manager._formatError(e), counts: null };
    }
    const oldTotal = Object.values(counts.old).reduce((a, b) => a + b, 0);
    const accounted = processed(fromReport(final));
    if (oldTotal === final.total && accounted === final.total) {
      return { counts };
    }
    const error = new Error(
      `The final copy read ${final.total} documents and accounted for ` +
        `${accounted}, but ${this.oldIndexes.join(", ")} holds ${oldTotal}; ` +
        "the old index was kept",
    );
    return {
      failure: { error, errorKind: "javascript", response: null },
      counts,
    };
  }

  /** Remove the old index(es), task results and the task marker */
  private async cleanup() {
    const removed: string[] = [];
    const errors: Error[] = [];
    for (const index of this.oldIndexes) {
      try {
        await this.client.indices.delete({ index });
        removed.push(index);
      } catch (e) {
        if (!isResponseStatus(e, 404)) {
          errors.push(this.manager._formatError(e).error);
        }
      }
    }
    for (const id of this.taskIds) {
      try {
        // the stored result of a `wait_for_completion: false` task
        await this.client.delete({ index: ".tasks", id });
      } catch {
        // not allowed on serverless (403) and harmless to leave
      }
    }
    await this.removeMarker();
    return { removed, errors };
  }

  /**
   * Find a reindex into the new index that is still running: first the task
   * recorded in the new index's mapping `_meta`, then (where the tasks list
   * API exists; not on serverless) any running reindex whose destination is
   * the new index
   */
  private async findRunningCopy(): Promise<string | null> {
    try {
      const mapping = await this.client.indices.getMapping({
        index: this.newIndex,
      });
      const meta = mapping[this.newIndex]?.mappings?._meta;
      const marker = meta?.[MIGRATION_META_KEY] as
        | { taskId?: unknown }
        | undefined;
      if (marker && typeof marker.taskId === "string") {
        const task = await this.client.tasks.get({ task_id: marker.taskId });
        // a cancelled task reports `completed: false` until it winds down
        if (!task.completed && !task.task?.cancelled) {
          return marker.taskId;
        }
      }
    } catch {
      // no marker, or its task result is gone: look further
    }
    try {
      const list = await this.client.tasks.list({
        actions: "*reindex",
        detailed: true,
        group_by: "none",
      });
      return findReindexInto(list, this.newIndex);
    } catch {
      // 410 api_not_available_exception on serverless
      return null;
    }
  }

  /** Record the first-copy task on the new index so a later run can attach */
  private async writeMarker(taskId: string) {
    const marker = {
      taskId,
      from: this.oldIndexes,
      startedAt: new Date().toISOString(),
    };
    try {
      await this.client.indices.putMapping({
        index: this.newIndex,
        _meta: { ...this.specMeta(), [MIGRATION_META_KEY]: marker },
      });
    } catch {
      // only used to attach after a restart; a later run copies again
    }
  }

  private async removeMarker() {
    try {
      await this.client.indices.putMapping({
        index: this.newIndex,
        _meta: this.specMeta(),
      });
    } catch {
      // harmless to leave
    }
  }

  private specMeta(): estypes.Metadata {
    return { ...(this.manager.createSpec.mappings?._meta ?? {}) };
  }

  private progress(
    phase: MigrationPassPhase,
    taskId: string,
    stats: TaskStats,
    failures: estypes.BulkIndexByScrollFailure[],
  ) {
    const done = processed(stats);
    let percent = 0;
    if (stats.total > 0) {
      percent = Math.floor(Math.min(99, (done / stats.total) * 100));
    }
    const details = this.details(phase, percent, stats, taskId);
    details.failures = failures;
    safeCall(this.options.onProgress, details);
  }

  private details(
    phase: MigrationPhase,
    percent: number,
    stats: TaskStats,
    taskId: string,
    oldIndex = this.oldIndexes.join(","),
  ): MigrationProgressDetails {
    return {
      done: processed(stats),
      total: stats.total,
      percent,
      taskId,
      oldIndex,
      newIndex: this.newIndex,
      alias: this.alias,
      phase,
      failures: [],
    };
  }

  private succeed(
    first: MigrationPassReport,
    removed: string[],
    cleanupErrors: Error[],
    counts: MigrationOutcome["counts"] = null,
  ): MigrationOutcome {
    const stats = fromReport(first);
    for (const oldIndex of this.oldIndexes) {
      const details = this.details("done", 100, stats, first.taskId, oldIndex);
      safeCall(this.options.onProgress, details);
    }
    safeCall(
      this.options.onComplete,
      this.details("done", 100, stats, first.taskId),
    );
    return {
      ...this.outcomeBase("MIGRATED", "done"),
      removedIndexes: removed,
      counts,
      cleanupErrors,
    };
  }

  private failPass(pass: PassResult, phase: MigrationPassPhase) {
    if (pass.ok === true) {
      throw new Error("failPass() needs a failed pass");
    }
    return this.fail(pass.code, phase, pass.failure, {
      failures: pass.report?.failures ?? [],
    });
  }

  private fail(
    code: MigrationOutcomeCode,
    phase: MigrationPhase,
    failure: Failure,
    more: Partial<MigrationOutcome> = {},
  ): MigrationOutcome {
    safeCall(this.options.onError, failure.error);
    return {
      ...this.outcomeBase(code, phase),
      ...more,
      success: false,
      error: failure.error,
      errorKind: failure.errorKind,
    };
  }

  private outcomeBase(
    code: MigrationOutcomeCode,
    phase: MigrationPhase,
  ): MigrationOutcome {
    return {
      success: code === "MIGRATED",
      code,
      phase,
      oldIndexes: [...this.oldIndexes],
      newIndex: this.newIndex,
      alias: this.alias,
      swapped: this.swapped,
      removedIndexes: [],
      passes: [...this.passes],
      taskIds: [...this.taskIds],
      cancelled: this.cancelled,
      counts: null,
      failures: [],
      cleanupErrors: [],
      took: Date.now() - this.start,
      error: null,
      errorKind: null,
    };
  }

  /** A result whose `completion` is already settled */
  private immediate(
    code: Exclude<MigrationCode, "MIGRATION_STARTED" | "MIGRATION_RESUMED">,
    failure: Failure | null = null,
    response: unknown = null,
  ): MigrationResult {
    if (failure) {
      safeCall(this.options.onError, failure.error);
    }
    const success = isImmediateSuccess(code);
    const outcome: MigrationOutcome = {
      ...this.outcomeBase(code, success ? "done" : "start"),
      success,
      error: failure?.error ?? null,
      errorKind: failure?.errorKind ?? null,
    };
    return this.result(code, failure, response, Promise.resolve(outcome));
  }

  private result(
    code: MigrationCode,
    failure: Failure | null,
    response: unknown,
    completion: Promise<MigrationOutcome>,
  ): MigrationResult {
    return {
      success: isImmediateSuccess(code),
      code,
      status: this.status,
      newName: this.newIndex,
      aliasName: this.alias,
      oldNames: [...this.oldIndexes],
      recordsToMigrate: this.recordsToMigrate,
      createdIndex: this.createdIndex,
      createdAlias: this.createdAlias,
      resumed: this.resumed,
      attached: this.attached,
      taskId: this.taskId,
      request: this.request,
      completion,
      took: Date.now() - this.start,
      error: failure?.error ?? null,
      errorKind: failure?.errorKind ?? null,
      response: failure ? failure.response : response,
    };
  }
}

function normalizeParams(
  params: MigrationParams,
  start: number,
): MigrationOptions {
  const timeout =
    typeof params.timeout === "number" && params.timeout > 0
      ? params.timeout
      : null;
  let requestsPerSecond: number | null = null;
  if (
    typeof params.requestsPerSecond === "number" &&
    params.requestsPerSecond > 0
  ) {
    requestsPerSecond = params.requestsPerSecond;
  }
  let batchSize: number | null = null;
  if (typeof params.batchSize === "number" && params.batchSize > 0) {
    batchSize = Math.floor(params.batchSize);
  }
  return {
    onProgress: params.onProgress,
    onComplete: params.onComplete,
    onError: params.onError,
    slices: params.slices ?? 1,
    pollInterval: Math.max(
      POLL_FLOOR_MS,
      params.pollInterval ?? DEFAULT_POLL_MS,
    ),
    timeout,
    deadline: timeout === null ? Number.POSITIVE_INFINITY : start + timeout,
    maxPollErrors: Math.max(1, params.maxPollErrors ?? DEFAULT_MAX_POLL_ERRORS),
    requestsPerSecond,
    batchSize,
  };
}

function isImmediateSuccess(code: MigrationCode) {
  return (
    code === "CREATED" ||
    code === "ALIAS_CREATED" ||
    code === "CURRENT" ||
    code === "MIGRATION_STARTED" ||
    code === "MIGRATION_RESUMED"
  );
}

/**
 * Wait before the next status check: 100 ms, doubling up to the interval,
 * so short passes end quickly; after errors, the interval doubled per error
 */
function pollDelay(interval: number, polls: number, errors: number) {
  if (errors > 0) {
    return Math.min(MAX_BACKOFF_MS, interval * 2 ** errors);
  }
  return Math.min(interval, FIRST_POLL_MS * 2 ** polls);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Call a user callback; an exception in it must not stop the migration */
function safeCall<T>(fn: ((arg: T) => void) | undefined, arg: T) {
  if (!fn) {
    return;
  }
  try {
    fn(arg);
  } catch {
    // ignored: the migration state does not depend on callbacks
  }
}

function emptyStats(): TaskStats {
  return {
    total: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    version_conflicts: 0,
    noops: 0,
  };
}

function fromReport(report: MigrationPassReport): TaskStats {
  return {
    total: report.total,
    created: report.created,
    updated: report.updated,
    deleted: report.deleted,
    version_conflicts: report.versionConflicts,
    noops: report.noops,
  };
}

/** Documents a pass has dealt with: copied, skipped or failed over */
function processed(stats: TaskStats) {
  return (
    stats.created +
    stats.updated +
    stats.deleted +
    stats.version_conflicts +
    stats.noops
  );
}

/** Read reindex counters from a task status or response (missing → 0) */
function readStats(source: unknown): TaskStats {
  const stats = emptyStats();
  if (typeof source !== "object" || source === null) {
    return stats;
  }
  const record = source as Record<string, unknown>;
  for (const key of Object.keys(stats) as Array<keyof TaskStats>) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      stats[key] = value;
    }
  }
  return stats;
}

/**
 * Why a finished reindex task did not succeed, or null when it did: a task
 * `error`, bulk/search `failures`, a server-side timeout, or a cancellation
 */
function describeTaskProblem(
  task: estypes.TasksGetResponse,
  failures: estypes.BulkIndexByScrollFailure[],
  what: string,
): Error | null {
  if (task.error) {
    const reason = task.error.reason ?? task.error.type;
    return new Error(`${what} failed: ${reason}`, { cause: task.error });
  }
  const response = (task.response ?? {}) as Record<string, unknown>;
  if (failures.length > 0) {
    const causes = failures.map((failure) => {
      const reason = failure.cause?.reason ?? failure.cause?.type ?? "failed";
      return new Error(`[${failure.id}] ${reason}`, { cause: failure });
    });
    return new AggregateError(
      causes,
      `${what} failed for ${failures.length} document(s): ` +
        causes
          .slice(0, 3)
          .map((cause) => cause.message)
          .join("; "),
    );
  }
  if (response.timed_out === true) {
    return new Error(`${what} timed out on the server`);
  }
  if (typeof response.canceled === "string") {
    return new Error(`${what} was cancelled: ${response.canceled}`);
  }
  return null;
}

/** The error half of a step's envelope, or null when the step succeeded */
function getFailure(step: {
  error: Error | null;
  errorKind: IndexErrorKind | null;
  response?: unknown;
}): Failure | null {
  if (!step.error) {
    return null;
  }
  const errorKind = step.errorKind ?? "javascript";
  let response: Failure["response"] = null;
  if (errorKind === "response") {
    response = (step.response ?? null) as Failure["response"];
  }
  return { error: step.error, errorKind, response };
}

function getErrorType(failure: Failure) {
  const body = failure.response?.body as
    | { error?: { type?: string } }
    | null
    | undefined;
  return body?.error?.type;
}

function isAlreadyExists(failure: Failure) {
  return getErrorType(failure) === "resource_already_exists_exception";
}

function isResponseStatus(e: unknown, statusCode: number) {
  if (typeof e !== "object" || e === null) {
    return false;
  }
  const { name, meta } = e as {
    name?: unknown;
    meta?: { statusCode?: unknown };
  };
  return name === "ResponseError" && meta?.statusCode === statusCode;
}

/** A copy of the failure with a clearer message; the original is the cause */
function withMessage(failure: Failure, message: string): Failure {
  const error = new Error(`${message}: ${failure.error.message}`, {
    cause: failure.error,
  });
  error.name = failure.error.name;
  return { ...failure, error };
}

/**
 * The id (`node:id`) of a running, top-level reindex task writing into
 * `index`, from a `GET _tasks?detailed&group_by=none` response. The task
 * description reads `reindex from [a, b] to [index]`.
 */
export function findReindexInto(
  list: estypes.TasksListResponse,
  index: string,
): string | null {
  const suffix = ` to [${index}]`;
  for (const task of listTasks(list)) {
    if (task.parent_task_id || task.cancelled) {
      continue;
    }
    if (task.description?.endsWith(suffix)) {
      return `${task.node}:${task.id}`;
    }
  }
  return null;
}

function listTasks(list: estypes.TasksListResponse): estypes.TasksTaskInfo[] {
  const tasks: estypes.TasksTaskInfo[] = [];
  if (Array.isArray(list.tasks)) {
    tasks.push(...list.tasks);
  } else if (list.tasks) {
    tasks.push(...Object.values(list.tasks));
  }
  for (const node of Object.values(list.nodes ?? {})) {
    tasks.push(...Object.values(node.tasks ?? {}));
  }
  return tasks;
}
