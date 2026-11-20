import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import IndexManager from '../IndexManager/IndexManager';
import type { MigrationProgressDetails } from '../IndexManager/migrate';
import { createTestKit } from '../testFixtures/esTestKit';
import SchemaRegistry from './SchemaRegistry';

// a migration on serverless takes about 15 s (each explicit refresh ~5 s)
setDefaultTimeout(60_000);
const MIGRATION_TEST_MS = 240_000;
/** Bound for a whole registry run, through the registry's own `timeout` */
const RUN_TIMEOUT_MS = 200_000;

const kit = await createTestKit('sr-registry');
const client = kit.client;

afterAll(() => kit.cleanup());

type Doc = { id: string; title: string; extra?: string };

function manager(label: string, version: number, strict = false) {
  return new IndexManager(
    { client, prefix: kit.prefix, version },
    {
      index: label,
      mappings: {
        ...(strict ? { dynamic: 'strict' as const } : {}),
        properties: {
          id: { type: 'keyword' },
          title: { type: 'keyword' },
        },
      },
    },
  );
}

function docs(label: string, count: number): Doc[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    title: `${label} ${i}`,
  }));
}

async function seed(index: IndexManager, rows: Doc[]) {
  const operations: object[] = [];
  for (const row of rows) {
    operations.push({ index: { _index: index.getAliasName(), _id: row.id } });
    operations.push(row);
  }
  const res = await client.bulk({ operations, refresh: true });
  expect(res.errors).toBe(false);
}

async function aliasTargets(index: IndexManager) {
  const meta = await index.getAliasMetadata();
  expect(meta.error).toBe(null);
  return [...meta.indexes].sort();
}

async function countThrough(index: IndexManager) {
  return (await client.count({ index: index.getAliasName() })).count;
}

async function exists(name: string) {
  return client.indices.exists({ index: name });
}

