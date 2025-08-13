import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import getEsClient from '../getEsClient/getEsClient';
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
    await new Promise(resolve => setTimeout(resolve, 1000));
    const found = await booksIndex.findByCriteria();
    if (found.error) {
      throw new Error(found.error);
    }
    const ids = found.records.map(r => r.id).sort();
    expect(ids).toEqual(['1', '2', '3']);
  });
});
