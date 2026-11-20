import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import {
  getArticlesCreateRequest,
  getArticlesData,
} from '../testFixtures/articles';
import { createTestKit } from '../testFixtures/esTestKit';
import QueryBuilder from './QueryBuilder';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(60_000);

const kit = await createTestKit('qb-serialize');
const client = kit.client;
afterAll(() => kit.cleanup());

const retrieverTest = kit.testIf('retrievers');
const hybrid = kit.caps.retrievers && kit.caps.inference;
if (!hybrid) {
  console.log(
    'skipping the rrf window test: it needs caps.retrievers and ' +
      `caps.inference (retrievers=${kit.caps.retrievers}, ` +
      `inference=${kit.caps.inference})`,
  );
}
const hybridTest = it.skipIf(!hybrid);

type Field = 'id' | 'n' | 'cat' | 'body' | 'vec';
type Doc = { id: string; n: number; cat: string; body: string; vec: number[] };

/** 150 docs; `n` = 1..150, `cat` 'odd'/'even' by `n`, vectors drift with n */
const docs: Doc[] = Array.from({ length: 150 }, (_, i) => ({
  id: String(i + 1),
  n: i + 1,
  cat: (i + 1) % 2 === 1 ? 'odd' : 'even',
  body: `doc number ${i + 1} ${(i + 1) % 3 === 0 ? 'fizz' : 'buzz'}`,
  vec: [1, (i + 1) / 150, 0.5],
}));

const create: estypes.IndicesCreateRequest = {
  index: 'nums',
  mappings: {
    properties: {
      id: { type: 'keyword' },
      n: { type: 'integer' },
      cat: { type: 'keyword' },
      body: { type: 'text' },
      vec: {
        type: 'dense_vector',
        dims: 3,
        similarity: 'cosine',
        index: true,
        index_options: { type: 'hnsw' },
      },
    },
  },
};

let index = '';
let articles = '';

beforeAll(async () => {
  index = await kit.makeIndex(create, docs);
  if (hybrid && kit.caps.inferenceId) {
    articles = await kit.makeIndex(
      getArticlesCreateRequest('articles', kit.caps.inferenceId),
      getArticlesData(),
    );
  }
});

const knn = (vector: number[]) => ({ field: 'vec' as const, vector, k: 150 });

/** Two knn retrievers: combined in a `linear` retriever */
function twoKnn() {
  return new QueryBuilder<Field>()
    .knn({ ...knn([1, 0, 0]), numCandidates: 200 })
    .knn({ ...knn([1, 1, 0]), numCandidates: 200 });
}

function search(request: estypes.SearchRequest) {
  return client.search<Doc>({ index, ...request });
}

function run(qb: QueryBuilder<Field>) {
  return search(qb.getQuery());
}

const ids = (res: estypes.SearchResponse<Doc>) =>
  res.hits.hits.map((hit) => hit._id);

/** The server's rejection of a raw request: status and reason */
async function rejection(request: estypes.SearchRequest) {
  try {
    await search(request);
  } catch (e) {
    const { meta } = e as {
      meta?: { statusCode?: number; body?: { error?: { reason?: string } } };
    };
    return {
      status: meta?.statusCode,
      reason: String(meta?.body?.error?.reason ?? ''),
    };
  }
  return { status: 200, reason: '' };
}

describe('rank_window_size covers the page (B-040)', () => {
  retrieverTest('reproduce: window 50 with size 100 is rejected', async () => {
    const old = twoKnn().rankWindowSize(50).limit(100);
    const body = structuredClone(old.getQuery({ size: 50 }));
    body.size = 100;
    const { status, reason } = await rejection(body);
    expect(status).toBe(400);
    expect(reason).toContain('[rank_window_size: 50]');
    expect(() => old.getBody()).toThrow(RangeError);
  });

  retrieverTest('limit(100) succeeds and returns 100 hits', async () => {
    const res = await run(twoKnn().limit(100));
    expect(res.hits.hits).toHaveLength(100);
  });

  retrieverTest('pages past the default window', async () => {
    const qb = twoKnn().limit(10).page(7);
    const res = await run(qb);
    expect(res.hits.hits).toHaveLength(10);
    // the old body (window 50) returned an empty page here
    const old = structuredClone(qb.getQuery());
    if (old.retriever?.linear) {
      old.retriever.linear.rank_window_size = 50;
    }
    expect((await search(old)).hits.hits).toHaveLength(0);
    const first = new Set(ids(await run(twoKnn().limit(10))));
    expect(ids(res).some((id) => first.has(id))).toBe(false);
  });

  hybridTest('rrf with limit(100) is accepted', async () => {
    const qb = new QueryBuilder()
      .rrf({
        semanticField: 'body_semantic',
        standardField: 'body',
        phrase: 'bread',
      })
      .limit(100);
    const res = await client.search({ index: articles, ...qb.getQuery() });
    expect(res.hits.hits.length).toBeGreaterThan(0);
    const old = structuredClone(qb.getQuery());
    if (old.retriever?.rrf) {
      old.retriever.rrf.rank_window_size = 50;
    }
    await expect(client.search({ index: articles, ...old })).rejects.toThrow(
      /rank_window_size: 50/,
    );
  });
});

