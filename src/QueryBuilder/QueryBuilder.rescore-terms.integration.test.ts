import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { createTestKit } from '../testFixtures/esTestKit';
import QueryBuilder from './QueryBuilder';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('qb-rescore-terms');
const client = kit.client;
let products = '';

// brand a: 2 docs, ratings 3 and 1; b: 1 doc, rating 5; c: 2 docs, ratings
// 2 and 4; doc 6 has no brand
const ratings: Record<string, number> = { 1: 3, 2: 1, 3: 5, 4: 2, 5: 4, 6: 0 };
const productDocs = [
  { id: '1', brand: 'a', tags: ['x'], title: 'shoes', price: 10 },
  { id: '2', brand: 'a', tags: ['x', 'y'], title: 'red shoes for running' },
  { id: '3', brand: 'b', tags: ['y'], title: 'blue shoes', price: 30 },
  { id: '4', brand: 'c', tags: ['z'], title: 'green hat', price: 40 },
  { id: '5', brand: 'c', title: 'shoes and socks', price: 50 },
  { id: '6', tags: ['x'], title: 'plain socks', price: 5 },
].map((doc) => ({
  ...doc,
  stats: { rating: ratings[doc.id] },
}));

type ProductField =
  | 'id'
  | 'brand'
  | 'tags'
  | 'title'
  | 'price'
  | 'stats.rating';

beforeAll(async () => {
  products = await kit.makeIndex(
    {
      index: 'products',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          brand: { type: 'keyword' },
          tags: { type: 'keyword' },
          title: { type: 'text' },
          price: { type: 'float' },
          stats: { properties: { rating: { type: 'float' } } },
        },
      },
    },
    productDocs,
  );
});

afterAll(async () => {
  await kit.cleanup();
});

async function search(qb: QueryBuilder<ProductField>) {
  return client.search<{ id: string }>({ index: products, ...qb.getQuery() });
}

/** Send a raw request; resolve with the server's error reason, or null */
async function rejection(request: Omit<estypes.SearchRequest, 'index'>) {
  try {
    await client.search({ index: products, ...request });
    return null;
  } catch (error) {
    const body = (error as { meta?: { body?: unknown } }).meta?.body as
      | { error?: { root_cause?: { reason?: string }[] } }
      | undefined;
    return body?.error?.root_cause?.[0]?.reason ?? String(error);
  }
}

/** Bucket keys of the `brand` terms aggregation */
async function brandKeys(qb: QueryBuilder<ProductField>) {
  const res = await search(qb);
  const agg = res.aggregations
    ?.brand as estypes.AggregationsStringTermsAggregate;
  return (agg.buckets as estypes.AggregationsStringTermsBucket[]).map(
    (b) => b.key,
  );
}

function ids(hits: estypes.SearchHit<{ id: string }>[]) {
  return hits.map((h) => h._id);
}

describe('rescore() (B-003)', () => {
  it('the old rescore_query shape is rejected by the server', async () => {
    const reason = await rejection({
      query: { match: { title: 'shoes' } },
      rescore: [
        {
          window_size: 10,
          query: {
            rescore_query: {
              _source: ['*'],
              query: { term: { brand: 'b' } },
            } as estypes.QueryDslQueryContainer,
          },
        },
      ],
    });
    expect(reason).toContain('[_source] query malformed');
  });

  it('is accepted and reorders the top window', async () => {
    const base = () =>
      new QueryBuilder<ProductField>().match({
        field: 'title',
        phrase: 'shoes',
      });
    const before = await search(base());
    expect(ids(before.hits.hits).sort()).toEqual(['1', '2', '3', '5']);
    expect(before.hits.hits[0]._id).not.toBe('3');

    const qb = base().rescore((q) => q.term('brand', 'b'), {
      windowSize: 10,
      rescoreQueryWeight: 10,
    });
    const after = await search(qb);
    expect(after.hits.hits[0]._id).toBe('3');
    expect(ids(after.hits.hits).sort()).toEqual(['1', '2', '3', '5']);
  });

  it('applies queryWeight and scoreMode', async () => {
    const qb = new QueryBuilder<ProductField>()
      .match({ field: 'title', phrase: 'shoes' })
      .rescore((q) => q.term('brand', 'b'), {
        queryWeight: 0,
        rescoreQueryWeight: 1,
        scoreMode: 'total',
      });
    const { hits } = await search(qb);
    expect(hits.hits[0]._id).toBe('3');
    expect(hits.hits[0]._score).toBeGreaterThan(0);
    for (const hit of hits.hits.slice(1)) {
      expect(hit._score).toBe(0);
    }
  });

  it('chains two phases', async () => {
    const qb = new QueryBuilder<ProductField>()
      .match({ field: 'title', phrase: 'shoes' })
      .rescore((q) => q.term('brand', 'b'), { rescoreQueryWeight: 10 })
      .rescore((q) => q.term('brand', 'c'), { rescoreQueryWeight: 100 });
    const { hits } = await search(qb);
    expect(ids(hits.hits).slice(0, 2)).toEqual(['5', '3']);
  });
});

