import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  jest,
  setDefaultTimeout,
} from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { getBooksCreateRequest, getBooksData } from '../testFixtures/books';
import { createTestKit } from '../testFixtures/esTestKit';
import IndexManager, { type MigrationProgressDetails } from './IndexManager';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('indexmanager');

// every index and alias below starts with kit.prefix
afterAll(async () => {
  await kit.cleanup();
});

describe('IndexManager - Integration', () => {
  const booksIndex = new IndexManager(
    {
      client: kit.client,
      version: 1,
      prefix: kit.prefix,
      language: 'english',
    },
    getBooksCreateRequest('books'),
  );

  beforeAll(async () => {
    await booksIndex.drop();
    const created = await booksIndex.create();
    if (created.error) {
      throw created.error;
    }
    await booksIndex.createAlias();
    const bulk = await booksIndex.putBulk(getBooksData(), { refresh: true });
    if (bulk.errors.length > 0) {
      throw new Error(bulk.errors.join('\n'));
    }
  });

  it('should flush, or skip flushing where the server does not allow it', async () => {
    const flush = await booksIndex.flush();
    expect(flush.error).toBe(null);
    expect(flush.success).toBe(true);
  });

  it('should work with no criteria', async () => {
    const found = await booksIndex.findMany();
    if (found.error) {
      throw found.error;
    }
    const ids = found.records.map((r) => r.id).sort();
    expect(ids).toEqual(['1', '2', '3']);
  });

  it('should get count', async () => {
    const res = await booksIndex.run((runner) => {
      runner.builder.matchPhrase({ field: 'title', phrase: 'Chamber' });
      return runner.count();
    });
    expect(res.request).toHaveProperty('index');
    expect(res.request).toHaveProperty('query');
    expect(res.total).toEqual(1);
  });

  it('should put a record and read it back unchanged', async () => {
    const record = {
      id: 900001,
      title: 'Put Round Trip',
      premise: 'A record goes in and the same record comes out',
      country: 'US',
    };
    const put = await booksIndex.put(record.id, record);
    expect(put.error).toBe(null);
    expect(put.result).toBe('created');
    const found = await booksIndex.findById(String(record.id));
    expect(found.error).toBe(null);
    expect(found.record).toEqual(record);
    await booksIndex.deleteById(String(record.id));
  });

  it('should patch only the given fields', async () => {
    const record = {
      id: 900002,
      title: 'Patch Round Trip',
      premise: 'Before',
      country: 'US',
    };
    await booksIndex.put(record.id, record);
    const patched = await booksIndex.patch(String(record.id), {
      premise: 'After',
    });
    expect(patched.error).toBe(null);
    expect(patched.success).toBe(true);
    const found = await booksIndex.findById(String(record.id));
    expect(found.record).toEqual({ ...record, premise: 'After' });
    await booksIndex.deleteById(String(record.id));
  });

  it('should migrate data', async () => {
    // make deletes from earlier tests visible before counting/reindexing
    await booksIndex.client.indices.refresh({
      index: booksIndex.getAliasName(),
    });
    expect((await booksIndex.count()).total).toBe(3);
    booksIndex.index.version = 2;
    expect(booksIndex.getFullName()).toEndWith('~v2');
    const status = await booksIndex.getStatus();
    expect(status.indexExists).toBe(false);
    expect(status.aliasExists).toBe(true);
    expect(status.needsMigration).toBe(true);
    expect(status.needsCreation).toBe(false);

    const onProgress = jest.fn((_details: MigrationProgressDetails) => {});
    const migration = await booksIndex.migrateIfNeeded({
      onProgress,
      // bounds the whole migration; completion resolves with TIMEOUT after it
      timeout: 60_000,
    });
    expect(migration.code).toBe('MIGRATION_STARTED');
    expect(migration.recordsToMigrate).toBe(3);
    expect(migration.createdAlias).toBe(false);
    expect(migration.createdIndex).toBe(true);

    const outcome = await migration.completion;
    expect(outcome.error).toBe(null);
    expect(outcome).toMatchObject({ success: true, code: 'MIGRATED' });
    const alias = await booksIndex.getAliasMetadata();
    expect(alias.indexes).toEqual([booksIndex.getFullName()]);

    expect((await booksIndex.count()).total).toBe(3);
    expect(onProgress).toHaveBeenCalled();
    const calls = onProgress.mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall.done).toBe(3);
    expect(lastCall.total).toBe(3);
    expect(lastCall.percent).toBe(100);
    const { total } = await booksIndex.count((qb) => {
      qb.matchPhrase({ field: 'title', phrase: 'Chamber' });
    });
    expect(total).toEqual(1);
  }, 90_000);
});

describe('IndexManager.create() - Integration', () => {
  const create = getBooksCreateRequest('books_spec');
  const index = new IndexManager(
    { client: kit.client, prefix: kit.prefix },
    {
      ...create,
      settings: {
        analysis: {
          analyzer: {
            englishplus: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'asciifolding'],
            },
          },
        },
      },
      mappings: {
        ...create.mappings,
        properties: {
          ...create.mappings?.properties,
          premise: {
            type: 'text',
            analyzer: 'englishplus',
            fields: { exact: { type: 'keyword', ignore_above: 256 } },
          },
        },
      },
    },
  );

  it('should send the settings and mappings of the specification', async () => {
    const created = await index.create();
    expect(created.error).toBe(null);
    expect(created.success).toBe(true);
    const meta = await index.getIndexMetadata();
    if (meta.error) {
      throw meta.error;
    }
    expect(meta.name).toBe(index.getFullName());
    // narrowed by meta.error under strictNullChecks; the cast also covers
    // non-strict compilers, where error: null does not narrow
    const response = meta.response as estypes.IndicesGetResponse;
    const state = response[index.getFullName()];
    expect(state?.settings?.index?.analysis?.analyzer).toHaveProperty(
      'englishplus',
    );
    expect(state?.mappings?.properties?.premise).toEqual({
      type: 'text',
      analyzer: 'englishplus',
      fields: { exact: { type: 'keyword', ignore_above: 256 } },
    });
    // a sub-field from the books fixture, passed through untouched
    expect(state?.mappings?.properties?.title).toMatchObject({
      fields: { fvh: { type: 'text', term_vector: 'with_positions_offsets' } },
    });
    expect(await index.aliasExists()).toMatchObject({ exists: true });
  });
});