describe('a lone retriever with conditions (S-057)', () => {
  it('excludes documents that do not match the conditions', async () => {
    const qb = new QueryBuilder<Field>()
      .knn({ ...knn([1, 0, 0]), numCandidates: 200 })
      .term('cat', 'odd')
      .filter((sub) => sub.range('n', '<=', 40))
      .limit(100);
    expect(qb.getBody().retriever?.knn?.filter).toBeDefined();
    const res = await run(qb);
    expect(res.hits.hits).toHaveLength(20);
    for (const hit of res.hits.hits) {
      expect(hit._source?.cat).toBe('odd');
      expect(hit._source?.n).toBeLessThanOrEqual(40);
    }
    // knn scores (no linear minmax normalization): the best is not 1.0
    expect(res.hits.hits[0]._score).toBeLessThan(1);
  });

  retrieverTest('several retrievers keep linear.filter', async () => {
    const res = await run(twoKnn().term('cat', 'even').limit(100));
    expect(res.hits.hits).toHaveLength(75);
    expect(res.hits.hits.every((hit) => hit._source?.cat === 'even')).toBe(
      true,
    );
  });
});

describe('combinations the builder rejects are rejected raw (B-058)', () => {
  const lone = () => new QueryBuilder<Field>().knn(knn([1, 0, 0]));

  it('retriever + sort', async () => {
    expect(() => lone().sort('n').getQuery()).toThrow(TypeError);
    const { status, reason } = await rejection({
      ...lone().getQuery(),
      sort: [{ n: { order: 'asc' } }],
    });
    expect(status).toBe(400);
    expect(reason).toContain('cannot specify [retriever] and [sort]');
  });

  it('retriever + search_after', async () => {
    expect(() => lone().searchAfter([1]).getQuery()).toThrow(TypeError);
    const { status, reason } = await rejection({
      ...lone().getQuery(),
      search_after: [1],
    });
    expect(status).toBe(400);
    expect(reason).toContain('cannot specify [retriever] and [search_after]');
  });

  it('retriever + top-level rescore (the builder uses a rescorer instead)', async () => {
    const qb = lone().rescore((q) => q.term('cat', 'odd'));
    expect(qb.getBody().rescore).toBeUndefined();
    const { status, reason } = await rejection({
      ...lone().getQuery(),
      rescore: qb.getRescore(),
    });
    expect(status).toBe(400);
    expect(reason).toContain('cannot specify [retriever] and [rescore]');
  });

  retrieverTest('linear window below size', async () => {
    const qb = twoKnn().rankWindowSize(20).limit(30);
    expect(() => qb.getQuery()).toThrow(RangeError);
    const raw = structuredClone(twoKnn().rankWindowSize(20).getQuery());
    raw.size = 30;
    const { status, reason } = await rejection(raw);
    expect(status).toBe(400);
    expect(reason).toContain('[rank_window_size: 20]');
  });

  it('rescorer window below size', async () => {
    const qb = lone()
      .rescore((q) => q.term('cat', 'odd'), { windowSize: 5 })
      .limit(10);
    expect(() => qb.getQuery()).toThrow(RangeError);
    const raw = structuredClone(qb.getQuery({ size: 5 }));
    raw.size = 10;
    const { status, reason } = await rejection(raw);
    expect(status).toBe(400);
    expect(reason).toContain('[rescorer] requires [window_size: 5]');
  });

  retrieverTest('rescorer window above the linear window', async () => {
    const rescored = () =>
      twoKnn().rescore((q) => q.term('cat', 'odd'), { windowSize: 100 });
    expect(() => rescored().rankWindowSize(50).getQuery()).toThrow(RangeError);
    const raw = structuredClone(rescored().rankWindowSize(100).getQuery());
    const linear = raw.retriever?.rescorer?.retriever?.linear;
    if (!linear) {
      throw new Error('expected a rescorer around a linear retriever');
    }
    linear.rank_window_size = 50;
    const { status, reason } = await rejection(raw);
    expect(status).toBe(400);
    expect(reason).toContain("sub retriever's linear [rank_window_size: 50]");
  });

  it('did not reproduce: retriever + min_score is accepted and applied', async () => {
    const all = await run(lone().limit(100));
    const scores = all.hits.hits.map((hit) => hit._score ?? 0);
    const cutoff = scores[49];
    const res = await run(lone().limit(100).minScore(cutoff));
    expect(res.hits.hits.length).toBeGreaterThanOrEqual(50);
    expect(res.hits.hits.length).toBeLessThan(100);
    for (const hit of res.hits.hits) {
      expect(hit._score ?? 0).toBeGreaterThanOrEqual(cutoff);
    }
  });
});

