import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { getBooksCreateRequest, getBooksData } from '../testFixtures/books';
import { createTestKit } from '../testFixtures/esTestKit';
import IndexManager, { type ManageOptions } from './IndexManager';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('im-lifecycle');

// every index and alias below starts with kit.prefix
afterAll(async () => {
  await kit.cleanup();
});

function getManager(name: string, options: Partial<ManageOptions> = {}) {
  return new IndexManager(
    { client: kit.client, prefix: kit.prefix, ...options },
    getBooksCreateRequest(name),
  );
}

/** A manager whose mapping Elasticsearch rejects */
function getBadManager(name: string) {
  const create = {
    index: name,
    mappings: { properties: { id: { type: 'no_such_type' } } },
  } as unknown as estypes.IndicesCreateRequest;
  return new IndexManager({ client: kit.client, prefix: kit.prefix }, create);
}

/** The concrete indexes the alias points at, sorted */
async function getAliasTargets(alias: string) {
  const res = await kit.client.indices.getAlias(
    { name: alias },
    { ignore: [404] },
  );
  return Object.keys(res)
    .filter((key) => key !== 'error' && key !== 'status')
    .sort();
}

async function countThroughAlias(manager: IndexManager) {
  const res = await kit.client.count({ index: manager.getAliasName() });
  return res.count;
}

const envelopeKeys = ['error', 'errorKind', 'request', 'response', 'took'];
const createKeys = [
  ...envelopeKeys,
  'success',
  'code',
  'aliasIndexes',
  'indexResponse',
  'aliasResponse',
].sort();
const recreateKeys = [...createKeys, 'dropResponse', 'flushResponse'].sort();
const aliasIfNeededKeys = [
  ...envelopeKeys,
  'success',
  'code',
  'aliasIndexes',
  'aliasResponse',
].sort();
const keysOf = (value: object) => Object.keys(value).sort();

describe('IndexManager.drop() - Integration (B-006)', () => {
  it('should report success when the alias existed', async () => {
    const manager = getManager('drop');
    const created = await manager.create();
    expect(created.code).toBe('CREATED');
    expect(await getAliasTargets(manager.getAliasName())).toEqual([
      manager.getFullName(),
    ]);
    const dropped = await manager.drop();
    expect(dropped.acknowledged).toBe(true);
    expect(dropped.error).toBe(null);
    expect(dropped.errorKind).toBe(null);
    expect((await manager.exists()).exists).toBe(false);
    expect((await manager.aliasExists()).exists).toBe(false);
  });

  it('should report a missing index as a response error', async () => {
    const dropped = await getManager('dropmissing').drop();
    expect(dropped.acknowledged).toBe(false);
    expect(dropped.errorKind).toBe('response');
    expect(dropped.response).toMatchObject({ statusCode: 404 });
  });
});

