import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { getBooksCreateRequest, getBooksData } from '../testFixtures/books';
import { createTestKit } from '../testFixtures/esTestKit';
import QueryBuilder from './QueryBuilder';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('qb-match');
const client = kit.client;
let books = '';
let phrases = '';

/** Documents that match "brown fox" as a phrase, all words, one word, none */
const phraseDocs = [
  { id: 'phrase', body: 'the brown fox jumped over' },
  { id: 'all', body: 'the fox jumped over brown' },
  { id: 'any', body: 'the brown dog jumped over' },
  { id: 'none', body: 'a grey cat sat quietly' },
];

beforeAll(async () => {
  books = await kit.makeIndex(getBooksCreateRequest('books'), getBooksData());
  phrases = await kit.makeIndex(
    {
      index: 'phrases',
      mappings: {
        properties: { id: { type: 'keyword' }, body: { type: 'text' } },
      },
    },
    phraseDocs,
  );
});

afterAll(async () => {
  await kit.cleanup();
});

/** Hit ids in score order (ties broken by id) */
async function search(index: string, qb: QueryBuilder) {
  const sort: estypes.Sort = [{ _score: { order: 'desc' } }, { id: 'asc' }];
  const response = await client.search(
    qb.getQuery({
      index,
      search_type: 'dfs_query_then_fetch',
      sort,
      track_scores: true,
    }),
  );
  return response.hits.hits;
}

async function ids(index: string, qb: QueryBuilder) {
  const hits = await search(index, qb);
  return hits.map((hit) => hit._id);
}

/** Book ids sorted by id, for filters where score order does not matter */
async function bookIds(qb: QueryBuilder) {
  const response = await client.search(
    qb.getQuery({ index: books, sort: [{ id: 'asc' }] }),
  );
  return response.hits.hits.map((hit) => hit._id);
}

describe('QueryBuilder.matchBoostedPhrase() - Integration (B-045)', () => {
  it('ranks exact phrase > all words > any word', async () => {
    const qb = new QueryBuilder().matchBoostedPhrase({
      field: 'body',
      phrase: 'brown fox',
      operators: ['exact', 'and', 'or'],
    });
    expect(await ids(phrases, qb)).toEqual(['phrase', 'all', 'any']);
  });

  it('keeps that order with the default operators', async () => {
    const qb = new QueryBuilder().matchBoostedPhrase({
      field: 'body',
      phrase: 'brown fox',
    });
    expect(await ids(phrases, qb)).toEqual(['phrase', 'all']);
  });

  it('applies the default boosts: exact 5, and 3, or 1', async () => {
    // A single-clause score scales with its boost, so each default shows
    // up as the ratio to the same clause with weight 1.
    const expected = { exact: 5, and: 3, or: 1 } as const;
    for (const [op, boost] of Object.entries(expected)) {
      const operators = [op as keyof typeof expected];
      const byDefault = new QueryBuilder().matchBoostedPhrase({
        field: 'body',
        phrase: 'brown fox',
        operators,
      });
      const unit = new QueryBuilder().matchBoostedPhrase({
        field: 'body',
        phrase: 'brown fox',
        operators,
        weights: [1],
      });
      const [defaultHit] = await search(phrases, byDefault);
      const [unitHit] = await search(phrases, unit);
      expect(defaultHit._id).toBe(unitHit._id);
      expect(Number(defaultHit._score)).toBeCloseTo(
        boost * Number(unitHit._score),
        4,
      );
    }
  });
});

describe('blank phrases - Integration (S-045)', () => {
  it('server: a blank match query matches nothing', async () => {
    const response = await client.search({
      index: books,
      query: { match: { title: { query: '' } } },
    });
    expect(response.hits.hits).toHaveLength(0);
  });

  it('a blank phrase behaves as no condition', async () => {
    const qb = new QueryBuilder()
      .match({ field: 'title', phrase: '' })
      .matchPhrase({ field: 'title', phrase: '  ' })
      .matchPhrasePrefix({ field: 'title', phrase: '' })
      .multiMatch({ fields: ['title', 'premise'], phrase: '' })
      .matchBoostedPhrase({ field: 'title', phrase: ' ' });
    expect(await bookIds(qb)).toEqual(['1', '2', '3']);
  });

  it('a blank phrase does not drop the other conditions', async () => {
    const qb = new QueryBuilder()
      .match({ field: 'title', phrase: '' })
      .match({ field: 'title', phrase: 'chamber' });
    expect(await bookIds(qb)).toEqual(['2']);
  });
});

