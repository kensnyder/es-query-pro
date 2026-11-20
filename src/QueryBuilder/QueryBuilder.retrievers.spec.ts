import { describe, expect, expectTypeOf, it } from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import QueryBuilder from './QueryBuilder';

type Field =
  | 'body'
  | 'body.raw'
  | 'body.words'
  | 'body_semantic'
  | 'embedding'
  | 'tag';
type Typed = QueryBuilder<Field>;

const lexical = (phrase: string, boosts = [6, 4, 1], exact = 'body.raw') => ({
  standard: {
    query: {
      bool: {
        should: [
          {
            wildcard: {
              [exact]: {
                value: `*${phrase}*`,
                case_insensitive: true,
                boost: boosts[0],
              },
            },
          },
          { match_phrase: { body: { query: phrase, boost: boosts[1] } } },
          { match: { body: { query: phrase, boost: boosts[2] } } },
        ],
      },
    },
  },
});

const semanticStandard = (phrase: string) => ({
  standard: { query: { semantic: { field: 'body_semantic', query: phrase } } },
});

function weighted(qb: Typed, phrase = 'sourdough bread') {
  return qb.weightedSemantic({
    semanticField: 'body_semantic',
    standardField: 'body',
    phrase,
  });
}

function knn(qb: Typed) {
  return qb.knn({ field: 'embedding', vector: [1, 0, 0], k: 3 });
}

describe('QueryBuilder.weightedSemantic() exact field (B-012, S-046)', () => {
  it('targets the standard field .raw sub-field by default', () => {
    const qb = weighted(new QueryBuilder<Field>());
    expect(qb.getBody()).toEqual({
      retriever: {
        rrf: {
          retrievers: [
            lexical('sourdough bread'),
            semanticStandard('sourdough bread'),
          ],
          rank_window_size: 50,
          rank_constant: 20,
        },
      },
    });
  });

  it('targets a configured exactField', () => {
    const qb = new QueryBuilder<Field>().weightedSemantic({
      semanticField: 'body_semantic',
      standardField: 'body',
      exactField: 'body.words',
      phrase: 'bread',
    });
    const rrf = qb.getBody().retriever?.rrf;
    expect(rrf?.retrievers[0]).toEqual(
      lexical('bread', undefined, 'body.words'),
    );
  });

  it('drops the contains clause when exactField is false', () => {
    const qb = new QueryBuilder<Field>().weightedSemantic({
      semanticField: 'body_semantic',
      standardField: 'body',
      exactField: false,
      phrase: 'bread',
    });
    const rrf = qb.getBody().retriever?.rrf;
    expect(rrf?.retrievers[0]).toEqual({
      standard: {
        query: {
          bool: {
            should: [
              { match_phrase: { body: { query: 'bread', boost: 4 } } },
              { match: { body: { query: 'bread', boost: 1 } } },
            ],
          },
        },
      },
    });
  });

  it('escapes wildcard characters in the contains clause', () => {
    const qb = weighted(new QueryBuilder<Field>(), 'what? 50*');
    const rrf = qb.getBody().retriever?.rrf;
    expect(JSON.stringify(rrf?.retrievers[0])).toContain(
      JSON.stringify('*what\\? 50\\**'),
    );
  });

  it('rejects an invalid exactField', () => {
    const qb = new QueryBuilder<Field>();
    const base = {
      semanticField: 'body_semantic',
      standardField: 'body',
      phrase: 'x',
    } as const;
    expect(() =>
      qb.weightedSemantic({ ...base, exactField: '' as Field }),
    ).toThrow(TypeError);
    // @ts-expect-error  true is not a field
    expect(() => qb.weightedSemantic({ ...base, exactField: true })).toThrow(
      TypeError,
    );
    // @ts-expect-error  unknown field
    qb.weightedSemantic({ ...base, exactField: 'zzz' });
    expect(qb.getRetrievers()).toHaveLength(1);
  });
});

describe('QueryBuilder.weightedSemantic() rank settings (B-042, B-043)', () => {
  it('uses the builder rank settings and normalizer', () => {
    const qb = weighted(
      new QueryBuilder<Field>()
        .rankWindowSize(500)
        .rankConstant(60)
        .normalizer('l2_norm'),
    );
    const [inner] = qb.getRetrievers();
    expect(inner.normalizer).toBe('l2_norm');
    expect(inner?.retriever?.rrf?.rank_window_size).toBe(500);
    expect(inner?.retriever?.rrf?.rank_constant).toBe(60);
  });

  it('applies rank settings set after the call', () => {
    const qb = weighted(new QueryBuilder<Field>());
    qb.rankWindowSize(200).rankConstant(7).normalizer('none');
    const [inner] = qb.getRetrievers();
    expect(inner.normalizer).toBe('none');
    expect(inner?.retriever?.rrf?.rank_window_size).toBe(200);
    expect(inner?.retriever?.rrf?.rank_constant).toBe(7);
  });
});

