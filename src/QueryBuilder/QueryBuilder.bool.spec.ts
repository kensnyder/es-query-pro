import { describe, expect, expectTypeOf, it } from 'bun:test';
import QueryBuilder from './QueryBuilder';

type Field = 'id' | 'title' | 'price' | 'tag' | 'reviews' | 'reviews.stars';
type Typed = QueryBuilder<Field>;

const A = { term: { tag: 'a' } };
const B = { term: { tag: 'b' } };
const C = { range: { price: { gte: 10 } } };

describe('QueryBuilder.should() with one branch (B-015)', () => {
  it('keeps every clause of a single branch', () => {
    const qb = new QueryBuilder<Field>().should([
      (sub) => {
        sub.term('tag', 'a');
        sub.range('price', '>=', 10);
      },
    ]);
    expect(qb.getMust()).toEqual([A, C]);
    expect(qb.getBody().query).toEqual({ bool: { must: [A, C] } });
  });

  it('adds a single-clause branch as is', () => {
    const qb = new QueryBuilder<Field>().should([
      (sub) => sub.term('tag', 'a'),
    ]);
    expect(qb.getMust()).toEqual([A]);
  });

  it("keeps a single branch's filter clauses in filter context", () => {
    const qb = new QueryBuilder<Field>().should([
      (sub) => {
        sub.term('tag', 'a');
        sub.filter((f) => f.range('price', '>=', 10));
      },
    ]);
    expect(qb.getBody().query).toEqual({
      bool: { must: [A], filter: [C] },
    });
  });
});

describe('QueryBuilder.should() with several branches', () => {
  it('wraps a multi-clause branch in bool.must', () => {
    const qb = new QueryBuilder<Field>().should([
      (sub) => sub.term('tag', 'a').range('price', '>=', 10),
      (sub) => sub.term('tag', 'b'),
    ]);
    expect(qb.getMust()).toEqual([
      {
        bool: {
          should: [{ bool: { must: [A, C] } }, B],
          minimum_should_match: 1,
        },
      },
    ]);
  });

  it('passes the branch index to each callback', () => {
    const seen: number[] = [];
    new QueryBuilder<Field>().should([
      (sub, idx) => {
        seen.push(idx);
        sub.term('tag', 'a');
      },
      (sub, idx) => {
        seen.push(idx);
        sub.term('tag', 'b');
      },
    ]);
    expect(seen).toEqual([0, 1]);
  });

  it('passes percentage and negative minimumShouldMatch through', () => {
    const pct = new QueryBuilder<Field>().should(
      [(sub) => sub.term('tag', 'a'), (sub) => sub.term('tag', 'b')],
      { minimumShouldMatch: '50%' },
    );
    expect(pct.getMust()[0]).toEqual({
      bool: { should: [A, B], minimum_should_match: '50%' },
    });
    const neg = new QueryBuilder<Field>().should(
      [(sub) => sub.term('tag', 'a'), (sub) => sub.term('tag', 'b')],
      { minimumShouldMatch: -1 },
    );
    expect(neg.getMust()[0]).toEqual({
      bool: { should: [A, B], minimum_should_match: -1 },
    });
  });
});

describe('QueryBuilder.should() empty branches (B-101)', () => {
  it('adds nothing when there are no branches', () => {
    const qb = new QueryBuilder<Field>().should([]);
    expect(qb.getMust()).toEqual([]);
    expect(qb.getBody().query).toEqual({ match_all: {} });
  });

  it('adds nothing when every branch is empty', () => {
    const qb = new QueryBuilder<Field>().should([() => {}, () => {}], {
      minimumShouldMatch: 2,
    });
    expect(qb.getMust()).toEqual([]);
  });

  it('lowers minimumShouldMatch to the number of non-empty branches', () => {
    const two = new QueryBuilder<Field>().should(
      [(sub) => sub.term('tag', 'a'), () => {}, (sub) => sub.term('tag', 'b')],
      { minimumShouldMatch: 3 },
    );
    expect(two.getMust()).toEqual([
      { bool: { should: [A, B], minimum_should_match: 2 } },
    ]);
    const one = new QueryBuilder<Field>().should(
      [(sub) => sub.term('tag', 'a'), () => {}],
      { minimumShouldMatch: 2 },
    );
    expect(one.getMust()).toEqual([A]);
  });

  it('keeps a lower minimumShouldMatch unchanged', () => {
    const qb = new QueryBuilder<Field>().should(
      [(sub) => sub.term('tag', 'a'), () => {}, (sub) => sub.term('tag', 'b')],
      { minimumShouldMatch: 1 },
    );
    expect(qb.getMust()).toEqual([
      { bool: { should: [A, B], minimum_should_match: 1 } },
    ]);
  });
});

