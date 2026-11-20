import type { Merge } from "type-fest";
import type IndexManager from "../IndexManager/IndexManager";
import type {
  IndexDropResult,
  IndexErrorKind,
  IndexLifecycleCode,
  IndexRecreateResult,
  MigrationOutcome,
  MigrationOutcomeCode,
  MigrationParams,
  MigrationResult,
  StatusReport,
  StatusSummary,
} from "../IndexManager/IndexManager";

/**
 * Any `IndexManager`, whatever its creation request. `any` keeps each
 * manager's own `Create` type when it is stored in a named map.
 */
export type AnyIndexManager = IndexManager<any>;

/** Indexes registered by name: `new SchemaRegistry({ books, authors })` */
export type SchemaNamedIndexes = Record<string, AnyIndexManager>;

/** The envelope every fleet operation resolves to */
export type SchemaFleetResult<Entry, Code extends string> = {
  /** True when every index succeeded (false for an empty registry) */
  success: boolean;
  took: number;
  /** One entry per registered index, in registration order */
  report: Entry[];
  /** The code of each index, keyed by full index name, in registration order */
  summary: Record<string, Code>;
  /**
   * The first error, in registration order (or the reason nothing ran);
   * null when no request failed
   */
  error: Error | null;
  errorKind: IndexErrorKind | null;
};

/**
 * What happened to one index in `migrateIfNeeded()`:
 * - `created`: the index and alias, or just the alias, were created
 *   (`CREATED`, `ALIAS_CREATED`)
 * - `migrated`: the data was copied to the new version (`MIGRATED`)
 * - `unchanged`: already current (`CURRENT`)
 * - `failed`: anything else, including a refusal without an error
 *   (`NEWER_VERSION_PRESENT`, `INCOMPARABLE_VERSION`, `ALIAS_CONFLICT`)
 */
export type SchemaMigrationOutcome =
  | "created"
  | "migrated"
  | "unchanged"
  | "failed";
export type SchemaMigrationReport = {
  fullName: string;
  aliasName: string;
  /** What happened to this index */
  outcome: SchemaMigrationOutcome;
  /**
   * How the index's migration ended (`MigrationOutcome.code`); `TIMEOUT`
   * when the registry's `timeout` ran out before it started; null when
   * `IndexManager.migrateIfNeeded()` itself rejected
   */
  code: MigrationOutcomeCode | null;
  /** The status the migration decided from; null if it was not read */
  before: StatusReport | null;
  /** Status after migrating; null when the migration did not run */
  after: StatusReport | null;
  /** The index's `completion` outcome; null when it did not run */
  migration: MigrationOutcome | null;
  /** The first error hit for this index, if any */
  error: Error | null;
  errorKind: IndexErrorKind | null;
  took: number;
};
/** What `completion` and `onAllComplete` receive from `migrateIfNeeded()` */
export type SchemaMigrationDetails = SchemaFleetResult<
  SchemaMigrationReport,
  SchemaMigrationOutcome
>;
export type SchemaMigrationParams = Merge<
  MigrationParams,
  {
    /**
     * Milliseconds for the whole run (default: no limit). Each index gets
     * the time left as its own `timeout`; an index not started in time is
     * reported as `TIMEOUT` without being touched.
     */
    timeout?: number;
    /** Called once with the same payload `completion` resolves to */
    onAllComplete?: (details: SchemaMigrationDetails) => void;
  }
>;

/** One index's `recreate()` in `recreateAll()` */
export type SchemaRecreateReport = {
  fullName: string;
  aliasName: string;
  success: boolean;
  /** `recreate()`'s code; `ERROR` when it rejected */
  code: SchemaRecreateCode;
  /** The `recreate()` result; null when it rejected */
  result: IndexRecreateResult | null;
  error: Error | null;
  errorKind: IndexErrorKind | null;
  took: number;
};
export type SchemaRecreateCode = IndexLifecycleCode | "ERROR";

/**
 * One index's `drop()` in `dropAll()`:
 * - `DROPPED`: deleted
 * - `MISSING`: there was no such index (counts as success)
 * - `ERROR`: the delete failed
 */
export type SchemaDropCode = "DROPPED" | "MISSING" | "ERROR";
export type SchemaDropReport = {
  fullName: string;
  aliasName: string;
  success: boolean;
  code: SchemaDropCode;
  /** The `drop()` result; null when it rejected */
  result: IndexDropResult | null;
  error: Error | null;
  errorKind: IndexErrorKind | null;
  took: number;
};

export type SchemaMigrationResultShape = Awaited<
  ReturnType<SchemaRegistry["migrateIfNeeded"]>