describe('QueryBuilder.matchPhrase() options - Integration (S-042)', () => {
  it('accepts zero_terms_query for a stop-word-only phrase', async () => {
    // `title` uses the english analyzer, so "the and" has no terms
    const none = new QueryBuilder().matchPhrase({
      field: 'title',
      phrase: 'the and',
    });
    const all = new QueryBuilder().matchPhrase({
      field: 'title',
      phrase: 'the and',
      zero_terms_query: 'all',
    });
    expect(await bookIds(none)).toEqual([]);
    expect(await bookIds(all)).toEqual(['1', '2', '3']);
  });

  it('accepts analyzer', async () => {
    // the keyword analyzer keeps "Harry Potter" as one token, which the
    // english-analyzed `title` does not contain
    const english = new QueryBuilder().matchPhrase({
      field: 'title',
      phrase: 'Harry Potter',
      analyzer: 'english',
    });
    const keyword = new QueryBuilder().matchPhrase({
      field: 'title',
      phrase: 'Harry Potter',
      analyzer: 'keyword',
    });
    expect(await bookIds(english)).toEqual(['1', '2']);
    expect(await bookIds(keyword)).toEqual([]);
  });

  it('accepts slop and boost', async () => {
    const plain = new QueryBuilder().matchPhrase({
      field: 'title',
      phrase: 'harry chamber',
      slop: 3,
    });
    const boosted = new QueryBuilder().matchPhrase({
      field: 'title',
      phrase: 'harry chamber',
      slop: 3,
      boost: 2,
    });
    const tooTight = new QueryBuilder().matchPhrase({
      field: 'title',
      phrase: 'harry chamber',
    });
    expect(await bookIds(tooTight)).toEqual([]);
    const [plainHit] = await search(books, plain);
    const [boostedHit] = await search(books, boosted);
    expect(plainHit._id).toBe('2');
    expect(boostedHit._id).toBe('2');
    expect(Number(boostedHit._score)).toBeCloseTo(
      2 * Number(plainHit._score),
      4,
    );
  });

  it('matchPhrasePrefix accepts max_expansions and analyzer', async () => {
    const qb = new QueryBuilder().matchPhrasePrefix({
      field: 'title',
      phrase: 'chamber of sec',
      max_expansions: 5,
      analyzer: 'english',
    });
    const keyword = new QueryBuilder().matchPhrasePrefix({
      field: 'title',
      phrase: 'chamber of sec',
      analyzer: 'keyword',
    });
    expect(await bookIds(qb)).toEqual(['2']);
    expect(await bookIds(keyword)).toEqual([]);
  });

  it('multiMatch searches several fields with options', async () => {
    const qb = new QueryBuilder().multiMatch({
      fields: ['title^2', 'premise'],
      phrase: 'skyward',
      operator: 'and',
      type: 'best_fields',
    });
    expect(await bookIds(qb)).toEqual(['3']);
  });
});

