import { estypes } from '@elastic/elasticsearch';
import type { Merge } from 'type-fest';
import type IndexManager from '../IndexManager/IndexManager';
import type {
  IndexDropResult,
  IndexRecreateResult,
  IndexStatusReport,
  MigrationParams,
  MigrationProgressDetails,
  StatusReport,
} from '../IndexManager/IndexManager';

export type SchemaMigrationResultShape = Awaited<
  ReturnType<SchemaRegistry['migrateIfNeeded']>
>;
export type SchemaStatusResultShape = Awaited<
  ReturnType<SchemaRegistry['getStatus']>
>;
export type SchemaDropResultShape = Awaited<
  ReturnType<SchemaRegistry['dropAll']>
>;

export type SchemaMigrationOutcome =
  | 'created'
  | 'migrated'
  | 'unchanged'
  | 'failed';
export type SchemaMigrationReport = {
  fullName: string;
  aliasName: string;
  /** What happened to this index */
  outcome: SchemaMigrationOutcome;
  /** Status before migrating; null if it could not be read */
  before: StatusReport | null;
  /** Status after migrating; null if it could not be read */
  after: StatusReport | null;
  /** The first error hit for this index, if any */
  error: Error | null;
  took: number;
};
export type SchemaMigrationDetails = {
  /** True when no index failed */
  success: boolean;
  took: number;
  /** One entry per registered index, in registration order */
  report: SchemaMigrationReport[];
  /** Outcome keyed by full index name */
  summary: Record<string, SchemaMigrationOutcome>;
};
export type SchemaMigrationParams = Merge<
  MigrationParams,
  { onAllComplete?: (details: SchemaMigrationDetails) => void }
>;

const OUTCOME_BY_PRIOR_STATUS: Record<
  StatusReport['summary'],
  SchemaMigrationOutcome
> = {
  needsCreation: 'created',
  needsMigration: 'migrated',
  current: 'unchanged',
};

export default class SchemaRegistry {
  // Yes, I know the proper term is "indices"
  public indexes: IndexManager[];

  constructor(indexes: IndexManager[] = []) {
    this.indexes = indexes;
  }

  register(index: IndexManager) {
    this.indexes.push(index);
    return this;
  }

  registerAll(indexes: IndexManager[]) {
    this.indexes.push(...indexes);
    return this;
  }

  public chunkify<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Create or migrate every registered index, one at a time.
   * Resolves as soon as the work is kicked off; await `completion` (or pass
   * `onAllComplete`) to get the per-index before/after report.
   * `onError` is called once per distinct error; failed indexes are also
   * listed in the report with `outcome: 'failed'`.
   */
  async migrateIfNeeded({
    onProgress,
    onComplete,
    onAllComplete,
    onError,
    slices = 1,
    pollInterval = 1000,
  }: SchemaMigrationParams = {}) {
    const start = Date.now();
    if (this.indexes.length === 0) {
      const details: SchemaMigrationDetails = {
        success: false,
        took: 0,
        report: [],
        summary: {},
      };
      return {
        acknowledged: false,
        error: new Error(
          'No indexes registered in SchemaRegistry; cannot migrateIfNeeded',
        ),
        completion: Promise.resolve(details),
      };
    }
    const indexes = [...this.indexes];
    const completion = (async () => {
      const report: SchemaMigrationReport[] = [];
      const summary: Record<string, SchemaMigrationOutcome> = {};
      for (const index of indexes) {
        const entry = await this._migrateOne(index, {
          onProgress,
          onComplete,
          onError,
          slices,
          pollInterval,
        });
        report.push(entry);
        summary[entry.fullName] = entry.outcome;
      }
      const details: SchemaMigrationDetails = {
        success: report.every((entry) => entry.error === null),
        took: Date.now() - start,
        report,
        summary,
      };
      try {
        onAllComplete?.(details);
      } catch (e) {
        console.error(e);
      }
      return details;
    })();
    return {
      acknowledged: true,
      error: null,
      completion,
    };
  }

