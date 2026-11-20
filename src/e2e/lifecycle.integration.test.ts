import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { IndexManager, SchemaRegistry } from '../../index';
import { getBooksCreateRequest, getBooksData } from '../testFixtures/books';
import { createTestKit } from '../testFixtures/esTestKit';
import { getPlacesCreateRequest, getPlacesData } from '../testFixtures/places';
import { aliasTargets, idsOf } from './helpers';

/**
 * Scenario 1 — application lifecycle, through the public entrypoint only:
 * a registry of two indexes is created with `migrateIfNeeded()`, loaded
 * with `putBulk()`, searched (match, filter, sort, paging, aggregations),
 * redeployed with a version bump on one index, updated with `updateMany()`,
 * counted, pruned with `deleteMany()` and dropped with `dropAll()`.
 * The steps share state and run in order.
 */

// a migration on serverless takes about 15 s (each explicit refresh ~5 s)
setDefaultTimeout(60_000);
const MIGRATION_TEST_MS = 240_000;
const RUN_TIMEOUT_MS = 200_000;

const kit = await createTestKit('e2e-lifecycle');
afterAll(() => kit.cleanup());

function booksV2Create(): estypes.IndicesCreateRequest {
  const create = getBooksCreateRequest('books');
  return {
    ...create,
    mappings: {
      ...create.mappings,
      properties: {
        ...create.mappings?.properties,
        stock: { type: 'integer' },
      },
    },
  };
}

const options = { client: kit.client, prefix: kit.prefix };
const booksV1 = new IndexManager(
  { ...options, version: 1 },
  getBooksCreateRequest('books'),
);
const booksV2 = new IndexManager({ ...options, version: 2 }, booksV2Create());
const places = new IndexManager(
  { ...options, version: 1 },
  getPlacesCreateRequest('places'),
);

/** `{ key: doc_count }` of a terms aggregation in a search result */
function bucketCounts(aggregations: unknown, name: string) {
  const agg = (aggregations as Record<string, unknown> | null)?.[name] as
    | { buckets?: { key: string; doc_count: number }[] }
    | undefined;
  const counts: Record<string, number> = {};
  for (const bucket of agg?.buckets ?? []) {
    counts[bucket.key] = bucket.doc_count;
  }
  return counts;
}

