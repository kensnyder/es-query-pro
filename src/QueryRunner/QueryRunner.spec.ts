import { describe, expect, expectTypeOf, it } from 'bun:test';
import type { Client, estypes } from '@elastic/elasticsearch';
import type { IndexErrorKind } from '../IndexManager/IndexManager';
import IndexManager from '../IndexManager/IndexManager';
import {
  connectionError,
  getRecordingClient,
  responseError,
  type SentRequest,
} from '../testFixtures/recordingClient';
import QueryRunner, {
  type QueryRecord,
  UPDATE_MANY_SCRIPT,
} from './QueryRunner';

const ALIAS = 'test~english~books';

const booksCreate = {
  index: 'books',
  mappings: {
    properties: {
      id: { type: 'keyword' },
      title: { type: 'text', fields: { raw: { type: 'keyword' } } },
      year: { type: 'integer' },
      embedding: { type: 'dense_vector', dims: 3 },
      publishing: {
        type: 'nested',
        properties: {
          author: { type: 'keyword' },
          year: { type: 'integer' },
        },
      },
      meta: {
        properties: {
          owner: { properties: { name: { type: 'keyword' } } },
        },
      },
    },
  },
} as const;

type Books = typeof booksCreate;

function getRunner(client: Client) {
  const index = new IndexManager(
    { client, version: 1, prefix: 'test' },
    booksCreate,
  );
  return new QueryRunner(index);
}

/** A runner for an index created from a widened (untyped) request */
function getLooseRunner(client: Client, create: estypes.IndicesCreateRequest) {
  return new QueryRunner(new IndexManager({ client, prefix: 'test' }, create));
}

const query = (req: SentRequest) =>
  Object.fromEntries(new URLSearchParams(req.querystring ?? ''));
/** The `statusCode` of an error envelope's `response` */
const statusOf = (res: { response: unknown }) =>
  (res.response as { statusCode?: number } | null)?.statusCode;
const keysOf = (value: object) => Object.keys(value).sort();

const envelopeKeys = ['error', 'errorKind', 'request', 'response', 'took'];
const findManyKeys = [
  ...envelopeKeys,
  'aggregations',
  'records',
  'total',
].sort();
const countKeys = [...envelopeKeys, 'total'].sort();
const updateManyKeys = [
  ...envelopeKeys,
  'failures',
  'noops',
  'success',
  'total',
  'updated',
  'versionConflicts',
].sort();

/** A search response with the given hits */
function searchReply(
  hits: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  return {
    body: {
      took: 3,
      timed_out: false,
      _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
      hits: {
        total: { value: hits.length, relation: 'eq' },
        max_score: 1,
        hits: hits.map((hit) => ({ _index: 'books-v1', ...hit })),
      },
      ...extra,
    },
  };
}

/** An update-by-query response */
function updateReply(extra: Record<string, unknown> = {}) {
  return {
    body: {
      took: 5,
      timed_out: false,
      total: 2,
      updated: 2,
      deleted: 0,
      batches: 1,
      version_conflicts: 0,
      noops: 0,
      retries: { bulk: 0, search: 0 },
      throttled_millis: 0,
      requests_per_second: -1,
      throttled_until_millis: 0,
      failures: [],
      ...extra,
    },
  };
}