describe('QueryBuilder.should() input validation', () => {
  const two = [
    (sub: Typed) => sub.term('tag', 'a'),
    (sub: Typed) => sub.term('tag', 'b'),
  ];

  it('throws RangeError when minimumShouldMatch exceeds the branches', () => {
    const qb = new QueryBuilder<Field>();
    expect(() => qb.should(two, { minimumShouldMatch: 3 })).toThrow(RangeError);
    expect(() => qb.should(two, { minimumShouldMatch: -3 })).toThrow(
      RangeError,
    );
    expect(qb.getMust()).toEqual([]);
  });

  it('throws RangeError for a non-integer minimumShouldMatch', () => {
    const qb = new QueryBuilder<Field>();
    expect(() => qb.should(two, { minimumShouldMatch: 1.5 })).toThrow(
      RangeError,
    );
    expect(() => qb.should(two, { minimumShouldMatch: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => qb.should(two, { minimumShouldMatch: '' })).toThrow(
      RangeError,
    );
  });

  it('throws TypeError for a minimumShouldMatch of the wrong type', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  not a number or string
    expect(() => qb.should(two, { minimumShouldMatch: true })).toThrow(
      TypeError,
    );
  });

  it('throws TypeError unless given an array of functions', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  not an array
    expect(() => qb.should((sub) => sub.term('tag', 'a'))).toThrow(TypeError);
    // @ts-expect-error  not a function
    expect(() => qb.should([A])).toThrow(TypeError);
    expect(qb.getMust()).toEqual([]);
  });
});

describe('QueryBuilder.shouldNot() (B-102, S-026)', () => {
  it('takes the options as optional', () => {
    const qb = new QueryBuilder<Field>().shouldNot([
      (sub) => sub.term('tag', 'a'),
      (sub) => sub.term('tag', 'b'),
    ]);
    expect(qb.getMust()).toEqual([
      {
        bool: {
          must_not: [{ bool: { should: [A, B], minimum_should_match: 1 } }],
        },
      },
    ]);
  });

  it('excludes the single branch with the default minimumShouldMatch', () => {
    const qb = new QueryBuilder<Field>().shouldNot([
      (sub) => sub.term('tag', 'a'),
    ]);
    expect(qb.getMust()).toEqual([{ bool: { must_not: [A] } }]);
  });

  it('excludes only documents matching all of a branch', () => {
    const qb = new QueryBuilder<Field>().shouldNot([
      (sub) => sub.term('tag', 'a').range('price', '>=', 10),
    ]);
    expect(qb.getMust()).toEqual([
      { bool: { must_not: [{ bool: { must: [A, C] } }] } },
    ]);
  });

  it('throws RangeError when minimumShouldMatch exceeds the branches', () => {
    const qb = new QueryBuilder<Field>();
    expect(() =>
      qb.shouldNot([(sub) => sub.term('tag', 'a')], { minimumShouldMatch: 2 }),
    ).toThrow(RangeError);
    expect(qb.getMust()).toEqual([]);
  });

  it('passes minimumShouldMatch to the inner should', () => {
    const qb = new QueryBuilder<Field>().shouldNot(
      [(sub) => sub.term('tag', 'a'), (sub) => sub.term('tag', 'b')],
      { minimumShouldMatch: 2 },
    );
    expect(qb.getMust()).toEqual([
      {
        bool: {
          must_not: [{ bool: { should: [A, B], minimum_should_match: 2 } }],
        },
      },
    ]);
  });

  it('adds nothing when every branch is empty', () => {
    const qb = new QueryBuilder<Field>().shouldNot([() => {}]);
    expect(qb.getMust()).toEqual([]);
  });
});