describe('E2E scenario 1: application lifecycle', () => {
  it('registry.migrateIfNeeded() creates both indexes and aliases', async () => {
    const registry = new SchemaRegistry({ books: booksV1, places });
    const run = await registry.migrateIfNeeded({
      timeout: RUN_TIMEOUT_MS,
      pollInterval: 200,
    });
    expect(run).toMatchObject({ acknowledged: true, error: null });
    const details = await run.completion;
    expect(details.error).toBe(null);
    expect(details.success).toBe(true);
    expect(details.summary).toEqual({
      [booksV1.getFullName()]: 'created',
      [places.getFullName()]: 'created',
    });
    expect(details.report.map((entry) => entry.code)).toEqual([
      'CREATED',
      'CREATED',
    ]);
    expect(await aliasTargets(kit, booksV1.getAliasName())).toEqual([
      booksV1.getFullName(),
    ]);
    expect(await aliasTargets(kit, places.getAliasName())).toEqual([
      places.getFullName(),
    ]);
    const status = await registry.getStatus();
    expect(status.success).toBe(true);
    expect(Object.values(status.summary)).toEqual(['current', 'current']);
  });

  it('putBulk() loads both indexes through their aliases', async () => {
    const books = await booksV1.putBulk(getBooksData(), { refresh: true });
    expect(books.error).toBe(null);
    expect(books.success).toBe(true);
    expect(books.report.map((row) => [row.id, row.effect])).toEqual([
      ['1', 'created'],
      ['2', 'created'],
      ['3', 'created'],
    ]);
    const loaded = await places.putBulk(getPlacesData(), { refresh: true });
    expect(loaded.error).toBe(null);
    expect(loaded.report.every((row) => row.status === 201)).toBe(true);
    // the documents are in the versioned indexes the aliases point at
    const raw = await kit.client.count({ index: places.getFullName() });
    expect(raw.count).toBe(6);
    expect((await booksV1.count()).total).toBe(3);
  });

  it('searches with match + filter: the filter narrows without scoring', async () => {
    const plain = await places.findMany((qb) =>
      qb.match({ field: 'description', phrase: 'park' }),
    );
    expect(plain.error).toBe(null);
    const filtered = await places.findMany((qb) =>
      qb
        .match({ field: 'description', phrase: 'park' })
        .filter((sub) => sub.term('category', 'park')),
    );
    expect(filtered.error).toBe(null);
    expect(idsOf(filtered.records).sort()).toEqual(['3', '4']);
    expect(filtered.total).toBe(2);
    // filter context leaves each score as the match alone gives it
    for (const record of filtered.records) {
      const same = plain.records.find((r) => r._id === record._id);
      expect(record._score).toBe(same?._score as number);
    }
  });

  it('searches with a range filter, sort and paging', async () => {
    // rating >= 4.5: '3' 4.9, '1' 4.8, '2' 4.7, '6' 4.5
    const page1 = await places.findMany((qb) =>
      qb
        .filter((sub) => sub.range('rating', '>=', 4.5))
        .sort('rating', 'desc')
        .limit(2),
    );
    expect(page1.error).toBe(null);
    expect(idsOf(page1.records)).toEqual(['3', '1']);
    expect(page1.total).toBe(4);
    const page2 = await places.findMany((qb) =>
      qb
        .filter((sub) => sub.range('rating', '>=', 4.5))
        .sort('rating', 'desc')
        .limit(2)
        .page(2),
    );
    expect(idsOf(page2.records)).toEqual(['2', '6']);
    expect(page2.records[0]._sort?.[0] as number).toBeCloseTo(4.7, 5);
    const page3 = await places.findMany((qb) =>
      qb
        .filter((sub) => sub.range('rating', '>=', 4.5))
        .sort('rating', 'desc')
        .limit(2)
        .page(3),
    );
    expect(page3.records).toEqual([]);
    expect(page3.total).toBe(4);
  });

  it('aggregates terms, alone and under a filter', async () => {
    const all = await places.findMany((qb) =>
      qb.aggregateTerm({ field: 'category' }),
    );
    expect(all.error).toBe(null);
    // aggregate*() defaults to no hits
    expect(all.records).toEqual([]);
    expect(all.total).toBe(6);
    expect(bucketCounts(all.aggregations, 'category')).toEqual({
      market: 2,
      museum: 2,
      park: 2,
    });
    const rated = await places.findMany((qb) =>
      qb
        .filter((sub) => sub.range('rating', '>=', 4.5))
        .aggregateTerm({ field: 'category', name: 'kinds' })
        .limit(10),
    );
    expect(rated.records).toHaveLength(4);
    expect(bucketCounts(rated.aggregations, 'kinds')).toEqual({
      museum: 2,
      park: 1,
      market: 1,
    });
  });

  it('finds books with findFirst, count and findFirstOrThrow', async () => {
    const first = await booksV1.findFirst((qb) =>
      qb.match({ field: 'title', phrase: 'chamber of secrets' }),
    );
    expect(first.error).toBe(null);
    expect(first.record?._id).toBe('2');
    expect(first.record?.title).toBe('Harry Potter and the Chamber of Secrets');
    const uk = await booksV1.count((qb) =>
      qb.term('country', 'United Kingdom'),
    );
    expect(uk.total).toBe(2);
    const missing = booksV1.run((runner) => {
      runner.builder.term('country', 'Narnia');
      return runner.findFirstOrThrow();
    });
    await expect(missing).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
    });
  });

  it(
    'redeploys with books v2: the registry migrates books, leaves places',
    async () => {
      const registry = new SchemaRegistry({ books: booksV2, places });
      const run = await registry.migrateIfNeeded({
        timeout: RUN_TIMEOUT_MS,
        pollInterval: 200,
      });
      expect(run.acknowledged).toBe(true);
      const details = await run.completion;
      expect(details.error).toBe(null);
      expect(details.summary).toEqual({
        [booksV2.getFullName()]: 'migrated',
        [places.getFullName()]: 'unchanged',
      });
      expect(details.report[0].code).toBe('MIGRATED');
      expect(details.report[0].after?.summary).toBe('current');
      expect(await aliasTargets(kit, booksV2.getAliasName())).toEqual([
        booksV2.getFullName(),
      ]);
      expect(
        await kit.client.indices.exists({ index: booksV1.getFullName() }),
      ).toBe(false);
      // the old manager reads through the alias, now served by v2
      const byId = await booksV1.findById('3');
      expect(byId.error).toBe(null);
      expect(byId.record?.title).toBe('Skyward');
      expect((await booksV2.count()).total).toBe(3);
      const uk = await booksV2.findMany((qb) =>
        qb.term('country', 'United Kingdom').sort('id'),
      );
      expect(idsOf(uk.records)).toEqual(['1', '2']);
    },
    MIGRATION_TEST_MS,
  );

  it('updateMany() changes only the matching documents', async () => {
    const markets = await places.run((runner) => {
      runner.builder.term('category', 'market');
      return runner.updateMany({ rating: 1 }, { refresh: true });
    });
    expect(markets.error).toBe(null);
    expect(markets).toMatchObject({ success: true, updated: 2, total: 2 });
    const low = await places.findMany((qb) =>
      qb.range('rating', '<', 2).sort('id'),
    );
    expect(idsOf(low.records)).toEqual(['5', '6']);
    // a nested object path and a field only v2 maps
    const books = await booksV2.run((runner) => {
      runner.builder.term('country', 'United Kingdom');
      return runner.updateMany(
        { 'publishing.year': 2001, stock: 5 },
        { refresh: true },
      );
    });
    expect(books.error).toBe(null);
    expect(books.updated).toBe(2);
    const one = await booksV2.findById('1');
    expect(one.record?.publishing).toMatchObject({ year: 2001 });
    expect(one.record?.stock).toBe(5);
    const three = await booksV2.findById('3');
    expect(three.record?.publishing).toMatchObject({ year: 2018 });
    expect(three.record?.stock).toBeUndefined();
    const stocked = await booksV2.count((qb) => qb.term('stock', 5));
    expect(stocked.total).toBe(2);
    // an unknown key is refused without a request
    const refused = await booksV2.run((runner) =>
      runner.updateMany({ nope: 1 }),
    );
    expect(refused.success).toBe(false);
    expect(refused.request).toBe(null);
    expect(refused.error).toBeInstanceOf(Error);
  });

  it('count() reflects the data', async () => {
    expect((await places.count()).total).toBe(6);
    expect((await booksV2.count()).total).toBe(3);
    // '6' (4.5) is a market, now rated 1
    const rated = await places.count((qb) => qb.range('rating', '>=', 4.5));
    expect(rated.total).toBe(3);
  });

  it('deleteMany() removes matching documents, then everything (D6)', async () => {
    const markets = await places.deleteMany(
      (qb) => qb.term('category', 'market'),
      { refresh: true },
    );
    expect(markets.error).toBe(null);
    expect(markets).toMatchObject({ success: true, deleted: 2 });
    expect((await places.count()).total).toBe(4);
    const left = await places.findMany((qb) => qb.sort('id'));
    expect(idsOf(left.records)).toEqual(['1', '2', '3', '4']);
    // no callback deletes every document
    const all = await booksV2.deleteMany(undefined, { refresh: true });
    expect(all).toMatchObject({ success: true, deleted: 3, error: null });
    expect((await booksV2.count()).total).toBe(0);
  });

  it('dropAll() drops both indexes; a second run reports MISSING', async () => {
    const registry = new SchemaRegistry({ books: booksV2, places });
    const dropped = await registry.dropAll();
    expect(dropped.error).toBe(null);
    expect(dropped.success).toBe(true);
    expect(dropped.summary).toEqual({
      [booksV2.getFullName()]: 'DROPPED',
      [places.getFullName()]: 'DROPPED',
    });
    for (const index of [booksV2, places]) {
      expect(
        await kit.client.indices.exists({ index: index.getFullName() }),
      ).toBe(false);
      expect(await aliasTargets(kit, index.getAliasName())).toEqual([]);
    }
    // reads through a dropped alias are response errors, not throws
    const gone = await places.findById('1');
    expect(gone).toMatchObject({ found: false, errorKind: 'response' });
    expect(gone.error).toBeInstanceOf(Error);
    const search = await places.findMany();
    expect(search).toMatchObject({ total: null, errorKind: 'response' });
    const again = await registry.dropAll();
    expect(again.success).toBe(true);
    expect(Object.values(again.summary)).toEqual(['MISSING', 'MISSING']);
  });
});
