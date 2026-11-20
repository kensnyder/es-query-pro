import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { createTestKit } from '../testFixtures/esTestKit';
import {
  getPlacesCreateRequest,
  getPlacesData,
  type PlaceRecord,
} from '../testFixtures/places';
import QueryBuilder from './QueryBuilder';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('qb-bool');
const client = kit.client;
let places = '';

type PlaceField =
  | 'id'
  | 'name'
  | 'category'
  | 'description'
  | 'rating'
  | 'embedding'
  | 'reviews'
  | 'reviews.author'
  | 'reviews.stars'
  | 'reviews.comment';

const ALL = ['1', '2', '3', '4', '5', '6'];

beforeAll(async () => {
  places = await kit.makeIndex(
    getPlacesCreateRequest('places'),
    getPlacesData(),
  );
});

afterAll(async () => {
  await kit.cleanup();
});

function builder() {
  return new QueryBuilder<PlaceField>();
}

async function search(qb: QueryBuilder<PlaceField>) {
  return client.search<PlaceRecord>({ index: places, ...qb.getQuery() });
}

async function searchRaw(query: estypes.QueryDslQueryContainer) {
  return client.search<PlaceRecord>({ index: places, query, size: 20 });
}

async function ids(qb: QueryBuilder<PlaceField>) {
  const result = await search(qb.limit(20));
  return result.hits.hits.map((hit) => hit._id).sort();
}

function scoresById(hits: estypes.SearchHit<PlaceRecord>[]) {
  return Object.fromEntries(hits.map((hit) => [hit._id, hit._score]));
}

const museum = (qb: QueryBuilder<PlaceField>) => qb.term('category', 'museum');
const park = (qb: QueryBuilder<PlaceField>) => qb.term('category', 'park');
const topRated = (qb: QueryBuilder<PlaceField>) =>
  qb.range('rating', '>=', 4.75);

describe('should() (B-015, B-101)', () => {
  it('single branch with two clauses matches only documents with both', async () => {
    const qb = builder().should([
      (sub) => {
        museum(sub);
        topRated(sub);
      },
    ]);
    // '2' is a museum rated 4.7, '3' is rated 4.9 but a park
    expect(await ids(qb)).toEqual(['1']);
  });

  it('several branches match either branch', async () => {
    const qb = builder().should([museum, (sub) => topRated(sub)]);
    expect(await ids(qb)).toEqual(['1', '2', '3']);
  });

  it('several branches with minimumShouldMatch 2 act as AND', async () => {
    const qb = builder().should([museum, topRated], { minimumShouldMatch: 2 });
    expect(await ids(qb)).toEqual(['1']);
  });

  it('skips an empty branch and lowers minimumShouldMatch', async () => {
    const qb = builder().should([museum, () => {}], {
      minimumShouldMatch: 2,
    });
    expect(await ids(qb)).toEqual(['1', '2']);
    const three = builder().should([museum, () => {}, park], {
      minimumShouldMatch: 3,
    });
    expect(three.getMust()).toEqual([
      {
        bool: {
          should: [
            { term: { category: 'museum' } },
            { term: { category: 'park' } },
          ],
          minimum_should_match: 2,
        },
      },
    ]);
    expect(await ids(three)).toEqual([]);
  });

  it('server: msm above the clause count matches nothing (why it is lowered)', async () => {
    const result = await searchRaw({
      bool: {
        should: [{ term: { category: 'museum' } }],
        minimum_should_match: 2,
      },
    });
    expect(result.hits.hits).toEqual([]);
  });

  it('adds nothing when all branches are empty or there are none', async () => {
    expect(await ids(builder().should([() => {}, () => {}]))).toEqual(ALL);
    expect(await ids(builder().should([]))).toEqual(ALL);
  });
});

