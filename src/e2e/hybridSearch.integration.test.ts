import {
  afterAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
  test,
} from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { IndexManager } from '../../index';
import {
  getArticlesCreateRequest,
  getArticlesData,
} from '../testFixtures/articles';
import { createTestKit } from '../testFixtures/esTestKit';
import { getPlacesCreateRequest, getPlacesData } from '../testFixtures/places';
import { aliasTargets, idsOf } from './helpers';

/**
 * Scenario 4 — the hybrid (retriever) search path through `IndexManager`,
 * behind capability flags:
 * - kNN alone (basic license, both targets): filters, the runner's refusal
 *   to count/update/delete with retrievers, and builder errors as envelopes
 * - several retrievers in `linear` (`caps.retrievers`): weights, paging
 *   with the auto-raised rank window, filters, rescore
 * - semantic, rrf and weightedSemantic on `semantic_text`, before and after
 *   a version migration (`caps.retrievers && caps.inference`)
 * Scores are not pinned; only orders that the vectors fix are.
 */

setDefaultTimeout(60_000);
const MIGRATION_TEST_MS = 240_000;

const kit = await createTestKit('e2e-hybrid');
afterAll(() => kit.cleanup());

const semanticReady = kit.caps.retrievers && kit.caps.inference;
if (!semanticReady) {
  console.log(
    '[e2e-hybrid] skipping semantic tests: they need caps.retrievers and ' +
      `caps.inference (retrievers=${kit.caps.retrievers}, ` +
      `inference=${kit.caps.inference})`,
  );
}

/**
 * The places fixture with plain `hnsw` vectors: the default `int8_hnsw`
 * quantization (9.1) can swap the close neighbors this scenario orders
 */
function placesCreate(): estypes.IndicesCreateRequest {
  const create = getPlacesCreateRequest('places');
  const properties = create.mappings?.properties ?? {};
  return {
    ...create,
    mappings: {
      ...create.mappings,
      properties: {
        ...properties,
        embedding: {
          ...(properties.embedding as estypes.MappingDenseVectorProperty),
          index_options: { type: 'hnsw' as const },
        },
      },
    },
  };
}

const places = new IndexManager(
  { client: kit.client, prefix: kit.prefix },
  placesCreate(),
);
const X = [1, 0, 0];
const Y = [0, 1, 0];