describe('rescore on the retriever path (S-021)', () => {
  it('a lone knn is rescored through a rescorer retriever', async () => {
    const plain = await run(
      new QueryBuilder<Field>().knn(knn([1, 0, 0])).limit(10),
    );
    const plainCats = plain.hits.hits.map((hit) => hit._source?.cat);
    expect(plainCats).toContain('even');
    const qb = new QueryBuilder<Field>()
      .knn(knn([1, 0, 0]))
      .rescore((q) => q.term('cat', 'odd'), { rescoreQueryWeight: 10 });
    expect(qb.getBody().retriever?.rescorer).toBeDefined();
    // without a size, the server returns the whole rescore window (50)
    expect((await run(qb)).hits.hits).toHaveLength(50);
    const res = await run(qb.limit(10));
    expect(res.hits.hits).toHaveLength(10);
    expect(res.hits.hits.every((hit) => hit._source?.cat === 'odd')).toBe(true);
  });

  retrieverTest('linear with conditions and paging is rescored', async () => {
    const rescored = () =>
      twoKnn()
        .range('n', '<=', 120)
        .rescore((q) => q.term('cat', 'odd'), { rescoreQueryWeight: 10 });
    // the rescore window follows the rank window: 60 for both requests
    const window = await run(rescored().limit(60));
    expect(window.hits.hits).toHaveLength(60);
    const cats = window.hits.hits.map((hit) => hit._source?.cat);
    const firstEven = cats.indexOf('even');
    expect(firstEven).toBeGreaterThan(0);
    expect(cats.slice(firstEven)).not.toContain('odd');
    for (const hit of window.hits.hits) {
      expect(hit._source?.n).toBeLessThanOrEqual(120);
    }
    const page3 = await run(rescored().limit(20).page(3));
    expect(ids(page3)).toEqual(ids(window).slice(40, 60));
  });
});

describe('toKibana() (B-057)', () => {
  /** Send a Kibana console request verbatim through the transport */
  async function sendKibana(text: string) {
    const [line, ...json] = text.split('\n');
    const [method, path] = line.split(' ');
    return (await client.transport.request({
      method,
      path: `/${path}`,
      body: JSON.parse(json.join('\n')),
    })) as estypes.SearchResponse<Doc>;
  }

  it('the query-path body is accepted as is', async () => {
    const qb = new QueryBuilder<Field>({ index })
      .term('cat', 'odd')
      .fields(['id', 'n', 'body'])
      .excludeFields(['body'])
      .highlightField('body')
      .aggregateTerm({ field: 'cat' })
      .sort('n', 'desc')
      .limit(3);
    const res = await sendKibana(qb.toKibana());
    expect(res.hits.hits.map((hit) => hit._id)).toEqual(['149', '147', '145']);
    expect(Object.keys(res.hits.hits[0]._source ?? {}).sort()).toEqual([
      'id',
      'n',
    ]);
  });

  it('the retriever-path body is accepted as is', async () => {
    const qb = new QueryBuilder<Field>()
      .knn(knn([1, 0, 0]))
      .term('cat', 'even')
      .limit(5);
    const text = qb.toKibana(index);
    expect(text.startsWith(`GET ${index}/_search\n`)).toBe(true);
    const res = await sendKibana(text);
    expect(res.hits.hits).toHaveLength(5);
    expect(res.hits.hits.every((hit) => hit._source?.cat === 'even')).toBe(
      true,
    );
  });

  it('without an index it searches every index (GET _search)', async () => {
    const qb = new QueryBuilder<Field>().term('id', 'no-such-id').limit(1);
    const text = qb.toKibana();
    expect(text.startsWith('GET _search\n')).toBe(true);
    const res = await sendKibana(text);
    expect(res.hits.hits).toHaveLength(0);
  });
});