describe('QueryRunner.count() (B-017, B-018, D10)', () => {
  it('should send only the query to _count', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_count`, { body: { count: 2 } });
    const runner = getRunner(client);
    runner.builder
      .term('id', '1')
      .limit(5)
      .page(3)
      .sort('year')
      .aggregateTerm({ field: 'id' })
      .highlightField('title')
      .excludeFields(['title'])
      .fields(['id'])
      .searchAfter([1])
      .trackTotalHits(true);
    const res = await runner.count();
    expect(res.error).toBe(null);
    expect(res.total).toBe(2);
    expect(sent).toHaveLength(1);
    expect(sent[0].path).toBe(`/${ALIAS}/_count`);
    expect(sent[0].body).toEqual({ query: { term: { id: '1' } } });
    expect(sent[0].querystring).toBeUndefined();
    expect(keysOf(res)).toEqual(countKeys);
    expect(res.errorKind).toBe(null);
    expect(typeof res.took).toBe('number');
    expect(res.request).toEqual({
      index: ALIAS,
      query: { term: { id: '1' } },
    });
  });

  it('should not change the builder', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_count`, { body: { count: 2 } });
    const runner = getRunner(client);
    runner.builder.term('id', '1').limit(5);
    const before = runner.builder.getQuery();
    await runner.count();
    expect(runner.builder.getQuery()).toEqual(before);
  });

  it('should count match_all without conditions', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_count`, { body: { count: 3 } });
    const res = await getRunner(client).count();
    expect(res.total).toBe(3);
    expect(sent[0].body).toEqual({ query: { match_all: {} } });
  });

  it('should send minScore() and let "more" override it', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_count`, { body: { count: 1 } });
    const runner = getRunner(client);
    runner.builder.match({ field: 'title', phrase: 'dune' }).minScore(1.5);
    await runner.count();
    expect(query(sent[0])).toEqual({ min_score: '1.5' });
    await runner.count({ min_score: 3, terminate_after: 10 });
    expect(query(sent[1])).toEqual({ min_score: '3', terminate_after: '10' });
  });

  it('should return the D10 envelope for retrievers without sending', async () => {
    const { client, sent } = getRecordingClient();
    const runner = getRunner(client);
    runner.builder
      .term('id', '1')
      .knn({ field: 'embedding', vector: [1, 0, 0], k: 2 });
    const res = await runner.count();
    expect(sent).toEqual([]);
    expect(res.total).toBe(null);
    expect(res.request).toBe(null);
    expect(res.error?.message).toMatch(/count\(\) does not support retrievers/);
    expect(res.errorKind).toBe('javascript');
    expect(res.response).toBe(null);
    expect(keysOf(res)).toEqual(countKeys);
  });

  it('should return the D10 envelope even when getBody() would throw', async () => {
    const { client, sent } = getRecordingClient();
    const runner = getRunner(client);
    runner.builder
      .knn({ field: 'embedding', vector: [1, 0, 0], k: 2 })
      .sort('year');
    const res = await runner.count();
    expect(sent).toEqual([]);
    expect(res.error?.message).toMatch(/does not support retrievers/);
  });

  it('should return an envelope when the builder throws', async () => {
    const { client, sent } = getRecordingClient();
    const runner = getRunner(client);
    runner.builder
      .term('id', '1')
      .rescore((q) => q.term('id', '2'))
      .sort('year');
    const res = await runner.count();
    expect(sent).toEqual([]);
    expect(res.total).toBe(null);
    expect(res.request).toBe(null);
    expect(res.error).toBeInstanceOf(TypeError);
    expect(res.errorKind).toBe('javascript');
  });

  it('should return a response error envelope', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_count`, responseError(400, 'parsing_exception'));
    const res = await getRunner(client).count();
    expect(res.total).toBe(null);
    expect(res.errorKind).toBe('response');
    expect(statusOf(res)).toBe(400);
    expect(res.request).toEqual({ index: ALIAS, query: { match_all: {} } });
    expect(keysOf(res)).toEqual(countKeys);
  });

  it('should return a connection error envelope', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_count`, connectionError());
    const res = await getRunner(client).count();
    expect(res.errorKind).toBe('connection');
    expect(res.response).toBe(null);
  });

  it('should type "more" as _count params', async () => {
    const { client } = getRecordingClient();
    const runner = getRunner(client);
    // @ts-expect-error  size is a search param
    await runner.count({ size: 1 });
    // @ts-expect-error  sort is a search param
    await runner.count({ sort: ['id'] });
    expect(true).toBe(true);
  });
});

