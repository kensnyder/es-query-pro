import { describe, expect, expectTypeOf, it } from 'bun:test';
import type { FieldType } from '../types';
import QueryBuilder, {
  type FunctionScoreOptions,
  type RandomSortOptions,
  type SortClause,
} from './QueryBuilder';

type Field = 'id' | 'title' | 'price' | 'created_at' | 'stats.rating';

describe('QueryBuilder.sort() with _score (B-014)', () => {
  it('sorts by _score descending by default', () => {
    const qb = new QueryBuilder<Field>().sort('_score');
    expect(qb.getSort()).toEqual([{ _score: { order: 'desc' } }]);
  });

  it('honors an explicit direction for _score', () => {
    const qb = new QueryBuilder<Field>()
      .sort('_score', 'asc')
      .sort('-_score')
      .sort('_score', 'desc');
    expect(qb.getSort()).toEqual([
      { _score: { order: 'asc' } },
      { _score: { order: 'desc' } },
      { _score: { order: 'desc' } },
    ]);
  });

  it('keeps other fields ascending by default', () => {
    const qb = new QueryBuilder<Field>().sort('price').sort('_doc');
    expect(qb.getSort()).toEqual([
      { price: { order: 'asc' } },
      { _doc: { order: 'asc' } },
    ]);
  });

  it('can be combined with rescore', () => {
    const qb = new QueryBuilder<Field>()
      .match({ field: 'title', phrase: 'red' })
      .rescore((q) => q.term('id', '1'))
      .sort('_score');
    expect(qb.getBody().sort).toEqual([{ _score: { order: 'desc' } }]);
    expect(qb.getBody().rescore).toHaveLength(1);
  });
});

describe('QueryBuilder.sort() array and object forms (B-055)', () => {
  it('accepts strings, {field: order} and option objects in an array', () => {
    const qb = new QueryBuilder<Field>();
    qb.sort([
      '_score',
      '-created_at',
      'id',
      { price: 'desc' },
      { 'stats.rating': { order: 'desc', missing: '_last' } },
      { _score: 'asc' },
    ]);
    expect(qb.getSort()).toEqual([
      { _score: { order: 'desc' } },
      { created_at: { order: 'desc' } },
      { id: { order: 'asc' } },
      { price: { order: 'desc' } },
      { 'stats.rating': { order: 'desc', missing: '_last' } },
      { _score: { order: 'asc' } },
    ]);
  });

  it('does not double-wrap option objects', () => {
    const qb = new QueryBuilder<Field>().sort({
      price: { order: 'desc', missing: '_last', unmapped_type: 'float' },
    });
    expect(qb.getSort()).toEqual([
      { price: { order: 'desc', missing: '_last', unmapped_type: 'float' } },
    ]);
  });

  it('splits an object with several keys into one clause per key', () => {
    const qb = new QueryBuilder<Field>().sort({ id: 'asc', price: 'desc' });
    expect(qb.getSort()).toEqual([
      { id: { order: 'asc' } },
      { price: { order: 'desc' } },
    ]);
  });

  it('passes special sorts through', () => {
    const geo = {
      _geo_distance: {
        location: { lat: 1, lon: 2 },
        order: 'asc' as const,
        unit: 'km' as const,
      },
    };
    const qb = new QueryBuilder<Field>().sort(geo).sort({ _score: {} });
    expect(qb.getSort()).toEqual([geo, { _score: {} }]);
  });

  it('copies option objects on input and output', () => {
    const options = { order: 'desc' as const, missing: '_last' };
    const qb = new QueryBuilder<Field>().sort({ price: options });
    options.order = 'asc' as 'desc';
    const sorts = qb.getSort();
    (sorts[0] as Record<string, { order: string }>).price.order = 'asc';
    sorts.push('id');
    expect(qb.getSort()).toEqual([
      { price: { order: 'desc', missing: '_last' } },
    ]);
  });

  it('types the array and {field: order} forms without casts', () => {
    const qb = new QueryBuilder<Field>();
    qb.sort([{ price: 'asc' }, '-id', { _score: 'desc' }]);
    qb.sort({ _score: 'asc' });
    // @ts-expect-error  a direction only goes with a single field name
    expect(() => qb.sort(['id'], 'asc')).toThrow(TypeError);
  });

  it('rejects invalid input without adding anything', () => {
    const qb = new QueryBuilder<Field>();
    const bad: unknown[] = [
      '',
      '-',
      null,
      42,
      {},
      { price: 'up' },
      { price: { order: 'up' } },
      { price: 5 },
      ['id', null],
    ];
    for (const value of bad) {
      expect(() => qb.sort(value as SortClause)).toThrow();
    }
    // @ts-expect-error  unknown direction
    expect(() => qb.sort('price', 'up')).toThrow(RangeError);
    expect(() => qb.sort('-price', 'asc')).toThrow(TypeError);
    // @ts-expect-error  a direction only goes with a field name
    expect(() => qb.sort({ price: 'asc' }, 'desc')).toThrow(TypeError);
    expect(qb.getSort()).toEqual([]);
  });

  it('throws TypeError for wrong types and RangeError for bad values', () => {
    const qb = new QueryBuilder<Field>();
    expect(() => qb.sort(null as unknown as SortClause)).toThrow(TypeError);
    expect(() => qb.sort('')).toThrow(RangeError);
    expect(() => qb.sort({ price: 'up' } as never)).toThrow(RangeError);
  });
});