describe('QueryBuilder.mustNot() (S-055)', () => {
  it('adds nothing for an empty callback', () => {
    const qb = new QueryBuilder<Field>().mustNot(() => {});
    expect(qb.getMust()).toEqual([]);
    expect(qb.getBody().query).toEqual({ match_all: {} });
  });

  it('puts every clause, including filter clauses, under must_not', () => {
    const qb = new QueryBuilder<Field>().mustNot((sub) => {
      sub.term('tag', 'a');
      sub.filter((f) => f.range('price', '>=', 10));
    });
    expect(qb.getMust()).toEqual([{ bool: { must_not: [A, C] } }]);
  });

  it('throws TypeError for a non-function', () => {
    // @ts-expect-error  not a function
    expect(() => new QueryBuilder<Field>().mustNot(A)).toThrow(TypeError);
  });
});

describe('QueryBuilder.must() (S-026)', () => {
  it('returns the builder type and copies the clause', () => {
    const clause = { term: { tag: 'a' } };
    const qb = new QueryBuilder<Field>();
    const result = qb.must(clause);
    expectTypeOf(result).toEqualTypeOf<Typed>();
    expect(result).toBe(qb);
    clause.term.tag = 'changed';
    expect(qb.getMust()).toEqual([A]);
  });

  it('throws TypeError for a non-object', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  not a query object
    expect(() => qb.must('tag:a')).toThrow(TypeError);
    // @ts-expect-error  not a query object
    expect(() => qb.must([A])).toThrow(TypeError);
    // @ts-expect-error  not a query object
    expect(() => qb.must(null)).toThrow(TypeError);
    expect(qb.getMust()).toEqual([]);
  });
});

describe('QueryBuilder.nested() (S-055)', () => {
  it('sends a single clause without a bool wrapper or default keys', () => {
    const qb = new QueryBuilder<Field>().nested({
      path: 'reviews',
      query: (sub) => sub.range('reviews.stars', '>=', 4),
    });
    expect(qb.getMust()).toEqual([
      {
        nested: {
          path: 'reviews',
          query: { range: { 'reviews.stars': { gte: 4 } } },
        },
      },
    ]);
  });

  it('wraps several clauses in bool.must and keeps filter clauses', () => {
    const qb = new QueryBuilder<Field>().nested({
      path: 'reviews',
      query: (sub) => {
        sub.range('reviews.stars', '>=', 4);
        sub.term('tag', 'a');
        sub.filter((f) => f.term('tag', 'b'));
      },
    });
    expect(qb.getMust()[0]).toEqual({
      nested: {
        path: 'reviews',
        query: {
          bool: {
            must: [{ range: { 'reviews.stars': { gte: 4 } } }, A],
            filter: [B],
          },
        },
      },
    });
  });

  it('uses match_all for an empty callback (any nested object)', () => {
    const qb = new QueryBuilder<Field>().nested({
      path: 'reviews',
      query: () => {},
    });
    expect(qb.getMust()[0]).toEqual({
      nested: { path: 'reviews', query: { match_all: {} } },
    });
  });

  it('sends options only when given; innerHits true means {}', () => {
    const innerHits = { name: 'top', size: 2 };
    const qb = new QueryBuilder<Field>()
      .nested({
        path: 'reviews',
        query: (sub) => sub.term('tag', 'a'),
        scoreMode: 'max',
        innerHits,
        ignoreUnmapped: true,
      })
      .nested({
        path: 'reviews',
        query: (sub) => sub.term('tag', 'a'),
        innerHits: true,
      })
      .nested({
        path: 'reviews',
        query: (sub) => sub.term('tag', 'a'),
        innerHits: false,
        ignoreUnmapped: false,
      });
    innerHits.size = 99;
    expect(qb.getMust()).toEqual([
      {
        nested: {
          path: 'reviews',
          query: A,
          score_mode: 'max',
          inner_hits: { name: 'top', size: 2 },
          ignore_unmapped: true,
        },
      },
      { nested: { path: 'reviews', query: A, inner_hits: {} } },
      { nested: { path: 'reviews', query: A, ignore_unmapped: false } },
    ]);
  });

  it('validates its arguments', () => {
    const qb = new QueryBuilder<Field>();
    const query = (sub: Typed) => sub.term('tag', 'a');
    // @ts-expect-error  path must be a field
    expect(() => qb.nested({ path: '', query })).toThrow(TypeError);
    // @ts-expect-error  path must be a string
    expect(() => qb.nested({ path: 1, query })).toThrow(TypeError);
    // @ts-expect-error  query must be a function
    expect(() => qb.nested({ path: 'reviews', query: A })).toThrow(TypeError);
    expect(() =>
      // @ts-expect-error  unknown score mode
      qb.nested({ path: 'reviews', query, scoreMode: 'median' }),
    ).toThrow(TypeError);
    expect(() =>
      // @ts-expect-error  innerHits must be an object or boolean
      qb.nested({ path: 'reviews', query, innerHits: 'yes' }),
    ).toThrow(TypeError);
    expect(() =>
      // @ts-expect-error  ignoreUnmapped must be a boolean
      qb.nested({ path: 'reviews', query, ignoreUnmapped: 'yes' }),
    ).toThrow(TypeError);
    expect(qb.getMust()).toEqual([]);
  });
});

