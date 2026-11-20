import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import IndexManager from '../IndexManager/IndexManager';
import { getBooksCreateRequest, getBooksData } from '../testFixtures/books';
import { createTestKit } from '../testFixtures/esTestKit';
import { getPlacesCreateRequest, getPlacesData } from '../testFixtures/places';
import QueryRunner from './QueryRunner';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('qrunner');

// every index and alias below starts with kit.prefix
afterAll(async () => {
  await kit.cleanup();
});

/** Create a manager's index and alias, then load `docs` with a refresh */
async function makeManaged<const C extends estypes.IndicesCreateRequest>(
  create: C,
  docs: Record<string, unknown>[],
) {
  const manager = new IndexManager(
    { client: kit.client, prefix: kit.prefix },
    create,
  );
  const created = await manager.create();
  if (!created.success) {
    throw created.error ?? new Error(`create failed: ${created.code}`);
  }
  const loaded = await manager.putBulk(docs as never[], { refresh: true });
  if (loaded.error) {
    throw loaded.error;
  }
  return manager;
}

/** The books index (ids '1', '2' UK; '3' US) behind its alias */
const books = await makeManaged(getBooksCreateRequest('books'), getBooksData());

/** An index for updateMany(): objects, a nested list, missing parents */
const notesCreate = (index: string) =>
  ({
    index,
    mappings: {
      dynamic: 'strict',
      properties: {
        id: { type: 'keyword' },
        title: { type: 'text', fields: { raw: { type: 'keyword' } } },
        n: { type: 'integer' },
        meta: {
          properties: {
            tag: { type: 'keyword' },
            owner: { properties: { name: { type: 'keyword' } } },
          },
        },
        items: { type: 'nested', properties: { k: { type: 'integer' } } },
      },
    },
  }) as const;

function getNotesData() {
  return [
    {
      id: '1',
      title: 'one',
      n: 1,
      meta: { tag: 'a', owner: { name: 'ana' } },
      items: [{ k: 1 }, { k: 2 }],
    },
    { id: '2', title: 'two', n: 2, meta: { tag: 'b' } },
    { id: '3', title: 'three', n: 3 },
    { id: '4', title: 'four', n: 4, items: [] },
  ];
}

/** `_source` and `_version` of every document, by id */
async function snapshot(index: string) {
  await kit.client.indices.refresh({ index });
  const res = await kit.client.search({ index, size: 100, version: true });
  return Object.fromEntries(
    res.hits.hits.map((hit) => [
      hit._id,
      { version: hit._version, source: hit._source },
    ]),
  );
}

describe('QueryRunner.count() - Integration', () => {
  it('should count a builder with search-only state (B-017)', async () => {
    const runner = new QueryRunner(books);
    runner.builder
      .term('country', 'United Kingdom')
      .limit(1)
      .page(2)
      .sort('id')
      .aggregateTerm({ field: 'author' })
      .highlightField('title')
      .excludeFields(['premise'])
      .trackTotalHits(true);
    const res = await runner.count();
    expect(res.error).toBe(null);
    expect(res.total).toBe(2);
    // the same builder searches fine and pages as set
    const found = await runner.findMany();
    expect(found.error).toBe(null);
    expect(found.total).toBe(2);
    expect(found.records.map((r) => r.id)).toEqual(['2']);
  });

  it('should count through IndexManager.count()', async () => {
    const res = await books.count((qb) =>
      qb.matchPhrase({ field: 'title', phrase: 'Harry Potter' }).limit(1),
    );
    expect(res.error).toBe(null);
    expect(res.total).toBe(2);
  });

  it('should apply minScore() like a search does', async () => {
    const runner = new QueryRunner(books);
    runner.builder.match({ field: 'title', phrase: 'chamber' }).minScore(0.01);
    const counted = await runner.count();
    const found = await runner.findMany();
    expect(counted.error).toBe(null);
    expect(counted.total).toBe(found.total);
    expect(counted.total).toBe(1);
    const none = await runner.count({ min_score: 1000 });
    expect(none.total).toBe(0);
  });

  it('should return the D10 envelope for a retriever (B-018)', async () => {
    const places = await makeManaged(
      getPlacesCreateRequest('places'),
      getPlacesData(),
    );
    const runner = new QueryRunner(places);
    runner.builder
      .term('category', 'museum')
      .knn({ field: 'embedding', vector: [1, 0, 0], k: 2 });
    const res = await runner.count();
    expect(res.total).toBe(null);
    expect(res.request).toBe(null);
    expect(res.error?.message).toMatch(/count\(\) does not support retrievers/);
    expect(res.errorKind).toBe('javascript');
    // the builder itself is fine: the search returns the two museums
    const found = await runner.findMany();
    expect(found.error).toBe(null);
    expect(found.records.map((r) => r.id).sort()).toEqual(['1', '2']);
  });
});

