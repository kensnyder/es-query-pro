import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { Client, HttpConnection } from '@elastic/elasticsearch';
import { getBooksCreateRequest } from '../testFixtures/books';
import { createTestKit } from '../testFixtures/esTestKit';
import IndexManager from './IndexManager';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('im-status');

// every index and alias below starts with kit.prefix
afterAll(async () => {
  await kit.cleanup();
});

function getManager(name: string, version: number | string = 1) {
  return new IndexManager(
    { client: kit.client, prefix: kit.prefix, version },
    getBooksCreateRequest(name),
  );
}

const noSiblings = {
  all: [],
  older: [],
  newer: [],
  incomparable: [],
  unrelated: [],
};

describe('IndexManager.getStatus() - Integration', () => {
  it('should report needsCreation when nothing exists (B-038)', async () => {
    const books = getManager('none');
    const status = await books.getStatus();
    expect(status).toMatchObject({
      indexExists: false,
      aliasExists: false,
      aliasIndexes: [],
      aliasAttached: false,
      siblings: noSiblings,
      needsCreation: true,
      needsMigration: false,
      summary: 'needsCreation',
      error: null,
      errorKind: null,
    });
    expect(await books.needsCreation()).toBe(true);
    expect(await books.needsMigration()).toBe(false);
  });

  it('should report current for an index behind its alias', async () => {
    const books = getManager('current');
    expect((await books.create()).success).toBe(true);
    const status = await books.getStatus();
    expect(status).toMatchObject({
      indexExists: true,
      aliasExists: true,
      aliasIndexes: [books.getFullName()],
      aliasAttached: true,
      siblings: noSiblings,
      needsCreation: false,
      needsMigration: false,
      summary: 'current',
      error: null,
    });
    expect(await books.needsCreation()).toBe(false);
  });

  it('should report needsAlias for an index without its alias', async () => {
    const books = getManager('noalias');
    expect((await books.createOnly()).error).toBe(null);
    const status = await books.getStatus();
    expect(status).toMatchObject({
      indexExists: true,
      aliasExists: false,
      aliasIndexes: [],
      aliasAttached: false,
      needsCreation: false,
      needsMigration: false,
      summary: 'needsAlias',
      error: null,
    });
  });

  it('should report needsMigration for an alias on an older version', async () => {
    const v1 = getManager('older', 1);
    expect((await v1.create()).success).toBe(true);
    const v2 = getManager('older', 2);
    const status = await v2.getStatus();
    expect(status).toMatchObject({
      indexExists: false,
      aliasExists: true,
      aliasIndexes: [v1.getFullName()],
      aliasAttached: false,
      siblings: {
        ...noSiblings,
        all: [v1.getFullName()],
        older: [v1.getFullName()],
      },
      needsCreation: false,
      needsMigration: true,
      summary: 'needsMigration',
      error: null,
    });
    expect(await v2.needsMigration()).toBe(true);
    expect(await v2.needsCreation()).toBe(false);
  });

  it('should report newerVersionPresent for an alias on a newer version (B-008)', async () => {
    const v2 = getManager('newer', 2);
    expect((await v2.create()).success).toBe(true);
    const v1 = getManager('newer', 1);
    const status = await v1.getStatus();
    expect(status).toMatchObject({
      indexExists: false,
      aliasExists: true,
      aliasIndexes: [v2.getFullName()],
      siblings: {
        ...noSiblings,
        all: [v2.getFullName()],
        newer: [v2.getFullName()],
      },
      needsCreation: false,
      needsMigration: false,
      summary: 'newerVersionPresent',
      error: null,
    });
    expect(await v1.needsMigration()).toBe(false);
  });

  it('should report aliasConflict for an alias on an unrelated index (B-008)', async () => {
    const books = getManager('unrelated');
    const raw = await kit.makeIndex({ index: 'raw' });
    await kit.client.indices.putAlias({
      index: raw,
      name: books.getAliasName(),
    });
    const status = await books.getStatus();
    expect(status).toMatchObject({
      indexExists: false,
      aliasExists: true,
      aliasIndexes: [raw],
      aliasAttached: false,
      siblings: { ...noSiblings, all: [raw], unrelated: [raw] },
      needsCreation: false,
      needsMigration: false,
      summary: 'aliasConflict',
      error: null,
    });
  });

  it('should classify a version that cannot be ordered as incomparable', async () => {
    const dated = getManager('incomparable', '2024a');
    expect((await dated.create()).success).toBe(true);
    const v2 = getManager('incomparable', 2);
    const status = await v2.getStatus();
    expect(status.siblings).toEqual({
      ...noSiblings,
      all: [dated.getFullName()],
      incomparable: [dated.getFullName()],
    });
    expect(status.error).toBe(null);
  });

  it('should list siblings by relation when the alias holds several versions', async () => {
    const v1 = getManager('mixed', 1);
    const v3 = getManager('mixed', 3);
    expect((await v1.createOnly()).error).toBe(null);
    expect((await v3.createOnly()).error).toBe(null);
    // an alias on several indexes, as an interrupted migration can leave it
    await kit.client.indices.updateAliases({
      actions: [
        { add: { index: v1.getFullName(), alias: v1.getAliasName() } },
        { add: { index: v3.getFullName(), alias: v1.getAliasName() } },
      ],
    });
    const res = await getManager('mixed', 2).getSiblingIndexes();
    expect(res.success).toBe(true);
    expect(res.siblings.older).toEqual([v1.getFullName()]);
    expect(res.siblings.newer).toEqual([v3.getFullName()]);
    expect(res.aliasIndexes.sort()).toEqual(
      [v1.getFullName(), v3.getFullName()].sort(),
    );
  });
});

describe('IndexManager.getStatus() on an unreachable cluster - Integration', () => {
  let closedClient: Client;

  beforeAll(() => {
    // bind a free port, then release it so nothing listens there
    const listener = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: { data() {} },
    });
    const port = listener.port;
    listener.stop(true);
    closedClient = new Client({
      node: `http://127.0.0.1:${port}`,
      // the default undici connection fails with a TypeError under Bun
      Connection: HttpConnection,
      maxRetries: 0,
      requestTimeout: 5_000,
    });
  });

  afterAll(async () => {
    await closedClient.close();
  });

  it('should report unknown, not needsCreation (B-035)', async () => {
    const books = new IndexManager(
      { client: closedClient, prefix: kit.prefix },
      getBooksCreateRequest('unreachable'),
    );
    const status = await books.getStatus();
    expect(status).toMatchObject({
      indexExists: null,
      aliasExists: null,
      aliasAttached: null,
      siblings: noSiblings,
      needsCreation: false,
      needsMigration: false,
      summary: 'unknown',
      errorKind: 'connection',
    });
    expect(status.error).toBeInstanceOf(Error);
    expect(await books.needsCreation()).toBe(null);
    expect(await books.needsMigration()).toBe(null);
  });
});