describe('QueryBuilder.weightedSemantic() boosts and weight (B-089)', () => {
  it('takes three lexical boosts; the semantic query has no boost', () => {
    const qb = new QueryBuilder<Field>().weightedSemantic({
      semanticField: 'body_semantic',
      standardField: 'body',
      phrase: 'bread',
      boosts: [9, 5, 2],
      weight: 3,
    });
    const [inner] = qb.getRetrievers();
    expect(inner.weight).toBe(3);
    expect(inner?.retriever?.rrf?.retrievers).toEqual([
      lexical('bread', [9, 5, 2]),
      semanticStandard('bread'),
    ]);
  });

  it('rejects the removed fourth (semantic) boost and invalid boosts', () => {
    const qb = new QueryBuilder<Field>();
    const base = {
      semanticField: 'body_semantic',
      standardField: 'body',
      phrase: 'x',
    } as const;
    const fourBoosts = [6, 4, 1, 2] as unknown as [number, number, number];
    expect(() => qb.weightedSemantic({ ...base, boosts: fourBoosts })).toThrow(
      /semantic boost/,
    );
    // @ts-expect-error  the semantic boost was removed
    qb.weightedSemantic.bind(qb, { ...base, boosts: [6, 4, 1, 2] });
    // @ts-expect-error  too few boosts
    expect(() => qb.weightedSemantic({ ...base, boosts: [6, 4] })).toThrow(
      TypeError,
    );
    expect(() => qb.weightedSemantic({ ...base, boosts: [6, -1, 1] })).toThrow(
      RangeError,
    );
    expect(() =>
      qb.weightedSemantic({ ...base, boosts: [6, Number.NaN, 1] }),
    ).toThrow(RangeError);
    expect(() => qb.weightedSemantic({ ...base, weight: -1 })).toThrow(
      RangeError,
    );
    expect(qb.getRetrievers()).toEqual([]);
  });
});

describe('QueryBuilder.weightedSemantic() blank phrase (S-045)', () => {
  it.each([[''], ['   '], [null], [undefined]])(
    'adds nothing for %p',
    (phrase) => {
      const qb = new QueryBuilder<Field>().weightedSemantic({
        semanticField: 'body_semantic',
        standardField: 'body',
        phrase: phrase as unknown as string,
      });
      expect(qb.getRetrievers()).toEqual([]);
      expect(qb.getBody()).toEqual({ query: { match_all: {} } });
    },
  );

  it('rejects a non-string phrase', () => {
    expect(() =>
      weighted(new QueryBuilder<Field>(), 5 as unknown as string),
    ).toThrow(TypeError);
  });

  it('applies to rrf() and semantic() too', () => {
    const qb = new QueryBuilder<Field>()
      .rrf({
        semanticField: 'body_semantic',
        standardField: 'body',
        phrase: '',
      })
      .semantic({ field: 'body_semantic', phrase: '  ' });
    expect(qb.getRetrievers()).toEqual([]);
  });
});