>;
export type SchemaStatusResultShape = Awaited<
  ReturnType<SchemaRegistry["getStatus"]>
>;
export type SchemaRecreateResultShape = Awaited<
  ReturnType<SchemaRegistry["recreateAll"]>
>;
export type SchemaDropResultShape = Awaited<
  ReturnType<SchemaRegistry["dropAll"]>
>;

type Failure = { error: Error; errorKind: IndexErrorKind };

const OUTCOME_BY_CODE: Partial<
  Record<MigrationOutcomeCode, SchemaMigrationOutcome>
> = {
  CREATED: "created",
  ALIAS_CREATED: "created",
  MIGRATED: "migrated",
  CURRENT: "unchanged",
};

const DEFAULT_CONCURRENCY = 2;

/**
 * Run `fn` over `items` with at most `concurrency` calls in flight, starting
 * them in order. Never rejects: resolves when every call has settled, with
 * one settled result per item, in input order.
 * @param concurrency  At least 1, rounded down (`Infinity`: all at once);
 *   anything else (0, negative, NaN) runs one at a time
 */
export async function runLimited<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => R | Promise<R>,
): Promise<PromiseSettledResult<Awaited<R>>[]> {
  const results: PromiseSettledResult<Awaited<R>>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next++;
      try {
        const value = await fn(items[i], i);
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  let limit = 1;
  if (concurrency >= 1) {
    limit = Math.floor(concurrency);
  }
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/** A configuration problem, reported in the envelope instead of thrown */
function configFailure(error: Error): Failure {
  return { error, errorKind: "configuration" };
}

function checkConcurrency(concurrency: unknown): Failure | null {
  if (typeof concurrency !== "number" || !(concurrency >= 1)) {
    return configFailure(
      new RangeError(
        `SchemaRegistry: concurrency must be a number of at least 1; got ${String(concurrency)}`,
      ),
    );
  }
  return null;
}

function toError(thrown: unknown): Error {
  if (thrown instanceof Error) {
    return thrown;
  }
  return new Error(String(thrown), { cause: thrown });
}

/** Classify a thrown value the way IndexManager does, when it can */
function toFailure(index: AnyIndexManager, thrown: unknown): Failure {
  try {
    const formatted = index._formatError(thrown);
    return { error: formatted.error, errorKind: formatted.errorKind };
  } catch {
    return { error: toError(thrown), errorKind: "javascript" };
  }
}

function safeCall<A>(callback: ((arg: A) => void) | undefined, arg: A) {
  try {
    callback?.(arg);
  } catch {
    // a throwing callback must not break the run (as in IndexManager)
  }
}

function timeoutError(timeout: number) {
  const error = new Error(
    `SchemaRegistry: timeout of ${timeout}ms ran out before this index started`,
  );
  error.name = "MigrationTimeoutError";
  return error;
}

/** Whether a failed drop means the index was not there */
function isMissingIndex(result: IndexDropResult) {
  if (result.errorKind !== "response") {
    return false;
  }
  const meta = result.response as {
    statusCode?: number | null;
    body?: { error?: { type?: string } };
  } | null;
  return (
    meta?.statusCode === 404 &&
    meta.body?.error?.type === "index_not_found_exception"
  );
}

function emptySiblings() {
  return { all: [], older: [], newer: [], incomparable: [], unrelated: [] };
}

/**
 * A collection of `IndexManager`s for fleet-wide operations: create or
 * migrate, recreate, check and drop every registered index.
 *
 * Operations never throw or reject. Each resolves to the same envelope
 * (`SchemaFleetResult`): `success`, `took`, `report` (one entry per index, in
 * registration order), `summary` (a code per full index name), `error` and
 * `errorKind`. An empty registry or an invalid `concurrency`/`timeout` is
 * reported with `errorKind: 'configuration'` and nothing is sent.
 *
 * Registration is checked at once: an index is registered once per full name
 * (later copies are ignored), and two different versions of the same alias
 * throw.
 *
 * Pass a named map to keep each index's type:
 * `new SchemaRegistry({ books, authors }).get('books')`.
 */
export default class SchemaRegistry<
  Named extends SchemaNamedIndexes = Record<never, never>,
> {
  // Yes, I know the proper term is "indices"
  /** Registered indexes, in registration order; use `register()` to add */
  public readonly indexes: AnyIndexManager[] = [];

  private readonly named: Named;

  /**
   * @param indexes  Indexes to register, as an array or a named map
   * @throws {Error} When two indexes share an alias but not a full name
   */
  constructor(indexes?: AnyIndexManager[]);
  constructor(indexes: Named);
  constructor(indexes: AnyIndexManager[] | Named = []) {
    if (Array.isArray(indexes)) {
      this.named = {} as Named;
      this.registerAll(indexes);
    } else {
      this.named = { ...indexes };
      this.registerAll(Object.values(indexes));
    }
  }

  /**
   * Register an index. One already registered under the same full name is
   * ignored.
   * @throws {Error} When another version of the same alias is registered
   */
  register(index: AnyIndexManager) {
    return this.registerAll([index]);
  }

  /**
   * Register several indexes, in order; all or none.
   * @throws {Error} When two of them, or one and a registered index, share
   *   an alias but not a full name
   */
  registerAll(indexes: readonly AnyIndexManager[]) {
    const byAlias = new Map<string, string>();
    for (const index of this.indexes) {
      byAlias.set(index.getAliasName(), index.getFullName());
    }
    const added: AnyIndexManager[] = [];
    for (const index of indexes) {
      const alias = index.getAliasName();
      const fullName = index.getFullName();
      const existing = byAlias.get(alias);
      if (existing === fullName) {
        continue;
      }
      if (existing !== undefined) {
        throw new Error(
          `SchemaRegistry: alias "${alias}" is already registered for ` +
            `${existing}; cannot also register ${fullName}`,
        );
      }
      byAlias.set(alias, fullName);
      added.push(index);
    }
    this.indexes.push(...added);
    return this;
  }

  /** The index registered under `name` (named-map registries only) */
  get<Name extends keyof Named>(name: Name): Named[Name] {
    return this.named[name];
  }

  /** The named map given to the constructor (empty for an array) */
  getNamedIndexes(): Readonly<Named> {
    return this.named;
  }

  listIndexes() {
    return this.indexes.map((index) => ({
      alias: index.getAliasName(),
      name: index.getFullName(),
      version: index.index.version,
    }));
  }

  /** Registered indexes keyed by alias name */
  getIndexLookup() {
    const map: Record<string, AnyIndexManager> = {};
    for (const index of this.indexes) {
      map[index.getAliasName()] = index;
    }
    return map;
  }

  /** Why nothing can run, or null */
  private _checkRunnable(operation: string): Failure | null {
    if (this.indexes.length === 0) {
      return configFailure(
        new Error(
          `No indexes registered in SchemaRegistry; cannot ${operation}`,
        ),
      );
    }
    return null;
  }

  /**
   * Create or migrate every registered index, one at a time, in registration
   * order. Resolves as soon as the work is kicked off; await `completion`
   * (or pass `onAllComplete`) for the report. Each index's own `completion`
   * is awaited before the next one starts.
   * @param params  `IndexManager.migrateIfNeeded()` options, passed to every
   *   index, plus `onAllComplete`, and `timeout` for the whole run
   * @returns `acknowledged`, `error`, `errorKind` and `completion`, which
   *   never rejects. `acknowledged` is false (and `completion` already
   *   settled) for an empty registry or an invalid `timeout`. `onError` is
   *   called once per distinct error; `onProgress` and `onComplete` are
   *   passed to each index.
   */
  async migrateIfNeeded(params: SchemaMigrationParams = {}): Promise<{
    acknowledged: boolean;
    error: Error | null;
    errorKind: IndexErrorKind | null;
    completion: Promise<SchemaMigrationDetails>;
  }> {
    const start = Date.now();
    const { onAllComplete, timeout, ...indexParams } = params;
    const failure =
      this._checkRunnable("migrateIfNeeded") ?? checkTimeout(timeout);
    if (failure) {
      return {
        acknowledged: false,
        ...failure,
        completion: Promise.resolve({
          success: false,
          took: 0,
          report: [],
          summary: {},
          ...failure,
        }),
      };
    }
    const deadline =
      timeout === undefined ? Number.POSITIVE_INFINITY : start + timeout;
    const indexes = [...this.indexes];
    const notified = new Set<Error>();
    const onError = (error: Error) => {
      if (!notified.has(error)) {
        notified.add(error);
        safeCall(params.onError, error);
      }
    };
    const completion = (async () => {
      const report: SchemaMigrationReport[] = [];
      for (const index of indexes) {
        const entry = await this._migrateOne(index, {
          ...indexParams,
          slices: indexParams.slices ?? 1,
          pollInterval: indexParams.pollInterval ?? 1000,
          onError,
          deadline,
          timeout,
        });
        if (entry.error) {
          onError(entry.error);
        }
        report.push(entry);
      }
      const details = fleetResult(start, report, (entry) => ({
        ok: entry.outcome !== "failed",
        code: entry.outcome,
      }));
      safeCall(onAllComplete, details);
      return details;
    })();
    return {
      acknowledged: true,
      error: null,
      errorKind: null,
      completion,
    };
  }

  /**
   * Migrate a single index and wait for its `completion`. Never rejects:
   * failures are captured on the returned report entry.
   */
  async _migrateOne(
    index: AnyIndexManager,
    {
      deadline,
      timeout,
      ...params
    }: MigrationParams & { deadline: number; timeout?: number },
  ): Promise<SchemaMigrationReport> {
    const start = Date.now();
    const entry: SchemaMigrationReport = {
      fullName: index.getFullName(),
      aliasName: index.getAliasName(),
      outcome: "failed",
      code: null,
      before: null,
      after: null,
      migration: null,
      error: null,
      errorKind: null,
      took: 0,
    };
    const finish = (failure: Failure | null = null) => {
      if (failure) {
        entry.error = failure.error;
        entry.errorKind = failure.errorKind;
      }
      entry.took = Date.now() - start;
      return entry;
    };
    const left = deadline - Date.now();
    if (left <= 0) {
      entry.code = "TIMEOUT";
      return finish({
        error: timeoutError(timeout ?? 0),
        errorKind: "timeout",
      });
    }
    let result: MigrationResult;
    let outcome: MigrationOutcome;
    try {
      result = await index.migrateIfNeeded({
        ...params,
        ...(Number.isFinite(left) ? { timeout: left } : {}),
      });
      entry.before = result.status;
      outcome = await result.completion;
    } catch (e) {
      return finish(toFailure(index, e));
    }
    entry.migration = outcome;
    entry.code = outcome.code;
    entry.outcome = OUTCOME_BY_CODE[outcome.code] ?? "failed";
    entry.after = await this._readStatus(index);
    if (outcome.error) {
      return finish({
        error: outcome.error,
        errorKind: outcome.errorKind ?? "javascript",
      });
    }
    return finish();
  }

  /** `getStatus()` that never rejects */
  private async _readStatus(index: AnyIndexManager): Promise<StatusReport> {
    try {
      return await index.getStatus();
    } catch (e) {
      return unknownStatus(
        { fullName: index.getFullName(), aliasName: index.getAliasName() },
        toFailure(index, e),
      );
    }
  }

  /**
   * Drop and recreate every registered index (see `IndexManager.recreate()`),
   * at most `concurrency` at a time. Deletes all their data.
   * @param concurrency  How many indexes at once (default 2)
   * @returns The fleet envelope; `summary` holds each `recreate()` code
   *   (`ERROR` when it rejected), and `success` is true only when every
   *   `recreate()` succeeded
   */
  async recreateAll(concurrency = DEFAULT_CONCURRENCY) {
    return this._runAll<SchemaRecreateReport, SchemaRecreateCode>(
      "recreateAll",
      concurrency,
      async (index, base) => {
        const result = await index.recreate();
        return {
          ...base(),
          success: result.success,
          code: result.code,
          result,
          error: result.error,
          errorKind: result.errorKind,
        };
      },
      (base, failure) => ({
        ...base,
        success: false,
        code: "ERROR",
        result: null,
        ...failure,
      }),
      (entry) => ({ ok: entry.success, code: entry.code }),
    );
  }

  /**
   * Read every registered index's status (see `IndexManager.getStatus()`),
   * at most `concurrency` at a time.
   * @param concurrency  How many indexes at once (default 2)
   * @returns The fleet envelope; `report` holds each `StatusReport` and
   *   `summary` each `StatusSummary`. `success` is true when every status
   *   could be read (whatever it says).
   */
  async getStatus(concurrency = DEFAULT_CONCURRENCY) {
    return this._runAll<StatusReport, StatusSummary>(
      "getStatus",
      concurrency,
      (index) => index.getStatus(),
      (base, failure) => unknownStatus(base, failure),
      (entry) => ({ ok: entry.error === null, code: entry.summary }),
    );
  }

  /**
   * Delete every registered index and all its data, at most `concurrency`
   * at a time. There is no confirmation step, just as Elasticsearch's own
   * `DELETE /<index>` has none.
   *
   * Only each manager's current versioned index (`getFullName()`) is
   * deleted, with its aliases. Older versioned indexes of the same name
   * (e.g. `v1` when the manager is at `v2`) are left in place, even when
   * the alias still points at them.
   * @param concurrency  How many indexes at once (default 2)
   * @returns The fleet envelope; `summary` is `DROPPED`, `MISSING` (no such
   *   index; counts as success) or `ERROR` per index
   */
  async dropAll(concurrency = DEFAULT_CONCURRENCY) {
    return this._runAll<SchemaDropReport, SchemaDropCode>(
      "dropAll",
      concurrency,
      async (index, base) => {
        const result = await index.drop();
        if (!result.error) {
          return {
            ...base(),
            success: true,
            code: "DROPPED",
            result,
            error: null,
            errorKind: null,
          };
        }
        if (isMissingIndex(result)) {
          return {
            ...base(),
            success: true,
            code: "MISSING",
            result,
            error: null,
            errorKind: null,
          };
        }
        return {
          ...base(),
          success: false,
          code: "ERROR",
          result,
          error: result.error,
          errorKind: result.errorKind,
        };
      },
      (base, failure) => ({
        ...base,
        success: false,
        code: "ERROR",
        result: null,
        ...failure,
      }),
      (entry) => ({ ok: entry.success, code: entry.code }),
    );
  }

  /**
   * Run `run` over every index with at most `concurrency` in flight, and
   * build the fleet envelope from the entries.
   * @param run  One index's entry
   * @param onThrow  The entry for an index whose `run` rejected (must not
   *   throw)
   * @param read  Whether an entry succeeded, and its summary code
   */
  private async _runAll<
    Entry extends {
      fullName: string;
      error: Error | null;
      errorKind: IndexErrorKind | null;
    },
    Code extends string,
  >(
    operation: string,
    concurrency: number,
    run: (index: AnyIndexManager, base: () => EntryBase) => Promise<Entry>,
    onThrow: (base: EntryBase, failure: Failure) => Entry,
    read: (entry: Entry) => { ok: boolean; code: Code },
  ): Promise<SchemaFleetResult<Entry, Code>> {
    const start = Date.now();
    const failure =
      this._checkRunnable(operation) ?? checkConcurrency(concurrency);
    if (failure) {
      return {
        success: false,
        took: Date.now() - start,
        report: [],
        summary: {},
        ...failure,
      };
    }
    const indexes = [...this.indexes];
    const names = indexes.map((index) => ({
      fullName: index.getFullName(),
      aliasName: index.getAliasName(),
    }));
    const results = await runLimited(
      indexes,
      Math.floor(concurrency),
      async (index, i) => {
        const began = Date.now();
        const base = () => ({ ...names[i], took: Date.now() - began });
        try {
          return await run(index, base);
        } catch (e) {
          return onThrow(base(), toFailure(index, e));
        }
      },
    );
    const report = results.map((settled, i) => {
      if (settled.status === "fulfilled") {
        return settled.value;
      }
      // not reachable: onThrow only builds an object
      return onThrow(
        { ...names[i], took: 0 },
        { error: toError(settled.reason), errorKind: "javascript" },
      );
    });
    return fleetResult(start, report, read);
  }
}

export type EntryBase = { fullName: string; aliasName: string; took: number };

function checkTimeout(timeout: unknown): Failure | null {
  if (timeout === undefined) {
    return null;
  }
  if (typeof timeout !== "number" || !(timeout > 0)) {
    return configFailure(
      new RangeError(
        `SchemaRegistry: timeout must be a positive number of milliseconds; got ${String(timeout)}`,
      ),
    );
  }
  return null;
}

function fleetResult<
  Entry extends {
    fullName: string;
    error: Error | null;
    errorKind: IndexErrorKind | null;
  },
  Code extends string,
>(
  start: number,
  report: Entry[],
  read: (entry: Entry) => { ok: boolean; code: Code },
): SchemaFleetResult<Entry, Code> {
  const summary: Record<string, Code> = {};
  let success = true;
  let firstError: Entry | null = null;
  for (const entry of report) {
    const { ok, code } = read(entry);
    summary[entry.fullName] = code;
    if (!ok) {
      success = false;
    }
    if (entry.error && firstError === null) {
      firstError = entry;
    }
  }
  return {
    success,
    took: Date.now() - start,
    report,
    summary,
    error: firstError?.error ?? null,
    errorKind: firstError?.errorKind ?? null,
  };
}

/** The status of an index whose `getStatus()` rejected */
function unknownStatus(
  names: { fullName: string; aliasName: string; took?: number },
  failure: Failure,
): StatusReport {
  return {
    took: names.took ?? 0,
    fullName: names.fullName,
    aliasName: names.aliasName,
    indexExists: null,
    aliasExists: null,
    aliasIndexes: [],
    aliasAttached: null,
    siblings: emptySiblings(),
    needsMigration: false,
    needsCreation: false,
    summary: "unknown",
    error: failure.error,
    errorKind: failure.errorKind,
  };
}