describe('E2E scenario 4: hybrid search path', () => {
  it('sets up places through migrateIfNeeded() and putBulk()', async () => {
    expect((await places.migrateIfNeeded()).code).toBe('CREATED');
    const loaded = await places.putBulk(getPlacesData(), { refresh: true });
    expect(loaded.error).toBe(null);
    expect((await places.count()).total).toBe(6);
  });

  describe('kNN alone', () => {
    it('ranks by vector inside the filter and the conditions', async () => {
      // parks only; '4' leans more towards x than '3'
      const parks = await places.findMany((qb) =>
        qb
          .knn({ field: 'embedding', vector: X, k: 2 })
          .filter((sub) => sub.term('category', 'park')),
      );
      expect(parks.error).toBe(null);
      expect(idsOf(parks.records)).toEqual(['4', '3']);
      // plain conditions are filters on the retriever path too (D5)
      const rated = await places.findMany((qb) =>
        qb
          .knn({ field: 'embedding', vector: Y, k: 6 })
          .range('rating', '>=', 4.7),
      );
      expect(idsOf(rated.records)).toEqual(['3', '2', '1']);
      const first = await places.findFirst((qb) =>
        qb.knn({ field: 'embedding', vector: X, k: 3 }),
      );
      expect(first.record?._id).toBe('1');
    });

    it('count, updateMany and deleteMany refuse retrievers without sending', async () => {
      const counted = await places.count((qb) =>
        qb.knn({ field: 'embedding', vector: X, k: 2 }),
      );
      expect(counted).toMatchObject({
        total: null,
        request: null,
        errorKind: 'javascript',
      });
      expect(counted.error?.message).toContain('retrievers');
      const updated = await places.run((runner) => {
        runner.builder.knn({ field: 'embedding', vector: X, k: 2 });
        return runner.updateMany({ rating: 0 }, { refresh: true });
      });
      expect(updated).toMatchObject({ success: false, request: null });
      expect(updated.error).toBeInstanceOf(Error);
      const deleted = await places.deleteMany(
        (qb) => qb.knn({ field: 'embedding', vector: X, k: 2 }),
        { refresh: true },
      );
      expect(deleted).toMatchObject({ success: false, deleted: null });
      expect(deleted.error).toBeInstanceOf(Error);
      // nothing changed on the server
      expect((await places.count()).total).toBe(6);
      const one = await places.findById('1');
      expect(one.record?.rating).toBeCloseTo(4.8, 5);
    });

    it('returns builder errors (retriever + sort) as envelopes', async () => {
      const res = await places.findMany((qb) =>
        qb.knn({ field: 'embedding', vector: X, k: 2 }).sort('rating'),
      );
      expect(res).toMatchObject({
        records: [],
        total: null,
        request: null,
        errorKind: 'javascript',
      });
      expect(res.error).toBeInstanceOf(TypeError);
    });
  });

  describe('several retrievers (linear)', () => {
    kit.testIf('retrievers')('weights decide the order', async () => {
      // x-similarity order: '1', '2', '4', '6', '3', '5'
      const towardsX = await places.findMany((qb) =>
        qb
          .knn({ field: 'embedding', vector: X, k: 6, weight: 1 })
          .knn({ field: 'embedding', vector: Y, k: 6, weight: 0 })
          .limit(3),
      );
      expect(towardsX.error).toBe(null);
      expect(idsOf(towardsX.records)).toEqual(['1', '2', '4']);
      const towardsY = await places.findMany((qb) =>
        qb
          .knn({ field: 'embedding', vector: X, k: 6, weight: 0 })
          .knn({ field: 'embedding', vector: Y, k: 6, weight: 1 })
          .limit(2),
      );
      expect(idsOf(towardsY.records)).toEqual(['3', '4']);
    });

    kit.testIf('retrievers')(
      'pages past the default window and filters',
      async () => {
        const page2 = await places.findMany((qb) =>
          qb
            .knn({ field: 'embedding', vector: X, k: 6, weight: 1 })
            .knn({ field: 'embedding', vector: Y, k: 6, weight: 0 })
            .limit(2)
            .page(2),
        );
        expect(page2.error).toBe(null);
        expect(idsOf(page2.records)).toEqual(['4', '6']);
        const markets = await places.findMany((qb) =>
          qb
            .knn({ field: 'embedding', vector: X, k: 6, weight: 1 })
            .knn({ field: 'embedding', vector: Y, k: 6, weight: 0 })
            .filter((sub) => sub.term('category', 'market')),
        );
        expect(idsOf(markets.records)).toEqual(['6', '5']);
      },
    );

    kit.testIf('retrievers')('rescores the retrieved window', async () => {
      const res = await places.findMany((qb) =>
        qb
          .knn({ field: 'embedding', vector: X, k: 6 })
          .limit(3)
          .rescore((sub) => sub.term('category', 'park'), {
            windowSize: 6,
            rescoreQueryWeight: 100,
          }),
      );
      expect(res.error).toBe(null);
      // the parks ('3' was 5th, '4' 3rd) jump ahead of the museums
      expect(idsOf(res.records).slice(0, 2).sort()).toEqual(['3', '4']);
      expect(idsOf(res.records)[2]).toBe('1');
    });
  });

  describe('semantic_text (inference)', () => {
    const articles = (version: number) =>
      new IndexManager(
        { client: kit.client, prefix: kit.prefix, version },
        {
          ...getArticlesCreateRequest(
            'articles',
            kit.caps.inferenceId ?? 'none',
          ),
        },
      );
    const v1 = articles(1);
    const v2 = articles(2);
    const bread = ['1', '4'];

    test.skipIf(!semanticReady)(
      'semantic, rrf and weightedSemantic rank by meaning',
      async () => {
        expect((await v1.migrateIfNeeded()).code).toBe('CREATED');
        const loaded = await v1.putBulk(getArticlesData(), { refresh: true });
        expect(loaded.error).toBe(null);
        const semantic = await v1.findFirst((qb) =>
          qb.semantic({ field: 'body_semantic', phrase: 'how to make a loaf' }),
        );
        expect(semantic.error).toBe(null);
        expect(bread).toContain(semantic.record?._id as string);
        const rrf = await v1.findMany((qb) =>
          qb
            .rrf({
              semanticField: 'body_semantic',
              standardField: 'body',
              phrase: 'bread dough in the oven',
            })
            .limit(2),
        );
        expect(rrf.error).toBe(null);
        expect(bread).toContain(rrf.records[0]?._id);
        // a filter limits what the fused ranking may return
        const garden = await v1.findMany((qb) =>
          qb
            .rrf({
              semanticField: 'body_semantic',
              standardField: 'body',
              phrase: 'bread dough in the oven',
            })
            .filter((sub) => sub.term('title.raw', 'Growing tomatoes')),
        );
        expect(idsOf(garden.records)).toEqual(['3']);
        // the literal phrase sits in '4' only: the contains clause wins
        const weighted = await v1.findFirst((qb) =>
          qb.weightedSemantic({
            semanticField: 'body_semantic',
            standardField: 'body',
            phrase: 'starter flour',
          }),
        );
        expect(weighted.error).toBe(null);
        expect(weighted.record?._id).toBe('4');
      },
    );

    test.skipIf(!semanticReady)(
      'still ranks by meaning after a v1 → v2 migration',
      async () => {
        const result = await v2.migrateIfNeeded({ pollInterval: 200 });
        expect(result.code).toBe('MIGRATION_STARTED');
        const outcome = await result.completion;
        expect(outcome.error).toBe(null);
        expect(outcome).toMatchObject({ success: true, code: 'MIGRATED' });
        expect(await aliasTargets(kit, v2.getAliasName())).toEqual([
          v2.getFullName(),
        ]);
        expect((await v2.count()).total).toBe(4);
        const semantic = await v2.findFirst((qb) =>
          qb.semantic({ field: 'body_semantic', phrase: 'how to make a loaf' }),
        );
        expect(semantic.error).toBe(null);
        expect(bread).toContain(semantic.record?._id as string);
        const space = await v2.findFirst((qb) =>
          qb.rrf({
            semanticField: 'body_semantic',
            standardField: 'body',
            phrase: 'launching a spacecraft into orbit',
          }),
        );
        expect(space.record?._id).toBe('2');
      },
      MIGRATION_TEST_MS,
    );
  });
});
