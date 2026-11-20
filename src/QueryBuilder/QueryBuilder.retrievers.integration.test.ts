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
  type ArticleRecord,
  getArticlesCreateRequest,
  getArticlesData,
} from '../testFixtures/articles';
import { createTestKit } from '../testFixtures/esTestKit';
import { getPlacesCreateRequest, getPlacesData } from '../testFixtures/places';
import QueryBuilder, { type KnnOptions } from './QueryBuilder';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(60_000);

const kit = await createTestKit('qb-retrievers');
const client = kit.client;
const hybrid = kit.caps.retrievers && kit.caps.inference;
if (!hybrid) {
  console.log(
    'skipping rrf/weightedSemantic tests: they need caps.retrievers and ' +
      `caps.inference (retrievers=${kit.caps.retrievers}, ` +
      `inference=${kit.caps.inference})`,
  );
}
const hybridTest = it.skipIf(!hybrid);

type PlaceField = 'embedding' | 'category' | 'rating';
type ArticleField = 'body' | 'body.raw' | 'body_semantic';
type PhraseField = 'body' | 'body.raw';

let places = '';
let phrases = '';
let articles = '';

/**
 * The places fixture with an unquantized `hnsw` vector index, so that the
 * similarity cutoff compares exact cosine values. Stateful 9.1 defaults to
 * `int8_hnsw`, whose quantization error on 3 dims let '2' (cosine 0.943)
 * pass a 0.95 cutoff.
 */
function exactPlacesCreate(): estypes.IndicesCreateRequest {
  const create = getPlacesCreateRequest('places');
  const embedding = create.mappings?.properties?.embedding;
  if (embedding?.type !== 'dense_vector') {
    throw new Error('places fixture has no dense_vector embedding');
  }
  embedding.index_options = { type: 'hnsw' };
  return create;
}

/** Text index with a keyword `.raw` sub-field, no semantic field */
const phrasesCreate: estypes.IndicesCreateRequest = {
  index: 'phrases',
  mappings: {
    properties: {
      id: { type: 'keyword' },
      body: {
        type: 'text',
        analyzer: 'english',
        fields: { raw: { type: 'keyword' } },
      },
    },
  },
};

// '1' contains "baking breads" literally; '2' only matches it after
// stemming ("bake bread"), but three times
const phrasesData = [
  { id: '1', body: 'We love baking breads every weekend' },
  { id: '2', body: 'Baked bread. Baked bread and more baked bread.' },
  { id: '3', body: 'Nothing about ovens here' },
];

beforeAll(async () => {
  places = await kit.makeIndex(exactPlacesCreate(), getPlacesData());
  phrases = await kit.makeIndex(phrasesCreate, phrasesData);
  if (kit.caps.inference && kit.caps.inferenceId) {
    articles = await kit.makeIndex(
      getArticlesCreateRequest('articles', kit.caps.inferenceId),
      getArticlesData(),
    );
  }
});

afterAll(async () => {
  await kit.cleanup();
});

function hitsOf<T>(result: estypes.SearchResponse<T>) {
  return result.hits.hits.map((hit) => [hit._id, hit._score] as const);
}

function idsOf<T>(result: estypes.SearchResponse<T>) {
  return result.hits.hits.map((hit) => hit._id);
}

async function searchPlaces(qb: QueryBuilder<PlaceField>) {
  return client.search({ index: places, ...qb.getQuery() });
}

async function searchArticles(qb: QueryBuilder<ArticleField>) {
  return client.search<ArticleRecord>({ index: articles, ...qb.getQuery() });
}

const towardX = (extra: Partial<KnnOptions<PlaceField>> = {}) =>
  new QueryBuilder<PlaceField>().knn({
    field: 'embedding',
    vector: [1, 0, 0],
    k: 6,
    numCandidates: 10,
    ...extra,
  });

describe('knn() (B-048, S-023)', () => {
  it('returns the nearest neighbors in order', async () => {
    const qb = new QueryBuilder<PlaceField>().knn({
      field: 'embedding',
      vector: [1, 0, 0],
      k: 2,
    });
    expect(idsOf(await searchPlaces(qb))).toEqual(['1', '2']);
  });

  it('applies a numeric similarity cutoff', async () => {
    // cosine similarity to [1, 0, 0]: '1' 0.994, '2' 0.943, then <= 0.32
    expect(idsOf(await searchPlaces(towardX({ similarity: 0.95 })))).toEqual([
      '1',
    ]);
    expect(idsOf(await searchPlaces(towardX({ similarity: 0.9 })))).toEqual([
      '1',
      '2',
    ]);
  });

  it('rejects the string similarity the builder used to send', async () => {
    const request = client.search({
      index: places,
      retriever: {
        knn: {
          field: 'embedding',
          query_vector: [1, 0, 0],
          k: 6,
          similarity: 'cosine' as unknown as number,
        },
      },
    });
    await expect(request).rejects.toThrow(/similarity/);
  });

  it('applies a filter, alone and with a similarity cutoff', async () => {
    const park = { term: { category: 'park' } };
    expect(idsOf(await searchPlaces(towardX({ filter: park })))).toEqual([
      '4',
      '3',
    ]);
    const two = towardX({
      filter: [park, { range: { rating: { gte: 4.5 } } }],
    });
    expect(idsOf(await searchPlaces(two))).toEqual(['3']);
    const cut = towardX({ filter: [park], similarity: 0.2 });
    expect(idsOf(await searchPlaces(cut))).toEqual(['4']);
    const empty = towardX({ filter: [] });
    expect(idsOf(await searchPlaces(empty))).toHaveLength(6);
  });
});