describe('IndexManager.createIfNeeded() - Integration (B-029, B-030)', () => {
  it('should let two concurrent calls both succeed', async () => {
    const first = getManager('race');
    const second = getManager('race');
    const results = await Promise.all([
      first.createIfNeeded(),
      second.createIfNeeded(),
    ]);
    for (const res of results) {
      expect(res.error).toBe(null);
      expect(res.success).toBe(true);
      expect(['CREATED', 'ALIAS_CREATED', 'ALREADY_EXISTS']).toContain(
        res.code,
      );
    }
    expect(results.map((res) => res.code)).toContain('CREATED');
    expect(await getAliasTargets(first.getAliasName())).toEqual([
      first.getFullName(),
    ]);
  });

  it('should leave the alias on v1 only after a version bump', async () => {
    const v1 = getManager('bump', { version: 1 });
    const created = await v1.create();
    expect(created.error).toBe(null);
    const put = await v1.putBulk(getBooksData(), { refresh: true });
    expect(put.errors).toEqual([]);
    const v2 = getManager('bump', { version: 2 });
    const res = await v2.createIfNeeded();
    expect(res.success).toBe(false);
    expect(res.code).toBe('NEEDS_MIGRATION');
    expect(res.error).toBe(null);
    expect(res.aliasIndexes).toEqual([v1.getFullName()]);
    expect(await getAliasTargets(v1.getAliasName())).toEqual([
      v1.getFullName(),
    ]);
    expect((await v2.exists()).exists).toBe(false);
    // reads and writes through the alias keep working, on v1
    expect(await countThroughAlias(v2)).toBe(3);
    const write = await v2.put('4', { id: '4' });
    expect(write.error).toBe(null);
  });

  it('should leave an alias on a newer version alone', async () => {
    const v3 = getManager('newer', { version: 3 });
    expect((await v3.create()).code).toBe('CREATED');
    const v2 = getManager('newer', { version: 2 });
    const res = await v2.createIfNeeded();
    expect(res.success).toBe(false);
    expect(res.code).toBe('NEWER_VERSION_PRESENT');
    expect(await getAliasTargets(v3.getAliasName())).toEqual([
      v3.getFullName(),
    ]);
    expect((await v2.exists()).exists).toBe(false);
  });

  it('should add the alias when the index exists without it', async () => {
    const manager = getManager('repair');
    const createdOnly = await manager.createOnly();
    expect(createdOnly.error).toBe(null);
    expect((await manager.aliasExists()).exists).toBe(false);
    const res = await manager.createIfNeeded();
    expect(res.success).toBe(true);
    expect(res.code).toBe('ALIAS_CREATED');
    expect(res.error).toBe(null);
    expect(await getAliasTargets(manager.getAliasName())).toEqual([
      manager.getFullName(),
    ]);
    const again = await manager.createIfNeeded();
    expect(again.code).toBe('ALREADY_EXISTS');
  });
});

describe('IndexManager.createAliasIfNeeded() - Integration (B-078, B-029)', () => {
  it('should add a missing alias, then leave it', async () => {
    const manager = getManager('aliasrepair');
    expect((await manager.createOnly()).error).toBe(null);
    const res = await manager.createAliasIfNeeded();
    expect(res.code).toBe('CREATED');
    expect(res.success).toBe(true);
    expect(typeof res.took).toBe('number');
    expect(await getAliasTargets(manager.getAliasName())).toEqual([
      manager.getFullName(),
    ]);
    expect((await manager.createAliasIfNeeded()).code).toBe('ALREADY_EXISTS');
  });

  it('should not add the alias to a second index', async () => {
    const v1 = getManager('aliasbump', { version: 1 });
    expect((await v1.create()).code).toBe('CREATED');
    const v2 = getManager('aliasbump', { version: 2 });
    expect((await v2.createOnly()).error).toBe(null);
    const res = await v2.createAliasIfNeeded();
    expect(res.success).toBe(false);
    expect(res.code).toBe('NEEDS_MIGRATION');
    expect(await getAliasTargets(v1.getAliasName())).toEqual([
      v1.getFullName(),
    ]);
  });
});

describe('IndexManager.recreate() - Integration (B-080)', () => {
  it('should leave an empty, aliased index', async () => {
    const manager = getManager('recreate');
    expect((await manager.create()).code).toBe('CREATED');
    const put = await manager.putBulk(getBooksData(), { refresh: true });
    expect(put.errors).toEqual([]);
    expect(await countThroughAlias(manager)).toBe(3);
    const res = await manager.recreate();
    expect(res.success).toBe(true);
    expect(res.code).toBe('CREATED');
    expect(res.error).toBe(null);
    expect(res.dropResponse?.acknowledged).toBe(true);
    expect(res.flushResponse?.error).toBe(null);
    expect(await countThroughAlias(manager)).toBe(0);
    expect(await getAliasTargets(manager.getAliasName())).toEqual([
      manager.getFullName(),
    ]);
  });

  it('should report a rejected mapping without flushing', async () => {
    const res = await getBadManager('recreatebad').recreate();
    expect(res.success).toBe(false);
    expect(res.code).toBe('CREATE_ERROR');
    expect(res.errorKind).toBe('response');
    expect(res.response).toMatchObject({ statusCode: 400 });
    expect(res.dropResponse).toBe(null);
    expect(res.flushResponse).toBe(null);
  });
});

