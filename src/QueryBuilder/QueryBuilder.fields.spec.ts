import { describe, expect, expectTypeOf, it } from 'bun:test';
import QueryBuilder from './QueryBuilder';

/**
 * Type-level tests for `QueryBuilder<Field>`. The `expectTypeOf` and
 * `@ts-expect-error` assertions are only enforced by
 * `bunx tsc --noEmit -p .`; `bun test` runs the runtime parts, which check
 * that a typed builder emits exactly what an untyped one does.
 *
 * Each `@ts-expect-error` call repeats the arguments of an accepted call
 * with only the field name changed, so the expected error can only come
 * from the unknown field.
 */

type Field = 'a' | 'b.c';
type Typed = QueryBuilder<Field>;

describe('QueryBuilder<Field> single-field methods', () => {
  it('should check range()', () => {
    const qb = new QueryBuilder<Field>();
    qb.range('a', 'gt', 1);
    // @ts-expect-error  unknown field
    qb.range('zzz', 'gt', 1);
    expect(qb.getMust()).toHaveLength(2);
  });

  it('should check matchPhrase()', () => {
    const qb = new QueryBuilder<Field>();
    qb.matchPhrase({ field: 'b.c', phrase: 'x' });
    // @ts-expect-error  unknown field
    qb.matchPhrase({ field: 'zzz', phrase: 'x' });
    expect(qb.getMust()).toHaveLength(2);
  });

  it('should check matchPhrasePrefix()', () => {
    const qb = new QueryBuilder<Field>();
    qb.matchPhrasePrefix({ field: 'a', phrase: 'x' });
    // @ts-expect-error  unknown field
    qb.matchPhrasePrefix({ field: 'zzz', phrase: 'x' });
    expect(qb.getMust()).toHaveLength(2);
  });

  it('should check match()', () => {
    const qb = new QueryBuilder<Field>();
    qb.match({ field: 'a', phrase: 'x', operator: 'and' });
    // @ts-expect-error  unknown field
    qb.match({ field: 'zzz', phrase: 'x', operator: 'and' });
    expect(qb.getMust()).toHaveLength(2);
  });

  it('should check matchBoostedPhrase()', () => {
    const qb = new QueryBuilder<Field>();
    qb.matchBoostedPhrase({ field: 'a', phrase: 'x' });
    // @ts-expect-error  unknown field
    qb.matchBoostedPhrase({ field: 'zzz', phrase: 'x' });
    expect(qb.getMust()).toHaveLength(2);
  });

  it('should check both fields of weightedSemantic()', () => {
    const qb = new QueryBuilder<Field>();
    qb.weightedSemantic({
      semanticField: 'a',
      standardField: 'b.c',
      phrase: 'x',
    });
    qb.weightedSemantic({
      // @ts-expect-error  unknown semantic field
      semanticField: 'zz',
      standardField: 'b.c',
      phrase: 'x',
    });
    qb.weightedSemantic({
      semanticField: 'a',
      // @ts-expect-error  unknown standard field
      standardField: 'zzz',
      phrase: 'x',
    });
    expect(qb.getRetrievers()).toHaveLength(3);
  });

  it('should check both fields of rrf()', () => {
    const qb = new QueryBuilder<Field>();
    qb.rrf({
      semanticField: 'a',
      standardField: 'b.c',
      phrase: 'x',
      weight: 1,
    });
    qb.rrf({
      // @ts-expect-error  unknown semantic field
      semanticField: 'z',
      standardField: 'b.c',
      phrase: 'x',
      weight: 1,
    });
    // @ts-expect-error  unknown standard field
    qb.rrf({ semanticField: 'a', standardField: 'zz', phrase: 'x', weight: 1 });
    expect(qb.getRetrievers()).toHaveLength(3);
  });

  it('should check semantic()', () => {
    const qb = new QueryBuilder<Field>();
    qb.semantic({ field: 'a', phrase: 'x', weight: 1 });
    // @ts-expect-error  unknown field
    qb.semantic({ field: 'zzz', phrase: 'x', weight: 1 });
    expect(qb.getRetrievers()).toHaveLength(2);
  });

  it('should check both forms of term()', () => {
    const qb = new QueryBuilder<Field>();
    qb.term('a', 1);
    qb.term({ field: 'b.c', value: 1 });
    // @ts-expect-error  unknown field
    qb.term('zzz', 1);
    // @ts-expect-error  unknown field
    qb.term({ field: 'zzz', value: 1 });
    expect(qb.getMust()).toHaveLength(4);
  });

  it('should check both forms of wildcard()', () => {
    const qb = new QueryBuilder<Field>();
    qb.wildcard('a', 'x*');
    qb.wildcard({ field: 'b.c', value: 'x*' });
    // @ts-expect-error  unknown field
    qb.wildcard('zzz', 'x*');
    // @ts-expect-error  unknown field
    qb.wildcard({ field: 'zzz', value: 'x*' });
    expect(qb.getMust()).toHaveLength(4);
  });

  it('should check both forms of containsExact()', () => {
    const qb = new QueryBuilder<Field>();
    qb.containsExact('a', 'x');
    qb.containsExact({ field: 'b.c', value: 'x' });
    // @ts-expect-error  unknown field
    qb.containsExact('zzz', 'x');
    // @ts-expect-error  unknown field
    qb.containsExact({ field: 'zzz', value: 'x' });
    expect(qb.getMust()).toHaveLength(4);
  });

  it('should check both forms of rexgep()', () => {
    const qb = new QueryBuilder<Field>();
    qb.rexgep('a', 'x.+');
    qb.rexgep({ field: 'b.c', value: 'x.+' });
    // @ts-expect-error  unknown field
    qb.rexgep('zzz', 'x.+');
    // @ts-expect-error  unknown field
    qb.rexgep({ field: 'zzz', value: 'x.+' });
    expect(qb.getMust()).toHaveLength(4);
  });

  it('should check both forms of exists()', () => {
    const qb = new QueryBuilder<Field>();
    qb.exists('a');
    qb.exists({ field: 'b.c' });
    // @ts-expect-error  unknown field
    qb.exists('zzz');
    // @ts-expect-error  unknown field
    qb.exists({ field: 'zzz' });
    expect(qb.getMust()).toHaveLength(4);
  });

  it('should check both forms of queryString()', () => {
    const qb = new QueryBuilder<Field>();
    qb.queryString('a', 'x AND y');
    qb.queryString({ field: 'b.c', queryString: 'x AND y' });
    // @ts-expect-error  unknown field
    qb.queryString('zzz', 'x AND y');
    // @ts-expect-error  unknown field
    qb.queryString({ field: 'zzz', queryString: 'x AND y' });
    expect(qb.getMust()).toHaveLength(4);
  });

  it('should check moreLikeThis()', () => {
    const qb = new QueryBuilder<Field>();
    qb.moreLikeThis({ field: 'a', like: 'x' });
    // @ts-expect-error  unknown field
    qb.moreLikeThis({ field: 'zzz', like: 'x' });
    expect(qb.getMust()).toHaveLength(2);
  });

  it('should check termsSet()', () => {
    const qb = new QueryBuilder<Field>();
    qb.termsSet({ field: 'a', terms: ['x'] });
    // @ts-expect-error  unknown field
    qb.termsSet({ field: 'zzz', terms: ['x'] });
    expect(qb.getMust()).toHaveLength(2);
  });

  it('should check knn()', () => {
    const qb = new QueryBuilder<Field>();
    qb.knn({ field: 'a', vector: [0.1], k: 1, weight: 1 });
    // @ts-expect-error  unknown field
    qb.knn({ field: 'zzz', vector: [0.1], k: 1, weight: 1 });
    expect(qb.getRetrievers()).toHaveLength(2);
  });

  it('should check highlightField()', () => {
    const qb = new QueryBuilder<Field>();
    qb.highlightField('a');
    // @ts-expect-error  unknown field
    qb.highlightField('zzz');
    expect(Object.keys(qb.getHighlighter().fields)).toEqual(['a', 'zzz']);
  });

  it('should check aggregateTerm() and its orderBy fields', () => {
    const qb = new QueryBuilder<Field>();
    qb.aggregateTerm({ field: 'a' });
    qb.aggregateTerm({
      field: 'a',
      orderBy: [{ field: '_count', order: 'asc' }],
    });
    qb.aggregateTerm({ field: 'a', orderBy: [{ field: 'b.c', order: 'asc' }] });
    // @ts-expect-error  unknown field
    qb.aggregateTerm({ field: 'zzz' });
    // @ts-expect-error  unknown orderBy field
    qb.aggregateTerm({ field: 'a', orderBy: [{ field: 'zz', order: 'asc' }] });
    expect(Object.keys(qb.getAggs())).toEqual(['a', 'zzz']);
  });

  it('should check aggregateHistogram()', () => {
    const qb = new QueryBuilder<Field>();
    qb.aggregateHistogram({ field: 'a', interval: 10 });
    // @ts-expect-error  unknown field
    qb.aggregateHistogram({ field: 'zzz', interval: 10 });
    expect(Object.keys(qb.getAggs())).toEqual(['a', 'zzz']);
  });

  it('should check aggregateDateHistogram()', () => {
    const qb = new QueryBuilder<Field>();
    qb.aggregateDateHistogram({ field: 'a', calendarInterval: '1d' });
    // @ts-expect-error  unknown field
    qb.aggregateDateHistogram({ field: 'zzz', calendarInterval: '1d' });
    expect(Object.keys(qb.getAggs())).toEqual(['a', 'zzz']);
  });

  it('should check aggregateGeotileGrid()', () => {
    const qb = new QueryBuilder<Field>();
    qb.aggregateGeotileGrid({ field: 'a', precision: 7 });
    // @ts-expect-error  unknown field
    qb.aggregateGeotileGrid({ field: 'zzz', precision: 7 });
    expect(Object.keys(qb.getAggs())).toEqual(['a', 'zzz']);
  });

  it('should check dateHistogram()', () => {
    const qb = new QueryBuilder<Field>();
    qb.dateHistogram({ field: 'a', interval: 'month' });
    // @ts-expect-error  unknown field
    qb.dateHistogram({ field: 'zzz', interval: 'month' });
    expect(Object.keys(qb.getAggs())).toEqual(['a', 'zzz']);
  });

  it("should check nested()'s path", () => {
    const qb = new QueryBuilder<Field>();
    qb.nested({ path: 'b.c', query: () => {} });
    // @ts-expect-error  unknown path
    qb.nested({ path: 'zzz', query: () => {} });
    expect(qb.getMust()).toHaveLength(2);
  });
});