describe('QueryRunner records - Integration (B-065)', () => {
  it('should carry _id, _score and highlights', async () => {
    const runner = new QueryRunner(books);
    runner.builder
      .match({ field: 'title', phrase: 'chamber' })
      .highlightField('title');
    const res = await runner.findMany();
    expect(res.error).toBe(null);
    expect(res.records).toHaveLength(1);
    const [record] = res.records;
    expect(record._id).toBe('2');
    expect(record.id).toBe('2');
    expect(record._score).toBeGreaterThan(0);
    expect(record._highlight?.title?.join(' ')).toMatch(
      /<em[^>]*>Chamber<\/em>/,
    );
    expect(record._sort).toBeUndefined();
  });

  it('should carry sort values that feed searchAfter()', async () => {
    const runner = new QueryRunner(books);
    runner.builder.sort('id').limit(1);
    const seen: string[] = [];
    let page = await runner.findMany();
    while (page.records.length > 0) {
      expect(page.error).toBe(null);
      const [record] = page.records;
      expect(record._sort).toEqual([record.id as string]);
      seen.push(record._id);
      runner.builder.searchAfter(record._sort ?? []);
      page = await runner.findMany();
    }
    expect(page.error).toBe(null);
    expect(seen).toEqual(['1', '2', '3']);
  });
});

describe('QueryRunner.findFirst() - Integration (S-030)', () => {
  it('should request and receive one hit', async () => {
    const runner = new QueryRunner(books);
    runner.builder.sort('id');
    const res = await runner.findFirst();
    if (res.error) {
      throw res.error;
    }
    expect(res.request?.size).toBe(1);
    expect(res.total).toBe(3);
    expect(res.response.hits.hits).toHaveLength(1);
    expect(res.record?._id).toBe('1');
    expect(runner.builder.getLimit()).toBe(null);
  });

  it('should return record null when nothing matches', async () => {
    const runner = new QueryRunner(books);
    runner.builder.term('id', 'nope');
    const res = await runner.findFirst();
    expect(res.error).toBe(null);
    expect(res.record === null).toBe(true);
  });
});

describe('QueryRunner.findFirstOrThrow() - Integration (B-019)', () => {
  it('should return the matching record', async () => {
    const runner = new QueryRunner(books);
    runner.builder.term('id', '3');
    const res = await runner.findFirstOrThrow();
    expect(res.record._id).toBe('3');
  });

  it('should throw NotFoundError when nothing matches', async () => {
    const runner = new QueryRunner(books);
    runner.builder.term('id', 'nope');
    const error = await runner.findFirstOrThrow().catch((e) => e);
    expect(error.name).toBe('NotFoundError');
    expect(error.status).toBe(404);
  });

  it('should throw the real error for a bad query', async () => {
    const runner = new QueryRunner(books);
    runner.builder.rawCondition({
      no_such_query: {},
    } as estypes.QueryDslQueryContainer);
    const error = await runner.findFirstOrThrow().catch((e) => e);
    expect(error.name).toBe('ResponseError');
    expect(error.meta.statusCode).toBe(400);
    expect(JSON.stringify(error.meta.body)).toContain('no_such_query');
  });
});

