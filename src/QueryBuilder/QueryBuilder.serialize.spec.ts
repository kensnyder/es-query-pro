import { describe, expect, expectTypeOf, it } from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import QueryBuilder from './QueryBuilder';

const vector = [1, 0, 0];
const knnA = { field: 'vec', vector, k: 5, numCandidates: 10 };
const knnB = { field: 'vec', vector: [0, 1, 0], k: 5, numCandidates: 10 };
const knnDsl = {
  field: 'vec',
  query_vector: vector,
  k: 5,
  num_candidates: 10,
};

function twoKnn() {
  return new QueryBuilder().knn(knnA).knn(knnB);
}

function rrfBuilder() {
  return new QueryBuilder().rrf({
    semanticField: 'body_semantic',
    standardField: 'body',
    phrase: 'bread',
  });
}

const oddFilter = { term: { cat: 'odd' } };

describe('rank_window_size covers the page (B-040, D11)', () => {
  it('keeps the default 50 when the page fits in it', () => {
    expect(
      twoKnn().limit(20).getBody().retriever?.linear?.rank_window_size,
    ).toBe(50);
    expect(twoKnn().getBody().retriever?.linear?.rank_window_size).toBe(50);
  });

  it('raises the linear window to cover limit()', () => {
    const body = twoKnn().limit(100).getBody();
    expect(body.retriever?.linear?.rank_window_size).toBe(100);
  });

  it('raises the rrf window to cover from + size', () => {
    const qb = rrfBuilder().limit(30).page(3);
    expect(qb.getBody().retriever?.rrf?.rank_window_size).toBe(90);
    expect(qb.getRetrievers()[0].retriever?.rrf?.rank_window_size).toBe(90);
    expect(qb.getRankWindowSize()).toBe(50);
  });

  it('pages by the default size 10 without limit()', () => {
    const body = twoKnn().page(8).getBody();
    expect(body.retriever?.linear?.rank_window_size).toBe(80);
  });

  it('uses the same window for an rrf inside linear', () => {
    const qb = rrfBuilder().knn(knnA).limit(70);
    const linear = qb.getBody().retriever?.linear;
    expect(linear?.rank_window_size).toBe(70);
    const inner = linear?.retrievers?.[0] as estypes.InnerRetriever;
    expect(inner.retriever?.rrf?.rank_window_size).toBe(70);
  });

  it('sizes the window for a getQuery() size/from override', () => {
    const qb = twoKnn();
    const query = qb.getQuery({ size: 120 });
    expect(query.size).toBe(120);
    expect(query.retriever?.linear?.rank_window_size).toBe(120);
    const paged = twoKnn().limit(10).getQuery({ from: 90 });
    expect(paged.retriever?.linear?.rank_window_size).toBe(100);
  });

  it('sends an explicit rankWindowSize() as is', () => {
    expect(
      twoKnn().rankWindowSize(200).limit(10).getBody().retriever?.linear
        ?.rank_window_size,
    ).toBe(200);
    // paging past an explicit window is allowed (the page comes back empty)
    expect(
      twoKnn().rankWindowSize(60).limit(10).page(9).getBody().retriever?.linear
        ?.rank_window_size,
    ).toBe(60);
  });

  it('throws when an explicit window is below the page size', () => {
    const qb = twoKnn().rankWindowSize(20).limit(100);
    expect(() => qb.getBody()).toThrow(RangeError);
    expect(() => qb.getQuery()).toThrow(/rankWindowSize\(20\)/);
    expect(() => rrfBuilder().rankWindowSize(5).limit(10).getBody()).toThrow(
      RangeError,
    );
  });

  it('does not check an explicit window when no size is sent', () => {
    // Elasticsearch validates only a size the request sends
    const body = rrfBuilder().rankWindowSize(1).getBody();
    expect(body.retriever?.rrf?.rank_window_size).toBe(1);
    const linear = twoKnn().rankWindowSize(2).getBody();
    expect(linear.retriever?.linear?.rank_window_size).toBe(2);
    expect(() => twoKnn().rankWindowSize(2).getQuery({ size: 5 })).toThrow(
      RangeError,
    );
  });

  it('does not check the window of a lone knn (it has none)', () => {
    const body = new QueryBuilder()
      .knn(knnA)
      .rankWindowSize(5)
      .limit(100)
      .getBody();
    expect(body.retriever).toEqual({ knn: knnDsl });
  });

  it("forgets the explicit flag on reset('rankWindowSize'), keeps it on clone()", () => {
    const qb = twoKnn().rankWindowSize(20).limit(100);
    expect(() => qb.clone().getBody()).toThrow(RangeError);
    qb.reset('rankWindowSize');
    expect(qb.getBody().retriever?.linear?.rank_window_size).toBe(100);
  });
});

