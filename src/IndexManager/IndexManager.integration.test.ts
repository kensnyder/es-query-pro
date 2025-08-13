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
    analyzer: 'english',
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
    const creation = await booksIndex.create();
    const put = await booksIndex.putBulk(getBooksData());
    const flush = await booksIndex.flush();
    console.log('flush', JSON.stringify(creation, null, 2));
  });

  afterAll(async () => {
    await booksIndex.drop();
  });

  it('should work with no criteria', async () => {
    const found = await booksIndex.findByCriteria();
    console.log(`findByCriteria found=${JSON.stringify(found, null, 2)}`);
    const ids = found.records.map(r => r.id).sort();
    expect(ids).toEqual(['1', '2', '3']);
  });
});