describe('rescore with a sort (S-021, D11)', () => {
  const rescored = () =>
    new QueryBuilder<ProductField>()
      .match({ field: 'title', phrase: 'shoes' })
      .rescore((q) => q.term('brand', 'b'), { rescoreQueryWeight: 10 });

  it('a lone _score descending sort is accepted', async () => {
    const qb = rescored().sort({ _score: { order: 'desc' } });
    const { hits } = await search(qb);
    expect(hits.hits[0]._id).toBe('3');
  });

  it('other sorts throw locally, as the server rejects them', async () => {
    for (const sort of [
      [{ price: 'asc' }],
      [{ _score: 'asc' }],
      [{ _score: 'desc' }, { price: 'asc' }],
    ] as estypes.Sort[]) {
      const qb = rescored();
      qb._sorts = [sort].flat();
      expect(() => qb.getQuery()).toThrow(TypeError);
      const { sort: _omit, ...withoutSort } = rescored().getQuery();
      const reason = await rejection({ ...withoutSort, sort });
      expect(reason).toContain('Cannot use [sort] option in conjunction');
    }
  });
});

describe('aggregateTerm() order (B-013, B-046)', () => {
  it('the old shapes fail on the server', async () => {
    // B-013: a max sub-agg on the keyword field being bucketed
    expect(
      await rejection({
        size: 0,
        aggs: {
          brand: {
            terms: { field: 'brand', order: { brand: 'asc' } },
            aggs: { brand: { max: { field: 'brand' } } },
          },
        },
      }),
    ).toContain('is not supported for aggregation [max]');
    // B-046: a dotted sub-agg name cannot be an order path
    expect(
      await rejection({
        size: 0,
        aggs: {
          brand: {
            terms: { field: 'brand', order: { 'stats.rating': 'desc' } },
            aggs: { 'stats.rating': { max: { field: 'stats.rating' } } },
          },
        },
      }),
    ).toContain('Invalid aggregation order path');
    // B-046: a multi-key order object applies only its last key
    const res = await client.search({
      index: products,
      size: 0,
      aggs: {
        brand: {
          terms: { field: 'brand', order: { _count: 'asc', _key: 'desc' } },
        },
      },
    });
    const agg = res.aggregations
      ?.brand as estypes.AggregationsStringTermsAggregate;
    const keys = (agg.buckets as estypes.AggregationsStringTermsBucket[]).map(
      (b) => b.key,
    );
    expect(keys).toEqual(['c', 'b', 'a']);
  });

  it('orders by key ascending, via the field or _key', async () => {
    for (const field of ['brand', '_key'] as const) {
      const qb = new QueryBuilder<ProductField>().aggregateTerm({
        field: 'brand',
        orderBy: [{ field, order: 'asc' }],
      });
      expect(await brandKeys(qb)).toEqual(['a', 'b', 'c']);
    }
  });

  it('orders by count', async () => {
    const desc = new QueryBuilder<ProductField>().aggregateTerm({
      field: 'brand',
    });
    expect(await brandKeys(desc)).toEqual(['a', 'c', 'b']);
    const asc = new QueryBuilder<ProductField>().aggregateTerm({
      field: 'brand',
      orderBy: [{ field: '_count', order: 'asc' }],
    });
    expect((await brandKeys(asc))[0]).toBe('b');
  });

  it('orders by a metric on a dotted field', async () => {
    const desc = new QueryBuilder<ProductField>().aggregateTerm({
      field: 'brand',
      orderBy: [{ field: 'stats.rating', order: 'desc' }],
    });
    // largest rating per brand: b 5, c 4, a 3
    expect(await brandKeys(desc)).toEqual(['b', 'c', 'a']);
    const asc = new QueryBuilder<ProductField>().aggregateTerm({
      field: 'brand',
      orderBy: [{ field: 'stats.rating', order: 'asc' }],
    });
    // smallest rating per brand: a 1, c 2, b 5
    expect(await brandKeys(asc)).toEqual(['a', 'c', 'b']);
  });

  it('orders by two criteria', async () => {
    const countAscKeyDesc = new QueryBuilder<ProductField>().aggregateTerm({
      field: 'brand',
      orderBy: [
        { field: '_count', order: 'asc' },
        { field: 'brand', order: 'desc' },
      ],
    });
    expect(await brandKeys(countAscKeyDesc)).toEqual(['b', 'c', 'a']);
    const countDescRating = new QueryBuilder<ProductField>().aggregateTerm({
      field: 'brand',
      orderBy: [
        { field: '_count', order: 'desc' },
        { field: 'stats.rating', order: 'desc' },
      ],
    });
    // a and c both have 2 docs; c has the higher rating
    expect(await brandKeys(countDescRating)).toEqual(['c', 'a', 'b']);
  });
});