describe('retriever-path combinations (B-058, S-027, D11)', () => {
  it('throws for sort() with retrievers', () => {
    const qb = new QueryBuilder().knn(knnA).sort('price');
    expect(() => qb.getBody()).toThrow(TypeError);
    expect(() => qb.getQuery()).toThrow(/\[retriever\] with \[sort\]/);
  });

  it("throws for sort('_score') with retrievers too", () => {
    const qb = new QueryBuilder().knn(knnA).sort('_score');
    expect(() => qb.getBody()).toThrow(TypeError);
  });

  it('throws for searchAfter() with retrievers', () => {
    const qb = new QueryBuilder().knn(knnA).searchAfter([1]);
    expect(() => qb.getOptions()).toThrow(/search_after/);
    expect(() => qb.getQuery()).toThrow(TypeError);
  });

  it('throws for sortByRandom() and score functions with retrievers (S-027)', () => {
    const random = new QueryBuilder().knn(knnA).sortByRandom();
    expect(() => random.getBody()).toThrow(/sortByRandom\(\)/);
    const scored = new QueryBuilder()
      .knn(knnA)
      .scoreFunction({ field_value_factor: { field: 'rating' } });
    expect(() => scored.getBody()).toThrow(/scoreFunction\(\)/);
  });

  it('names every problem in one error', () => {
    const qb = new QueryBuilder().knn(knnA).sort('price').sortByRandom();
    expect(() => qb.getBody()).toThrow(/sort\(\).*sortByRandom\(\)/);
  });

  it('keeps sending min_score with retrievers (Elasticsearch accepts it)', () => {
    const query = new QueryBuilder().knn(knnA).minScore(0.5).getQuery();
    expect(query.min_score).toBe(0.5);
    expect(query.retriever).toEqual({ knn: knnDsl });
  });

  it('still allows all of these on the query path', () => {
    const qb = new QueryBuilder()
      .term('cat', 'odd')
      .sort('price')
      .searchAfter([1])
      .scoreFunction({ field_value_factor: { field: 'rating' } });
    expect(qb.getQuery().sort).toEqual([{ price: { order: 'asc' } }]);
  });
});

describe('rescore on the retriever path (S-021, D11)', () => {
  const rescoreQuery = { term: { cat: 'odd' } };
  const addRescore =
    (windowSize?: number) =>
    (qb: QueryBuilder): QueryBuilder =>
      qb.rescore((q) => q.term('cat', 'odd'), {
        rescoreQueryWeight: 10,
        ...(windowSize === undefined ? {} : { windowSize }),
      });

  it('wraps a lone retriever in a rescorer retriever', () => {
    const body = addRescore()(new QueryBuilder().knn(knnA)).getBody();
    expect(body.rescore).toBeUndefined();
    expect(body.retriever).toEqual({
      rescorer: {
        retriever: { knn: knnDsl },
        rescore: [
          {
            window_size: 50,
            query: {
              rescore_query: rescoreQuery,
              rescore_query_weight: 10,
            },
          },
        ],
      },
    });
  });

  it('wraps a linear retriever; an unset window follows the rank window', () => {
    const body = addRescore()(twoKnn().limit(80)).getBody();
    const rescorer = body.retriever?.rescorer;
    expect(rescorer?.retriever?.linear?.rank_window_size).toBe(80);
    expect([rescorer?.rescore].flat()[0]?.window_size).toBe(80);
  });

  it('raises the rank window to cover an explicit rescore window', () => {
    const body = addRescore(120)(twoKnn()).getBody();
    const rescorer = body.retriever?.rescorer;
    expect(rescorer?.retriever?.linear?.rank_window_size).toBe(120);
    expect([rescorer?.rescore].flat()[0]?.window_size).toBe(120);
  });

  it('throws for a rescore window below limit()', () => {
    const qb = addRescore(5)(new QueryBuilder().knn(knnA)).limit(10);
    expect(() => qb.getBody()).toThrow(RangeError);
    expect(() => qb.getBody()).toThrow(/windowSize 5/);
    qb.reset('limit');
    expect([qb.getBody().retriever?.rescorer?.rescore].flat()[0]).toEqual(
      expect.objectContaining({ window_size: 5 }),
    );
  });

  it('throws for a rescore window above an explicit rank window', () => {
    const qb = addRescore(100)(twoKnn().rankWindowSize(50));
    expect(() => qb.getBody()).toThrow(/larger than rankWindowSize\(50\)/);
  });

  it('allows a rescore window above k on a lone knn', () => {
    const body = addRescore(100)(new QueryBuilder().knn(knnA)).getBody();
    expect([body.retriever?.rescorer?.rescore].flat()[0]?.window_size).toBe(
      100,
    );
  });

  it('keeps the conditions as the inner retriever filter', () => {
    const qb = addRescore()(new QueryBuilder().knn(knnA).term('id', '1'));
    expect(qb.getBody().retriever?.rescorer?.retriever).toEqual({
      knn: { ...knnDsl, filter: [{ term: { id: '1' } }] },
    });
  });

  it('leaves the query path as before: top-level rescore, sort check kept', () => {
    const qb = addRescore()(new QueryBuilder().term('id', '1'));
    expect(qb.getBody().rescore).toEqual([
      { query: { rescore_query: rescoreQuery, rescore_query_weight: 10 } },
    ]);
    qb.sort('price');
    expect(() => qb.getBody()).toThrow(/rescore/);
  });
});