describe('QueryRunner.findMany() envelope (B-108)', () => {
  it('should return the success envelope', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, searchReply([{ _id: 'a', _score: 1 }]));
    const res = await getRunner(client).findMany();
    expect(keysOf(res)).toEqual(findManyKeys);
    expect(res.error).toBe(null);
    expect(res.errorKind).toBe(null);
    expect(res.total).toBe(1);
    expect(res.aggregations).toBe(null);
    expect(typeof res.took).toBe('number');
    expect(res.request).toEqual({
      index: ALIAS,
      _source: ['*'],
      query: { match_all: {} },
    });
  });

  it('should return aggregations', async () => {
    const { client, script } = getRecordingClient();
    const aggregations = { id: { buckets: [{ key: '1', doc_count: 1 }] } };
    script(`POST /${ALIAS}/_search`, searchReply([], { aggregations }));
    const res = await getRunner(client).findMany();
    expect(res.aggregations).toEqual(aggregations);
  });

  it('should read a numeric or missing hits.total', async () => {
    const { client, script } = getRecordingClient();
    const numeric = searchReply([]);
    (numeric.body.hits as Record<string, unknown>).total = 7;
    const missing = searchReply([]);
    delete (missing.body.hits as Record<string, unknown>).total;
    script(`POST /${ALIAS}/_search`, numeric, missing);
    const runner = getRunner(client);
    expect((await runner.findMany()).total).toBe(7);
    expect((await runner.findMany()).total).toBe(null);
  });

  it('should return an error envelope for a response without hits', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, { body: { took: 1 } });
    const res = await getRunner(client).findMany();
    expect(res.records).toEqual([]);
    expect(res.total).toBe(null);
    expect(res.aggregations).toBe(null);
    expect(res.error?.message).toBe('response.hits.hits not found');
    expect(res.errorKind).toBe('javascript');
    expect(keysOf(res)).toEqual(findManyKeys);
  });

  it('should return a response error envelope with the error meta', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, responseError(400, 'parsing_exception'));
    const res = await getRunner(client).findMany();
    expect(res.records).toEqual([]);
    expect(res.total).toBe(null);
    expect(res.aggregations).toBe(null);
    expect(res.errorKind).toBe('response');
    expect(statusOf(res)).toBe(400);
    expect(res.request).not.toBe(null);
    expect(typeof res.took).toBe('number');
    expect(keysOf(res)).toEqual(findManyKeys);
  });

  it('should return a connection error envelope', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, connectionError());
    const res = await getRunner(client).findMany();
    expect(res.errorKind).toBe('connection');
    expect(res.response).toBe(null);
  });

  it('should return an envelope when getQuery() throws', async () => {
    const { client, sent } = getRecordingClient();
    const runner = getRunner(client);
    runner.builder.searchAfter([1]).page(2);
    const res = await runner.findMany();
    expect(sent).toEqual([]);
    expect(res.request).toBe(null);
    expect(res.error).toBeInstanceOf(TypeError);
    expect(res.errorKind).toBe('javascript');
  });

  it('should pass "more" through getQuery() overrides', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, searchReply([]));
    const runner = getRunner(client);
    runner.builder.limit(5);
    await runner.findMany({ size: 2, track_total_hits: false });
    expect(sent[0].body).toMatchObject({ size: 2, track_total_hits: false });
  });
});

