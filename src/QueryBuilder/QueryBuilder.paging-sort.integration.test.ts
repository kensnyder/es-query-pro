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

const kit = await createTestKit('qb-paging-sort');
const client = kit.client;
let items = '';
let fruit = '';

type ItemField = 'id' | 'n' | 'tag' | 'price' | 'title';
type Item = { id: string; n: number; tag: string; price?: number };

// 25 items: n = 1..25, tag a/b/c, price missing for every 4th item
const itemDocs: Item[] = Array.from({ length: 25 }, (_, i) => {
  const n = i + 1;
  const doc: Item = {
    id: `i${String(n).padStart(2, '0')}`,
    n,
    tag: 'abc'[n % 3],
  };
  if (n % 4 !== 0) {
    doc.price = (n % 5) * 10;
  }
  return doc;
});
const allIds = itemDocs.map((doc) => doc.id);

const fruitDocs = [
  { id: 'best', title: 'apple apple apple' },
  { id: 'good', title: 'apple pie' },
  { id: 'weak', title: 'a long story that mentions an apple only once here' },
  { id: 'none', title: 'banana bread' },
];

beforeAll(async () => {
  items = await kit.makeIndex(
    {
      index: 'items',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          n: { type: 'integer' },
          tag: { type: 'keyword' },
          price: { type: 'float' },
        },
      },
    },
    itemDocs,
  );
  fruit = await kit.makeIndex(
    {
      index: 'fruit',
      // one shard keeps BM25 statistics identical for every document
      ...(kit.caps.serverless ? {} : { settings: { number_of_shards: 1 } }),
      mappings: {
        properties: { id: { type: 'keyword' }, title: { type: 'text' } },
      },
    },
    fruitDocs,
  );
});

afterAll(async () => {
  await kit.cleanup();
});

async function search(index: string, qb: QueryBuilder<ItemField>) {
  return client.search<Item>({ index, ...qb.getQuery() });
}

function ids(result: estypes.SearchResponse<Item>) {
  return result.hits.hits.map((hit) => hit._id as string);
}

function byN(list: Item[]) {
  return list.map((doc) => doc.id);
}