describe('conditions on a lone retriever (S-057, D5)', () => {
  it('puts them in the knn filter instead of wrapping in linear', () => {
    const body = new QueryBuilder().knn(knnA).term('cat', 'odd').getBody();
    expect(body.retriever).toEqual({ knn: { ...knnDsl, filter: [oddFilter] } });
  });

  it("appends them to the knn's own filter", () => {
    const body = new QueryBuilder()
      .knn({ ...knnA, filter: { range: { n: { lte: 20 } } } })
      .term('cat', 'odd')
      .getBody();
    expect(body.retriever?.knn?.filter).toEqual([
      { range: { n: { lte: 20 } } },
      oddFilter,
    ]);
  });

  it('keeps scoring and filter clauses together as one filter', () => {
    const body = new QueryBuilder()
      .knn(knnA)
      .match({ field: 'body', phrase: 'fizz' })
      .filter((qb) => qb.term('cat', 'odd'))
      .getBody();
    expect(body.retriever?.knn?.filter).toEqual([
      {
        bool: {
          must: [{ match: { body: { query: 'fizz' } } }],
          filter: [oddFilter],
        },
      },
    ]);
  });

  it('puts them on a lone semantic (standard) or rrf retriever', () => {
    const semantic = new QueryBuilder()
      .semantic({ field: 'body_semantic', phrase: 'bread' })
      .term('cat', 'odd')
      .getBody();
    expect(semantic.retriever?.standard?.filter).toEqual([oddFilter]);
    const rrf = rrfBuilder().term('cat', 'odd').getBody();
    expect(rrf.retriever?.rrf?.filter).toEqual([oddFilter]);
    expect(rrf.retriever?.rrf?.rank_window_size).toBe(50);
  });

  it('still uses linear.filter with several retrievers', () => {
    const body = twoKnn().term('cat', 'odd').getBody();
    expect(body.retriever?.linear?.filter).toEqual([oddFilter]);
  });
});

describe('getBody() returns copies (B-104, S-058)', () => {
  function fullBuilder() {
    return new QueryBuilder()
      .term('a', 1)
      .term('b', 2)
      .filter((qb) => qb.term('c', 3))
      .sort('price')
      .highlightField('title')
      .aggregateTerm({ field: 'cat' })
      .rescore((q) => q.term('d', 4), { windowSize: 5 });
  }

  it('changing the body does not change the builder', () => {
    const qb = new QueryBuilder()
      .term('a', 1)
      .term('b', 2)
      .filter((sub) => sub.term('c', 3))
      .highlightField('title')
      .aggregateTerm({ field: 'cat' })
      .rescore((q) => q.term('d', 4), { windowSize: 5 })
      .sort('_score');
    const before = structuredClone(qb.getQuery());
    const body = qb.getBody();
    const bool = body.query?.bool as estypes.QueryDslBoolQuery;
    (bool.must as estypes.QueryDslQueryContainer[]).push({ term: { x: 1 } });
    (bool.filter as estypes.QueryDslQueryContainer[])[0] = {
      term: { y: 1 },
    };
    (body.sort as unknown[]).push('price');
    body.aggs = {};
    if (body.highlight) {
      body.highlight.fields = {};
    }
    body.rescore = [];
    expect(qb.getQuery()).toEqual(before);
  });

  it('a lone must clause in the body is a copy', () => {
    const qb = new QueryBuilder().term('a', 1);
    const term = qb.getBody().query?.term as Record<string, unknown>;
    term.a = 999;
    expect(qb.getMust()).toEqual([{ term: { a: 1 } }]);
  });

  it('a retriever filter is a copy', () => {
    const qb = new QueryBuilder().knn(knnA).term('a', 1);
    const filter = qb.getBody().retriever?.knn?.filter as Record<
      string,
      Record<string, unknown>
    >[];
    filter[0].term.a = 999;
    expect(qb.getMust()).toEqual([{ term: { a: 1 } }]);
  });

  it('getMust() and getFunctionScores() return copies', () => {
    const qb = fullBuilder().scoreFunction({ weight: 2 });
    qb.getMust().push({ term: { x: 1 } });
    (qb.getMust()[0] as { term: Record<string, unknown> }).term.a = 999;
    qb.getFunctionScores().push({ weight: 3 });
    expect(qb.getMust()).toEqual([{ term: { a: 1 } }, { term: { b: 2 } }]);
    expect(qb.getFunctionScores()).toEqual([{ weight: 2 }]);
  });
});