describe('QueryBuilder.limit() validation (S-054)', () => {
  it('accepts integers >= 0', () => {
    const qb = new QueryBuilder<Field>();
    expect(qb.limit(0).getLimit()).toBe(0);
    expect(qb.limit(25).getLimit()).toBe(25);
  });

  it('throws for negative, fractional, NaN and non-numbers', () => {
    const qb = new QueryBuilder<Field>();
    for (const value of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => qb.limit(value)).toThrow(RangeError);
    }
    expect(() => qb.limit('10' as unknown as number)).toThrow(TypeError);
    expect(qb.getLimit()).toBeNull();
  });
});

describe('QueryBuilder.page() (B-056)', () => {
  it('pages with the default size of 10 when no limit is set', () => {
    expect(new QueryBuilder().page(3).getOptions()).toEqual({ from: 20 });
    expect(new QueryBuilder().page(1).getOptions()).toEqual({});
  });

  it('pages with the limit when one is set', () => {
    expect(new QueryBuilder().limit(5).page(3).getOptions()).toEqual({
      size: 5,
      from: 10,
    });
    expect(new QueryBuilder().page(3).limit(5).getQuery().from).toBe(10);
  });

  it('sends no from when the size is 0', () => {
    expect(new QueryBuilder().limit(0).page(4).getOptions()).toEqual({
      size: 0,
    });
  });

  it('throws for page < 1, fractional pages and non-numbers', () => {
    const qb = new QueryBuilder<Field>();
    for (const value of [0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => qb.page(value)).toThrow(RangeError);
    }
    expect(() => qb.page('2' as unknown as number)).toThrow(TypeError);
    expect(qb.getPage()).toBe(1);
  });
});

describe('QueryBuilder searchAfter() with page() (B-041)', () => {
  it('throws when search_after would be sent with from > 0', () => {
    const qb = new QueryBuilder().limit(10).page(3).searchAfter([123, 'abc']);
    expect(() => qb.getOptions()).toThrow(TypeError);
    expect(() => qb.getQuery()).toThrow(/search_after|searchAfter/);
  });

  it('allows searchAfter on page 1', () => {
    const qb = new QueryBuilder().limit(10).searchAfter([123, 'abc']);
    expect(qb.getOptions()).toEqual({ size: 10, search_after: [123, 'abc'] });
  });

  it('allows page() again after searchAfter is reset', () => {
    const qb = new QueryBuilder().limit(10).page(2).searchAfter([1]);
    qb.reset('searchAfter');
    expect(qb.getOptions()).toEqual({ size: 10, from: 10 });
  });
});

describe('QueryBuilder.reset() (B-103, S-060)', () => {
  it("resets random sort with 'shouldSortByRandom'", () => {
    const qb = new QueryBuilder<Field>()
      .sort('price')
      .sortByRandom(true, { seed: 7 });
    qb.reset('shouldSortByRandom');
    expect(qb.getSortByRandom()).toBe(false);
    expect(qb.getSortByRandomOptions()).toEqual({});
    expect(qb.getSort()).toEqual([{ price: { order: 'asc' } }]);
    expect(JSON.stringify(qb.getBody())).not.toContain('random_score');
  });

  it("'sorts' clears field sorts and random sort", () => {
    const qb = new QueryBuilder<Field>().sort('price').sortByRandom();
    qb.reset('sorts');
    expect(qb.getSort()).toEqual([]);
    expect(qb.getSortByRandom()).toBe(false);
  });

  it('resets everything with no argument', () => {
    const qb = new QueryBuilder<Field>()
      .fields(['title'])
      .excludeFields(['price'])
      .term('id', '1')
      .aggregateTerm({ field: 'title' })
      .scoreFunction({ weight: 2 })
      .functionScoreOptions({ boostMode: 'sum' })
      .highlightField('title')
      .sort('price')
      .sortByRandom(true, { seed: 1 })
      .minScore(1)
      .searchAfter([1])
      .trackTotalHits(true)
      .limit(5)
      .page(2)
      .rankWindowSize(70)
      .rankConstant(30);
    qb.reset();
    const empty = new QueryBuilder<Field>();
    expect(qb.getQuery()).toEqual(empty.getQuery());
    expect(qb.getSortByRandom()).toBe(false);
    expect(qb.getFunctionScoreOptions()).toEqual({});
    expect(qb.getPage()).toBe(1);
    expect(qb.getRankWindowSize()).toBe(empty.getRankWindowSize());
    expect(qb.getRankConstant()).toBe(empty.getRankConstant());
  });

  it('accepts null, one name or a list', () => {
    const qb = new QueryBuilder<Field>().limit(5).page(2).sort('id');
    qb.reset(['limit', 'page']);
    expect(qb.getLimit()).toBeNull();
    expect(qb.getPage()).toBe(1);
    expect(qb.getSort()).toHaveLength(1);
    qb.reset(null);
    expect(qb.getSort()).toEqual([]);
  });

  it('throws for unknown names', () => {
    const qb = new QueryBuilder<Field>().limit(5);
    expect(() => qb.reset('bogus' as FieldType)).toThrow(TypeError);
    expect(() => qb.reset(['limit', 'bogus' as FieldType])).toThrow(TypeError);
    expect(qb.getLimit()).toBe(5);
  });
});