describe('linear retriever settings (B-043, S-018)', () => {
  kit.testIf('retrievers')(
    'applies weight and a normalizer set after knn()',
    async () => {
      // the linear retriever is used because a condition is present
      const minmax = towardX({ weight: 2 }).range('rating', '>=', 0);
      const minmaxHits = hitsOf(await searchPlaces(minmax));
      expect(minmaxHits[0]).toEqual(['1', 2]);
      expect(minmaxHits.at(-1)?.[1]).toBeCloseTo(0, 5);

      const none = towardX().range('rating', '>=', 0).normalizer('none');
      const noneHits = hitsOf(await searchPlaces(none));
      expect(noneHits[0]?.[0]).toBe('1');
      // the raw knn score (1 + cosine) / 2, not normalized to 1
      expect(noneHits[0]?.[1]).toBeCloseTo((1 + 0.9937) / 2, 3);
      expect(noneHits.at(-1)?.[1]).toBeGreaterThan(0.5);
    },
  );
});

describe('weightedSemantic() contains clause (B-012)', () => {
  function lexicalRetriever(exactField?: PhraseField | false) {
    const qb = new QueryBuilder<PhraseField | 'body_semantic'>()
      .weightedSemantic({
        semanticField: 'body_semantic',
        standardField: 'body',
        exactField,
        phrase: 'Baking Breads',
      })
      .getRetrievers();
    const lexical = qb[0]?.retriever?.rrf?.retrievers[0];
    if (!lexical) {
      throw new Error('no lexical retriever');
    }
    return lexical as estypes.RetrieverContainer;
  }

  it('boosts the document that contains the multi-word phrase', async () => {
    // the standard retriever alone needs no license or inference
    const withContains = await client.search({
      index: phrases,
      retriever: lexicalRetriever(),
    });
    const without = await client.search({
      index: phrases,
      retriever: lexicalRetriever(false),
    });
    expect(idsOf(without)).toEqual(['2', '1']);
    expect(idsOf(withContains)).toEqual(['1', '2']);
    const score = (res: estypes.SearchResponse, id: string) =>
      res.hits.hits.find((hit) => hit._id === id)?._score ?? 0;
    // the case-insensitive wildcard adds its constant boost (6) to '1' only
    expect(score(withContains, '1') - score(without, '1')).toBeCloseTo(6, 3);
    expect(score(withContains, '2')).toBeCloseTo(score(without, '2'), 5);
  });

  it('matches nothing through an unmapped exactField', async () => {
    const qb = new QueryBuilder()
      .weightedSemantic({
        semanticField: 'body_semantic',
        standardField: 'id',
        phrase: 'baking breads',
      })
      .getRetrievers();
    const lexical = qb[0]?.retriever?.rrf?.retrievers[0];
    const res = await client.search({
      index: phrases,
      retriever: lexical as estypes.RetrieverContainer,
    });
    expect(res.hits.hits).toEqual([]);
  });
});

describe('semantic() (B-092)', () => {
  kit.testIf('inference')('ranks the matching meaning first', async () => {
    const qb = new QueryBuilder<ArticleField>().semantic({
      field: 'body_semantic',
      phrase: 'how to make a loaf',
    });
    const ids = idsOf(await searchArticles(qb));
    expect(['1', '4']).toContain(ids[0] ?? '');
    expect(ids).toHaveLength(4);
  });
});

describe('rrf() (B-043, B-092)', () => {
  const bread = () =>
    new QueryBuilder<ArticleField>().rrf({
      semanticField: 'body_semantic',
      standardField: 'body',
      phrase: 'bread dough',
    });

  hybridTest('fuses lexical and semantic ranks', async () => {
    const hits = hitsOf(await searchArticles(bread()));
    // '1' is first in both lists: 2 / (rank_constant 20 + 1)
    expect(hits[0]?.[0]).toBe('1');
    expect(hits[0]?.[1]).toBeCloseTo(2 / 21, 5);
  });

  hybridTest('applies rank settings set after rrf()', async () => {
    const constant = bread().rankConstant(60);
    const top = hitsOf(await searchArticles(constant))[0];
    expect(top?.[1]).toBeCloseTo(2 / 61, 5);
    const window = bread().rankWindowSize(1);
    expect(idsOf(await searchArticles(window))).toEqual(['1']);
  });
});

describe('weightedSemantic() (B-042, B-043, B-089)', () => {
  const rise = (exactField?: ArticleField | false) =>
    new QueryBuilder<ArticleField>().weightedSemantic({
      semanticField: 'body_semantic',
      standardField: 'body',
      exactField,
      phrase: 'let it rise overnight',
    });

  hybridTest('finds the document containing the phrase', async () => {
    const hits = hitsOf(await searchArticles(rise()));
    expect(hits[0]?.[0]).toBe('1');
    expect(hits[0]?.[1]).toBeCloseTo(2 / 21, 5);
    expect(idsOf(await searchArticles(rise(false)))[0]).toBe('1');
  });

  hybridTest('uses the builder rank settings in any call order', async () => {
    const before = new QueryBuilder<ArticleField>()
      .rankConstant(5)
      .rankWindowSize(2);
    before.weightedSemantic({
      semanticField: 'body_semantic',
      standardField: 'body',
      phrase: 'let it rise overnight',
    });
    const after = rise().rankConstant(5).rankWindowSize(2);
    for (const qb of [before, after]) {
      const hits = hitsOf(await searchArticles(qb));
      expect(hits).toHaveLength(2);
      expect(hits[0]?.[0]).toBe('1');
      expect(hits[0]?.[1]).toBeCloseTo(2 / 6, 5);
    }
  });
});