describe('shouldNot() (B-102)', () => {
  it('one branch excludes documents matching all of its clauses', async () => {
    const qb = builder().shouldNot([
      (sub) => {
        museum(sub);
        topRated(sub);
      },
    ]);
    expect(await ids(qb)).toEqual(['2', '3', '4', '5', '6']);
  });

  it('several branches exclude documents matching any branch', async () => {
    const qb = builder().shouldNot([museum, park]);
    expect(await ids(qb)).toEqual(['5', '6']);
  });

  it('minimumShouldMatch 2 excludes only documents matching both', async () => {
    const qb = builder().shouldNot([museum, topRated], {
      minimumShouldMatch: 2,
    });
    expect(await ids(qb)).toEqual(['2', '3', '4', '5', '6']);
    const any = builder().shouldNot([museum, topRated]);
    expect(await ids(any)).toEqual(['4', '5', '6']);
  });

  it('server: one clause with msm 2 excludes nothing, so it throws locally', async () => {
    const result = await searchRaw({
      bool: {
        must_not: [
          {
            bool: {
              should: [{ term: { category: 'museum' } }],
              minimum_should_match: 2,
            },
          },
        ],
      },
    });
    expect(result.hits.hits.map((hit) => hit._id).sort()).toEqual(ALL);
    expect(() =>
      builder().shouldNot([museum], { minimumShouldMatch: 2 }),
    ).toThrow(RangeError);
  });
});

describe('mustNot() (S-055)', () => {
  it('excludes documents matching any of its conditions', async () => {
    const qb = builder().mustNot((sub) => {
      museum(sub);
      park(sub);
    });
    expect(await ids(qb)).toEqual(['5', '6']);
  });

  it('an empty callback excludes nothing', async () => {
    expect(await ids(builder().mustNot(() => {}))).toEqual(ALL);
  });
});

describe('filter() (S-019, S-057, D5)', () => {
  const matchMuseum = (qb: QueryBuilder<PlaceField>) =>
    qb.match({ field: 'description', phrase: 'museum' });

  it('restricts results without changing _score', async () => {
    const plain = await search(matchMuseum(builder()).limit(20));
    const plainScores = scoresById(plain.hits.hits);
    // '4' ("park with museums") matches the text but is rated 4.4
    expect(Object.keys(plainScores).sort()).toEqual(['1', '2', '4']);

    const filtered = await search(
      matchMuseum(builder())
        .filter((sub) => sub.range('rating', '>=', 4.5))
        .limit(20),
    );
    const filteredScores = scoresById(filtered.hits.hits);
    expect(Object.keys(filteredScores).sort()).toEqual(['1', '2']);
    for (const id of ['1', '2']) {
      expect(filteredScores[id]).toBeCloseTo(plainScores[id] as number, 6);
    }

    // the same range as a scoring must clause adds its constant score
    const scored = await search(
      matchMuseum(builder()).range('rating', '>=', 4.5).limit(20),
    );
    const scoredScores = scoresById(scored.hits.hits);
    for (const id of ['1', '2']) {
      expect(scoredScores[id]).toBeCloseTo((plainScores[id] as number) + 1, 6);
    }
  });

  it('a filter-only query scores every hit 0', async () => {
    const result = await search(
      builder()
        .filter((sub) => sub.term('category', 'park'))
        .limit(20),
    );
    expect(result.hits.hits.map((hit) => hit._id).sort()).toEqual(['3', '4']);
    expect(result.hits.hits.map((hit) => hit._score)).toEqual([0, 0]);
  });

  it('works inside should() branches and with mustNot()', async () => {
    const qb = builder()
      .should([(sub) => sub.filter(museum), (sub) => sub.filter(park)])
      .filter((sub) => sub.mustNot((n) => n.term('id', '1')));
    expect(await ids(qb)).toEqual(['2', '3', '4']);
  });

  kit.testIf('retrievers')(
    'on the retriever path, filter and must clauses restrict knn results',
    async () => {
      const knn = () =>
        builder().knn({
          field: 'embedding',
          vector: [1, 0, 0],
          k: 6,
          numCandidates: 10,
          weight: 1,
        });
      const filtered = await search(
        knn()
          .filter((sub) => sub.term('category', 'park'))
          .limit(20),
      );
      expect(filtered.hits.hits.map((hit) => hit._id).sort()).toEqual([
        '3',
        '4',
      ]);
      const withMust = await search(
        knn()
          .term('category', 'market')
          .filter((sub) => sub.range('rating', '>=', 4.4))
          .limit(20),
      );
      expect(withMust.hits.hits.map((hit) => hit._id)).toEqual(['6']);
    },
  );
});

