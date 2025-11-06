import { estypes } from '@elastic/elasticsearch';
import type IndexManager from '../IndexManager/IndexManager';
import type {
  IndexDropResult,
  IndexRecreateResult,
  IndexStatusReport,
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

  async migrateIfNeeded({
    onProgress,
    onComplete,
    slices = 1,
    pollInterval = 1000,
  }: {
    onProgress?: (details: MigrationProgressDetails) => void;
    onComplete?: (details: {
      took: number;
      report: StatusReport[];
      summary: Record<string, StatusReport['summary']>;
    }) => void;
    slices?: number;
    pollInterval?: number;
  } = {}) {
    const start = Date.now();
    if (this.indexes.length === 0) {
      return {
        acknowledge: false,
        error: new Error(
          'No indexes registered in SchemaRegistry; cannot migrateIfNeeded',
        ),
      };
    }
    const report: StatusReport[] = [];
    const summary: Record<string, StatusReport['summary']> = {};
    (async () => {
      for (const index of this.indexes) {
        const status = await index.getStatus();
        await new Promise(async (resolve, reject) => {
          const migration = await index.migrateIfNeeded({
            slices,
            pollInterval,
            onProgress: (progress) => {
              if (progress.percent === 100) {
                report.push(status);
                summary[index.getFullName()] = status.summary;
                resolve('done');
              }
              onProgress(progress);
            },
          });
          if (migration.error) {
            reject(migration.error);
          }
        });
      }
      onComplete({ report, summary, took: Date.now() - start });
    })();
    return {
      acknowledged: true,
      error: null,
    };
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