describe('QueryRunner records (B-065)', () => {
  it('should carry _id, _score, _highlight and _sort', async () => {
    const { client, script } = getRecordingClient();
    script(
      `POST /${ALIAS}/_search`,
      searchReply([
        {
          _id: 'a',
          _score: 2.5,
          _source: { id: '1', title: 'Dune' },
          highlight: { title: ['<em>Dune</em>'] },
          sort: [2.5, '1'],
        },
        { _id: 'b', _score: null, _source: { id: '2' } },
      ]),
    );
    const { records } = await getRunner(client).findMany();
    expect(records).toEqual([
      {
        id: '1',
        title: 'Dune',
        _id: 'a',
        _score: 2.5,
        _highlight: { title: ['<em>Dune</em>'] },
        _sort: [2.5, '1'],
      },
      { id: '2', _id: 'b', _score: null },
    ]);
  });

  it('should return records without _source', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, searchReply([{ _id: 'a', _score: 1 }]));
    const runner = getRunner(client);
    runner.builder.fields([]);
    const { records } = await runner.findMany();
    expect(records).toEqual([{ _id: 'a', _score: 1 }]);
  });

  it('should type the record keys', () => {
    type Rec = QueryRecord<Books>;
    expectTypeOf<Rec['_id']>().toEqualTypeOf<string>();
    expectTypeOf<Rec['_score']>().toEqualTypeOf<number | null>();
    expectTypeOf<Rec['_highlight']>().toEqualTypeOf<
      Record<string, string[]> | undefined
    >();
    expectTypeOf<Rec['_sort']>().toEqualTypeOf<
      estypes.SortResults | undefined
    >();
    expectTypeOf<Rec>().toHaveProperty('title');
    expect(true).toBe(true);
  });
});

describe('QueryRunner.findFirst() (S-030)', () => {
  it('should request size 1 without changing the builder', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, searchReply([{ _id: 'a', _score: 1 }]));
    const runner = getRunner(client);
    const res = await runner.findFirst();
    expect((sent[0].body as { size: number }).size).toBe(1);
    expect(runner.builder.getLimit()).toBe(null);
    expect(res.record?._id).toBe('a');
    expect(res.error).toBe(null);
    expect(res.errorKind).toBe(null);
  });

  it('should let "more" set the size', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, searchReply([]));
    await getRunner(client).findFirst({ size: 3 });
    expect((sent[0].body as { size: number }).size).toBe(3);
  });

  it('should return record null when nothing matched (B-108)', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, searchReply([]));
    const res = await getRunner(client).findFirst();
    expect(res.record === null).toBe(true);
    expect(res.error).toBe(null);
  });

  it('should return record null and the error envelope on failure', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, connectionError());
    const res = await getRunner(client).findFirst();
    expect(res.record === null).toBe(true);
    expect(res.errorKind).toBe('connection');
  });
});