describe('QueryBuilder.filter() (S-019, S-057, D5)', () => {
  it('puts the callback clauses in bool.filter', () => {
    const qb = new QueryBuilder<Field>().filter((sub) =>
      sub.term('tag', 'a').range('price', '>=', 10),
    );
    expect(qb.getMust()).toEqual([]);
    expect(qb.getFilter()).toEqual([A, C]);
    expect(qb.getBody().query).toEqual({ bool: { filter: [A, C] } });
  });

  it('combines filter and must clauses in one bool', () => {
    const qb = new QueryBuilder<Field>()
      .match({ field: 'title', phrase: 'apple' })
      .filter((sub) => sub.term('tag', 'a'));
    expect(qb.getBody().query).toEqual({
      bool: {
        must: [{ match: { title: { query: 'apple' } } }],
        filter: [A],
      },
    });
  });

  it('keeps the bool inside function_score', () => {
    const qb = new QueryBuilder<Field>()
      .filter((sub) => sub.term('tag', 'a'))
      .scoreFunction({ weight: 2 });
    expect(qb.getBody().query).toEqual({
      function_score: {
        query: { bool: { filter: [A] } },
        functions: [{ weight: 2 }],
      },
    });
  });

  it('flattens nested filter() and bool helpers into the filter list', () => {
    const qb = new QueryBuilder<Field>().filter((sub) => {
      sub.filter((inner) => inner.term('tag', 'a'));
      return sub.mustNot((n) => n.term('tag', 'b'));
    });
    expect(qb.getFilter()).toEqual([{ bool: { must_not: [B] } }, A]);
  });

  it('adds nothing for an empty callback', () => {
    const qb = new QueryBuilder<Field>().filter((sub) => sub);
    expect(qb.getFilter()).toEqual([]);
    expect(qb.getBody().query).toEqual({ match_all: {} });
  });

  it('returns a copy from getFilter()', () => {
    const qb = new QueryBuilder<Field>().filter((sub) => sub.term('tag', 'a'));
    qb.getFilter().push(B);
    expect(qb.getFilter()).toEqual([A]);
  });

  it('works inside should() branches', () => {
    const qb = new QueryBuilder<Field>().should([
      (sub) => sub.filter((f) => f.term('tag', 'a')),
      (sub) => sub.term('tag', 'b'),
    ]);
    expect(qb.getMust()).toEqual([
      {
        bool: {
          should: [{ bool: { filter: [A] } }, B],
          minimum_should_match: 1,
        },
      },
    ]);
  });

  it('is applied as a retriever filter on the retriever path', () => {
    const qb = new QueryBuilder<Field>()
      .knn({ field: 'title', vector: [1, 0, 0], k: 3, weight: 1 })
      .term('tag', 'b')
      .filter((sub) => sub.term('tag', 'a'));
    // QB9 (S-057): a lone retriever takes the conditions as its own filter
    expect(qb.getBody().retriever?.knn?.filter).toEqual([
      { bool: { must: [B], filter: [A] } },
    ]);
    const onlyFilter = new QueryBuilder<Field>()
      .knn({ field: 'title', vector: [1, 0, 0], k: 3, weight: 1 })
      .filter((sub) => sub.term('tag', 'a'));
    expect(onlyFilter.getBody().retriever?.knn?.filter).toEqual([
      { bool: { filter: [A] } },
    ]);
  });

  it('is cloned and reset', () => {
    const qb = new QueryBuilder<Field>().filter((sub) => sub.term('tag', 'a'));
    const copy = qb.clone();
    copy.filter((sub) => sub.term('tag', 'b'));
    expect(qb.getFilter()).toEqual([A]);
    expect(copy.getFilter()).toEqual([A, B]);
    copy.reset('filter');
    expect(copy.getFilter()).toEqual([]);
    qb.term('tag', 'b').reset('must');
    expect(qb.getFilter()).toEqual([A]);
    qb.reset();
    expect(qb.getFilter()).toEqual([]);
  });

  it('passes a typed builder to the callback', () => {
    const qb = new QueryBuilder<Field>();
    qb.filter((sub) => {
      expectTypeOf(sub).toEqualTypeOf<Typed>();
      sub.term('tag', 'a');
      // @ts-expect-error  unknown field
      return sub.term('zzz', 1);
    });
    expectTypeOf(qb.filter((sub) => sub)).toEqualTypeOf<Typed>();
    expect(qb.getFilter()).toHaveLength(2);
  });

  it('throws TypeError for a non-function', () => {
    // @ts-expect-error  not a function
    expect(() => new QueryBuilder<Field>().filter(A)).toThrow(TypeError);
  });
});