describe('QueryBuilder<Field> pattern, boost and raw-DSL methods', () => {
  it('should accept arbitrary strings', () => {
    const qb = new QueryBuilder<Field>();
    qb.fields(['a*', 'anything']);
    qb.sourceIncludes(['a*', 'anything']);
    qb.excludeFields(['b.*', 'anything']);
    qb.sourceExcludes(['b.*', 'anything']);
    qb.multiMatch({ fields: ['a^3', 'anything'], phrase: 'x' });
    qb.sort('-anything');
    qb.sort('anything', 'desc');
    qb.sort({ anything: 'desc' });
    qb.rawCondition({ term: { anything: 1 } });
    qb.must({ term: { anything: 1 } });
    qb.aggs({ anything: { terms: { field: 'anything' } } });
    expect(qb.getMust()).toHaveLength(3);
    expect(qb.getSort()).toHaveLength(3);
  });
});

describe('QueryBuilder<Field> callbacks and clone()', () => {
  it('should pass the same Field to should() callbacks', () => {
    const qb = new QueryBuilder<Field>();
    qb.should([
      (sub, idx) => {
        expectTypeOf(sub).toEqualTypeOf<Typed>();
        expectTypeOf(idx).toEqualTypeOf<number>();
        sub.term('a', 1);
      },
      (sub) => {
        // @ts-expect-error  unknown field
        sub.term('zzz', 1);
      },
    ]);
    expect(qb.getMust()).toHaveLength(1);
  });

  it('should pass the same Field to shouldNot() callbacks', () => {
    const qb = new QueryBuilder<Field>();
    qb.shouldNot(
      [
        (sub) => {
          expectTypeOf(sub).toEqualTypeOf<Typed>();
          sub.term('a', 1);
        },
        (sub) => {
          // @ts-expect-error  unknown field
          sub.term('zzz', 1);
        },
      ],
      { minimumShouldMatch: 1 },
    );
    expect(qb.getMust()).toHaveLength(1);
  });

  it('should pass the same Field to the mustNot() callback', () => {
    const qb = new QueryBuilder<Field>();
    qb.mustNot((sub) => {
      expectTypeOf(sub).toEqualTypeOf<Typed>();
      sub.term('a', 1);
      // @ts-expect-error  unknown field
      sub.term('zzz', 1);
    });
    expect(qb.getMust()).toHaveLength(1);
  });

  it('should pass the same Field to the nested() callback', () => {
    const qb = new QueryBuilder<Field>();
    qb.nested({
      path: 'b.c',
      query: (sub) => {
        expectTypeOf(sub).toEqualTypeOf<Typed>();
        sub.term('b.c', 1);
        // @ts-expect-error  unknown field
        sub.term('zzz', 1);
      },
    });
    expect(qb.getMust()).toHaveLength(1);
  });

  it('should pass the same Field to the rescore() callback', () => {
    const qb = new QueryBuilder<Field>();
    qb.rescore(
      (sub) => {
        expectTypeOf(sub).toEqualTypeOf<Typed>();
        sub.match({ field: 'a', phrase: 'x' });
        // @ts-expect-error  unknown field
        sub.match({ field: 'zzz', phrase: 'x' });
      },
      { windowSize: 10 },
    );
    expect(qb.getRescore()).toHaveLength(1);
  });

  it('should keep Field through clone() and chaining', () => {
    const qb = new QueryBuilder<Field>();
    const copy = qb.clone();
    expectTypeOf(copy).toEqualTypeOf<Typed>();
    expectTypeOf(qb.term('a', 1)).toEqualTypeOf<Typed>();
    // @ts-expect-error  unknown field
    copy.term('zzz', 1);
    expect(copy).not.toBe(qb);
  });
});

describe('QueryBuilder default type parameter', () => {
  it('should be QueryBuilder<string> and accept any field', () => {
    const qb = new QueryBuilder();
    expectTypeOf(qb).toEqualTypeOf<QueryBuilder<string>>();
    expectTypeOf(qb).not.toEqualTypeOf<Typed>();
    qb.term('anything', 1);
    qb.should([(sub) => sub.term('anything.else', 1)]);
    expect(qb.getMust()).toHaveLength(2);
  });

  it('should let a typed builder be used as an untyped one', () => {
    const typed = new QueryBuilder<'a'>();
    const untyped: QueryBuilder = typed;
    expectTypeOf<QueryBuilder<'a'>>().toExtend<QueryBuilder>();
    expect(untyped).toBe(typed);
  });
});

describe('QueryBuilder<Field> output', () => {
  it('should emit field names verbatim', () => {
    const qb = new QueryBuilder<Field>()
      .term('b.c', 1)
      .nested({ path: 'b.c', query: (sub) => sub.exists('b.c') });
    expect(qb.getMust()).toEqual([
      { term: { 'b.c': 1 } },
      {
        nested: {
          path: 'b.c',
          query: { exists: { field: 'b.c' } },
        },
      },
    ]);
  });
});
