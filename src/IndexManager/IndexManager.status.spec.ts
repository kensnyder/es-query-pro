import { describe, expect, expectTypeOf, it } from 'bun:test';
import type { Client } from '@elastic/elasticsearch';
import {
  connectionError,
  getRecordingClient,
  responseError,
} from '../testFixtures/recordingClient';
import IndexManager, {
  type IndexErrorKind,
  type SiblingIndexes,
  type StatusReport,
  type StatusSummary,
} from './IndexManager';

const V1 = 'test~english~books~v1';
const V2 = 'test~english~books~v2';
const V3 = 'test~english~books~v3';
const V9 = 'test~english~books~v9';
const V10 = 'test~english~books~v10';
const V2024A = 'test~english~books~v2024a';
const OTHER = 'test~english~movies~v1';
const FOREIGN = 'some-hand-made-index';
const ALIAS = 'test~english~books';

const booksCreate = {
  index: 'books',
  mappings: { properties: { id: { type: 'keyword' } } },
} as const;

/** A books manager at `version` (default 2) */
function getBooks(client: Client, version: number | string = 2) {
  return new IndexManager(
    { client, version, prefix: 'test', serverless: false },
    booksCreate,
  );
}

/** The 404 Elasticsearch sends for `GET /_alias/<name>` with no such alias */
const aliasMissing = {
  status: 404,
  body: { error: `alias [${ALIAS}] missing`, status: 404 },
};

/** The `GET /_alias/<name>` response for an alias on the given indexes */
function aliasOn(...indexes: string[]) {
  const body: Record<string, unknown> = {};
  for (const index of indexes) {
    body[index] = { aliases: { [ALIAS]: {} } };
  }
  return { body };
}

/**
 * A recording client where the version-2 index does (or does not) exist and
 * the alias points at `aliasIndexes` (missing when empty)
 */
function getClient(indexExists: boolean, aliasIndexes: string[] = []) {
  const recording = getRecordingClient();
  recording.script(`HEAD /${V2}`, { status: indexExists ? 200 : 404 });
  if (aliasIndexes.length === 0) {
    recording.script(`GET /_alias/${ALIAS}`, aliasMissing);
  } else {
    recording.script(`GET /_alias/${ALIAS}`, aliasOn(...aliasIndexes));
  }
  return recording;
}

const noSiblings: SiblingIndexes = {
  all: [],
  older: [],
  newer: [],
  incomparable: [],
  unrelated: [],
};