describe('QueryBuilder.sortByRandom() (S-028)', () => {
  it('emits random_score with a seed and the _seq_no field by default', () => {
    const qb = new QueryBuilder<Field>().sortByRandom(true, { seed: 42 });
    expect(qb.getBody().query).toEqual({
      function_score: {
        query: { match_all: {} },
        functions: [{ random_score: { seed: 42, field: '_seq_no' } }],
        boost_mode: 'replace',
      },
    });
    expect(qb.getSortByRandomOptions()).toEqual({
      seed: 42,
      field: '_seq_no',
    });
  });

  it('accepts a string seed and a typed field', () => {
    const qb = new QueryBuilder<Field>().sortByRandom(true, {
      seed: 'abc',
      field: 'price',
    });
    const query = qb.getBody().query as {
      function_score: { functions: unknown[] };
    };
    expect(query.function_score.functions).toEqual([
      { random_score: { seed: 'abc', field: 'price' } },
    ]);
    expectTypeOf<RandomSortOptions<Field>['field']>().toEqualTypeOf<
      Field | '_seq_no' | undefined
    >();
    // @ts-expect-error  unknown field
    qb.sortByRandom(true, { seed: 1, field: 'zzz' });
  });

  it('emits an unseeded random_score without options', () => {
    const qb = new QueryBuilder<Field>().sortByRandom();
    const query = qb.getBody().query as {
      function_score: { functions: unknown[] };
    };
    expect(query.function_score.functions).toEqual([{ random_score: {} }]);
  });

  it('turns off and forgets the seed with false', () => {
    const qb = new QueryBuilder<Field>().sortByRandom(true, { seed: 1 });
    qb.sortByRandom(false);
    expect(qb.getSortByRandom()).toBe(false);
    expect(qb.getSortByRandomOptions()).toEqual({});
    expect(qb.getBody().query).toEqual({ match_all: {} });
  });

  it('puts _score first so that field sorts become tie-breakers', () => {
    const qb = new QueryBuilder<Field>()
      .sort('-created_at')
      .sortByRandom(true, { seed: 3 });
    expect(qb.getBody().sort).toEqual([
      { _score: { order: 'desc' } },
      { created_at: { order: 'desc' } },
    ]);
    // internal state is unchanged
    expect(qb.getSort()).toEqual([{ created_at: { order: 'desc' } }]);
  });

  it('keeps a leading _score sort as is', () => {
    const qb = new QueryBuilder<Field>()
      .sort('_score')
      .sort('id')
      .sortByRandom();
    expect(qb.getBody().sort).toEqual([
      { _score: { order: 'desc' } },
      { id: { order: 'asc' } },
    ]);
  });

  it('sends no sort when only random sort is set', () => {
    expect(new QueryBuilder().sortByRandom().getBody().sort).toBeUndefined();
  });

  it('validates its arguments', () => {
    const qb = new QueryBuilder<Field>();
    expect(() => qb.sortByRandom('yes' as unknown as boolean)).toThrow(
      TypeError,
    );
    expect(() => qb.sortByRandom(true, { seed: 1.5 })).toThrow(RangeError);
    expect(() => qb.sortByRandom(true, { seed: '' })).toThrow(RangeError);
    expect(() =>
      qb.sortByRandom(true, { seed: true as unknown as number }),
    ).toThrow(TypeError);
    expect(() => qb.sortByRandom(true, { field: 'price' })).toThrow(TypeError);
    expect(() =>
      qb.sortByRandom(true, { seed: 1, field: '' as Field }),
    ).toThrow(RangeError);
    expect(() =>
      qb.sortByRandom(true, null as unknown as RandomSortOptions<Field>),
    ).toThrow(TypeError);
    expect(qb.getSortByRandom()).toBe(false);
  });

  it('is copied by clone()', () => {
    const qb = new QueryBuilder<Field>().sortByRandom(true, { seed: 9 });
    const copy = qb.clone();
    expect(copy.getBody()).toEqual(qb.getBody());
    expect(copy.getSortByRandomOptions()).toEqual({
      seed: 9,
      field: '_seq_no',
    });
  });
});