describe('IndexManager lifecycle envelopes - Integration (B-031)', () => {
  it('should return the same keys on every create() path', async () => {
    const v1 = getManager('keyscreate', { version: 1 });
    const created = await v1.create();
    const duplicate = await v1.create();
    const migrating = await getManager('keyscreate', { version: 2 }).create();
    const rejected = await getBadManager('keyscreatebad').create();
    const all = [created, duplicate, migrating, rejected];
    expect(all.map((r) => r.code)).toEqual([
      'CREATED',
      'CREATE_ERROR',
      'NEEDS_MIGRATION',
      'CREATE_ERROR',
    ]);
    expect(created.error).toBe(null);
    expect(duplicate.errorKind).toBe('response');
    for (const res of all) {
      expect(keysOf(res)).toEqual(createKeys);
    }
  });

  it('should return the same keys on every createIfNeeded() path', async () => {
    const v1 = getManager('keysifneeded', { version: 1 });
    const created = await v1.createIfNeeded();
    const existing = await v1.createIfNeeded();
    const migrating = await getManager('keysifneeded', {
      version: 2,
    }).createIfNeeded();
    const repairing = getManager('keysifneededrepair');
    await repairing.createOnly();
    const repaired = await repairing.createIfNeeded();
    const rejected = await getBadManager('keysifneededbad').createIfNeeded();
    const all = [created, existing, migrating, repaired, rejected];
    expect(all.map((r) => r.code)).toEqual([
      'CREATED',
      'ALREADY_EXISTS',
      'NEEDS_MIGRATION',
      'ALIAS_CREATED',
      'CREATE_ERROR',
    ]);
    for (const res of all) {
      expect(keysOf(res)).toEqual(createKeys);
    }
  });

  it('should return the same keys on every createAliasIfNeeded() path', async () => {
    const manager = getManager('keysalias');
    await manager.createOnly();
    const created = await manager.createAliasIfNeeded();
    const existing = await manager.createAliasIfNeeded();
    const missingIndex =
      await getManager('keysaliasmissing').createAliasIfNeeded();
    const migrating = await getManager('keysalias', {
      version: 2,
    }).createAliasIfNeeded();
    const all = [created, existing, missingIndex, migrating];
    expect(all.map((r) => r.code)).toEqual([
      'CREATED',
      'ALREADY_EXISTS',
      'ALIAS_ERROR',
      'NEEDS_MIGRATION',
    ]);
    expect(missingIndex.errorKind).toBe('response');
    for (const res of all) {
      expect(keysOf(res)).toEqual(aliasIfNeededKeys);
    }
  });

  it('should return the same keys on every recreate() path', async () => {
    const fresh = await getManager('keysrecreate').recreate();
    const again = await getManager('keysrecreate').recreate();
    const rejected = await getBadManager('keysrecreatebad').recreate();
    const all = [fresh, again, rejected];
    expect(all.map((r) => r.code)).toEqual([
      'CREATED',
      'CREATED',
      'CREATE_ERROR',
    ]);
    for (const res of all) {
      expect(keysOf(res)).toEqual(recreateKeys);
    }
  });

  it('should return the same keys from drop() on success and failure', async () => {
    const manager = getManager('keysdrop');
    await manager.create();
    const dropped = await manager.drop();
    const missing = await manager.drop();
    expect(dropped.error).toBe(null);
    expect(missing.errorKind).toBe('response');
    expect(keysOf(missing)).toEqual(keysOf(dropped));
  });
});
