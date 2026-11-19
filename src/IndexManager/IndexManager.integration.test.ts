import { afterAll, beforeAll, describe, expect, it, jest } from 'bun:test';
import { getBooksData, getBooksSchema } from '../testFixtures/books';
import IndexManager, { type MigrationProgressDetails } from './IndexManager';

describe('QueryBuilder - Integration', () => {
  const booksIndex = new IndexManager({
    index: {
      name: `books_${Date.now()}`,
      version: 1,
      prefix: 'test',
      language: 'english',
    },
    schema: getBooksSchema(),
  });

  beforeAll(async () => {
    await booksIndex.drop();
    const created = await booksIndex.create();
    if (created.error) {
      throw new Error(created.error);
    }
    await booksIndex.createAlias();
    const bulk = await booksIndex.putBulk(getBooksData(), { refresh: true });
    if (bulk.errors.length > 0) {
      throw new Error(bulk.errors.join('\n'));
    }
    const flush = await booksIndex.flush();
    if (flush.error) {
      throw new Error(flush.error);
    }
  });

  afterAll(async () => {
    const indexes = await booksIndex.client.cat.indices({
      index: 'test~english~books_*',
      format: 'json',
    });
    for (const { index } of indexes) {
      await booksIndex.client.indices.delete({ index });
    }
  });

  it('should work with no criteria', async () => {
    const found = await booksIndex.findMany();
    if (found.error) {
      throw new Error(found.error);
    }
    const ids = found.records.map((r) => r.id).sort();
    expect(ids).toEqual(['1', '2', '3']);
  });

  it('should get count', async () => {
    const res = await booksIndex.run((runner) => {
      runner.builder.matchPhrase({ field: 'title', phrase: 'Chamber' });
      return runner.count();
    });
    expect(res.request).toHaveProperty('index');
    expect(res.request).toHaveProperty('query');
    expect(res.total).toEqual(1);
  });

  it('should put a record and read it back unchanged', async () => {
    const record = {
      id: 900001,
      title: 'Put Round Trip',
      premise: 'A record goes in and the same record comes out',
      country: 'US',
    };
    const put = await booksIndex.put(record.id, record);
    expect(put.error).toBe(null);
    expect(put.result).toBe('created');
    const found = await booksIndex.findById(String(record.id));
    expect(found.error).toBe(null);
    expect(found.record).toEqual(record);
    await booksIndex.deleteById(String(record.id));
  });

  it('should patch only the given fields', async () => {
    const record = {
      id: 900002,
      title: 'Patch Round Trip',
      premise: 'Before',
      country: 'US',
    };
    await booksIndex.put(record.id, record);
    const patched = await booksIndex.patch(String(record.id), {
      premise: 'After',
    });
    expect(patched.error).toBe(null);
    expect(patched.success).toBe(true);
    const found = await booksIndex.findById(String(record.id));
    expect(found.record).toEqual({ ...record, premise: 'After' });
    await booksIndex.deleteById(String(record.id));
  });

  it('should migrate data', async () => {
    expect((await booksIndex.count()).total).toBe(3);
    booksIndex.index.version = 2;
    expect(booksIndex.getFullName()).toEndWith('~v2');
    const status = await booksIndex.getStatus();
    expect(status.indexExists).toBe(false);
    expect(status.aliasExists).toBe(true);
    expect(status.needsMigration).toBe(true);
    expect(status.needsCreation).toBe(false);

    let resolveDone: (() => void) | null = null;
    let timeoutId: number | null = null;
    const donePromise = new Promise<void>((resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Migration progress wait timed out after 4500ms'));
      }, 4500) as unknown as number;
      resolveDone = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId as unknown as number);
          timeoutId = null;
        }
        resolve();
      };
    });

    const onProgress = jest.fn((details: MigrationProgressDetails) => {
      if (details.percent === 100) {
        if (resolveDone !== null) {
          resolveDone();
        }
      }
    });

    const migration = await booksIndex.migrateIfNeeded({
      onProgress,
    });
    expect(migration.recordsToMigrate).toBe(3);
    expect(migration.createdAlias).toBe(false);
    expect(migration.createdIndex).toBe(true);

    await donePromise;

    expect((await booksIndex.count()).total).toBe(3);
    expect(onProgress).toHaveBeenCalled();
    const calls = onProgress.mock
      .calls as unknown as MigrationProgressDetails[];
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall.done).toBe(3);
    expect(lastCall.total).toBe(3);
    expect(lastCall.percent).toBe(100);
    const { total } = await booksIndex.count((qb) => {
      qb.matchPhrase({ field: 'title', phrase: 'Chamber' });
    });
    expect(total).toEqual(1);
  });
});
