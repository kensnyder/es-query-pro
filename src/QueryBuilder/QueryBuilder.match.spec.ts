import { describe, expect, expectTypeOf, it } from 'bun:test';
import QueryBuilder, { type RangeOptions } from './QueryBuilder';

/**
 * QB2: range() and the match family (B-045, B-091, B-095, S-042, S-045,
 * S-047, S-048, S-020).
 */

describe('QueryBuilder.range() input validation (B-091)', () => {
  it('throws when an array is used with a comparison operator', () => {
    const qb = new QueryBuilder();
    expect(() => qb.range('price', 'gt', [1, 2])).toThrow(TypeError);
    expect(() => qb.range('price', '<=', ['a', 'b'])).toThrow(TypeError);
    expect(qb.getMust()).toEqual([]);
  });

  it('skips null and undefined bounds for comparison operators', () => {
    const qb = new QueryBuilder();
    qb.range('price', 'gt', null);
    qb.range('price', '>=', undefined);
    expect(qb.getMust()).toEqual([]);
  });

  it('treats blank strings as empty', () => {
    const qb = new QueryBuilder();
    qb.range('published_at', 'gte', '');
    qb.range('published_at', 'lt', '   ');
    qb.range('published_at', 'between', ['', '']);
    expect(qb.getMust()).toEqual([]);
    qb.range('published_at', 'between', ['', '2020-01-01']);
    qb.range('published_at', 'between', ['2019-01-01', ' ']);
    expect(qb.getMust()).toEqual([
      { range: { published_at: { lte: '2020-01-01' } } },
      { range: { published_at: { gte: '2019-01-01' } } },
    ]);
  });

  it('throws when "between" has min > max for numbers or dates', () => {
    const qb = new QueryBuilder();
    expect(() => qb.range('price', 'between', [20, 10])).toThrow(RangeError);
    expect(() =>
      qb.range('published_at', 'between', [
        new Date('2020-01-02T00:00:00Z'),
        new Date('2020-01-01T00:00:00Z'),
      ]),
    ).toThrow(RangeError);
    expect(qb.getMust()).toEqual([]);
  });

  it('accepts "between" with min === max', () => {
    const qb = new QueryBuilder();
    qb.range('price', 'between', [10, 10]);
    expect(qb.getMust()).toEqual([{ range: { price: { gte: 10, lte: 10 } } }]);
  });

  it('does not compare string bounds (date math, custom formats)', () => {
    const qb = new QueryBuilder();
    qb.range('published_at', 'between', ['now', 'now-1d']);
    expect(qb.getMust()).toEqual([
      { range: { published_at: { gte: 'now', lte: 'now-1d' } } },
    ]);
  });

  it('throws on non-finite numbers and invalid dates', () => {
    const qb = new QueryBuilder();
    expect(() => qb.range('price', 'gt', Number.NaN)).toThrow(RangeError);
    expect(() => qb.range('price', 'lt', Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(() => qb.range('price', 'between', [1, Number.NaN])).toThrow(
      RangeError,
    );
    expect(() =>
      qb.range('published_at', 'gte', new Date('not a date')),
    ).toThrow(RangeError);
    expect(qb.getMust()).toEqual([]);
  });

  it('throws on unsupported value types', () => {
    const qb = new QueryBuilder();
    // @ts-expect-error  booleans are not range values
    expect(() => qb.range('flag', 'gt', true)).toThrow(TypeError);
    // @ts-expect-error  plain objects are not range values
    expect(() => qb.range('price', 'gt', { gte: 1 })).toThrow(TypeError);
    // @ts-expect-error  booleans are not range bounds
    expect(() => qb.range('price', 'between', [true, 2])).toThrow(TypeError);
  });

  it('still requires a [min, max] pair for "between"', () => {
    const qb = new QueryBuilder();
    expect(() => qb.range('price', 'between', 5)).toThrow(TypeError);
    // @ts-expect-error  a pair is required
    expect(() => qb.range('price', 'between', [5])).toThrow(TypeError);
  });

  it('throws TypeError on an unknown or non-string operator', () => {
    const qb = new QueryBuilder();
    // @ts-expect-error  unknown operator
    expect(() => qb.range('price', 'eq', 5)).toThrow(TypeError);
    // @ts-expect-error  not a string
    expect(() => qb.range('price', 5, 5)).toThrow(TypeError);
  });

  it('accepts upper-case operators', () => {
    const qb = new QueryBuilder();
    // @ts-expect-error  RangeOperator is lower case; runtime is lenient
    qb.range('price', 'GTE', 5);
    expect(qb.getMust()).toEqual([{ range: { price: { gte: 5 } } }]);
  });
});

describe('QueryBuilder.range() Date values and options (S-048)', () => {
  const jan1 = new Date('2020-01-01T00:00:00Z');
  const jan2 = new Date('2020-01-02T00:00:00Z');

  it('sends Date values as ISO 8601 strings', () => {
    const qb = new QueryBuilder();
    qb.range('published_at', '>=', jan1);
    qb.range('published_at', 'between', [jan1, jan2]);
    qb.range('published_at', 'between', [jan1, 'now']);
    qb.range('published_at', 'between', [null, jan2]);
    expect(qb.getMust()).toEqual([
      { range: { published_at: { gte: '2020-01-01T00:00:00.000Z' } } },
      {
        range: {
          published_at: {
            gte: '2020-01-01T00:00:00.000Z',
            lte: '2020-01-02T00:00:00.000Z',
          },
        },
      },
      {
        range: {
          published_at: { gte: '2020-01-01T00:00:00.000Z', lte: 'now' },
        },
      },
      { range: { published_at: { lte: '2020-01-02T00:00:00.000Z' } } },
    ]);
  });

  it('does not keep a reference to a mutable Date', () => {
    const qb = new QueryBuilder();
    const date = new Date('2020-01-01T00:00:00Z');
    qb.range('published_at', 'gt', date);
    date.setUTCFullYear(1999);
    expect(qb.getMust()[0]).toEqual({
      range: { published_at: { gt: '2020-01-01T00:00:00.000Z' } },
    });
  });

  it('passes format, time_zone, relation and boost through', () => {
    const qb = new QueryBuilder();
    qb.range('published_at', 'gte', '01/02/2020', {
      format: 'dd/MM/yyyy',
      time_zone: '+01:00',
      relation: 'within',
      boost: 2,
    });
    qb.range('price', 'between', [10, 20], { boost: 1.5 });
    expect(qb.getMust()).toEqual([
      {
        range: {
          published_at: {
            gte: '01/02/2020',
            format: 'dd/MM/yyyy',
            time_zone: '+01:00',
            relation: 'within',
            boost: 2,
          },
        },
      },
      { range: { price: { gte: 10, lte: 20, boost: 1.5 } } },
    ]);
  });

  it('throws when a Date is combined with a non-ISO format', () => {
    const qb = new QueryBuilder();
    expect(() =>
      qb.range('published_at', 'gte', jan1, { format: 'dd/MM/yyyy' }),
    ).toThrow(TypeError);
    expect(() =>
      qb.range('published_at', 'between', [jan1, '02/01/2020'], {
        format: 'dd/MM/yyyy',
      }),
    ).toThrow(TypeError);
    expect(qb.getMust()).toEqual([]);
    qb.range('published_at', 'between', [jan1, '02/01/2020'], {
      format: 'dd/MM/yyyy||strict_date_time',
    });
    qb.range('published_at', 'gte', jan1, {
      format: 'strict_date_optional_time',
    });
    expect(qb.getMust()).toHaveLength(2);
  });

  it('omits undefined options and ignores unknown option keys', () => {
    const qb = new QueryBuilder();
    qb.range('price', 'lt', 5, {
      format: undefined,
      // @ts-expect-error  bounds cannot be smuggled in through options
      gte: 1,
    });
    expect(qb.getMust()).toEqual([{ range: { price: { lt: 5 } } }]);
  });

  it('adds nothing for an empty range even when options are given', () => {
    const qb = new QueryBuilder();
    qb.range('price', 'between', [null, null], { boost: 2 });
    qb.range('price', 'gt', null, { boost: 2 });
    expect(qb.getMust()).toEqual([]);
  });

  it('declares RangeOptions as the four range query options', () => {
    expectTypeOf<RangeOptions>().toEqualTypeOf<{
      format?: string;
      time_zone?: string;
      relation?: 'within' | 'contains' | 'intersects';
      boost?: number;
    }>();
  });

  it('keeps the field typed (rule 7)', () => {
    const qb = new QueryBuilder<'price' | 'published_at'>();
    qb.range('price', 'gt', 1, { boost: 2 });
    qb.range('published_at', 'gte', jan1, { time_zone: 'UTC' });
    // @ts-expect-error  unknown field
    qb.range('zzz', 'gt', 1, { boost: 2 });
    expect(qb.getMust()).toHaveLength(3);
  });
});

describe('blank phrases are a no-op (S-045)', () => {
  const blanks = ['', '   ', '\n\t', undefined, null] as unknown as string[];

  it('match()', () => {
    const qb = new QueryBuilder();
    for (const phrase of blanks) {
      qb.match({ field: 'title', phrase });
    }
    expect(qb.getMust()).toEqual([]);
  });

  it('matchPhrase()', () => {
    const qb = new QueryBuilder();
    for (const phrase of blanks) {
      qb.matchPhrase({ field: 'title', phrase, slop: 2 });
    }
    expect(qb.getMust()).toEqual([]);
  });

  it('matchPhrasePrefix()', () => {
    const qb = new QueryBuilder();
    for (const phrase of blanks) {
      qb.matchPhrasePrefix({ field: 'title', phrase });
    }
    expect(qb.getMust()).toEqual([]);
  });

  it('multiMatch()', () => {
    const qb = new QueryBuilder();
    for (const phrase of blanks) {
      qb.multiMatch({ fields: ['title', 'premise'], phrase });
    }
    expect(qb.getMust()).toEqual([]);
  });

  it('matchBoostedPhrase()', () => {
    const qb = new QueryBuilder();
    for (const phrase of blanks) {
      qb.matchBoostedPhrase({ field: 'title', phrase });
    }
    expect(qb.getMust()).toEqual([]);
    expect(qb.getQuery().query).toEqual({ match_all: {} });
  });

  it('keeps surrounding whitespace in a non-blank phrase', () => {
    const qb = new QueryBuilder();
    qb.match({ field: 'title', phrase: ' harry ' });
    expect(qb.getMust()).toEqual([{ match: { title: { query: ' harry ' } } }]);
  });
});

describe('QueryBuilder.matchPhrase() options (S-042)', () => {
  it('passes boost, analyzer and zero_terms_query through', () => {
    const qb = new QueryBuilder();
    qb.matchPhrase({
      field: 'title',
      phrase: 'harry potter',
      boost: 2,
      analyzer: 'standard',
      zero_terms_query: 'all',
    });
    expect(qb.getMust()).toEqual([
      {
        match_phrase: {
          title: {
            query: 'harry potter',
            slop: 0,
            boost: 2,
            analyzer: 'standard',
            zero_terms_query: 'all',
          },
        },
      },
    ]);
  });

  it('keeps slop, defaulting to 0', () => {
    const qb = new QueryBuilder();
    qb.matchPhrase({ field: 'title', phrase: 'a b', slop: 3 });
    qb.matchPhrase({ field: 'title', phrase: 'a b' });
    expect(qb.getMust()).toEqual([
      { match_phrase: { title: { query: 'a b', slop: 3 } } },
      { match_phrase: { title: { query: 'a b', slop: 0 } } },
    ]);
  });

  it('does not let options override the query', () => {
    const qb = new QueryBuilder();
    // @ts-expect-error  `query` is the phrase
    qb.matchPhrase({ field: 'title', phrase: 'a b', query: 'c' });
    expect(qb.getMust()).toEqual([
      { match_phrase: { title: { query: 'a b', slop: 0 } } },
    ]);
  });

  it('keeps the field typed (rule 7)', () => {
    const qb = new QueryBuilder<'title'>();
    qb.matchPhrase({ field: 'title', phrase: 'x', boost: 2 });
    // @ts-expect-error  unknown field
    qb.matchPhrase({ field: 'zzz', phrase: 'x', boost: 2 });
    expect(qb.getMust()).toHaveLength(2);
  });
});

describe('QueryBuilder.matchPhrasePrefix() options (S-020)', () => {
  it('passes max_expansions, analyzer, boost and slop through', () => {
    const qb = new QueryBuilder();
    qb.matchPhrasePrefix({
      field: 'title',
      phrase: 'harry pot',
      max_expansions: 10,
      analyzer: 'standard',
      boost: 3,
      slop: 1,
      zero_terms_query: 'none',
    });
    expect(qb.getMust()).toEqual([
      {
        match_phrase_prefix: {
          title: {
            query: 'harry pot',
            max_expansions: 10,
            analyzer: 'standard',
            boost: 3,
            slop: 1,
            zero_terms_query: 'none',
          },
        },
      },
    ]);
  });
});

describe('QueryBuilder.multiMatch() (S-020)', () => {
  it('builds a multi_match with options', () => {
    const qb = new QueryBuilder();
    qb.multiMatch({
      fields: ['title^2', 'premise'],
      phrase: 'young wizard',
      operator: 'and',
      type: 'best_fields',
      tie_breaker: 0.3,
    });
    expect(qb.getMust()).toEqual([
      {
        multi_match: {
          fields: ['title^2', 'premise'],
          query: 'young wizard',
          operator: 'and',
          type: 'best_fields',
          tie_breaker: 0.3,
        },
      },
    ]);
  });

  it('accepts a single field name and no fields at all', () => {
    const qb = new QueryBuilder();
    qb.multiMatch({ fields: 'title', phrase: 'x' });
    qb.multiMatch({ phrase: 'y' });
    expect(qb.getMust()).toEqual([
      { multi_match: { fields: 'title', query: 'x' } },
      { multi_match: { query: 'y' } },
    ]);
  });

  it('copies the fields array', () => {
    const qb = new QueryBuilder();
    const fields = ['title'];
    qb.multiMatch({ fields, phrase: 'x' });
    fields.push('premise');
    expect(qb.getMust()).toEqual([
      { multi_match: { fields: ['title'], query: 'x' } },
    ]);
  });

  it('does not let options override the query', () => {
    const qb = new QueryBuilder();
    // @ts-expect-error  `query` is the phrase
    qb.multiMatch({ fields: ['title'], phrase: 'x', query: 'y' });
    expect(qb.getMust()).toEqual([
      { multi_match: { fields: ['title'], query: 'x' } },
    ]);
  });
});

describe('QueryBuilder.match() (S-020)', () => {
  it('passes fuzziness and minimum_should_match through', () => {
    const qb = new QueryBuilder();
    qb.match({
      field: 'title',
      phrase: 'hary poter',
      fuzziness: 'AUTO',
      minimum_should_match: '50%',
    });
    expect(qb.getMust()).toEqual([
      {
        match: {
          title: {
            query: 'hary poter',
            fuzziness: 'AUTO',
            minimum_should_match: '50%',
          },
        },
      },
    ]);
  });
});

describe('QueryBuilder.matchBoostedPhrase() weights (B-045)', () => {
  const phrase = 'Harry Potter';

  function boosts(qb: QueryBuilder) {
    const clause = qb.getMust()[0];
    const should = clause?.bool?.should as Record<string, any>[];
    return should.map((c) => {
      const [kind] = Object.keys(c);
      const body = c[kind].title;
      return [kind === 'match' ? body.operator : 'exact', body.boost];
    });
  }

  it('gives the exact phrase the highest default boost', () => {
    const qb = new QueryBuilder();
    qb.matchBoostedPhrase({ field: 'title', phrase });
    expect(qb.getMust()).toEqual([
      {
        bool: {
          should: [
            { match_phrase: { title: { query: phrase, boost: 5 } } },
            {
              match: { title: { query: phrase, operator: 'and', boost: 3 } },
            },
          ],
          minimum_should_match: 1,
        },
      },
    ]);
  });

  it('defaults to exact 5, and 3, or 1 for all three operators', () => {
    const qb = new QueryBuilder();
    qb.matchBoostedPhrase({
      field: 'title',
      phrase,
      operators: ['exact', 'and', 'or'],
    });
    expect(boosts(qb)).toEqual([
      ['exact', 5],
      ['and', 3],
      ['or', 1],
    ]);
  });

  it('picks the default by operator, not by position', () => {
    const qb = new QueryBuilder();
    qb.matchBoostedPhrase({ field: 'title', phrase, operators: ['or', 'and'] });
    expect(boosts(qb)).toEqual([
      ['or', 1],
      ['and', 3],
    ]);
  });

  it('uses given weights by position and defaults for missing ones', () => {
    const qb = new QueryBuilder();
    qb.matchBoostedPhrase({
      field: 'title',
      phrase,
      operators: ['exact', 'and', 'or'],
      weights: [10],
    });
    expect(boosts(qb)).toEqual([
      ['exact', 10],
      ['and', 3],
      ['or', 1],
    ]);
  });

  it('throws on an unknown operator', () => {
    const qb = new QueryBuilder();
    expect(() =>
      // @ts-expect-error  unknown operator
      qb.matchBoostedPhrase({ field: 'title', phrase, operators: ['near'] }),
    ).toThrow(TypeError);
    expect(qb.getMust()).toEqual([]);
  });

  it('throws on a negative or non-finite weight', () => {
    const qb = new QueryBuilder();
    expect(() =>
      qb.matchBoostedPhrase({ field: 'title', phrase, weights: [-1] }),
    ).toThrow(RangeError);
    expect(() =>
      qb.matchBoostedPhrase({ field: 'title', phrase, weights: [Number.NaN] }),
    ).toThrow(RangeError);
    expect(qb.getMust()).toEqual([]);
  });
});

describe('QueryBuilder.escapeWildcards() (S-047, S-020)', () => {
  it('is a static utility', () => {
    expect(QueryBuilder.escapeWildcards('a*b?c\\d')).toBe('a\\*b\\?c\\\\d');
    expect(QueryBuilder.escapeWildcards('plain')).toBe('plain');
    expect(QueryBuilder.escapeWildcards('')).toBe('');
  });

  it('escapes backslashes before the wildcards they precede', () => {
    expect(QueryBuilder.escapeWildcards('\\*')).toBe('\\\\\\*');
  });

  it('is still callable on an instance', () => {
    expect(new QueryBuilder().escapeWildcards('a*')).toBe('a\\*');
  });

  it('throws TypeError for non-strings', () => {
    // @ts-expect-error  not a string
    expect(() => QueryBuilder.escapeWildcards(5)).toThrow(TypeError);
  });
});

describe('match-method JSDoc (B-095)', () => {
  it('has no typos, removed options or broken examples', async () => {
    const source = await Bun.file(
      new URL('./QueryBuilder.ts', import.meta.url),
    ).text();
    expect(source).not.toContain('multipe');
    expect(source).not.toContain('cutoff_frequency');
    expect(source).not.toContain("'summary]");
    expect(source).not.toContain('than they would be in a regular');
  });
});
