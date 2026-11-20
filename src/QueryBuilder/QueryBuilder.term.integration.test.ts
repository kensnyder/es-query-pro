import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { createTestKit } from '../testFixtures/esTestKit';
import QueryBuilder from './QueryBuilder';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('qb-term');
const client = kit.client;
let items = '';

const itemDocs = [
  {
    id: '1',
    tags: ['red', 'blue', 'green'],
    required: 3,
    code: 'Alpha-100',
    title: 'Alpine hiking boots',
    body: 'waterproof leather for mountain trails',
  },
  {
    id: '2',
    tags: ['red', 'blue'],
    required: 2,
    code: 'alpha-200',
    title: 'Trail running shoes',
    body: 'light mesh shoes for hiking',
  },
  {
    id: '3',
    tags: ['red'],
    required: 1,
    code: 'BETA-300',
    title: 'Mountain tent',
    body: 'two person tent',
  },
  {
    id: '4',
    tags: ['yellow'],
    required: 1,
    code: 'gamma',
    title: 'Kitchen kettle',
    body: 'stainless steel',
  },
];

type ItemField = 'id' | 'tags' | 'required' | 'code' | 'title' | 'body';

beforeAll(async () => {
  items = await kit.makeIndex(
    {
      index: 'items',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          tags: { type: 'keyword' },
          required: { type: 'integer' },
          code: { type: 'keyword' },
          title: { type: 'text' },
          body: { type: 'text' },
        },
      },
    },
    itemDocs,
  );
});

afterAll(async () => {
  await kit.cleanup();
});

/** Ids of the matching items, sorted by id */
async function ids(build: (qb: QueryBuilder<ItemField>) => unknown) {
  const qb = new QueryBuilder<ItemField>();
  build(qb);
  const response = await client.search(
    qb.getQuery({ index: items, sort: [{ id: 'asc' }] }),
  );
  return response.hits.hits.map((hit) => hit._id);
}

/** The error a search rejects with, or null when it succeeds */
async function searchError(build: (qb: QueryBuilder<ItemField>) => unknown) {
  return ids(build)
    .then(() => null)
    .catch((e: Error & { meta?: { statusCode?: number } }) => e);
}