describe('aggregateTerm() missing (B-047)', () => {
  it('the server rejects missing_bucket and missing_order on terms', async () => {
    for (const option of [
      { missing_bucket: true },
      { missing_order: 'last' },
    ]) {
      const reason = await rejection({
        size: 0,
        aggs: {
          brand: {
            terms: {
              field: 'brand',
              ...option,
            } as estypes.AggregationsTermsAggregation,
          },
        },
      });
      expect(reason).toContain('[terms] unknown field');
    }
  });

  it('puts documents without the field in the missing bucket', async () => {
    const qb = new QueryBuilder<ProductField>().aggregateTerm({
      field: 'brand',
      missing: '(none)',
      orderBy: [{ field: '_key', order: 'asc' }],
    });
    const res = await search(qb);
    const agg = res.aggregations
      ?.brand as estypes.AggregationsStringTermsAggregate;
    const buckets = agg.buckets as estypes.AggregationsStringTermsBucket[];
    expect(buckets.map((b) => [b.key, b.doc_count])).toEqual([
      ['(none)', 1],
      ['a', 2],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('honors exclude', async () => {
    const qb = new QueryBuilder<ProductField>().aggregateTerm({
      field: 'brand',
      exclude: ['a'],
    });
    expect((await brandKeys(qb)).sort()).toEqual(['b', 'c']);
  });
});

describe('includeFacets() (B-053)', () => {
  it('returns buckets for each field and no hits', async () => {
    const qb = new QueryBuilder<ProductField>().includeFacets({
      fields: ['brand', 'tags'],
      limit: 2,
    });
    const res = await search(qb);
    expect(res.hits.hits).toEqual([]);
    const keys = (name: string) => {
      const agg = res.aggregations?.[
        name
      ] as estypes.AggregationsStringTermsAggregate;
      return (agg.buckets as estypes.AggregationsStringTermsBucket[]).map(
        (b) => [b.key, b.doc_count],
      );
    };
    expect(keys('brand')).toEqual([
      ['a', 2],
      ['c', 2],
    ]);
    expect(keys('tags')).toEqual([
      ['x', 3],
      ['y', 2],
    ]);
  });
});

describe('limit and aggregate* (B-098)', () => {
  it('a user-set limit survives aggregate*', async () => {
    const qb = new QueryBuilder<ProductField>()
      .limit(2)
      .aggregateTerm({ field: 'brand' })
      .aggregateHistogram({ field: 'price', interval: 100 });
    const res = await search(qb);
    expect(res.hits.hits).toHaveLength(2);
    expect(res.aggregations?.brand).toBeDefined();
    expect(res.aggregations?.price).toBeDefined();
  });

  it('without a limit, aggregate* returns no hits until reset("aggs")', async () => {
    const qb = new QueryBuilder<ProductField>().aggregateTerm({
      field: 'brand',
    });
    expect((await search(qb)).hits.hits).toEqual([]);
    qb.reset('aggs');
    const res = await search(qb);
    expect(res.hits.hits).toHaveLength(6);
    expect(res.aggregations).toBeUndefined();
  });

  it('aggs() sends a copy of raw aggregations', async () => {
    const raw: Record<string, estypes.AggregationsAggregationContainer> = {
      top_rating: { max: { field: 'stats.rating' } },
    };
    const qb = new QueryBuilder<ProductField>().aggs(raw).limit(0);
    qb.aggregateTerm({ field: 'brand' });
    expect(Object.keys(raw)).toEqual(['top_rating']);
    const res = await search(qb);
    const top = res.aggregations
      ?.top_rating as estypes.AggregationsMaxAggregate;
    expect(top.value).toBe(5);
    expect(res.aggregations?.brand).toBeDefined();
  });
});