describe('sort() against Elasticsearch (B-014, B-055)', () => {
  it("sort('_score') returns the best match first", async () => {
    const qb = new QueryBuilder<ItemField>()
      .match({ field: 'title', phrase: 'apple' })
      .sort('_score');
    const result = await search(fruit, qb);
    expect(ids(result)).toEqual(['best', 'good', 'weak']);
    const scores = result.hits.hits.map((hit) => hit.sort?.[0] as number);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("sort('_score', 'asc') returns the weakest match first", async () => {
    const qb = new QueryBuilder<ItemField>()
      .match({ field: 'title', phrase: 'apple' })
      .sort('_score', 'asc');
    expect(ids(await search(fruit, qb))).toEqual(['weak', 'good', 'best']);
  });

  it('accepts an array of strings, {field: order} and option objects', async () => {
    const qb = new QueryBuilder<ItemField>()
      .sort([
        { tag: 'asc' },
        '-price',
        { n: { order: 'asc', unmapped_type: 'integer' } },
      ])
      .limit(25);
    // missing values sort last for desc by default
    const expected = [...itemDocs].sort(
      (a, b) =>
        a.tag.localeCompare(b.tag) ||
        (b.price ?? Number.NEGATIVE_INFINITY) -
          (a.price ?? Number.NEGATIVE_INFINITY) ||
        a.n - b.n,
    );
    expect(ids(await search(items, qb))).toEqual(byN(expected));
  });

  it('sends option objects such as missing unchanged', async () => {
    const qb = new QueryBuilder<ItemField>()
      .sort({ price: { order: 'desc', missing: '_first' } })
      .sort('id')
      .limit(25);
    const missing = itemDocs.filter((doc) => doc.price === undefined);
    const found = ids(await search(items, qb));
    expect(found.slice(0, missing.length)).toEqual(byN(missing));
    expect(found).toHaveLength(25);
  });

  it('splits a several-key object in key order', async () => {
    const qb = new QueryBuilder<ItemField>()
      .sort({ tag: 'desc', n: 'desc' })
      .limit(25);
    const expected = [...itemDocs].sort(
      (a, b) => b.tag.localeCompare(a.tag) || b.n - a.n,
    );
    expect(ids(await search(items, qb))).toEqual(byN(expected));
  });
});

describe('page() against Elasticsearch (B-056)', () => {
  it('pages by 10 when no limit is set', async () => {
    const page = (n: number) =>
      search(items, new QueryBuilder<ItemField>().sort('n').page(n));
    expect(ids(await page(1))).toEqual(allIds.slice(0, 10));
    expect(ids(await page(2))).toEqual(allIds.slice(10, 20));
    expect(ids(await page(3))).toEqual(allIds.slice(20));
  });

  it('pages by the limit when one is set', async () => {
    const qb = new QueryBuilder<ItemField>().sort('n').limit(7).page(3);
    expect(ids(await search(items, qb))).toEqual(allIds.slice(14, 21));
  });
});

describe('searchAfter() paging (B-041)', () => {
  it('walks the whole result set with the hits’ sort values', async () => {
    const seen: string[] = [];
    let after: estypes.SortResults | undefined;
    for (let round = 0; round < 20; round++) {
      const qb = new QueryBuilder<ItemField>().sort(['tag', '-n']).limit(4);
      if (after) {
        qb.searchAfter(after);
      }
      const { hits } = (await search(items, qb)).hits;
      if (hits.length === 0) {
        break;
      }
      seen.push(...hits.map((hit) => hit._id as string));
      after = hits[hits.length - 1].sort;
    }
    const expected = [...itemDocs].sort(
      (a, b) => a.tag.localeCompare(b.tag) || b.n - a.n,
    );
    expect(seen).toEqual(byN(expected));
    expect(new Set(seen).size).toBe(25);
  });

  it('the server rejects from > 0 with search_after; the builder throws first', async () => {
    let reason = '';
    try {
      await client.search({
        index: items,
        size: 5,
        from: 5,
        sort: [{ n: 'asc' }],
        search_after: [3],
      });
    } catch (error) {
      reason = String((error as Error).message);
    }
    expect(reason).toMatch(/from.*search_after/);
    const qb = new QueryBuilder<ItemField>()
      .sort('n')
      .limit(5)
      .page(2)
      .searchAfter([3]);
    expect(() => qb.getQuery()).toThrow(TypeError);
  });
});

describe('sortByRandom() against Elasticsearch (S-028)', () => {
  async function randomPages(
    seed: number | string,
    field: ItemField | '_seq_no',
  ) {
    const pages: string[][] = [];
    for (let page = 1; page <= 5; page++) {
      const qb = new QueryBuilder<ItemField>()
        .sortByRandom(true, { seed, field })
        .limit(5)
        .page(page);
      pages.push(ids(await search(items, qb)));
    }
    return pages;
  }

  it('a seed gives stable, non-overlapping pages', async () => {
    const first = await randomPages(42, 'n');
    const again = await randomPages(42, 'n');
    expect(again).toEqual(first);
    const flat = first.flat();
    expect(flat).toHaveLength(25);
    expect(new Set(flat).size).toBe(25);
    expect([...flat].sort()).toEqual(allIds);
    // a random order, not the natural one
    expect(flat).not.toEqual(allIds);
  });

  it('another seed gives another order', async () => {
    const a = (await randomPages(1, 'n')).flat();
    const b = (await randomPages('other', 'n')).flat();
    expect(a).not.toEqual(b);
  });

  it('_seq_no with a tie-breaker sort pages with searchAfter', async () => {
    const walk = async () => {
      const seen: string[] = [];
      let after: estypes.SortResults | undefined;
      for (let round = 0; round < 10; round++) {
        const qb = new QueryBuilder<ItemField>()
          .sortByRandom(true, { seed: 7 })
          .sort('id')
          .limit(6);
        if (after) {
          qb.searchAfter(after);
        }
        const { hits } = (await search(items, qb)).hits;
        if (hits.length === 0) {
          break;
        }
        // _score leads, then the tie-breaker
        expect(hits[0].sort).toHaveLength(2);
        seen.push(...hits.map((hit) => hit._id as string));
        after = hits[hits.length - 1].sort;
      }
      return seen;
    };
    const first = await walk();
    expect(new Set(first).size).toBe(25);
    expect(await walk()).toEqual(first);
  });

  it('random order wins over a field sort', async () => {
    const plain = new QueryBuilder<ItemField>().sort('n').limit(25);
    const random = new QueryBuilder<ItemField>()
      .sort('n')
      .sortByRandom(true, { seed: 42, field: 'n' })
      .limit(25);
    const seeded = (await randomPages(42, 'n')).flat();
    expect(ids(await search(items, plain))).toEqual(allIds);
    expect(ids(await search(items, random))).toEqual(seeded);
  });
});

describe('function_score options against Elasticsearch (S-053)', () => {
  const byValue = () =>
    new QueryBuilder<ItemField>()
      .scoreFunction({ field_value_factor: { field: 'n' } })
      .limit(25);

  function scores(result: estypes.SearchResponse<Item>) {
    return Object.fromEntries(
      result.hits.hits.map((hit) => [hit._source?.n, hit._score]),
    );
  }

  it('boostMode replace scores each document by the function', async () => {
    const qb = byValue().functionScoreOptions({ boostMode: 'replace' });
    const result = await search(items, qb);
    expect(ids(result)).toEqual([...allIds].reverse());
    for (const [n, score] of Object.entries(scores(result))) {
      expect(score).toBeCloseTo(Number(n));
    }
  });

  it('maxBoost caps the function score', async () => {
    const qb = byValue().functionScoreOptions({
      boostMode: 'replace',
      maxBoost: 10,
    });
    const result = await search(items, qb);
    for (const [n, score] of Object.entries(scores(result))) {
      expect(score).toBeCloseTo(Math.min(Number(n), 10));
    }
  });

  it('minScore drops low-scoring documents', async () => {
    const qb = byValue().functionScoreOptions({
      boostMode: 'replace',
      minScore: 20,
    });
    const result = await search(items, qb);
    expect([...ids(result)].sort()).toEqual(allIds.slice(19));
  });

  it('scoreMode sum adds the functions', async () => {
    const qb = byValue()
      .scoreFunction({ weight: 100 })
      .functionScoreOptions({ boostMode: 'replace', scoreMode: 'sum' });
    const result = await search(items, qb);
    for (const [n, score] of Object.entries(scores(result))) {
      expect(score).toBeCloseTo(Number(n) + 100);
    }
  });
});
