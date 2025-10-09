import { estypes } from '@elastic/elasticsearch';
import IndexManager, {
  DropResult,
  MigrationCode,
  MigrationReport,
  StatusReport,
} from '../IndexManager/IndexManager';

export type MigrationResultShape = Awaited<
  ReturnType<SchemaRegistry['migrateIfNeeded']>
>;
export type StatusResultShape = Awaited<
  ReturnType<SchemaRegistry['getStatus']>
>;
export type DropResultShape = Awaited<ReturnType<SchemaRegistry['dropAll']>>;

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

  private chunkify<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async migrateIfNeeded(concurrency = 2) {
    const start = Date.now();
    const report: MigrationReport[] = [];
    const summary: Record<string, MigrationCode> = {};
    try {
      const groups = this.chunkify(this.indexes, concurrency);
      await Promise.all(
        groups.map(async group => {
          for (const index of group) {
            const result = await index.migrateIfNeeded();
            report.push(result);
            summary[index.getAliasName()] = result.code;
          }
        })
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

  async getStatus(concurrency = 2) {
    const start = Date.now();
    const report: StatusReport[] = [];
    const summary: Record<
      string,
      'needsCreation' | 'current' | 'needsMigration'
    > = {};
    try {
      const groups = this.chunkify(this.indexes, concurrency);
      await Promise.all(
        groups.map(async group => {
          for (const index of group) {
            const status = await index.getStatus();
            report.push(status);
            summary[index.getAliasName()] = status.needsCreation
              ? 'needsCreation'
              : status.needsMigration
                ? 'needsMigration'
                : 'current';
          }
        })
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
    const results: DropResult[] = [];
    try {
      const groups = this.chunkify(this.indexes, concurrency);
      await Promise.all(
        groups.map(async group => {
          for (const index of group) {
            results.push(await index.drop());
          }
        })
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