describe('clone() (S-058)', () => {
  class TaggedBuilder<F extends string = string> extends QueryBuilder<F> {
    tags: string[] = [];
    tag(name: string): this {
      this.tags.push(name);
      return this;
    }
  }

  it('returns an instance of the subclass with its own state copied', () => {
    const qb = new TaggedBuilder().tag('a').term('x', 1);
    const copy = qb.clone();
    expectTypeOf(copy).toEqualTypeOf<TaggedBuilder>();
    expect(copy).toBeInstanceOf(TaggedBuilder);
    copy.tag('b').term('y', 2);
    expect(qb.tags).toEqual(['a']);
    expect(copy.tags).toEqual(['a', 'b']);
    expect(qb.getMust()).toEqual([{ term: { x: 1 } }]);
  });

  it('keeps the field type of a typed builder', () => {
    const qb = new QueryBuilder<'a' | 'b'>();
    expectTypeOf(qb.clone()).toEqualTypeOf<QueryBuilder<'a' | 'b'>>();
    const loose: QueryBuilder = qb.clone();
    expect(loose).not.toBe(qb);
  });

  it('does not throw for a function or class instance inside a clause', () => {
    class Marker {
      value = 1;
    }
    const marker = new Marker();
    const fn = () => 1;
    const qb = new QueryBuilder().rawCondition({
      script: { script: { source: 'true', params: { fn, marker } } },
    } as unknown as estypes.QueryDslQueryContainer);
    const copy = qb.clone();
    const params = (
      copy.getMust()[0] as {
        script: { script: { params: Record<string, unknown> } };
      }
    ).script.script.params;
    expect(params.fn).toBe(fn);
    expect(params.marker).toBe(marker);
  });

  it('copies dates and keeps "__proto__" keys as plain keys', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    const clause = JSON.parse('{"term":{"__proto__":{"polluted":1}}}');
    const qb = new QueryBuilder().rawCondition(clause).rawCondition({
      range: { at: { gte: date } },
    } as unknown as estypes.QueryDslQueryContainer);
    const copy = qb.clone();
    const [term, range] = copy.getMust() as [
      { term: object },
      { range: { at: { gte: Date } } },
    ];
    expect(Object.keys(term.term)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(term.term)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(range.range.at.gte).toEqual(date);
    expect(range.range.at.gte).not.toBe(date);
  });

  it('copies every piece of state, including the explicit window flag', () => {
    const qb = twoKnn().rankWindowSize(70).limit(5).minScore(1);
    const copy = qb.clone();
    expect(copy.getQuery()).toEqual(qb.getQuery());
    copy.knn(knnA);
    expect(qb.getRetrievers()).toHaveLength(2);
  });
});

describe('valueOf() is removed (S-059, D12)', () => {
  it('is not defined by QueryBuilder', () => {
    expect(Object.hasOwn(QueryBuilder.prototype, 'valueOf')).toBe(false);
    const qb = new QueryBuilder();
    expect(qb.valueOf()).toBe(qb);
  });
});

describe('toKibana() (B-057, S-029)', () => {
  it('prints GET _search without an index', () => {
    const text = new QueryBuilder().toKibana();
    expect(text.split('\n')[0]).toBe('GET _search');
    expect(text).not.toContain('undefined');
  });

  it("prints the builder's index, or the override", () => {
    const qb = new QueryBuilder({ index: 'books' });
    expect(qb.toKibana().split('\n')[0]).toBe('GET books/_search');
    expect(qb.toKibana('other').split('\n')[0]).toBe('GET other/_search');
  });

  it('prints the getQuery() body without index', () => {
    const qb = new QueryBuilder({ index: 'books' }).term('a', 1).limit(5);
    const [, ...rest] = qb.toKibana().split('\n');
    const { index, ...query } = qb.getQuery();
    expect(index).toBe('books');
    expect(JSON.parse(rest.join('\n'))).toEqual(query);
  });
});