describe('IndexManager.getStatus() states', () => {
  it('should report needsCreation when neither index nor alias exists', async () => {
    const { client } = getClient(false);
    const status = await getBooks(client).getStatus();
    expect(status).toMatchObject({
      fullName: V2,
      aliasName: ALIAS,
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
    expect(status.took).toBeNumber();
  });

  it('should report current when the alias points at this index only', async () => {
    const { client } = getClient(true, [V2]);
    const status = await getBooks(client).getStatus();
    expect(status).toMatchObject({
      indexExists: true,
      aliasExists: true,
      aliasIndexes: [V2],
      aliasAttached: true,
      siblings: noSiblings,
      needsCreation: false,
      needsMigration: false,
      summary: 'current',
      error: null,
    });
  });

  it('should report needsAlias for an index without its alias', async () => {
    const { client } = getClient(true);
    const status = await getBooks(client).getStatus();
    expect(status).toMatchObject({
      indexExists: true,
      aliasExists: false,
      aliasAttached: false,
      needsCreation: false,
      needsMigration: false,
      summary: 'needsAlias',
      error: null,
    });
  });

  it('should report needsMigration for an alias on an older version', async () => {
    const { client } = getClient(false, [V1]);
    const status = await getBooks(client).getStatus();
    expect(status).toMatchObject({
      indexExists: false,
      aliasExists: true,
      aliasIndexes: [V1],
      aliasAttached: false,
      siblings: { ...noSiblings, all: [V1], older: [V1] },
      needsCreation: false,
      needsMigration: true,
      summary: 'needsMigration',
      error: null,
    });
  });

  it('should still need migration when the alias is on this and an older version', async () => {
    const { client } = getClient(true, [V1, V2]);
    const status = await getBooks(client).getStatus();
    expect(status.aliasAttached).toBe(true);
    expect(status.siblings.older).toEqual([V1]);
    expect(status.summary).toBe('needsMigration');
  });

  it('should report newerVersionPresent, not needsMigration, for an alias on a newer version (B-008)', async () => {
    const { client } = getClient(false, [V3]);
    const status = await getBooks(client).getStatus();
    expect(status).toMatchObject({
      indexExists: false,
      aliasExists: true,
      siblings: { ...noSiblings, all: [V3], newer: [V3] },
      needsCreation: false,
      needsMigration: false,
      summary: 'newerVersionPresent',
      error: null,
    });
  });

  it('should report aliasConflict, not needsMigration, for an alias on an unrelated index (B-008)', async () => {
    const { client } = getClient(false, [FOREIGN, OTHER]);
    const status = await getBooks(client).getStatus();
    expect(status).toMatchObject({
      siblings: {
        ...noSiblings,
        all: [FOREIGN, OTHER],
        unrelated: [OTHER, FOREIGN].sort(),
      },
      needsCreation: false,
      needsMigration: false,
      summary: 'aliasConflict',
      error: null,
    });
  });

  it('should put versions that cannot be ordered in their own category', async () => {
    const { client } = getClient(false, [V2024A]);
    const status = await getBooks(client).getStatus();
    expect(status.siblings).toEqual({
      ...noSiblings,
      all: [V2024A],
      incomparable: [V2024A],
    });
    // like createIfNeeded()'s NEEDS_MIGRATION; migrateIfNeeded() decides
    expect(status.summary).toBe('needsMigration');
    expect(status.needsMigration).toBe(true);
  });

  it('should let a newer version win over older and unrelated siblings', async () => {
    const { client } = getClient(false, [V1, FOREIGN, V3]);
    const status = await getBooks(client).getStatus();
    expect(status.summary).toBe('newerVersionPresent');
    expect(status.siblings).toEqual({
      all: [V1, FOREIGN, V3],
      older: [V1],
      newer: [V3],
      incomparable: [],
      unrelated: [FOREIGN],
    });
  });

  it('should prefer needsMigration over aliasConflict when older versions are present', async () => {
    const { client } = getClient(false, [FOREIGN, V1]);
    const status = await getBooks(client).getStatus();
    expect(status.summary).toBe('needsMigration');
    expect(status.siblings.unrelated).toEqual([FOREIGN]);
  });

  it('should order older and newer versions numerically, oldest first', async () => {
    const recording = getRecordingClient();
    const v5 = 'test~english~books~v5';
    const v11 = 'test~english~books~v11';
    recording.script(`HEAD /${v5}`, { status: 404 });
    recording.script(`GET /_alias/${ALIAS}`, aliasOn(V10, V1, v11, V9, V3));
    const status = await getBooks(recording.client, 5).getStatus();
    expect(status.siblings.older).toEqual([V1, V3]);
    expect(status.siblings.newer).toEqual([V9, V10, v11]);
  });
});

describe('IndexManager.getStatus() errors (B-035)', () => {
  it('should report unknown, not needsCreation, when the cluster is unreachable', async () => {
    const { client, script } = getRecordingClient();
    script(/.*/, connectionError());
    const status = await getBooks(client).getStatus();
    expect(status).toMatchObject({
      indexExists: null,
      aliasExists: null,
      aliasIndexes: [],
      aliasAttached: null,
      siblings: noSiblings,
      needsCreation: false,
      needsMigration: false,
      summary: 'unknown',
      errorKind: 'connection',
    });
    expect(status.error).toBeInstanceOf(Error);
    expect(status.error?.name).toBe('ConnectionError');
  });

  it('should report unknown when only the alias lookup fails', async () => {
    const { client, script } = getClient(false);
    script(`GET /_alias/${ALIAS}`, responseError(403, 'security_exception'));
    const status = await getBooks(client).getStatus();
    expect(status).toMatchObject({
      indexExists: false,
      aliasExists: null,
      aliasAttached: null,
      needsCreation: false,
      needsMigration: false,
      summary: 'unknown',
      errorKind: 'response',
    });
    expect(status.error?.message).toContain('security_exception');
  });

  it('should report unknown when only the index check fails', async () => {
    const { client, script } = getClient(false, [V1]);
    script(`HEAD /${V2}`, { status: 500 });
    const status = await getBooks(client).getStatus();
    expect(status).toMatchObject({
      indexExists: null,
      aliasExists: true,
      siblings: { ...noSiblings, all: [V1], older: [V1] },
      needsCreation: false,
      needsMigration: false,
      summary: 'unknown',
      errorKind: 'response',
    });
  });

  it('should report unknown for an alias 404 without the "missing" body', async () => {
    const { client, script } = getClient(false);
    script(`GET /_alias/${ALIAS}`, { status: 404, body: {} });
    const status = await getBooks(client).getStatus();
    expect(status.summary).toBe('unknown');
    expect(status.needsCreation).toBe(false);
  });

  it('should have the same keys on success and failure', async () => {
    const ok = await getBooks(getClient(true, [V2]).client).getStatus();
    const { client, script } = getRecordingClient();
    script(/.*/, connectionError());
    const failed = await getBooks(client).getStatus();
    expect(Object.keys(failed).sort()).toEqual(Object.keys(ok).sort());
  });
});

describe('IndexManager.getStatus() requests (S-041)', () => {
  it('should send one index check and one alias lookup', async () => {
    const { client, sent } = getClient(false, [V1]);
    await getBooks(client).getStatus();
    const lines = sent.map((r) => `${r.method} ${decodeURIComponent(r.path)}`);
    expect(lines.sort()).toEqual([`GET /_alias/${ALIAS}`, `HEAD /${V2}`]);
  });

  it('should run the checks in parallel', async () => {
    const started: string[] = [];
    const release: (() => void)[] = [];
    const wait = <T>(name: string, value: T) => {
      started.push(name);
      return new Promise<T>((resolve) => {
        release.push(() => resolve(value));
      });
    };
    const client = {
      indices: {
        exists: () => wait('exists', false),
        getAlias: () => wait('getAlias', { [V1]: { aliases: {} } }),
      },
    } as unknown as Client;
    const pending = getBooks(client).getStatus();
    // both requests are in flight before either answers
    await Promise.resolve();
    await Promise.resolve();
    expect(started.sort()).toEqual(['exists', 'getAlias']);
    for (const done of release) {
      done();
    }
    const status = await pending;
    expect(status.summary).toBe('needsMigration');
  });

  it('should never reject, even if the client throws synchronously', async () => {
    const client = {
      indices: {
        exists: () => {
          throw new TypeError('boom');
        },
        getAlias: () => {
          throw new TypeError('boom');
        },
      },
    } as unknown as Client;
    const status = await getBooks(client).getStatus();
    expect(status.summary).toBe('unknown');
    expect(status.errorKind).toBe('javascript');
  });
});

describe('IndexManager.needsCreation() (B-038)', () => {
  it('should be true when neither index nor alias exists', async () => {
    const { client } = getClient(false);
    expect(await getBooks(client).needsCreation()).toBe(true);
  });

  it('should be false when the index exists', async () => {
    const { client } = getClient(true, [V2]);
    expect(await getBooks(client).needsCreation()).toBe(false);
  });

  it('should be false when an older version needs migrating instead', async () => {
    const { client } = getClient(false, [V1]);
    expect(await getBooks(client).needsCreation()).toBe(false);
  });

  it('should be null when the checks fail (B-035)', async () => {
    const { client, script } = getRecordingClient();
    script(/.*/, connectionError());
    expect(await getBooks(client).needsCreation()).toBe(null);
  });
});

describe('IndexManager.needsMigration() (B-008)', () => {
  it('should be true for an alias on an older version', async () => {
    const { client } = getClient(false, [V1]);
    expect(await getBooks(client).needsMigration()).toBe(true);
  });

  it('should be false for an alias on a newer version', async () => {
    const { client } = getClient(false, [V3]);
    expect(await getBooks(client).needsMigration()).toBe(false);
  });

  it('should be false for an alias on an unrelated index', async () => {
    const { client } = getClient(false, [OTHER]);
    expect(await getBooks(client).needsMigration()).toBe(false);
  });

  it('should be false for an alias on this index only', async () => {
    const { client } = getClient(true, [V2]);
    expect(await getBooks(client).needsMigration()).toBe(false);
  });

  it('should be null when the alias lookup fails (B-035)', async () => {
    const { client, script } = getRecordingClient();
    script(/.*/, connectionError());
    expect(await getBooks(client).needsMigration()).toBe(null);
  });
});

describe('IndexManager.getSiblingIndexes() (B-008, B-035)', () => {
  it('should classify every other index on the alias', async () => {
    const { client } = getClient(true, [V1, V2, V3, V2024A, OTHER]);
    const res = await getBooks(client).getSiblingIndexes();
    expect(res).toMatchObject({
      success: true,
      aliasIndexes: [V1, V2, V3, V2024A, OTHER],
      siblings: {
        all: [V1, V3, V2024A, OTHER],
        older: [V1],
        newer: [V3],
        incomparable: [V2024A],
        unrelated: [OTHER],
      },
      error: null,
      errorKind: null,
    });
    expect(res.request.endpoint).toBe(`/_alias/${ALIAS}`);
  });

  it('should classify by this manager’s separator', async () => {
    const recording = getRecordingClient();
    const full = 'test.english.books.v2';
    recording.script('GET /_alias/test.english.books', {
      body: {
        'test.english.books.v1': {},
        [V1]: {},
        [full]: {},
      },
    });
    const index = new IndexManager(
      { client: recording.client, prefix: 'test', separator: '.', version: 2 },
      booksCreate,
    );
    const res = await index.getSiblingIndexes();
    expect(res.siblings.older).toEqual(['test.english.books.v1']);
    expect(res.siblings.unrelated).toEqual([V1]);
  });

  it('should return no siblings when the alias is missing', async () => {
    const { client } = getClient(false);
    const res = await getBooks(client).getSiblingIndexes();
    expect(res.success).toBe(true);
    expect(res.siblings).toEqual(noSiblings);
  });

  it('should return an error envelope when the lookup fails', async () => {
    const { client, script } = getRecordingClient();
    script(/.*/, connectionError());
    const res = await getBooks(client).getSiblingIndexes();
    expect(res.success).toBe(false);
    expect(res.siblings).toEqual(noSiblings);
    expect(res.errorKind).toBe('connection');
    expect(res.error).toBeInstanceOf(Error);
  });
});

describe('StatusReport type', () => {
  it('should expose the summary states and the envelope', () => {
    expectTypeOf<StatusReport['summary']>().toEqualTypeOf<StatusSummary>();
    expectTypeOf<StatusSummary>().toEqualTypeOf<
      | 'needsCreation'
      | 'needsMigration'
      | 'needsAlias'
      | 'newerVersionPresent'
      | 'aliasConflict'
      | 'current'
      | 'unknown'
    >();
    expectTypeOf<StatusReport['error']>().toEqualTypeOf<Error | null>();
    expectTypeOf<
      StatusReport['errorKind']
    >().toEqualTypeOf<IndexErrorKind | null>();
    expectTypeOf<StatusReport['siblings']>().toEqualTypeOf<SiblingIndexes>();
    expectTypeOf<
      Awaited<ReturnType<IndexManager['needsCreation']>>
    >().toEqualTypeOf<boolean | null>();
  });
});