describe('QueryRunner.updateMany() - Integration', () => {
  it('should set a top-level field on the matching documents', async () => {
    const notes = await makeManaged(notesCreate('upd-top'), getNotesData());
    const index = notes.getAliasName();
    const before = await snapshot(index);
    const res = await notes.run((runner) => {
      runner.builder.term('id', '1');
      return runner.updateMany({ title: "it's new" }, { refresh: true });
    });
    expect(res.error).toBe(null);
    expect(res.success).toBe(true);
    expect(res.updated).toBe(1);
    const after = await snapshot(index);
    expect(after['1'].source).toEqual({
      ...(before['1'].source as object),
      title: "it's new",
    });
    for (const id of ['2', '3', '4']) {
      expect(after[id]).toEqual(before[id]);
    }
    const found = await notes.count((qb) => qb.term('title.raw', "it's new"));
    expect(found.total).toBe(1);
  });

  it('should set nested paths, creating missing parents (B-059)', async () => {
    const notes = await makeManaged(notesCreate('upd-nested'), getNotesData());
    const index = notes.getAliasName();
    const res = await notes.run((runner) =>
      runner.updateMany(
        { 'meta.owner.name': 'zed', 'items.k': 9 },
        { refresh: true },
      ),
    );
    expect(res.error).toBe(null);
    expect(res.updated).toBe(4);
    const after = await snapshot(index);
    // an existing object, an object without "owner", no "meta" at all
    expect(after['1'].source).toMatchObject({
      meta: { tag: 'a', owner: { name: 'zed' } },
      items: [{ k: 9 }, { k: 9 }],
    });
    expect(after['2'].source).toMatchObject({
      meta: { tag: 'b', owner: { name: 'zed' } },
      items: { k: 9 },
    });
    expect(after['3'].source).toMatchObject({
      meta: { owner: { name: 'zed' } },
    });
    // an empty list has no objects to set the field on
    expect(after['4'].source).toMatchObject({ items: [] });
    const owners = await notes.count((qb) => qb.term('meta.owner.name', 'zed'));
    expect(owners.total).toBe(4);
  });

  it('should replace a whole object container', async () => {
    const notes = await makeManaged(notesCreate('upd-object'), getNotesData());
    const res = await notes.run((runner) => {
      runner.builder.term('id', '1');
      return runner.updateMany({ meta: { tag: 'z' } }, { refresh: true });
    });
    expect(res.error).toBe(null);
    const after = await snapshot(notes.getAliasName());
    expect((after['1'].source as { meta: unknown }).meta).toEqual({
      tag: 'z',
    });
  });

  it('should update at most limit() documents (B-060)', async () => {
    const notes = await makeManaged(notesCreate('upd-limit'), getNotesData());
    const res = await notes.run((runner) => {
      runner.builder.limit(2);
      return runner.updateMany({ n: 100 }, { refresh: true });
    });
    expect(res.error).toBe(null);
    expect(res.updated).toBe(2);
    const changed = await notes.count((qb) => qb.term('n', 100));
    expect(changed.total).toBe(2);
  });

  it('should reject bad input and modify nothing (B-020, B-059, S-033)', async () => {
    const notes = await makeManaged(notesCreate('upd-reject'), getNotesData());
    const index = notes.getAliasName();
    const before = await snapshot(index);
    const hostile =
      "x'] = params['v0']; ctx['op'] = 'delete'; ctx['_source']['y";
    const inputs = [
      {},
      { [hostile]: 1 },
      { '': { id: 'x' } },
      { 'title.raw': 'x' },
      { 'meta..tag': 'x' },
    ];
    for (const values of inputs) {
      const res = await notes.run((runner) =>
        runner.updateMany(values, { refresh: true }),
      );
      expect(res.success).toBe(false);
      expect(res.error).toBeInstanceOf(Error);
      expect(res.request).toBe(null);
    }
    expect(await snapshot(index)).toEqual(before);
  });

  it('should report a script failure as an error envelope', async () => {
    const loose = await makeManaged(
      {
        index: 'upd-fail',
        mappings: { dynamic: true, properties: { id: { type: 'keyword' } } },
      },
      [{ id: '1', x: 'text' }],
    );
    const before = await snapshot(loose.getAliasName());
    // x is a string, so nothing can be set inside it
    const res = await loose.run((runner) => runner.updateMany({ 'x.y': 1 }));
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe('response');
    expect(JSON.stringify(res.response)).toContain('is not an object');
    expect(await snapshot(loose.getAliasName())).toEqual(before);
  });
});