describe('nested() (S-055)', () => {
  it('matches one nested object against all conditions, with inner_hits', async () => {
    const qb = builder().nested({
      path: 'reviews',
      query: (sub) => {
        sub.term('reviews.author', 'bo');
        sub.range('reviews.stars', '>=', 5);
      },
      innerHits: true,
    });
    // '1' has a 5-star review and a review by 'bo', but not the same one
    const result = await search(qb.limit(20));
    expect(result.hits.hits.map((hit) => hit._id)).toEqual(['3']);
    const inner = result.hits.hits[0].inner_hits?.reviews?.hits.hits ?? [];
    expect(inner.map((hit) => hit._source)).toEqual([
      { author: 'bo', stars: 5, comment: 'Lovely walking paths' },
    ]);
  });

  it('sends a single clause unwrapped, with named inner_hits options', async () => {
    const qb = builder().nested({
      path: 'reviews',
      query: (sub) => sub.range('reviews.stars', '>=', 4),
      scoreMode: 'max',
      innerHits: { name: 'good', size: 1, _source: ['reviews.stars'] },
    });
    expect(qb.getMust()[0]).toEqual({
      nested: {
        path: 'reviews',
        query: { range: { 'reviews.stars': { gte: 4 } } },
        score_mode: 'max',
        inner_hits: { name: 'good', size: 1, _source: ['reviews.stars'] },
      },
    });
    const result = await search(qb.limit(20));
    expect(result.hits.hits.map((hit) => hit._id).sort()).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    for (const hit of result.hits.hits) {
      expect(hit.inner_hits?.good?.hits.hits).toHaveLength(1);
    }
  });

  it('an empty callback matches documents with any nested object', async () => {
    const qb = builder().nested({ path: 'reviews', query: () => {} });
    expect(await ids(qb)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('filter() inside nested() restricts nested objects', async () => {
    const qb = builder().nested({
      path: 'reviews',
      query: (sub) => sub.filter((f) => f.term('reviews.author', 'ana')),
    });
    expect(await ids(qb)).toEqual(['1', '4']);
  });

  it('ignoreUnmapped turns an unknown path into no match', async () => {
    const qb = new QueryBuilder().nested({
      path: 'missing',
      query: (sub) => sub.term('missing.x', 1),
      ignoreUnmapped: true,
    });
    const result = await client.search({ index: places, ...qb.getQuery() });
    expect(result.hits.hits).toEqual([]);
  });
});

describe('sub-builder state (S-056)', () => {
  it('throws for unsupported state and leaves the builder usable', async () => {
    const qb = builder();
    expect(() =>
      qb.should([(sub) => museum(sub).sort('rating'), park]),
    ).toThrow(TypeError);
    expect(() => qb.mustNot((sub) => museum(sub).limit(1))).toThrow(TypeError);
    expect(() =>
      qb.filter((sub) => sub.aggregateTerm({ field: 'category' })),
    ).toThrow(TypeError);
    expect(() =>
      qb.nested({
        path: 'reviews',
        query: (sub) =>
          sub.knn({ field: 'embedding', vector: [1, 0, 0], k: 1, weight: 1 }),
      }),
    ).toThrow(TypeError);
    // nothing was added: the builder still matches everything
    expect(await ids(qb)).toEqual(ALL);
  });
});