describe('QueryBuilder.rrf() (B-043, B-092)', () => {
  it('applies rankWindowSize() and rankConstant() called after it', () => {
    const qb = new QueryBuilder<Field>().rrf({
      semanticField: 'body_semantic',
      standardField: 'body',
      phrase: 'bread',
    });
    qb.rankWindowSize(200).rankConstant(60);
    expect(qb.getBody()).toEqual({
      retriever: {
        rrf: {
          retrievers: [
            { standard: { query: { match: { body: 'bread' } } } },
            semanticStandard('bread'),
          ],
          rank_window_size: 200,
          rank_constant: 60,
        },
      },
    });
  });

  it('follows reset() of the rank settings', () => {
    const qb = new QueryBuilder<Field>()
      .rankWindowSize(200)
      .rankConstant(60)
      .rrf({
        semanticField: 'body_semantic',
        standardField: 'body',
        phrase: 'x',
      })
      .reset(['rankWindowSize', 'rankConstant']);
    const rrf = qb.getBody().retriever?.rrf;
    expect(rrf?.rank_window_size).toBe(50);
    expect(rrf?.rank_constant).toBe(20);
  });

  it('defaults weight to 1 and validates it', () => {
    const qb = new QueryBuilder<Field>().rrf({
      semanticField: 'body_semantic',
      standardField: 'body',
      phrase: 'x',
    });
    expect(qb.getRetrievers()[0].weight).toBe(1);
    expect(() =>
      qb.rrf({
        semanticField: 'body_semantic',
        standardField: 'body',
        phrase: 'x',
        weight: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(RangeError);
  });
});

describe('QueryBuilder.semantic() (B-043, B-092)', () => {
  it('defaults weight to 1', () => {
    const qb = new QueryBuilder<Field>().semantic({
      field: 'body_semantic',
      phrase: 'bread',
    });
    expect(qb.getRetrievers()).toEqual([
      {
        retriever: semanticStandard('bread'),
        weight: 1,
        normalizer: 'minmax',
      },
    ]);
  });

  it('applies the normalizer set after it, in the linear retriever too', () => {
    const qb = new QueryBuilder<Field>()
      .semantic({ field: 'body_semantic', phrase: 'bread', weight: 2 })
      .term('tag', 'a')
      .normalizer('l2_norm')
      .rankWindowSize(30);
    expect(qb.getBody().retriever).toEqual({
      linear: {
        retrievers: [
          {
            retriever: semanticStandard('bread'),
            weight: 2,
            normalizer: 'l2_norm',
          },
        ],
        rank_window_size: 30,
        filter: [{ term: { tag: 'a' } }],
      },
    });
  });

  it('rejects a negative weight', () => {
    expect(() =>
      new QueryBuilder<Field>().semantic({
        field: 'body_semantic',
        phrase: 'x',
        weight: -0.5,
      }),
    ).toThrow(RangeError);
  });
});

describe('QueryBuilder.normalizer() (S-018)', () => {
  it('sets, gets and resets the normalizer', () => {
    const qb = new QueryBuilder<Field>();
    expect(qb.getNormalizer()).toBe('minmax');
    expect(qb.normalizer('none')).toBe(qb);
    expect(qb.getNormalizer()).toBe('none');
    qb.reset('normalizer');
    expect(qb.getNormalizer()).toBe('minmax');
  });

  it('rejects unknown normalizers', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  unknown normalizer
    expect(() => qb.normalizer('max')).toThrow(TypeError);
    // @ts-expect-error  not a string
    expect(() => qb.normalizer(1)).toThrow(TypeError);
    expect(qb.getNormalizer()).toBe('minmax');
  });

  it('is copied by clone()', () => {
    const qb = knn(new QueryBuilder<Field>()).normalizer('l2_norm');
    const copy = qb.clone();
    expect(copy.getNormalizer()).toBe('l2_norm');
    copy.normalizer('none');
    expect(qb.getRetrievers()[0].normalizer).toBe('l2_norm');
  });
});

describe('QueryBuilder.knn() similarity (B-048)', () => {
  it('passes a numeric similarity cutoff through', () => {
    const qb = new QueryBuilder<Field>().knn({
      field: 'embedding',
      vector: [1, 0, 0],
      k: 5,
      similarity: 0.9,
    });
    expect(qb.getBody().retriever?.knn?.similarity).toBe(0.9);
  });

  it('rejects a string similarity', () => {
    const qb = new QueryBuilder<Field>();
    expect(() =>
      qb.knn({
        field: 'embedding',
        vector: [1, 0, 0],
        k: 5,
        // @ts-expect-error  similarity is a number
        similarity: 'cosine',
      }),
    ).toThrow(TypeError);
    expect(() =>
      qb.knn({
        field: 'embedding',
        vector: [1, 0, 0],
        k: 5,
        similarity: Number.NaN,
      }),
    ).toThrow(RangeError);
    expect(qb.getRetrievers()).toEqual([]);
  });
});

describe('QueryBuilder.knn() validation (S-023)', () => {
  const base = { field: 'embedding', vector: [1, 0, 0], k: 3 } as const;

  it('defaults weight to 1', () => {
    const qb = knn(new QueryBuilder<Field>());
    expect(qb.getRetrievers()).toEqual([
      {
        retriever: {
          knn: {
            field: 'embedding',
            query_vector: [1, 0, 0],
            k: 3,
            num_candidates: 5,
          },
        },
        weight: 1,
        normalizer: 'minmax',
      },
    ]);
  });

  it('validates k, numCandidates, vector and weight', () => {
    const qb = new QueryBuilder<Field>();
    expect(() => qb.knn({ ...base, k: 0 })).toThrow(RangeError);
    expect(() => qb.knn({ ...base, k: 1.5 })).toThrow(RangeError);
    // @ts-expect-error  k is a number
    expect(() => qb.knn({ ...base, k: '3' })).toThrow(TypeError);
    expect(() => qb.knn({ ...base, numCandidates: 2 })).toThrow(RangeError);
    expect(() => qb.knn({ ...base, vector: [] })).toThrow(RangeError);
    expect(() => qb.knn({ ...base, vector: [1, Number.NaN] })).toThrow(
      RangeError,
    );
    // @ts-expect-error  not a vector
    expect(() => qb.knn({ ...base, vector: 'abc' })).toThrow(TypeError);
    expect(() => qb.knn({ ...base, weight: -1 })).toThrow(RangeError);
    // @ts-expect-error  not a query
    expect(() => qb.knn({ ...base, filter: 'x' })).toThrow(TypeError);
    expect(qb.getRetrievers()).toEqual([]);
    qb.knn({ ...base, numCandidates: 3 });
    expect(qb.getRetrievers()).toHaveLength(1);
  });

  it('omits an empty filter array', () => {
    const qb = new QueryBuilder<Field>().knn({ ...base, filter: [] });
    expect(qb.getBody().retriever?.knn).toEqual({
      field: 'embedding',
      query_vector: [1, 0, 0],
      k: 3,
      num_candidates: 5,
    });
  });

  it('defaults numCandidates to 1.5 * k, between k and 10000', () => {
    const candidates = (k: number) =>
      new QueryBuilder<Field>()
        .knn({ field: 'embedding', vector: [1], k })
        .getBody().retriever?.knn?.num_candidates;
    expect(candidates(1)).toBe(2);
    expect(candidates(10)).toBe(15);
    expect(candidates(9000)).toBe(10_000);
    expect(candidates(12_000)).toBe(12_000);
  });
});

describe('QueryBuilder retriever copies (B-097)', () => {
  it('copies the knn filter and vector on input', () => {
    const filter: estypes.QueryDslQueryContainer[] = [{ term: { tag: 'a' } }];
    const single: estypes.QueryDslQueryContainer = { term: { tag: 'b' } };
    const vector = [1, 0, 0];
    const qb = new QueryBuilder<Field>()
      .knn({ ...{ field: 'embedding', k: 3 }, vector, filter })
      .knn({ field: 'embedding', vector: [0, 1, 0], k: 3, filter: single });
    const [original] = filter;
    filter.push({ term: { tag: 'z' } });
    (original?.term as Record<string, unknown>).tag = 'changed';
    (single.term as Record<string, unknown>).tag = 'changed';
    vector[0] = 9;
    const [first, second] = qb.getRetrievers();
    expect(first?.retriever?.knn?.filter).toEqual({
      bool: { filter: [{ term: { tag: 'a' } }] },
    });
    expect(first?.retriever?.knn?.query_vector).toEqual([1, 0, 0]);
    expect(second?.retriever?.knn?.filter).toEqual({ term: { tag: 'b' } });
  });

  it('returns copies from getRetrievers() and getBody()', () => {
    const qb = knn(new QueryBuilder<Field>()).knn({
      field: 'embedding',
      vector: [0, 1, 0],
      k: 2,
      filter: [{ term: { tag: 'a' } }],
    });
    const before = qb.getRetrievers();
    const list = qb.getRetrievers();
    list.pop();
    const [kept] = list;
    if (kept) {
      kept.weight = 99;
      (kept.retriever?.knn as estypes.KnnRetriever).k = 99;
    }
    const body = qb.getBody();
    body.retriever?.linear?.retrievers?.pop();
    expect(qb.getRetrievers()).toEqual(before);
  });

  it('clone() keeps retrievers independent', () => {
    const qb = knn(new QueryBuilder<Field>());
    const copy = qb.clone();
    copy.semantic({ field: 'body_semantic', phrase: 'x' });
    expect(qb.getRetrievers()).toHaveLength(1);
    expect(copy.getRetrievers()).toHaveLength(2);
    copy.reset('retrievers');
    expect(copy.getRetrievers()).toEqual([]);
    expect(qb.getRetrievers()).toHaveLength(1);
  });
});

describe('QueryBuilder retrievers inside sub-builders', () => {
  it('still throws when a sub-builder adds a retriever', () => {
    expect(() =>
      new QueryBuilder<Field>().filter((sub) =>
        sub.semantic({ field: 'body_semantic', phrase: 'x' }),
      ),
    ).toThrow(TypeError);
  });
});

describe('QueryBuilder retriever types', () => {
  it('keeps typed field names and chaining', () => {
    const qb = new QueryBuilder<Field>();
    expectTypeOf(knn(qb)).toEqualTypeOf<Typed>();
    expectTypeOf(qb.normalizer('none')).toEqualTypeOf<Typed>();
    expectTypeOf(qb.getNormalizer()).toEqualTypeOf<estypes.ScoreNormalizer>();
    expectTypeOf(qb.getRetrievers()).toEqualTypeOf<estypes.InnerRetriever[]>();
    // @ts-expect-error  unknown field
    qb.knn({ field: 'zzz', vector: [1], k: 1 });
    // @ts-expect-error  unknown field
    qb.semantic({ field: 'zzz', phrase: 'x' });
    const untyped: QueryBuilder = qb;
    expect(untyped).toBe(qb);
  });
});