describe('termsSet() - Integration (B-049)', () => {
  const terms = ['red', 'blue'];

  it('server rejects a terms_set without a minimum (the old output)', async () => {
    const error = await searchError((qb) =>
      qb.rawCondition({ terms_set: { tags: { terms } } }),
    );
    expect(error?.name).toBe('ResponseError');
    expect(error?.meta?.statusCode).toBe(400);
    expect(error?.message).toContain('No minimum should match');
  });

  it('defaults to one matching term', async () => {
    expect(await ids((qb) => qb.termsSet({ field: 'tags', terms }))).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('minimumShouldMatch as a number and as a percentage', async () => {
    expect(
      await ids((qb) =>
        qb.termsSet({ field: 'tags', terms, minimumShouldMatch: 2 }),
      ),
    ).toEqual(['1', '2']);
    expect(
      await ids((qb) =>
        qb.termsSet({ field: 'tags', terms, minimumShouldMatch: '100%' }),
      ),
    ).toEqual(['1', '2']);
  });

  it('minimumShouldMatchField reads the minimum per document', async () => {
    expect(
      await ids((qb) =>
        qb.termsSet({
          field: 'tags',
          terms,
          minimumShouldMatchField: 'required',
        }),
      ),
    ).toEqual(['2', '3']);
  });

  it('script as a source string and as a script object', async () => {
    expect(
      await ids((qb) =>
        qb.termsSet({
          field: 'tags',
          terms,
          script: 'Math.min(params.num_terms, 2)',
        }),
      ),
    ).toEqual(['1', '2']);
    expect(
      await ids((qb) =>
        qb.termsSet({
          field: 'tags',
          terms,
          script: {
            source: "doc['required'].value",
          },
        }),
      ),
    ).toEqual(['2', '3']);
  });
});

describe('regexp() - Integration (B-052, S-005)', () => {
  it('both call forms are case-insensitive by default', async () => {
    const fromString = await ids((qb) => qb.regexp('code', 'alpha-[0-9]+'));
    const fromObject = await ids((qb) =>
      qb.regexp({ field: 'code', value: 'alpha-[0-9]+' }),
    );
    expect(fromString).toEqual(['1', '2']);
    expect(fromObject).toEqual(fromString);
  });

  it('caseSensitive: true in both call forms', async () => {
    expect(
      await ids((qb) =>
        qb.regexp('code', 'alpha-[0-9]+', { caseSensitive: true }),
      ),
    ).toEqual(['2']);
    expect(
      await ids((qb) =>
        qb.regexp({
          field: 'code',
          value: 'alpha-[0-9]+',
          caseSensitive: true,
        }),
      ),
    ).toEqual(['2']);
  });

  it('flags enable or disable optional operators', async () => {
    const pattern = 'alpha-<100-150>';
    expect(
      await ids((qb) => qb.regexp('code', pattern, { flags: 'INTERVAL' })),
    ).toEqual(['1']);
    expect(
      await ids((qb) => qb.regexp('code', pattern, { flags: 'NONE' })),
    ).toEqual([]);
  });

  it('the deprecated rexgep() alias matches the same documents', async () => {
    expect(await ids((qb) => qb.rexgep('code', 'alpha-[0-9]+'))).toEqual([
      '1',
      '2',
    ]);
  });
});

describe('term(), wildcard(), containsExact() - Integration (S-050, S-051)', () => {
  it('term is case-sensitive unless caseSensitive: false', async () => {
    expect(await ids((qb) => qb.term('code', 'ALPHA-100'))).toEqual([]);
    expect(
      await ids((qb) => qb.term('code', 'ALPHA-100', { caseSensitive: false })),
    ).toEqual(['1']);
    expect(
      await ids((qb) =>
        qb.term({ field: 'code', value: 'ALPHA-100', caseSensitive: false }),
      ),
    ).toEqual(['1']);
  });

  it('wildcard is case-insensitive in both call forms', async () => {
    expect(await ids((qb) => qb.wildcard('code', 'ALPHA-*'))).toEqual([
      '1',
      '2',
    ]);
    expect(
      await ids((qb) => qb.wildcard({ field: 'code', value: 'ALPHA-*' })),
    ).toEqual(['1', '2']);
  });

  it('containsExact matches a substring; a blank value matches all', async () => {
    expect(await ids((qb) => qb.containsExact('code', 'PHA-1'))).toEqual(['1']);
    expect(await ids((qb) => qb.containsExact('code', ''))).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
  });
});

describe('queryString() and simpleQueryString() - Integration (S-024)', () => {
  it('default_operator', async () => {
    expect(await ids((qb) => qb.queryString('body', 'tent leather'))).toEqual([
      '1',
      '3',
    ]);
    expect(
      await ids((qb) =>
        qb.queryString('body', 'tent leather', { default_operator: 'and' }),
      ),
    ).toEqual([]);
  });

  it('fuzziness applies to ~ without a number', async () => {
    expect(await ids((qb) => qb.queryString('title', 'tant~'))).toEqual(['3']);
    expect(
      await ids((qb) =>
        qb.queryString({ field: 'title', queryString: 'tant~', fuzziness: 0 }),
      ),
    ).toEqual([]);
  });

  it('analyze_wildcard and lenient', async () => {
    expect(
      await ids((qb) =>
        qb.queryString('title', 'Mount*', { analyze_wildcard: true }),
      ),
    ).toEqual(['3']);
    const strict = await searchError((qb) => qb.queryString('required', 'abc'));
    expect(strict?.meta?.statusCode).toBe(400);
    expect(
      await ids((qb) => qb.queryString('required', 'abc', { lenient: true })),
    ).toEqual([]);
  });

  it('queryString fails on bad syntax; simpleQueryString does not', async () => {
    const error = await searchError((qb) =>
      qb.queryString('title', 'tent AND ('),
    );
    expect(error?.meta?.statusCode).toBe(400);
    expect(
      await ids((qb) =>
        qb.simpleQueryString({ fields: ['title'], query: 'tent AND (' }),
      ),
    ).toEqual(['3']);
  });

  it('simpleQueryString operators, boosted fields and options', async () => {
    // with the default "or", "-tent" means "or not tent"
    expect(
      await ids((qb) =>
        qb.simpleQueryString({
          fields: ['title^2', 'body'],
          query: 'mountain -tent',
        }),
      ),
    ).toEqual(['1', '2', '3', '4']);
    expect(
      await ids((qb) =>
        qb.simpleQueryString({
          fields: ['title^2', 'body'],
          query: 'mountain -tent',
          default_operator: 'and',
        }),
      ),
    ).toEqual(['1']);
    expect(
      await ids((qb) =>
        qb.simpleQueryString({
          fields: ['body'],
          query: 'hiking mesh',
          default_operator: 'and',
        }),
      ),
    ).toEqual(['2']);
  });
});

describe('moreLikeThis() - Integration (S-024)', () => {
  const like = 'hiking mountain';
  const options = { min_term_freq: 1, min_doc_freq: 1 };

  it('one field', async () => {
    expect(
      await ids((qb) => qb.moreLikeThis({ field: 'title', like, ...options })),
    ).toEqual(['1', '3']);
  });

  it('several fields', async () => {
    expect(
      await ids((qb) =>
        qb.moreLikeThis({ field: ['title', 'body'], like, ...options }),
      ),
    ).toEqual(['1', '2', '3']);
  });
});