describe('QueryRunner.findFirstOrThrow() (B-019)', () => {
  it('should return the record', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, searchReply([{ _id: 'a', _score: 1 }]));
    const res = await getRunner(client).findFirstOrThrow();
    expect(res.record._id).toBe('a');
    expectTypeOf(res.record).toEqualTypeOf<QueryRecord<Books>>();
  });

  it('should throw NotFoundError when nothing matched', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, searchReply([]));
    const error = await getRunner(client)
      .findFirstOrThrow()
      .catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NotFoundError');
    expect(error.status).toBe(404);
    expect(error.result.total).toBe(0);
  });

  it('should rethrow a connection error', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, connectionError());
    const error = await getRunner(client)
      .findFirstOrThrow()
      .catch((e) => e);
    expect(error.name).toBe('ConnectionError');
  });

  it('should rethrow a response error', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_search`, responseError(400, 'parsing_exception'));
    const error = await getRunner(client)
      .findFirstOrThrow()
      .catch((e) => e);
    expect(error.name).toBe('ResponseError');
    expect(error.meta.statusCode).toBe(400);
  });

  it('should rethrow a builder error', async () => {
    const { client } = getRecordingClient();
    const runner = getRunner(client);
    runner.builder.searchAfter([1]).page(2);
    const error = await runner.findFirstOrThrow().catch((e) => e);
    expect(error).toBeInstanceOf(TypeError);
  });
});

describe('QueryRunner.updateMany() request (B-020, B-059, B-060)', () => {
  it('should send the fixed script with paths as params', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_update_by_query`, updateReply());
    const runner = getRunner(client);
    runner.builder.term('id', '1');
    const res = await runner.updateMany({
      title: "it's",
      'publishing.year': 2001,
      'meta.owner.name': 'ana',
      year: undefined,
    });
    expect(res.error).toBe(null);
    expect(sent).toHaveLength(1);
    expect(sent[0].path).toBe(`/${ALIAS}/_update_by_query`);
    expect(sent[0].querystring).toBeUndefined();
    expect(sent[0].body).toEqual({
      conflicts: 'proceed',
      query: { term: { id: '1' } },
      script: {
        lang: 'painless',
        source: UPDATE_MANY_SCRIPT,
        params: {
          updates: [
            { path: ['title'], value: "it's" },
            { path: ['publishing', 'year'], value: 2001 },
            { path: ['meta', 'owner', 'name'], value: 'ana' },
          ],
        },
      },
    });
  });

  it('should keep field names out of the script source', () => {
    expect(UPDATE_MANY_SCRIPT).not.toContain('ctx._source[');
    expect(UPDATE_MANY_SCRIPT).toContain('params.updates');
  });

  it('should accept a whole object container', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_update_by_query`, updateReply());
    const res = await getRunner(client).updateMany({
      publishing: { author: 'x', year: 1 },
    });
    expect(res.error).toBe(null);
    expect(sent).toHaveLength(1);
  });

  it('should send limit() as max_docs (B-060)', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_update_by_query`, updateReply());
    const runner = getRunner(client);
    runner.builder.limit(5);
    await runner.updateMany({ year: 1 });
    expect(sent[0].body).toMatchObject({ conflicts: 'proceed', max_docs: 5 });
  });

  it('should let "more" override the defaults', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_update_by_query`, updateReply());
    const runner = getRunner(client);
    runner.builder.limit(5);
    await runner.updateMany(
      { year: 1 },
      { conflicts: 'abort', max_docs: 2, refresh: true },
    );
    expect(sent[0].body).toMatchObject({ conflicts: 'abort', max_docs: 2 });
    expect(query(sent[0])).toEqual({ refresh: 'true' });
  });

  it('should refuse limit(0) without sending', async () => {
    const { client, sent } = getRecordingClient();
    const runner = getRunner(client);
    runner.builder.aggregateTerm({ field: 'id' });
    const res = await runner.updateMany({ year: 1 });
    expect(sent).toEqual([]);
    expect(res.error).toBeInstanceOf(RangeError);
    expect(res.error?.message).toMatch(/limit is 0/);
  });

  it('should refuse a builder without a query', async () => {
    const { client, sent } = getRecordingClient();
    const runner = getRunner(client);
    runner.builder.knn({ field: 'embedding', vector: [1, 0, 0], k: 2 });
    const res = await runner.updateMany({ year: 1 });
    expect(sent).toEqual([]);
    expect(res.success).toBe(false);
    expect(res.error?.message).toMatch(/produced no "query"/);
    expect(res.errorKind).toBe('javascript');
    expect(keysOf(res)).toEqual(updateManyKeys);
  });

  it('should not accept script in "more"', async () => {
    const { client } = getRecordingClient();
    const runner = getRunner(client);
    // @ts-expect-error  the script is updateMany's own
    await runner.updateMany({ year: 1 }, { script: { source: 'x' } });
    // @ts-expect-error  unknown key
    await runner.updateMany({ titel: 1 });
    expect(true).toBe(true);
  });
});

describe('QueryRunner.updateMany() validation (B-020, B-059, S-033)', () => {
  const rejected: [string, unknown][] = [
    ['empty newValues', {}],
    ['only undefined values', { year: undefined }],
    ['an empty key', { '': { id: 'x' } }],
    ['a dot key', { '.': 1 }],
    ['an empty segment', { 'publishing..year': 1 }],
    ['a trailing dot', { 'publishing.': 1 }],
    [
      'a hostile key',
      { "x'] = params['v0']; ctx['op'] = 'delete'; ctx['_source']['y": 1 },
    ],
    ['a quote', { "it's": 1 }],
    ['an unknown field', { titel: 'x' }],
    ['a sub-field', { 'title.raw': 'x' }],
    ['a path below a leaf', { 'year.value': 1 }],
    ['an inherited key', { constructor: 1 }],
    ['a proto key', JSON.parse('{"__proto__": 1}')],
    ['a key inside another key', { publishing: {}, 'publishing.year': 1 }],
    ['null', null],
    ['an array', [['year', 1]]],
    ['a string', 'year=1'],
  ];

  for (const [label, values] of rejected) {
    it(`should reject ${label} without sending`, async () => {
      const { client, sent } = getRecordingClient();
      const runner = getRunner(client);
      const res = await runner.updateMany(values as { year: number });
      expect(sent).toEqual([]);
      expect(res.success).toBe(false);
      expect(res.error).toBeInstanceOf(Error);
      expect(res.errorKind).toBe('javascript');
      expect(res.request).toBe(null);
      expect(res.updated).toBe(null);
      expect(keysOf(res)).toEqual(updateManyKeys);
    });
  }

  it('should name every unknown key', async () => {
    const { client } = getRecordingClient();
    const res = await getRunner(client).updateMany({
      titel: 1,
      yaer: 2,
    } as unknown as { year: number });
    expect(res.error).toBeInstanceOf(RangeError);
    expect(res.error?.message).toContain('"titel", "yaer"');
  });

  it('should accept any path below a loose dynamic mapping', async () => {
    const { client, sent } = getRecordingClient();
    const runner = getLooseRunner(client, {
      index: 'books',
      mappings: { dynamic: true, properties: { id: { type: 'keyword' } } },
    });
    const res = await runner.updateMany({ 'a.b': 1, id: '2' });
    expect(res.error).toBe(null);
    expect(sent).toHaveLength(1);
  });

  it('should follow dynamic per object, inherited when omitted', async () => {
    const { client, sent } = getRecordingClient();
    const runner = getLooseRunner(client, {
      index: 'books',
      mappings: {
        dynamic: 'strict',
        properties: {
          open: {
            dynamic: 'runtime',
            properties: {
              inner: { properties: { x: { type: 'keyword' } } },
              closed: { dynamic: false, properties: {} },
            },
          },
          flat: { type: 'flattened' },
          text: { type: 'text' },
        },
      },
    });
    for (const key of ['open.new', 'open.inner.new', 'flat.any.key']) {
      const res = await runner.updateMany({ [key]: 1 });
      expect(res.error).toBe(null);
    }
    for (const key of ['other', 'open.closed.new', 'text.sub']) {
      const res = await runner.updateMany({ [key]: 1 });
      expect(res.error).toBeInstanceOf(RangeError);
    }
    expect(sent).toHaveLength(3);
  });

  it('should accept runtime fields and reject everything without mappings', async () => {
    const { client, sent } = getRecordingClient();
    const runtime = getLooseRunner(client, {
      index: 'books',
      mappings: { runtime: { score: { type: 'long' } } },
    });
    expect((await runtime.updateMany({ score: 1 })).error).toBe(null);
    const bare = getLooseRunner(client, { index: 'books' });
    expect((await bare.updateMany({ score: 1 })).error).toBeInstanceOf(
      RangeError,
    );
    expect(sent).toHaveLength(1);
  });
});

describe('QueryRunner.updateMany() envelope (B-061)', () => {
  it('should return the success envelope', async () => {
    const { client, script } = getRecordingClient();
    script(
      `POST /${ALIAS}/_update_by_query`,
      updateReply({ total: 3, updated: 2, noops: 1, version_conflicts: 0 }),
    );
    const res = await getRunner(client).updateMany({ year: 1 });
    expect(keysOf(res)).toEqual(updateManyKeys);
    expect(res.success).toBe(true);
    expect(res.updated).toBe(2);
    expect(res.total).toBe(3);
    expect(res.noops).toBe(1);
    expect(res.versionConflicts).toBe(0);
    expect(res.failures).toEqual([]);
    expect(res.error).toBe(null);
    expect(res.errorKind).toBe(null);
    expect(res.request?.index).toBe(ALIAS);
    expect(typeof res.took).toBe('number');
  });

  it('should count version conflicts as success with conflicts proceed', async () => {
    const { client, script } = getRecordingClient();
    script(
      `POST /${ALIAS}/_update_by_query`,
      updateReply({ updated: 1, version_conflicts: 1 }),
    );
    const res = await getRunner(client).updateMany({ year: 1 });
    expect(res.success).toBe(true);
    expect(res.versionConflicts).toBe(1);
  });

  it('should turn failures into an AggregateError', async () => {
    const { client, script } = getRecordingClient();
    const failure = {
      index: 'books-v1',
      id: '3',
      cause: { type: 'script_exception', reason: 'runtime error' },
      status: 400,
    };
    script(
      `POST /${ALIAS}/_update_by_query`,
      updateReply({ updated: 1, failures: [failure] }),
    );
    const res = await getRunner(client).updateMany({ year: 1 });
    expect(res.success).toBe(false);
    expect(res.updated).toBe(1);
    expect(res.error).toBeInstanceOf(AggregateError);
    expect(res.error?.message).toMatch(/1 document\(s\) failed/);
    expect(res.errorKind).toBe('response');
    expect(statusOf(res)).toBe(200);
    expect(res.failures).toEqual([failure]);
  });

  it('should report a timeout', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_update_by_query`, updateReply({ timed_out: true }));
    const res = await getRunner(client).updateMany({ year: 1 });
    expect(res.success).toBe(false);
    expect(res.error?.message).toMatch(/timed out/);
  });

  it('should return a response error envelope', async () => {
    const { client, script } = getRecordingClient();
    script(
      `POST /${ALIAS}/_update_by_query`,
      responseError(409, 'version_conflict_engine_exception'),
    );
    const res = await getRunner(client).updateMany({ year: 1 });
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe('response');
    expect(statusOf(res)).toBe(409);
    expect(res.request).not.toBe(null);
    expect(keysOf(res)).toEqual(updateManyKeys);
  });

  it('should return a connection error envelope', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_update_by_query`, connectionError());
    const res = await getRunner(client).updateMany({ year: 1 });
    expect(res.errorKind).toBe('connection');
    expect(res.response).toBe(null);
  });

  it('should report a task when not waiting for completion', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_update_by_query`, { body: { task: 'n:1' } });
    const res = await getRunner(client).updateMany(
      { year: 1 },
      { wait_for_completion: false },
    );
    expect(res.success).toBe(true);
    expect(res.updated).toBe(null);
    expect(res.response).toEqual({ task: 'n:1' });
  });
});

describe('QueryRunner result types (B-108)', () => {
  it('should carry errorKind on every result', () => {
    type Runner = QueryRunner<Books>;
    type Kind = IndexErrorKind | null;
    expectTypeOf<
      Awaited<ReturnType<Runner['findMany']>>['errorKind']
    >().toEqualTypeOf<Kind>();
    expectTypeOf<
      Awaited<ReturnType<Runner['findFirst']>>['errorKind']
    >().toEqualTypeOf<Kind>();
    expectTypeOf<
      Awaited<ReturnType<Runner['count']>>['errorKind']
    >().toEqualTypeOf<Kind>();
    expectTypeOf<
      Awaited<ReturnType<Runner['updateMany']>>['errorKind']
    >().toEqualTypeOf<Kind>();
    expectTypeOf<
      Awaited<ReturnType<Runner['count']>>['took']
    >().toEqualTypeOf<number>();
    expect(true).toBe(true);
  });
});