describe('QueryBuilder sub-builder state (S-056)', () => {
  const unsupported: Array<[string, (sub: Typed) => unknown]> = [
    ['sort', (sub) => sub.sort('price')],
    ['limit', (sub) => sub.limit(5)],
    ['page', (sub) => sub.page(2)],
    ['sortByRandom', (sub) => sub.sortByRandom()],
    ['scoreFunction', (sub) => sub.scoreFunction({ weight: 2 })],
    ['aggregateTerm', (sub) => sub.aggregateTerm({ field: 'tag' })],
    ['highlightField', (sub) => sub.highlightField('title')],
    ['fields', (sub) => sub.fields(['id'])],
    ['excludeFields', (sub) => sub.excludeFields(['id'])],
    ['minScore', (sub) => sub.minScore(1)],
    ['searchAfter', (sub) => sub.searchAfter([1])],
    ['trackTotalHits', (sub) => sub.trackTotalHits(true)],
    ['index', (sub) => sub.index('other')],
    ['knn', (sub) => sub.knn({ field: 'title', vector: [1], k: 1, weight: 1 })],
    ['rescore', (sub) => sub.rescore((r) => r.term('tag', 'a'))],
  ];

  for (const [name, setup] of unsupported) {
    it(`throws TypeError for ${name}() in a sub-builder`, () => {
      const qb = new QueryBuilder<Field>();
      const withSetup = (sub: Typed) => {
        sub.term('tag', 'a');
        setup(sub);
      };
      expect(() => qb.should([withSetup, withSetup])).toThrow(TypeError);
      expect(() => qb.should([withSetup])).toThrow(TypeError);
      expect(() => qb.shouldNot([withSetup])).toThrow(TypeError);
      expect(() => qb.mustNot(withSetup)).toThrow(TypeError);
      expect(() => qb.filter(withSetup)).toThrow(TypeError);
      expect(() => qb.nested({ path: 'reviews', query: withSetup })).toThrow(
        TypeError,
      );
      expect(qb.getMust()).toEqual([]);
      expect(qb.getFilter()).toEqual([]);
    });
  }

  it('names the method and the ignored state in the message', () => {
    const qb = new QueryBuilder<Field>();
    expect(() => qb.filter((sub) => sub.term('tag', 'a').limit(3))).toThrow(
      /filter\(\).*limit/,
    );
  });

  it('allows conditions and nested bool helpers', () => {
    const qb = new QueryBuilder<Field>().filter((sub) => {
      sub.term('tag', 'a');
      sub.should([(s) => s.term('tag', 'b'), (s) => s.term('tag', 'a')]);
      sub.mustNot((s) => s.term('tag', 'b'));
      sub.nested({ path: 'reviews', query: (s) => s.term('tag', 'a') });
      return sub.filter((s) => s.term('tag', 'b'));
    });
    expect(qb.getFilter()).toHaveLength(5);
  });
});

describe('QueryBuilder<Field> bool typing', () => {
  it('keeps QueryBuilder<Field> assignable to QueryBuilder', () => {
    expectTypeOf<Typed>().toExtend<QueryBuilder>();
  });

  it('types nested() path as Field', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  unknown path
    qb.nested({ path: 'zzz', query: () => {} });
    expect(qb.getMust()).toHaveLength(1);
  });
});