  /**
   * Migrate a single index and wait for any background reindexing to finish.
   * Never rejects: failures are captured on the returned report entry.
   */
  async _migrateOne(
    index: IndexManager,
    { onProgress, onComplete, onError, slices, pollInterval }: MigrationParams,
  ): Promise<SchemaMigrationReport> {
    const start = Date.now();
    const entry: SchemaMigrationReport = {
      fullName: index.getFullName(),
      aliasName: index.getAliasName(),
      outcome: 'failed',
      before: null,
      after: null,
      error: null,
      took: 0,
    };
    // IndexManager reports some failures through onError, some through the
    // result envelope, and some through both; notify once per error
    const notified = new Set<Error>();
    const fail = (thrown: unknown) => {
      const error =
        thrown instanceof Error ? thrown : new Error(String(thrown));
      if (entry.error === null) {
        entry.error = error;
      }
      if (notified.has(error)) {
        return;
      }
      notified.add(error);
      try {
        onError?.(error);
      } catch (e) {
        console.error(e);
      }
    };
    try {
      entry.before = await index.getStatus();
      // number of reindex tasks we are waiting on; unknown until
      // index.migrateIfNeeded() returns
      let expected = Number.POSITIVE_INFINITY;
      let finished = 0;
      let settle = () => {};
      const settled = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const settleIfDone = () => {
        if (entry.error !== null || finished >= expected) {
          settle();
        }
      };
      const migration = await index.migrateIfNeeded({
        slices,
        pollInterval,
        onComplete,
        onError: (error) => {
          fail(error);
          settleIfDone();
        },
        onProgress: (progress) => {
          onProgress?.(progress);
          if (progress.percent === 100) {
            finished++;
            settleIfDone();
          }
        },
      });
      if (migration.error) {
        fail(migration.error);
      } else {
        // Reindexing continues in the background only when there were
        // records to copy (one task per old index); every other path is
        // already done
        if (migration.recordsToMigrate > 0) {
          expected = migration.oldNames.length;
        } else {
          expected = 0;
        }
        settleIfDone();
        await settled;
      }
    } catch (e) {
      fail(e);
    }
    if (entry.before !== null) {
      try {
        entry.after = await index.getStatus();
      } catch (e) {
        if (entry.error === null) {
          fail(e);
        }
      }
    }
    if (entry.error === null && entry.before !== null) {
      entry.outcome = OUTCOME_BY_PRIOR_STATUS[entry.before.summary];
    }
    entry.took = Date.now() - start;
    return entry;
  }

  async recreateAll(concurrency = 2) {
    const start = Date.now();
    if (this.indexes.length === 0) {
      throw new Error(
        'No indexes registered in SchemaRegistry; cannot recreateAll',
      );
    }
    const report: IndexRecreateResult[] = [];
    const summary: Record<string, string> = {};
    try {
      const groups = this.chunkify(this.indexes, concurrency);
      await Promise.all(
        groups.map((group) => {
          return (async () => {
            for (const index of group) {
              try {
                const result = await index.recreate();
                report.push(result);
                summary[index.getFullName()] = 'SUCCESS';
              } catch (_error) {
                summary[index.getFullName()] = 'ERROR';
              }
            }
          })();
        }),
      );
      return {
        success: true,
        took: Date.now() - start,
        report,
        summary,
        error: null,
      };
    } catch (e) {
      console.error(e);
      return {
        success: false,
        took: Date.now() - start,
        report,
        summary,
        error: (e as Error).message,
      };
    }
  }

  listIndexes() {
    return this.indexes.map((index) => ({
      alias: index.getAliasName(),
      name: index.getFullName(),
      version: index.schema.schema.version,
    }));
  }

  getIndexLookup() {
    const map: Record<string, IndexManager> = {};
    for (const index of this.indexes) {
      map[index.getAliasName()] = index;
    }
    return map;
  }

  async getStatus(concurrency = 2) {
    const start = Date.now();
    const report: IndexStatusReport[] = [];
    const summary: Record<
      string,
      'needsCreation' | 'current' | 'needsMigration'
    > = {};
    try {
      const groups = this.chunkify(this.indexes, concurrency);
      await Promise.all(
        groups.map(async (group) => {
          return (async () => {
            for (const index of group) {
              const status = await index.getStatus();
              report.push(status);
              summary[index.getFullName()] = status.summary;
            }
          })();
        }),
      );
      return {
        success: true,
        took: Date.now() - start,
        report,
        summary,
        error: null,
      };
    } catch (e) {
      return {
        success: true,
        took: Date.now() - start,
        report,
        summary,
        error: (e as Error).message,
      };
    }
  }

  async dropAll(concurrency = 2) {
    const start = Date.now();
    const results: IndexDropResult[] = [];
    try {
      const groups = this.chunkify(this.indexes, concurrency);
      await Promise.all(
        groups.map(async (group) => {
          for (const index of group) {
            results.push(await index.drop());
          }
        }),
      );
      return {
        success: true,
        took: Date.now() - start,
        results,
        error: null,
      };
    } catch (e) {
      return {
        success: true,
        took: Date.now() - start,
        results,
        error: (e as Error).message,
      };
    }
  }
}