describe('QueryBuilder.scoreFunction() and functionScoreOptions() (S-053)', () => {
  const fvf = { field_value_factor: { field: 'price', factor: 1.2 } };

  it('scoreFunction() and decayFunctionScore() add the same function', () => {
    const a = new QueryBuilder<Field>().scoreFunction(fvf);
    const b = new QueryBuilder<Field>().decayFunctionScore(fvf);
    expect(a.getBody()).toEqual(b.getBody());
    expect(a.getFunctionScores()).toEqual([fvf]);
  });

  it('copies the function on input', () => {
    const fn = { weight: 2 };
    const qb = new QueryBuilder<Field>().scoreFunction(fn);
    fn.weight = 5;
    expect(qb.getFunctionScores()).toEqual([{ weight: 2 }]);
  });

  it('rejects non-objects', () => {
    const qb = new QueryBuilder<Field>();
    for (const value of [null, 'gauss', [], 3]) {
      expect(() => qb.scoreFunction(value as never)).toThrow(TypeError);
    }
    expect(qb.getFunctionScores()).toEqual([]);
  });

  it('applies score_mode, boost_mode, max_boost and min_score', () => {
    const qb = new QueryBuilder<Field>()
      .term('id', '1')
      .scoreFunction(fvf)
      .scoreFunction({ weight: 3 })
      .functionScoreOptions({
        scoreMode: 'sum',
        boostMode: 'multiply',
        maxBoost: 10,
        minScore: 0.5,
      });
    expect(qb.getBody().query).toEqual({
      function_score: {
        query: { term: { id: '1' } },
        functions: [fvf, { weight: 3 }],
        score_mode: 'sum',
        boost_mode: 'multiply',
        max_boost: 10,
        min_score: 0.5,
      },
    });
  });

  it('merges options and removes keys passed as undefined', () => {
    const qb = new QueryBuilder<Field>()
      .functionScoreOptions({ scoreMode: 'max', maxBoost: 2 })
      .functionScoreOptions({ boostMode: 'sum', maxBoost: undefined });
    expect(qb.getFunctionScoreOptions()).toEqual({
      scoreMode: 'max',
      boostMode: 'sum',
    });
  });

  it('a boostMode overrides the replace default of random sort', () => {
    const qb = new QueryBuilder<Field>()
      .scoreFunction(fvf)
      .sortByRandom()
      .functionScoreOptions({ boostMode: 'sum' });
    const query = qb.getBody().query as {
      function_score: Record<string, unknown>;
    };
    expect(query.function_score.boost_mode).toBe('sum');
  });

  it('sends nothing without a function', () => {
    const qb = new QueryBuilder<Field>().functionScoreOptions({
      minScore: 1,
    });
    expect(qb.getBody().query).toEqual({ match_all: {} });
  });

  it('validates the options', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  unknown score mode
    expect(() => qb.functionScoreOptions({ scoreMode: 'total' })).toThrow(
      TypeError,
    );
    // @ts-expect-error  unknown boost mode
    expect(() => qb.functionScoreOptions({ boostMode: 'first' })).toThrow(
      TypeError,
    );
    expect(() =>
      qb.functionScoreOptions({ maxBoost: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
    expect(() => qb.functionScoreOptions({ minScore: Number.NaN })).toThrow(
      RangeError,
    );
    // @ts-expect-error  unknown option
    expect(() => qb.functionScoreOptions({ boost: 2 })).toThrow(TypeError);
    expect(() =>
      qb.functionScoreOptions(null as unknown as FunctionScoreOptions),
    ).toThrow(TypeError);
    expect(qb.getFunctionScoreOptions()).toEqual({});
  });

  it("reset('functionScores') clears functions and options; clone() copies both", () => {
    const qb = new QueryBuilder<Field>()
      .scoreFunction(fvf)
      .functionScoreOptions({ scoreMode: 'avg' });
    const copy = qb.clone();
    qb.reset('functionScores');
    expect(qb.getFunctionScores()).toEqual([]);
    expect(qb.getFunctionScoreOptions()).toEqual({});
    expect(copy.getFunctionScoreOptions()).toEqual({ scoreMode: 'avg' });
    expect(copy.getFunctionScores()).toEqual([fvf]);
  });
});
