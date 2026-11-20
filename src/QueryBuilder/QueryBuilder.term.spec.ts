import { describe, expect, expectTypeOf, it } from 'bun:test';
import QueryBuilder from './QueryBuilder';

type Field = 'status' | 'tags' | 'required' | 'sku' | 'title' | 'body';

function must(build: (qb: QueryBuilder<Field>) => unknown) {
  const qb = new QueryBuilder<Field>();
  build(qb);
  return qb.getMust();
}

describe('QueryBuilder.term() (B-100, S-050)', () => {
  it('emits the same shorthand clause from both call forms', () => {
    const fromString = must((qb) => qb.term('status', 'active'));
    const fromObject = must((qb) => {
      qb.term({ field: 'status', value: 'active' });
    });
    expect(fromString).toEqual([{ term: { status: 'active' } }]);
    expect(fromObject).toEqual(fromString);
  });

  it('accepts numbers and booleans', () => {
    expect(must((qb) => qb.term('required', 0))).toEqual([
      { term: { required: 0 } },
    ]);
    expect(must((qb) => qb.term('status', false))).toEqual([
      { term: { status: false } },
    ]);
  });

  it('supports caseSensitive and boost in both call forms', () => {
    const expected = [
      {
        term: { status: { value: 'Active', case_insensitive: true, boost: 2 } },
      },
    ];
    expect(
      must((qb) =>
        qb.term('status', 'Active', { caseSensitive: false, boost: 2 }),
      ),
    ).toEqual(expected);
    expect(
      must((qb) => {
        qb.term({
          field: 'status',
          value: 'Active',
          caseSensitive: false,
          boost: 2,
        });
      }),
    ).toEqual(expected);
  });

  it('emits case_insensitive: false for caseSensitive: true', () => {
    expect(
      must((qb) => qb.term('status', 'a', { caseSensitive: true })),
    ).toEqual([{ term: { status: { value: 'a', case_insensitive: false } } }]);
  });

  it('throws TypeError for a missing, null, array or object value', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  value is required
    expect(() => qb.term('status')).toThrow(TypeError);
    // @ts-expect-error  value is required
    expect(() => qb.term({ field: 'status' })).toThrow(TypeError);
    // @ts-expect-error  null is not a term value
    expect(() => qb.term('status', null)).toThrow(TypeError);
    // @ts-expect-error  arrays belong in terms, not term
    expect(() => qb.term('status', ['a', 'b'])).toThrow(TypeError);
    // @ts-expect-error  objects are not term values
    expect(() => qb.term('status', { a: 1 })).toThrow(TypeError);
    expect(() => qb.term('status', Number.NaN)).toThrow(RangeError);
    expect(qb.getMust()).toEqual([]);
  });

  it('throws TypeError for a non-boolean caseSensitive', () => {
    const qb = new QueryBuilder<Field>();
    expect(() =>
      // @ts-expect-error  caseSensitive is a boolean
      qb.term('status', 'a', { caseSensitive: 'no' }),
    ).toThrow(TypeError);
  });
});

describe('QueryBuilder.wildcard() (B-100)', () => {
  it('emits the same clause from both call forms, case-insensitive', () => {
    const expected = [
      { wildcard: { sku: { value: 'ab*', case_insensitive: true } } },
    ];
    expect(must((qb) => qb.wildcard('sku', 'ab*'))).toEqual(expected);
    expect(
      must((qb) => {
        qb.wildcard({ field: 'sku', value: 'ab*' });
      }),
    ).toEqual(expected);
  });

  it('passes caseSensitive, boost and rewrite in both call forms', () => {
    const expected = [
      {
        wildcard: {
          sku: {
            value: 'ab*',
            case_insensitive: false,
            boost: 3,
            rewrite: 'constant_score',
          },
        },
      },
    ];
    const options = {
      caseSensitive: true,
      boost: 3,
      rewrite: 'constant_score',
    } as const;
    expect(must((qb) => qb.wildcard('sku', 'ab*', options))).toEqual(expected);
    expect(
      must((qb) => {
        qb.wildcard({ field: 'sku', value: 'ab*', ...options });
      }),
    ).toEqual(expected);
  });

  it('throws TypeError when the value is missing or not a string', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  value is required
    expect(() => qb.wildcard('sku')).toThrow(TypeError);
    // @ts-expect-error  value is required
    expect(() => qb.wildcard({ field: 'sku' })).toThrow(TypeError);
    // @ts-expect-error  value is a string
    expect(() => qb.wildcard('sku', 5)).toThrow(TypeError);
    expect(qb.getMust()).toEqual([]);
  });
});