describe('SchemaRegistry - Integration', () => {
  const a1 = manager('a', 1);
  const b1 = manager('b', 1);
  const c1 = manager('c', 1);
  const a2 = manager('a', 2);
  const b2 = manager('b', 2);
  // `d` v1 accepts any field; v2 is strict and rejects the `extra` field
  const d1 = manager('d', 1);
  const d2 = manager('d', 2, true);

  it('migrateIfNeeded() creates every index with its alias', async () => {
    const registry = new SchemaRegistry([a1, b1, c1]);
    const response = await registry.migrateIfNeeded({
      timeout: RUN_TIMEOUT_MS,
    });
    expect(response).toMatchObject({ acknowledged: true, error: null });
    const details = await response.completion;
    expect(details.error).toBe(null);
    expect(details.success).toBe(true);
    expect(details.summary).toEqual({
      [a1.getFullName()]: 'created',
      [b1.getFullName()]: 'created',
      [c1.getFullName()]: 'created',
    });
    for (const entry of details.report) {
      expect(entry.code).toBe('CREATED');
      expect(entry.before?.summary).toBe('needsCreation');
      expect(entry.after?.summary).toBe('current');
    }
    for (const index of [a1, b1, c1]) {
      expect(await aliasTargets(index)).toEqual([index.getFullName()]);
    }
    await seed(a1, docs('a', 4));
    await seed(b1, docs('b', 3));
    await seed(c1, docs('c', 2));
  });

  it(
    'migrateIfNeeded() migrates a version bump on two indexes and leaves the third',
    async () => {
      const registry = new SchemaRegistry([a2, b2, c1]);
      const progress: MigrationProgressDetails[] = [];
      const completed: string[] = [];
      const response = await registry.migrateIfNeeded({
        timeout: RUN_TIMEOUT_MS,
        onProgress: (details) => {
          progress.push(details);
        },
        onComplete: (details) => {
          completed.push(details.newIndex);
        },
      });
      const details = await response.completion;
      expect(details.error).toBe(null);
      expect(details.success).toBe(true);
      expect(details.summary).toEqual({
        [a2.getFullName()]: 'migrated',
        [b2.getFullName()]: 'migrated',
        [c1.getFullName()]: 'unchanged',
      });
      expect(details.report.map((entry) => entry.code)).toEqual([
        'MIGRATED',
        'MIGRATED',
        'CURRENT',
      ]);
      expect(details.report[0].before?.summary).toBe('needsMigration');
      expect(details.report[0].after?.summary).toBe('current');
      expect(details.report[0].migration?.removedIndexes).toEqual([
        a1.getFullName(),
      ]);
      expect(completed).toEqual([a2.getFullName(), b2.getFullName()]);
      const finals = progress.filter((event) => event.phase === 'done');
      expect(finals.map((event) => event.newIndex)).toEqual([
        a2.getFullName(),
        b2.getFullName(),
      ]);
      expect(await aliasTargets(a2)).toEqual([a2.getFullName()]);
      expect(await aliasTargets(b2)).toEqual([b2.getFullName()]);
      expect(await aliasTargets(c1)).toEqual([c1.getFullName()]);
      expect(await exists(a1.getFullName())).toBe(false);
      expect(await exists(b1.getFullName())).toBe(false);
      expect(await countThrough(a2)).toBe(4);
      expect(await countThrough(b2)).toBe(3);
      expect(await countThrough(c1)).toBe(2);
    },
    MIGRATION_TEST_MS,
  );

  it('getStatus() reports every index in registration order', async () => {
    const registry = new SchemaRegistry([c1, b2, a2, d2]);
    const result = await registry.getStatus(4);
    expect(result.error).toBe(null);
    expect(result.success).toBe(true);
    expect(result.report.map((status) => status.fullName)).toEqual([
      c1.getFullName(),
      b2.getFullName(),
      a2.getFullName(),
      d2.getFullName(),
    ]);
    expect(Object.entries(result.summary)).toEqual([
      [c1.getFullName(), 'current'],
      [b2.getFullName(), 'current'],
      [a2.getFullName(), 'current'],
      [d2.getFullName(), 'needsCreation'],
    ]);
  });

  it(
    'one failing migration yields success: false while the others complete',
    async () => {
      // d v1 holds a document with a field the strict v2 mapping rejects
      const created = await d1.create();
      expect(created.success).toBe(true);
      await seed(d1, [...docs('d', 2), { id: 'x', title: 'x', extra: 'no' }]);
      const e = manager('e', 1);
      const registry = new SchemaRegistry([d2, e, c1]);
      const errors: Error[] = [];
      const response = await registry.migrateIfNeeded({
        timeout: RUN_TIMEOUT_MS,
        onError: (error) => {
          errors.push(error);
        },
      });
      const details = await response.completion;
      expect(details.success).toBe(false);
      expect(details.summary).toEqual({
        [d2.getFullName()]: 'failed',
        [e.getFullName()]: 'created',
        [c1.getFullName()]: 'unchanged',
      });
      const failed = details.report[0];
      expect(failed).toMatchObject({
        code: 'REINDEX_FAILED',
        errorKind: 'response',
      });
      expect(failed.migration?.failures[0]?.cause.type).toBe(
        'strict_dynamic_mapping_exception',
      );
      expect(details.error).toBe(failed.error);
      expect(errors).toEqual([failed.error as Error]);
      // the failed index is untouched; its alias stays on v1
      expect(await aliasTargets(d1)).toEqual([d1.getFullName()]);
      expect(await countThrough(d1)).toBe(3);
      expect(await aliasTargets(e)).toEqual([e.getFullName()]);
    },
    MIGRATION_TEST_MS,
  );

  it('recreateAll() empties and recreates every index', async () => {
    const registry = new SchemaRegistry([a2, b2, c1]);
    const result = await registry.recreateAll();
    expect(result.error).toBe(null);
    expect(result.success).toBe(true);
    expect(result.summary).toEqual({
      [a2.getFullName()]: 'CREATED',
      [b2.getFullName()]: 'CREATED',
      [c1.getFullName()]: 'CREATED',
    });
    for (const index of [a2, b2, c1]) {
      expect(await aliasTargets(index)).toEqual([index.getFullName()]);
      expect(await countThrough(index)).toBe(0);
    }
  });

  it('dropAll() drops every registered index and leaves older versions (D6)', async () => {
    // the failed migration left d v2 next to d v1, which the alias points at
    expect(await exists(d2.getFullName())).toBe(true);
    const registry = new SchemaRegistry([a2, b2, c1, d2]);
    const result = await registry.dropAll();
    expect(result.error).toBe(null);
    expect(result.success).toBe(true);
    expect(result.summary).toEqual({
      [a2.getFullName()]: 'DROPPED',
      [b2.getFullName()]: 'DROPPED',
      [c1.getFullName()]: 'DROPPED',
      [d2.getFullName()]: 'DROPPED',
    });
    for (const index of [a2, b2, c1, d2]) {
      expect(await exists(index.getFullName())).toBe(false);
    }
    // only getFullName() is dropped: d v1 and its alias are still there
    expect(await exists(d1.getFullName())).toBe(true);
    expect(await aliasTargets(d1)).toEqual([d1.getFullName()]);
    expect(await countThrough(d1)).toBe(3);
  });

  it('dropAll() reports indexes that are already gone as MISSING', async () => {
    const result = await new SchemaRegistry([a2, b2]).dropAll();
    expect(result.success).toBe(true);
    expect(result.summary).toEqual({
      [a2.getFullName()]: 'MISSING',
      [b2.getFullName()]: 'MISSING',
    });
  });
});
