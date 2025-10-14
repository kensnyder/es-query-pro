import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { getBooksData, getBooksSchema } from '../testFixtures/books';
import IndexManager from './IndexManager';

describe('QueryBuilder - Integration', () => {
  const booksIndex = new IndexManager({
    index: {
      name: `books_${Date.now()}`,
      version: 1,
      prefix: 'test',
      language: 'english',
    },
    // analyzer: 'english',
    schema: getBooksSchema(),
    // settings: {
    //   // Specify fields (other than relevance) we might sort by to make sorting faster
    //   // See https://www.elastic.co/blog/index-sorting-elasticsearch-6-0
    //   index: {
    //     'sort.field': ['price'],
    //     'sort.order': ['asc'],
    //   },
    // },
  });

  beforeAll(async () => {
    await booksIndex.drop();
    const migration = await booksIndex.migrateIfNeeded();
    if (migration.error) {
      throw new Error(migration.error);
    }
    const bulk = await booksIndex.putBulk(getBooksData(), { refresh: true });
    if (bulk.error) {
      throw new Error(bulk.error);
    }
    const flush = await booksIndex.flush();
    if (flush.error) {
      throw new Error(flush.error);
    }
  });

  afterAll(async () => {
    await booksIndex.drop();
  });

  it('should work with no criteria', async () => {
    const found = await booksIndex.findByCriteria();
    if (found.error) {
      throw new Error(found.error);
    }
    const ids = found.records.map(r => r.id).sort();
    expect(ids).toEqual(['1', '2', '3']);
  });

  it('should match by phrase', async () => {
    const found = await booksIndex.findByPhrase({
      phrase: 'Potter',
    });
    if (found.error) {
      throw new Error(found.error);
    }
    const ids = found.records.map(r => r.id).sort();
    expect(ids).toEqual(['1', '2']);
  });

  it('should get count', async () => {
    const res = await booksIndex.run(runner => {
      runner.builder.matchPhrase('title', 'Chamber');
      return runner.count();
    });
    expect(res.request).toHaveProperty('index');
    expect(res.request).toHaveProperty('query');
    expect(res.total).toEqual(1);
  });

  it('should migrate data', async () => {
    booksIndex.index.version = 2;
    expect(booksIndex.getFullName()).toEndWith('~v2');
    await booksIndex.migrateIfNeeded();
    await booksIndex.flush();
    const res = await booksIndex.run(runner => {
      runner.builder.matchPhrase('title', 'Chamber');
      return runner.count();
    });
    expect(res.total).toEqual(1);
  });
});
