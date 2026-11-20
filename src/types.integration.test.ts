import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import IndexManager from './IndexManager/IndexManager';
import QueryBuilder from './QueryBuilder/QueryBuilder';
import { getBooksCreateRequest, getBooksData } from './testFixtures/books';
import { createTestKit } from './testFixtures/esTestKit';
import type { IndexExistParams, RangeShape } from './types';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('types');

afterAll(async () => {
  await kit.cleanup();
});

describe('IndexExistParams with IndexManager.exists() (B-079)', () => {
  const books = new IndexManager(
    { client: kit.client, prefix: kit.prefix, version: 1 },
    getBooksCreateRequest('books'),
  );
  const missing = new IndexManager(
    { client: kit.client, prefix: kit.prefix, version: 1 },
    getBooksCreateRequest('missing'),
  );

  beforeAll(async () => {
    const created = await books.create();
    if (created.error) {
      throw created.error;
    }
  });

  const optionSets: Partial<IndexExistParams>[] = [
    { flat_settings: true },
    { include_defaults: true },
    { flat_settings: false, include_defaults: false },
    { ignore_unavailable: false, allow_no_indices: true },
    { expand_wildcards: 'open' },
  ];

  for (const options of optionSets) {
    const label = JSON.stringify(options);

    it(`reports an existing index as present with ${label}`, async () => {
      const result = await books.exists(options);
      expect(result.error).toBe(null);
      expect(result.errorKind).toBe(null);
      expect(result.exists).toBe(true);
      expect(result.request.body).toEqual({
        index: books.getFullName(),
        ...options,
      });
    });

    it(`reports a missing index as absent with ${label}`, async () => {
      const result = await missing.exists(options);
      expect(result.error).toBe(null);
      expect(result.errorKind).toBe(null);
      expect(result.exists).toBe(false);
    });
  }
});

describe('RangeShape with Date values (S-048, type only)', () => {
  let index = '';

  beforeAll(async () => {
    index = await kit.makeIndex(getBooksCreateRequest('range'), getBooksData());
  });

  async function searchIds(field: 'published_at', range: RangeShape) {
    const ids: string[] = [];
    const op = Array.isArray(range) ? 'between' : '>=';
    const query = new QueryBuilder<'published_at'>()
      .range(field, op, range)
      .sort('id', 'asc')
      .getQuery();
    const result = await kit.client.search<{ id: string }>({ index, ...query });
    for (const hit of result.hits.hits) {
      if (hit._source) {
        ids.push(hit._source.id);
      }
    }
    return ids;
  }

  it('accepts a Date bound for a comparison operator', async () => {
    const ids = await searchIds(
      'published_at',
      new Date('1999-01-01T00:00:00Z'),
    );
    expect(ids).toEqual(['2', '3']);
  });

  it('accepts a Date bound mixed with date math in "between"', async () => {
    const ids = await searchIds('published_at', [
      new Date('1999-01-01T00:00:00Z'),
      'now',
    ]);
    expect(ids).toEqual(['2', '3']);
  });

  it('accepts open-ended Date pairs in "between"', async () => {
    const before = await searchIds('published_at', [
      null,
      new Date('1999-01-01T00:00:00Z'),
    ]);
    expect(before).toEqual(['1']);
    const after = await searchIds('published_at', [
      new Date('2000-01-01T00:00:00Z'),
      undefined,
    ]);
    expect(after).toEqual(['3']);
  });
});
