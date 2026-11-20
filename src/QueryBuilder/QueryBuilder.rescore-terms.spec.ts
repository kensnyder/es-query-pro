import { describe, expect, expectTypeOf, it } from 'bun:test';
import type {
  AggregationsAggregationContainer,
  SortCombinations,
} from '../types';
import QueryBuilder from './QueryBuilder';

type Field = 'brand' | 'title' | 'price' | 'stats.rating' | 'tags';

describe('QueryBuilder.rescore() (B-003, S-025)', () => {
  it('emits the full rescore shape with only the inner query', () => {
    const qb = new QueryBuilder<Field>();
    qb.match({ field: 'title', phrase: 'shoes' });
    qb.rescore(
      (q) => {
        q.matchPhrase({ field: 'title', phrase: 'red shoes' });
        q.aggregateTerm({ field: 'brand' });
        q.highlightField('title');
        q.limit(3);
      },
      {
        windowSize: 50,
        queryWeight: 0.5,
        rescoreQueryWeight: 2,
        scoreMode: 'max',
      },
    );
    expect(qb.getBody().rescore).toEqual([
      {
        window_size: 50,
        query: {
          rescore_query: {
            match_phrase: { title: { query: 'red shoes', slop: 0 } },
          },
          query_weight: 0.5,
          rescore_query_weight: 2,
          score_mode: 'max',
        },
      },
    ]);
  });

  it('omits unset options and accepts no options at all', () => {
    const qb = new QueryBuilder<Field>();
    qb.rescore((q) => q.term('brand', 'acme'));
    qb.rescore((q) => q.term('brand', 'zeta'), { windowSize: 5 });
    expect(qb.getRescore()).toEqual([
      { query: { rescore_query: { term: { brand: 'acme' } } } },
      {
        window_size: 5,
        query: { rescore_query: { term: { brand: 'zeta' } } },
      },
    ]);
  });

  it('combines several inner conditions in a bool and keeps score functions', () => {
    const qb = new QueryBuilder<Field>();
    qb.rescore((q) => {
      q.term('brand', 'acme');
      q.match({ field: 'title', phrase: 'red' });
    });
    qb.rescore((q) => {
      q.decayFunctionScore({
        field_value_factor: { field: 'price', factor: 1.2 },
      });
    });
    const [first, second] = qb.getRescore() ?? [];
    expect(first.query?.rescore_query).toEqual({
      bool: {
        must: [
          { term: { brand: 'acme' } },
          { match: { title: { query: 'red' } } },
        ],
      },
    });
    expect(second.query?.rescore_query).toHaveProperty('function_score');
  });

  it('adds nothing when the inner builder has no conditions (S-021)', () => {
    const qb = new QueryBuilder<Field>();
    qb.rescore(() => {}, { windowSize: 10 });
    qb.rescore((q) => q.match({ field: 'title', phrase: '  ' }));
    expect(qb.getRescore()).toBeUndefined();
    expect(qb.getBody().rescore).toBeUndefined();
  });

  it('throws when the inner builder uses retrievers (S-021)', () => {
    const qb = new QueryBuilder<Field>();
    expect(() =>
      qb.rescore((q) => {
        q.knn({ field: 'title', vector: [1, 0], k: 3, weight: 1 });
      }),
    ).toThrow(TypeError);
  });

  it('validates the options', () => {
    const qb = new QueryBuilder<Field>();
    const inner = (q: QueryBuilder<Field>) => q.term('brand', 'acme');
    expect(() => qb.rescore(inner, { windowSize: 0 })).toThrow(RangeError);
    expect(() => qb.rescore(inner, { windowSize: 2.5 })).toThrow(RangeError);
    // @ts-expect-error  windowSize is a number
    expect(() => qb.rescore(inner, { windowSize: '5' })).toThrow(TypeError);
    expect(() => qb.rescore(inner, { queryWeight: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() =>
      qb.rescore(inner, { rescoreQueryWeight: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
    // @ts-expect-error  unknown score mode
    expect(() => qb.rescore(inner, { scoreMode: 'sum' })).toThrow(TypeError);
    // @ts-expect-error  a callback is required
    expect(() => qb.rescore(null)).toThrow(TypeError);
    expect(qb.getRescore()).toBeUndefined();
  });

  it('passes a typed builder to the callback', () => {
    new QueryBuilder<Field>().rescore((q) => {
      expectTypeOf(q).toEqualTypeOf<QueryBuilder<Field>>();
    });
  });
});

describe('QueryBuilder rescore with a sort (S-021, D11)', () => {
  const build = () =>
    new QueryBuilder<Field>()
      .match({ field: 'title', phrase: 'red' })
      .rescore((q) => q.term('brand', 'acme'));

  /** Builder with raw sort clauses, bypassing sort()'s own conversions */
  const withSorts = (...sorts: unknown[]) => {
    const qb = build();
    qb._sorts = sorts as SortCombinations[];
    return qb;
  };

  it('allows a lone _score descending sort', () => {
    // a raw '_score' is descending in Elasticsearch; sort('_score') emits
    // ascending order today (QB6), so it is not used here
    for (const sort of ['_score', { _score: 'desc' }, { _score: {} }]) {
      expect(withSorts(sort).getBody().rescore).toHaveLength(1);
    }
    expect(
      build()
        .sort({ _score: { order: 'desc' } })
        .getBody().sort,
    ).toEqual([{ _score: { order: 'desc' } }]);
  });

  it('throws for any other sort', () => {
    const builders = [
      build().sort('price'),
      build().sort({ _score: { order: 'asc' } }),
      build()
        .sort({ _score: { order: 'desc' } })
        .sort('price'),
      withSorts({ _score: 'asc' }),
      withSorts({ price: 'asc' }),
      withSorts('_score', '_score'),
    ];
    for (const qb of builders) {
      expect(() => qb.getBody()).toThrow(/rescore.*sort/i);
      expect(() => qb.getQuery()).toThrow(TypeError);
    }
  });

  it('does not throw for a sort without rescore', () => {
    const qb = new QueryBuilder<Field>().sort('price');
    expect(qb.getBody().sort).toEqual([{ price: { order: 'asc' } }]);
  });
});

describe('QueryBuilder.getRescore() (B-097)', () => {
  it('returns a copy', () => {
    const qb = new QueryBuilder<Field>();
    qb.rescore((q) => q.term('brand', 'acme'), { windowSize: 5 });
    const got = qb.getRescore() ?? [];
    got[0].window_size = 99;
    got.push({ window_size: 1 });
    expect(qb.getRescore()).toEqual([
      { window_size: 5, query: { rescore_query: { term: { brand: 'acme' } } } },
    ]);
    const body = qb.getBody();
    (body.rescore as { window_size?: number }[])[0].window_size = 77;
    expect(qb.getRescore()?.[0].window_size).toBe(5);
  });
});

describe('QueryBuilder.aggregateTerm() order (B-013, B-046, S-025)', () => {
  function terms(qb: QueryBuilder<Field>) {
    return qb.getAggs().brand;
  }

  it('orders by _count with an object and no sub-aggs by default', () => {
    const qb = new QueryBuilder<Field>().aggregateTerm({ field: 'brand' });
    expect(terms(qb)).toEqual({
      terms: {
        field: 'brand',
        size: 25,
        show_term_doc_count_error: false,
        order: { _count: 'desc' },
      },
    });
  });

  it('maps the aggregated field and _key to _key without a sub-agg', () => {
    for (const field of ['brand', '_key'] as const) {
      const qb = new QueryBuilder<Field>().aggregateTerm({
        field: 'brand',
        orderBy: [{ field, order: 'asc' }],
      });
      expect(terms(qb)).toEqual({
        terms: {
          field: 'brand',
          size: 25,
          show_term_doc_count_error: false,
          order: { _key: 'asc' },
        },
      });
    }
  });

  it('sends several criteria as an array, in order', () => {
    const qb = new QueryBuilder<Field>().aggregateTerm({
      field: 'brand',
      orderBy: [
        { field: '_count', order: 'asc' },
        { field: 'brand', order: 'desc' },
      ],
    });
    expect(terms(qb)?.terms?.order).toEqual([
      { _count: 'asc' },
      { _key: 'desc' },
    ]);
    expect(terms(qb)?.aggs).toBeUndefined();
  });

  it('orders by a metric of another field through a safely named sub-agg', () => {
    const qb = new QueryBuilder<Field>().aggregateTerm({
      field: 'brand',
      orderBy: [
        { field: 'stats.rating', order: 'desc' },
        { field: 'price', order: 'asc' },
        { field: '_count', order: 'desc' },
      ],
    });
    expect(terms(qb)).toEqual({
      terms: {
        field: 'brand',
        size: 25,
        show_term_doc_count_error: false,
        order: [
          { __order_0: 'desc' },
          { __order_1: 'asc' },
          { _count: 'desc' },
        ],
      },
      aggs: {
        __order_0: { max: { field: 'stats.rating' } },
        __order_1: { min: { field: 'price' } },
      },
    });
  });

  it('validates orderBy, limit and exclude', () => {
    const qb = new QueryBuilder<Field>();
    expect(() => qb.aggregateTerm({ field: 'brand', orderBy: [] })).toThrow(
      TypeError,
    );
    expect(() =>
      qb.aggregateTerm({
        field: 'brand',
        // @ts-expect-error  order is asc or desc
        orderBy: [{ field: '_count', order: 'up' }],
      }),
    ).toThrow(TypeError);
    expect(() => qb.aggregateTerm({ field: 'brand', limit: 0 })).toThrow(
      RangeError,
    );
    expect(() => qb.aggregateTerm({ field: 'brand', limit: 1.5 })).toThrow(
      RangeError,
    );
    // @ts-expect-error  exclude is an array
    expect(() => qb.aggregateTerm({ field: 'brand', exclude: 'x' })).toThrow(
      TypeError,
    );
    expect(qb.getAggs()).toEqual({});
  });

  it('copies exclude', () => {
    const exclude = ['acme'];
    const qb = new QueryBuilder<Field>().aggregateTerm({
      field: 'brand',
      exclude,
    });
    exclude.push('zeta');
    expect(terms(qb)?.terms?.exclude).toEqual(['acme']);
  });
});

describe('QueryBuilder.aggregateTerm() missing (B-047)', () => {
  it('sends missing, not the composite-only options', () => {
    const qb = new QueryBuilder<Field>().aggregateTerm({
      field: 'brand',
      missing: '(none)',
    });
    expect(qb.getAggs().brand?.terms).toEqual({
      field: 'brand',
      size: 25,
      show_term_doc_count_error: false,
      order: { _count: 'desc' },
      missing: '(none)',
    });
  });

  it('throws for missing_bucket and missing_order', () => {
    const qb = new QueryBuilder<Field>();
    expect(() =>
      // @ts-expect-error  removed: composite-only option
      qb.aggregateTerm({ field: 'brand', missing_bucket: true }),
    ).toThrow(TypeError);
    expect(() =>
      // @ts-expect-error  removed: composite-only option
      qb.aggregateTerm({ field: 'brand', missing_order: 'last' }),
    ).toThrow(TypeError);
  });

  it('rejects a missing value that is not a term value', () => {
    const qb = new QueryBuilder<Field>();
    expect(() =>
      // @ts-expect-error  objects are not term values
      qb.aggregateTerm({ field: 'brand', missing: { a: 1 } }),
    ).toThrow(TypeError);
  });
});

describe('QueryBuilder.includeFacets() (B-053, S-025)', () => {
  it('adds a terms agg per field and chains', () => {
    const qb = new QueryBuilder<Field>();
    const returned = qb.includeFacets({ fields: ['brand', 'tags'], limit: 5 });
    expect(returned).toBe(qb);
    const expected = (field: string) => ({
      terms: {
        field,
        size: 5,
        show_term_doc_count_error: false,
        order: { _count: 'desc' as const },
      },
    });
    expect(qb.getAggs()).toEqual({
      brand: expected('brand'),
      tags: expected('tags'),
    });
    expect(qb.getQuery().size).toBe(0);
  });

  it('defaults limit to 25 and type-checks field names', () => {
    const qb = new QueryBuilder<Field>().includeFacets({ fields: ['brand'] });
    expect(qb.getAggs().brand?.terms?.size).toBe(25);
    // @ts-expect-error  unknown field
    qb.includeFacets({ fields: ['zzz'] });
  });

  it('throws unless fields is an array of strings', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  fields is an array
    expect(() => qb.includeFacets({ fields: 'brand' })).toThrow(TypeError);
  });
});

describe('QueryBuilder.aggs() / getAggs() (B-097)', () => {
  it('copies on input', () => {
    const mine: Record<string, AggregationsAggregationContainer> = {
      top: { terms: { field: 'brand' } },
    };
    const qb = new QueryBuilder<Field>().aggs(mine);
    qb.aggregateTerm({ field: 'tags' });
    (mine.top.terms as { size?: number }).size = 3;
    expect(Object.keys(mine)).toEqual(['top']);
    expect(qb.getAggs().top).toEqual({ terms: { field: 'brand' } });
  });

  it('copies on output, including getBody()', () => {
    const qb = new QueryBuilder<Field>().aggregateTerm({ field: 'brand' });
    const got = qb.getAggs();
    delete got.brand;
    const body = qb.getBody();
    (body.aggs as Record<string, unknown>).extra = {};
    expect(Object.keys(qb.getAggs())).toEqual(['brand']);
  });

  it('throws unless given an object', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  not an object
    expect(() => qb.aggs([])).toThrow(TypeError);
    // @ts-expect-error  not an object
    expect(() => qb.aggs(null)).toThrow(TypeError);
  });

  it('does not change the limit', () => {
    const qb = new QueryBuilder<Field>().aggs({
      a: { max: { field: 'price' } },
    });
    expect(qb.getLimit()).toBeNull();
  });
});

describe('aggregate* and limit (B-098)', () => {
  it('keeps a user-set limit', () => {
    const qb = new QueryBuilder<Field>()
      .limit(10)
      .aggregateTerm({ field: 'brand' })
      .aggregateHistogram({ field: 'price', interval: 10 })
      .includeFacets({ fields: ['tags'] });
    expect(qb.getQuery().size).toBe(10);
    qb.reset('aggs');
    expect(qb.getQuery().size).toBe(10);
  });

  it('defaults to no hits, and reset("aggs") undoes that default', () => {
    const qb = new QueryBuilder<Field>().aggregateTerm({ field: 'brand' });
    expect(qb.getQuery().size).toBe(0);
    qb.reset('aggs');
    expect(qb.getLimit()).toBeNull();
    expect(qb.getQuery().size).toBeUndefined();
  });

  it('keeps a limit set after the aggregation', () => {
    const qb = new QueryBuilder<Field>()
      .aggregateTerm({ field: 'brand' })
      .limit(5);
    qb.reset('aggs');
    expect(qb.getQuery().size).toBe(5);
  });

  it('keeps the default through clone()', () => {
    const copy = new QueryBuilder<Field>()
      .aggregateTerm({ field: 'brand' })
      .clone();
    copy.reset('aggs');
    expect(copy.getLimit()).toBeNull();
  });
});