describe('QueryBuilder.containsExact() (S-051)', () => {
  it('wraps the escaped value in * from both call forms', () => {
    const expected = [
      {
        wildcard: {
          sku: { value: '*50%\\*off\\?*', case_insensitive: true },
        },
      },
    ];
    expect(must((qb) => qb.containsExact('sku', '50%*off?'))).toEqual(expected);
    expect(
      must((qb) => {
        qb.containsExact({ field: 'sku', value: '50%*off?' });
      }),
    ).toEqual(expected);
  });

  it('passes caseSensitive and boost', () => {
    expect(
      must((qb) =>
        qb.containsExact('sku', 'ab', { caseSensitive: true, boost: 2 }),
      ),
    ).toEqual([
      {
        wildcard: {
          sku: { value: '*ab*', case_insensitive: false, boost: 2 },
        },
      },
    ]);
  });

  it('adds nothing for a blank, null or undefined value', () => {
    const result = must((qb) => {
      qb.containsExact('sku', '');
      qb.containsExact('sku', '   ');
      qb.containsExact({ field: 'sku', value: '' });
      // @ts-expect-error  null is not a string, but is tolerated
      qb.containsExact('sku', null);
      // @ts-expect-error  undefined is not a string, but is tolerated
      qb.containsExact('sku', undefined);
    });
    expect(result).toEqual([]);
  });

  it('throws TypeError for a non-string value', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  value is a string
    expect(() => qb.containsExact('sku', 5)).toThrow(TypeError);
  });
});

describe('QueryBuilder.regexp() (B-052, S-005)', () => {
  it('uses the same case default (insensitive) in both call forms', () => {
    const expected = [
      { regexp: { sku: { value: 'a.+', case_insensitive: true } } },
    ];
    expect(must((qb) => qb.regexp('sku', 'a.+'))).toEqual(expected);
    expect(
      must((qb) => {
        qb.regexp({ field: 'sku', value: 'a.+' });
      }),
    ).toEqual(expected);
  });

  it('passes caseSensitive, flags, max_determinized_states, rewrite, boost', () => {
    const options = {
      caseSensitive: true,
      flags: 'COMPLEMENT|INTERVAL',
      max_determinized_states: 2000,
      rewrite: 'constant_score',
      boost: 2,
    } as const;
    const expected = [
      {
        regexp: {
          sku: {
            value: 'a.+',
            case_insensitive: false,
            flags: 'COMPLEMENT|INTERVAL',
            max_determinized_states: 2000,
            rewrite: 'constant_score',
            boost: 2,
          },
        },
      },
    ];
    expect(must((qb) => qb.regexp('sku', 'a.+', options))).toEqual(expected);
    expect(
      must((qb) => {
        qb.regexp({ field: 'sku', value: 'a.+', ...options });
      }),
    ).toEqual(expected);
  });

  it('keeps rexgep() as an alias with the same output', () => {
    const fromAlias = must((qb) => {
      qb.rexgep('sku', 'a.+');
      qb.rexgep({ field: 'sku', value: 'a.+', flags: 'NONE' });
    });
    const fromRegexp = must((qb) => {
      qb.regexp('sku', 'a.+');
      qb.regexp({ field: 'sku', value: 'a.+', flags: 'NONE' });
    });
    expect(fromAlias).toEqual(fromRegexp);
  });

  it('throws on a missing value or invalid max_determinized_states', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  value is required
    expect(() => qb.regexp('sku')).toThrow(TypeError);
    expect(() => qb.regexp('sku', 'a', { max_determinized_states: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      qb.regexp('sku', 'a', { max_determinized_states: 1.5 }),
    ).toThrow(RangeError);
    expect(qb.getMust()).toEqual([]);
  });
});

describe('QueryBuilder.queryString() (S-024)', () => {
  it('passes options in both call forms', () => {
    const options = {
      default_operator: 'and',
      analyze_wildcard: true,
      lenient: true,
      fuzziness: 'AUTO',
    } as const;
    const expected = [
      {
        query_string: {
          ...options,
          fields: ['body'],
          query: 'quick fox',
        },
      },
    ];
    expect(must((qb) => qb.queryString('body', 'quick fox', options))).toEqual(
      expected,
    );
    expect(
      must((qb) => {
        qb.queryString({ field: 'body', queryString: 'quick fox', ...options });
      }),
    ).toEqual(expected);
  });

  it('throws TypeError when the query is missing', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  query is required
    expect(() => qb.queryString('body')).toThrow(TypeError);
    // @ts-expect-error  query is required
    expect(() => qb.queryString({ field: 'body' })).toThrow(TypeError);
  });
});