describe('QueryBuilder.range() - Integration (B-091, S-048)', () => {
  // published_at: '1' 1998-06-26, '2' 1999-07-02, '3' 2018-11-06 (UTC)
  // price: '1' 24.99, '2' 22.99, '3' 18.99

  it('filters numbers with comparison operators and between', async () => {
    const lt = new QueryBuilder().range('price', 'lt', 20);
    const between = new QueryBuilder().range('price', 'between', [19, 23]);
    const inclusive = new QueryBuilder().range(
      'price',
      'between',
      [22.99, 24.99],
    );
    expect(await bookIds(lt)).toEqual(['3']);
    expect(await bookIds(between)).toEqual(['2']);
    expect(await bookIds(inclusive)).toEqual(['1', '2']);
  });

  it('filters with open-ended between', async () => {
    const noMin = new QueryBuilder().range('price', 'between', [null, 20]);
    const noMax = new QueryBuilder().range('price', 'between', [23, null]);
    const blankMin = new QueryBuilder().range('published_at', 'between', [
      '',
      '1999-01-01',
    ]);
    const neither = new QueryBuilder().range('price', 'between', [null, '']);
    expect(await bookIds(noMin)).toEqual(['3']);
    expect(await bookIds(noMax)).toEqual(['1']);
    expect(await bookIds(blankMin)).toEqual(['1']);
    expect(await bookIds(neither)).toEqual(['1', '2', '3']);
  });

  it('filters with Date values', async () => {
    const gte = new QueryBuilder().range(
      'published_at',
      'gte',
      new Date('1999-07-02T00:00:00Z'),
    );
    const between = new QueryBuilder().range('published_at', 'between', [
      new Date('1998-01-01T00:00:00Z'),
      new Date('1999-12-31T00:00:00Z'),
    ]);
    const mixed = new QueryBuilder().range('published_at', 'between', [
      new Date('2000-01-01T00:00:00Z'),
      'now',
    ]);
    expect(await bookIds(gte)).toEqual(['2', '3']);
    expect(await bookIds(between)).toEqual(['1', '2']);
    expect(await bookIds(mixed)).toEqual(['3']);
  });

  it('server: a Date with a non-ISO format matches nothing', async () => {
    // why range() throws for that combination. Every shard fails to parse
    // the date: with several shards (serverless) the search returns 200 and
    // no hits, with one (stateful) a 400; with partial results off it is a
    // 400 everywhere.
    const request: estypes.SearchRequest = {
      index: books,
      query: {
        range: {
          published_at: {
            gte: '1990-01-01T00:00:00.000Z',
            format: 'dd/MM/yyyy',
          },
        },
      },
    };
    let hits = 0;
    try {
      hits = (await client.search(request)).hits.hits.length;
    } catch (e) {
      expect(String(e)).toContain('failed to parse date field');
    }
    expect(hits).toBe(0);
    let error: unknown;
    try {
      await client.search({ ...request, allow_partial_search_results: false });
    } catch (e) {
      error = e;
    }
    expect(String(error)).toContain('failed to parse date field');
  });

  it('passes format through', async () => {
    const qb = new QueryBuilder().range(
      'published_at',
      'between',
      ['26/06/1998', '01/07/1999'],
      { format: 'dd/MM/yyyy' },
    );
    expect(await bookIds(qb)).toEqual(['1']);
  });

  it('accepts a Date with a format that includes an ISO format', async () => {
    const qb = new QueryBuilder().range(
      'published_at',
      'between',
      [new Date('1999-01-01T00:00:00Z'), '01/01/2000'],
      { format: 'dd/MM/yyyy||strict_date_time' },
    );
    expect(await bookIds(qb)).toEqual(['2']);
  });

  it('passes time_zone through', async () => {
    // 1999-07-02 at +05:00 is 1999-07-01T19:00Z, so book 2 is included;
    // at -05:00 it is 1999-07-02T05:00Z, so book 2 is excluded
    const east = new QueryBuilder().range('published_at', 'gte', '1999-07-02', {
      time_zone: '+05:00',
    });
    const west = new QueryBuilder().range('published_at', 'gte', '1999-07-02', {
      time_zone: '-05:00',
    });
    expect(await bookIds(east)).toEqual(['2', '3']);
    expect(await bookIds(west)).toEqual(['3']);
  });

  it('passes boost through', async () => {
    const qb = new QueryBuilder().range('price', 'gt', 0, { boost: 3 });
    const hits = await search(books, qb);
    expect(hits).toHaveLength(3);
    for (const hit of hits) {
      expect(hit._score).toBe(3);
    }
  });

  it('passes relation through for range fields', async () => {
    const index = await kit.makeIndex(
      {
        index: 'periods',
        mappings: {
          properties: {
            id: { type: 'keyword' },
            period: { type: 'date_range' },
          },
        },
      },
      [
        {
          id: 'inside',
          period: { gte: '2020-03-01', lte: '2020-03-31' },
        },
        {
          id: 'overlap',
          period: { gte: '2020-06-01', lte: '2021-06-01' },
        },
      ],
    );
    const year2020: [string, string] = ['2020-01-01', '2020-12-31'];
    const within = new QueryBuilder().range('period', 'between', year2020, {
      relation: 'within',
    });
    const intersects = new QueryBuilder().range('period', 'between', year2020, {
      relation: 'intersects',
    });
    const sortedIds = async (qb: QueryBuilder) => {
      const response = await client.search(
        qb.getQuery({ index, sort: [{ id: 'asc' }] }),
      );
      return response.hits.hits.map((hit: estypes.SearchHit) => hit._id);
    };
    expect(await sortedIds(within)).toEqual(['inside']);
    expect(await sortedIds(intersects)).toEqual(['inside', 'overlap']);
  });
});
