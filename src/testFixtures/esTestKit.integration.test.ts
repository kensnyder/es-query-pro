import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { getArticlesCreateRequest, getArticlesData } from './articles';
import { getBooksCreateRequest, getBooksData, insertBooksData } from './books';
import {
  createTestKit,
  KIT_INDEX_PREFIX,
  parseRunPrefixTime,
} from './esTestKit';
import { getPlacesCreateRequest, getPlacesData } from './places';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(60_000);

const kit = await createTestKit('kitself');

afterAll(async () => {
  await kit.cleanup();
});

async function listUnderPrefix(prefix: string) {
  const rows = await kit.client.cat.indices({
    index: `${prefix}*`,
    format: 'json',
    h: 'index',
  });
  return rows.map((row) => row.index);
}

describe('esTestKit - Integration', () => {
  it('should report sensible capability flags for the target', () => {
    const { caps } = kit;
    console.log(`[esTestKit] target caps: ${JSON.stringify(caps)}`);
    expect(caps.version).toMatch(/^\d+\.\d+\.\d+/);
    // serverless has no task list API and always has an enterprise license
    if (caps.serverless) {
      expect(caps.tasksApi).toBe(false);
      expect(caps.retrievers).toBe(true);
    } else {
      expect(caps.tasksApi).toBe(true);
    }
    expect(caps.inference).toBe(caps.inferenceId !== null);
  });

  it('should leave no capability probe index behind', async () => {
    const names = await listUnderPrefix(`${KIT_INDEX_PREFIX}_`);
    const probes = names.filter((name) => name?.endsWith('_probe'));
    // a probe from a run in the last minute may still be there
    for (const name of probes) {
      const time = parseRunPrefixTime(name ?? '') ?? 0;
      expect(Date.now() - time).toBeLessThan(60_000);
    }
  });

  it('should create, write, read, and clean up leaving nothing behind', async () => {
    const own = await createTestKit('kitcleanup');
    const books = await own.makeIndex(
      getBooksCreateRequest('books'),
      getBooksData(),
    );
    expect(books.startsWith(`${own.prefix}_books_`)).toBe(true);
    const found = await own.client.search({
      index: books,
      query: { term: { country: 'United Kingdom' } },
    });
    expect(found.hits.hits.map((hit) => hit._id).sort()).toEqual(['1', '2']);

    // an index plus alias made outside makeIndex, as IndexManager does
    const managed = `${own.prefix}~english~books~v1`;
    await own.client.indices.create({
      index: managed,
      aliases: { [`${own.prefix}~english~books`]: {} },
    });
    // a name reserved but never created is ignored
    own.indexName('never');

    expect((await listUnderPrefix(own.prefix)).sort()).toEqual(
      [books, managed].sort(),
    );
    const deleted = await own.cleanup();
    expect(deleted).toContain(books);
    expect(deleted).toContain(managed);
    expect(await listUnderPrefix(own.prefix)).toEqual([]);
    const alias = await own.client.indices.existsAlias({
      name: `${own.prefix}~english~books`,
    });
    expect(alias).toBe(false);
    // a second cleanup has nothing left to do
    expect(await own.cleanup()).toEqual([]);
  });

  it('should load books with insertBooksData using float prices', async () => {
    const index = kit.indexName('books');
    await kit.client.indices.create(getBooksCreateRequest(index));
    await insertBooksData(index, kit.client);
    const res = await kit.client.search({
      index,
      size: 0,
      aggs: { max_price: { max: { field: 'price' } } },
    });
    const max = res.aggregations?.max_price as { value: number };
    // an integer mapping would have stored 24
    expect(max.value).toBeCloseTo(24.99, 6);
  });

  it('should poll with waitFor until a document is visible', async () => {
    const index = await kit.makeIndex({ index: 'wait' });
    await kit.client.index({ index, id: 'a', document: { n: 1 } });
    const count = await kit.waitFor(async () => {
      await kit.client.indices.refresh({ index });
      const res = await kit.client.count({ index });
      return res.count;
    });
    expect(count).toBe(1);
  });

  it('should accept the places fixture: geo, knn and nested', async () => {
    const index = await kit.makeIndex(
      getPlacesCreateRequest('places'),
      getPlacesData(),
    );
    const knn = await kit.client.search({
      index,
      knn: {
        field: 'embedding',
        query_vector: [1, 0, 0],
        k: 2,
        num_candidates: 10,
      },
    });
    expect(knn.hits.hits.map((hit) => hit._id)).toEqual(['1', '2']);

    const geo = await kit.client.search({
      index,
      size: 0,
      aggs: { tiles: { geotile_grid: { field: 'location', precision: 4 } } },
    });
    const tiles = geo.aggregations?.tiles as { buckets: unknown[] };
    expect(tiles.buckets).toHaveLength(6);

    const nested = await kit.client.search({
      index,
      query: {
        nested: {
          path: 'reviews',
          query: {
            bool: {
              must: [
                { term: { 'reviews.author': 'bo' } },
                { term: { 'reviews.stars': 5 } },
              ],
            },
          },
        },
      },
    });
    expect(nested.hits.hits.map((hit) => hit._id)).toEqual(['3']);
  });

  kit.testIf('retrievers')('should run an rrf retriever', async () => {
    const index = await kit.makeIndex(
      getBooksCreateRequest('rrf'),
      getBooksData(),
    );
    const res = await kit.client.search({
      index,
      retriever: {
        rrf: {
          retrievers: [
            { standard: { query: { match: { title: 'harry' } } } },
            { standard: { query: { match: { premise: 'pilot' } } } },
          ],
        },
      },
    });
    expect(res.hits.hits.map((hit) => hit._id).sort()).toEqual(['1', '2', '3']);
  });

  kit.testIf('inference')('should accept the articles fixture', async () => {
    const index = await kit.makeIndex(
      getArticlesCreateRequest('articles', kit.caps.inferenceId ?? ''),
      getArticlesData(),
    );
    const res = await kit.client.search({
      index,
      size: 2,
      query: {
        semantic: { field: 'body_semantic', query: 'how to make a loaf' },
      },
    });
    const top = res.hits.hits[0]?._id;
    expect(['1', '4']).toContain(top ?? '');
  });

  it('should sweep nothing that is not an old kit index', async () => {
    // only names with a run prefix older than 3h; ours are seconds old
    const swept = await kit.sweep();
    for (const name of swept) {
      expect(name.startsWith(`${KIT_INDEX_PREFIX}_`)).toBe(true);
      const time = parseRunPrefixTime(name) ?? Date.now();
      expect(Date.now() - time).toBeGreaterThan(3 * 3_600_000);
    }
    expect((await listUnderPrefix(kit.prefix)).length).toBeGreaterThan(0);
  });
});