describe('QueryBuilder.simpleQueryString() (S-024)', () => {
  it('emits simple_query_string with fields and options', () => {
    const fields = ['title^2', 'body'];
    const result = must((qb) =>
      qb.simpleQueryString({
        fields,
        query: '"quick fox" +jumped',
        default_operator: 'and',
        flags: 'PHRASE|AND',
      }),
    );
    expect(result).toEqual([
      {
        simple_query_string: {
          default_operator: 'and',
          flags: 'PHRASE|AND',
          fields: ['title^2', 'body'],
          query: '"quick fox" +jumped',
        },
      },
    ]);
    fields.push('mutated');
    expect(result[0]?.simple_query_string?.fields).toEqual(['title^2', 'body']);
  });

  it('omits fields when not given', () => {
    expect(must((qb) => qb.simpleQueryString({ query: 'fox' }))).toEqual([
      { simple_query_string: { query: 'fox' } },
    ]);
  });

  it('adds nothing for a blank query and throws for a non-string', () => {
    const qb = new QueryBuilder<Field>();
    qb.simpleQueryString({ query: '  ' });
    expect(qb.getMust()).toEqual([]);
    // @ts-expect-error  query is a string
    expect(() => qb.simpleQueryString({ query: 5 })).toThrow(TypeError);
  });
});

describe('QueryBuilder.moreLikeThis() (S-024, B-099)', () => {
  it('accepts several fields and copies the array', () => {
    const fields: Field[] = ['title', 'body'];
    const result = must((qb) =>
      qb.moreLikeThis({ field: fields, like: 'fox', min_term_freq: 1 }),
    );
    fields.push('sku');
    expect(result).toEqual([
      {
        more_like_this: {
          fields: ['title', 'body'],
          like: 'fox',
          min_term_freq: 1,
        },
      },
    ]);
  });

  it('throws TypeError for no fields or a missing like', () => {
    const qb = new QueryBuilder<Field>();
    expect(() => qb.moreLikeThis({ field: [], like: 'fox' })).toThrow(
      TypeError,
    );
    // @ts-expect-error  like is required
    expect(() => qb.moreLikeThis({ field: 'body' })).toThrow(TypeError);
    // @ts-expect-error  unknown field in the array
    expect(() => qb.moreLikeThis({ field: ['zzz'], like: 'x' })).not.toThrow();
  });
});

describe('QueryBuilder.termsSet() (B-049)', () => {
  const terms = ['red', 'blue'];

  it('defaults to minimum_should_match: 1 without a minimum', () => {
    expect(must((qb) => qb.termsSet({ field: 'tags', terms }))).toEqual([
      { terms_set: { tags: { terms, minimum_should_match: 1 } } },
    ]);
  });

  it('emits each minimum form', () => {
    expect(
      must((qb) =>
        qb.termsSet({ field: 'tags', terms, minimumShouldMatch: 2 }),
      ),
    ).toEqual([{ terms_set: { tags: { terms, minimum_should_match: 2 } } }]);
    expect(
      must((qb) =>
        qb.termsSet({
          field: 'tags',
          terms,
          minimumShouldMatchField: 'required',
        }),
      ),
    ).toEqual([
      {
        terms_set: { tags: { terms, minimum_should_match_field: 'required' } },
      },
    ]);
    expect(
      must((qb) =>
        qb.termsSet({
          field: 'tags',
          terms,
          script: 'Math.min(params.num_terms, 2)',
          boost: 2,
        }),
      ),
    ).toEqual([
      {
        terms_set: {
          tags: {
            terms,
            minimum_should_match_script: {
              source: 'Math.min(params.num_terms, 2)',
            },
            boost: 2,
          },
        },
      },
    ]);
    const script = { source: 'params.n', params: { n: 1 } };
    expect(must((qb) => qb.termsSet({ field: 'tags', terms, script }))).toEqual(
      [{ terms_set: { tags: { terms, minimum_should_match_script: script } } }],
    );
  });

  it('copies the terms array', () => {
    const input = ['red'];
    const result = must((qb) => qb.termsSet({ field: 'tags', terms: input }));
    input.push('blue');
    expect(result).toEqual([
      { terms_set: { tags: { terms: ['red'], minimum_should_match: 1 } } },
    ]);
  });

  it('throws TypeError for more than one minimum or non-array terms', () => {
    const qb = new QueryBuilder<Field>();
    expect(() =>
      qb.termsSet({
        field: 'tags',
        terms,
        minimumShouldMatch: 1,
        script: 'params.num_terms',
      }),
    ).toThrow(TypeError);
    // @ts-expect-error  terms is an array
    expect(() => qb.termsSet({ field: 'tags', terms: 'red' })).toThrow(
      TypeError,
    );
    expect(() =>
      qb.termsSet({ field: 'tags', terms, minimumShouldMatch: 1.5 }),
    ).toThrow(RangeError);
    expect(qb.getMust()).toEqual([]);
  });

  it('types minimumShouldMatchField as a field name', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  unknown field
    qb.termsSet({ field: 'tags', terms, minimumShouldMatchField: 'zzz' });
    expectTypeOf(qb.termsSet({ field: 'tags', terms })).toEqualTypeOf<
      QueryBuilder<Field>
    >();
  });
});
