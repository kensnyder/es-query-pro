import { describe, expect, it, spyOn } from 'bun:test';
import type IndexManager from '../IndexManager/IndexManager';
import type {
  IndexErrorKind,
  MigrationCode,
  MigrationOutcome,
  MigrationOutcomeCode,
  MigrationParams,
  MigrationResult,
  StatusReport,
  StatusSummary,
} from '../IndexManager/IndexManager';
import SchemaRegistry, { type SchemaMigrationOutcome } from './SchemaRegistry';

function status(name: string, summary: StatusSummary): StatusReport {
  const failed = summary === 'unknown';
  return {
    took: 0,
    fullName: `${name}~v2`,
    aliasName: name,
    indexExists: failed ? null : summary !== 'needsCreation',
    aliasExists: failed ? null : summary !== 'needsCreation',
    aliasIndexes: [],
    aliasAttached: failed ? null : summary === 'current',
    siblings: {
      all: [],
      older: [],
      newer: [],
      incomparable: [],
      unrelated: [],
    },
    needsMigration: summary === 'needsMigration',
    needsCreation: summary === 'needsCreation',
    summary,
    error: failed ? new Error('status failed') : null,
    errorKind: failed ? 'connection' : null,
  };
}

const SUCCESS_CODES: MigrationCode[] = [
  'CREATED',
  'ALIAS_CREATED',
  'CURRENT',
  'MIGRATION_STARTED',
  'MIGRATION_RESUMED',
];

function outcome(
  name: string,
  code: MigrationOutcomeCode,
  error: Error | null = null,
  errorKind: IndexErrorKind | null = null,
): MigrationOutcome {
  const success = ['CREATED', 'ALIAS_CREATED', 'CURRENT', 'MIGRATED'].includes(
    code,
  );
  return {
    success,
    code,
    phase: success ? 'done' : 'reindex',
    oldIndexes: [],
    newIndex: `${name}~v2`,
    alias: name,
    swapped: false,
    removedIndexes: [],
    passes: [],
    taskIds: [],
    cancelled: false,
    counts: null,
    failures: [],
    cleanupErrors: [],
    took: 0,
    error,
    errorKind: error ? (errorKind ?? 'response') : null,
  };
}

type FakeMigration = {
  code: MigrationCode;
  before?: StatusSummary;
  error?: Error | null;
  /** Defaults to an already-settled outcome with the same code */
  completion?: Promise<MigrationOutcome>;
};

function result(name: string, fake: FakeMigration): MigrationResult {
  const error = fake.error ?? null;
  const immediate = fake.code as MigrationOutcomeCode;
  return {
    success: SUCCESS_CODES.includes(fake.code),
    code: fake.code,
    status: status(name, fake.before ?? 'current'),
    newName: `${name}~v2`,
    aliasName: name,
    oldNames: [],
    recordsToMigrate: 0,
    createdIndex: false,
    createdAlias: false,
    resumed: false,
    attached: false,
    taskId: null,
    request: null,
    completion:
      fake.completion ?? Promise.resolve(outcome(name, immediate, error)),
    took: 0,
    error,
    errorKind: error ? 'response' : null,
    response: null,
  };
}

/**
 * Build a stand-in IndexManager
 * @param name  Alias name; full name is `${name}~v2`
 * @param migrate  Stand-in for IndexManager.migrateIfNeeded
 * @param after  Summary returned by getStatus() after migrating
 */
function fakeIndex(
  name: string,
  migrate: (
    params: MigrationParams,
  ) => FakeMigration | Promise<FakeMigration> = () => ({ code: 'CURRENT' }),
  after: StatusSummary = 'current',
) {
  const calls = { getStatus: 0, migrateIfNeeded: 0 };
  const params: MigrationParams[] = [];
  const index = {
    index: { version: 2 },
    getFullName: () => `${name}~v2`,
    getAliasName: () => name,
    getStatus: async () => {
      calls.getStatus++;
      return status(name, after);
    },
    migrateIfNeeded: async (given: MigrationParams) => {
      calls.migrateIfNeeded++;
      params.push(given);
      return result(name, await migrate(given));
    },
  };
  return { index: index as unknown as IndexManager, calls, params };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SchemaRegistry.migrateIfNeeded', () => {
  it('should return an error envelope when no indexes are registered (S-031)', async () => {
    const onAllComplete = spyOn({ fn: () => {} }, 'fn');
    const response = await new SchemaRegistry().migrateIfNeeded({
      onAllComplete,
    });
    expect(response.acknowledged).toBe(false);
    expect(response.error).toBeInstanceOf(Error);
    expect(response.errorKind).toBe('configuration');
    const details = await response.completion;
    expect(details).toMatchObject({
      success: false,
      report: [],
      summary: {},
      error: response.error,
      errorKind: 'configuration',
    });
    expect(onAllComplete).not.toHaveBeenCalled();
  });

  it('should acknowledge before the work finishes', async () => {
    const gate = deferred<void>();
    const { index } = fakeIndex('books', async () => {
      await gate.promise;
      return { code: 'CURRENT' };
    });
    const onAllComplete = spyOn({ fn: () => {} }, 'fn');
    const response = await new SchemaRegistry([index]).migrateIfNeeded({
      onAllComplete,
    });
    expect(response.acknowledged).toBe(true);
    expect(response.error).toBeNull();
    expect(response.errorKind).toBeNull();
    await tick();
    expect(onAllComplete).not.toHaveBeenCalled();
    gate.resolve();
    await response.completion;
    expect(onAllComplete).toHaveBeenCalledTimes(1);
  });

  it('should map each result code to an outcome', async () => {
    const cases: Array<[MigrationCode, SchemaMigrationOutcome]> = [
      ['CURRENT', 'unchanged'],
      ['CREATED', 'created'],
      ['ALIAS_CREATED', 'created'],
    ];
    for (const [code, expected] of cases) {
      const { index } = fakeIndex('books', () => ({ code }));
      const { completion } = await new SchemaRegistry([
        index,
      ]).migrateIfNeeded();
      const details = await completion;
      expect(details.success).toBe(true);
      expect(details.summary).toEqual({ 'books~v2': expected });
      expect(details.report[0]).toMatchObject({ code, error: null });
    }
  });

  it('should report up-to-date indexes as unchanged with before and after', async () => {
    const { index, calls } = fakeIndex('books');
    const onError = spyOn({ fn: () => {} }, 'fn');
    const { completion } = await new SchemaRegistry([index]).migrateIfNeeded({
      onError,
    });
    const details = await completion;
    expect(details).toMatchObject({ success: true, error: null });
    expect(details.report[0]).toMatchObject({
      fullName: 'books~v2',
      aliasName: 'books',
      outcome: 'unchanged',
      code: 'CURRENT',
      error: null,
      errorKind: null,
    });
    expect(details.report[0].migration?.code).toBe('CURRENT');
    // before comes from the migration's own status check
    expect(details.report[0].before?.summary).toBe('current');
    expect(details.report[0].after?.summary).toBe('current');
    expect(calls.getStatus).toBe(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('should pass every migration option to each index', async () => {
    const { index, params } = fakeIndex('books');
    const registry = new SchemaRegistry([index]);
    await (await registry.migrateIfNeeded()).completion;
    await (
      await registry.migrateIfNeeded({
        slices: 'auto',
        pollInterval: 250,
        maxPollErrors: 3,
        requestsPerSecond: 10,
        batchSize: 50,
      })
    ).completion;
    expect(params[0]).toMatchObject({ slices: 1, pollInterval: 1000 });
    expect(params[0].timeout).toBeUndefined();
    expect(params[1]).toMatchObject({
      slices: 'auto',
      pollInterval: 250,
      maxPollErrors: 3,
      requestsPerSecond: 10,
      batchSize: 50,
    });
  });

  it('should wait for completion, not for percent === 100 events (S-061)', async () => {
    const done = deferred<MigrationOutcome>();
    const a = fakeIndex(
      'a',
      () => ({
        code: 'MIGRATION_STARTED',
        before: 'needsMigration',
        completion: done.promise,
      }),
      'current',
    );
    const b = fakeIndex('b');
    let settled = false;
    const { completion } = await new SchemaRegistry([
      a.index,
      b.index,
    ]).migrateIfNeeded();
    completion.then(() => {
      settled = true;
    });
    await tick();
    // a progress event with percent 100 alone must not finish the index
    a.params[0].onProgress?.({
      done: 1,
      total: 1,
      percent: 100,
      taskId: 't',
      oldIndex: 'a~v1',
      newIndex: 'a~v2',
      alias: 'a',
      phase: 'done',
      failures: [],
    });
    await tick();
    expect(settled).toBe(false);
    // one at a time: b waits for a's completion
    expect(b.calls.migrateIfNeeded).toBe(0);
    done.resolve(outcome('a', 'MIGRATED'));
    const details = await completion;
    expect(b.calls.migrateIfNeeded).toBe(1);
    expect(details.success).toBe(true);
    expect(details.summary).toEqual({
      'a~v2': 'migrated',
      'b~v2': 'unchanged',
    });
    expect(details.report[0]).toMatchObject({
      code: 'MIGRATED',
      outcome: 'migrated',
    });
    expect(details.report[0].before?.summary).toBe('needsMigration');
    expect(details.report[0].after?.summary).toBe('current');
  });

  it('should migrate indexes in registration order', async () => {
    const order: string[] = [];
    const make = (name: string) =>
      fakeIndex(name, () => {
        order.push(name);
        return { code: 'CURRENT' };
      });
    const registry = new SchemaRegistry([
      make('c').index,
      make('a').index,
      make('b').index,
    ]);
    const details = await (await registry.migrateIfNeeded()).completion;
    expect(order).toEqual(['c', 'a', 'b']);
    expect(details.report.map((entry) => entry.fullName)).toEqual([
      'c~v2',
      'a~v2',
      'b~v2',
    ]);
    expect(Object.keys(details.summary)).toEqual(['c~v2', 'a~v2', 'b~v2']);
  });

  it('should fail an index whose migration fails and continue', async () => {
    const boom = new Error('reindex failed');
    const a = fakeIndex(
      'a',
      ({ onError }) => {
        // IndexManager calls onError once, and completion carries the error
        const completion = Promise.resolve(
          outcome('a', 'REINDEX_FAILED', boom),
        ).then((value) => {
          onError?.(boom);
          return value;
        });
        return {
          code: 'MIGRATION_STARTED',
          before: 'needsMigration',
          completion,
        };
      },
      'needsMigration',
    );
    const b = fakeIndex('b', () => ({ code: 'CREATED' }));
    const onError = spyOn({ fn: (_: Error) => {} }, 'fn');
    const onAllComplete = spyOn({ fn: () => {} }, 'fn');
    const registry = new SchemaRegistry([a.index, b.index]);
    const { completion } = await registry.migrateIfNeeded({
      onError,
      onAllComplete,
    });
    const details = await completion;
    expect(details.success).toBe(false);
    expect(details.error).toBe(boom);
    expect(details.errorKind).toBe('response');
    expect(details.summary).toEqual({ 'a~v2': 'failed', 'b~v2': 'created' });
    expect(details.report[0]).toMatchObject({
      outcome: 'failed',
      code: 'REINDEX_FAILED',
      error: boom,
      errorKind: 'response',
    });
    expect(details.report[0].after?.summary).toBe('needsMigration');
    expect(details.report[1].error).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
    expect(onAllComplete).toHaveBeenCalledTimes(1);
    expect(onAllComplete).toHaveBeenCalledWith(details);
  });

  it('should forward an immediate error once', async () => {
    const boom = new Error('create failed');
    const { index } = fakeIndex('books', ({ onError }) => {
      onError?.(boom);
      return { code: 'CREATE_ERROR', error: boom, before: 'needsCreation' };
    });
    const onError = spyOn({ fn: (_: Error) => {} }, 'fn');
    const { completion } = await new SchemaRegistry([index]).migrateIfNeeded({
      onError,
    });
    const details = await completion;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
    expect(details.report[0]).toMatchObject({
      outcome: 'failed',
      code: 'CREATE_ERROR',
      error: boom,
    });
  });

  it('should forward an error IndexManager did not report itself', async () => {
    const boom = new Error('status failed');
    const { index } = fakeIndex('books', () => ({
      code: 'STATUS_ERROR',
      error: boom,
      before: 'unknown',
    }));
    const onError = spyOn({ fn: (_: Error) => {} }, 'fn');
    const { completion } = await new SchemaRegistry([index]).migrateIfNeeded({
      onError,
    });
    const details = await completion;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
    expect(details.report[0].before?.summary).toBe('unknown');
  });

  for (const code of [
    'NEWER_VERSION_PRESENT',
    'INCOMPARABLE_VERSION',
    'ALIAS_CONFLICT',
  ] as const) {
    it(`should count ${code} as failed without an error`, async () => {
      const { index } = fakeIndex('books', () => ({ code }));
      const onError = spyOn({ fn: (_: Error) => {} }, 'fn');
      const { completion } = await new SchemaRegistry([index]).migrateIfNeeded({
        onError,
      });
      const details = await completion;
      expect(details.success).toBe(false);
      expect(details.error).toBeNull();
      expect(details.report[0]).toMatchObject({
        outcome: 'failed',
        code,
        error: null,
      });
      expect(onError).not.toHaveBeenCalled();
    });
  }

  it('should fail an index whose migrateIfNeeded() rejects', async () => {
    const boom = new Error('bug');
    const a = fakeIndex('a', () => {
      throw boom;
    });
    const b = fakeIndex('b');
    const onError = spyOn({ fn: (_: Error) => {} }, 'fn');
    const registry = new SchemaRegistry([a.index, b.index]);
    const { completion } = await registry.migrateIfNeeded({ onError });
    const details = await completion;
    expect(details.report[0]).toMatchObject({
      outcome: 'failed',
      code: null,
      before: null,
      after: null,
      migration: null,
      error: boom,
      errorKind: 'javascript',
    });
    expect(details.summary).toEqual({ 'a~v2': 'failed', 'b~v2': 'unchanged' });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('should fail an index whose completion rejects', async () => {
    const { index } = fakeIndex('a', () => ({
      code: 'MIGRATION_STARTED',
      completion: Promise.reject(new Error('rejected')),
    }));
    const { completion } = await new SchemaRegistry([index]).migrateIfNeeded();
    const details = await completion;
    expect(details.report[0]).toMatchObject({
      outcome: 'failed',
      code: null,
      errorKind: 'javascript',
    });
    expect(details.report[0].error?.message).toBe('rejected');
  });

  it('should give each index the time left and skip the rest after the timeout (S-061)', async () => {
    // a stand-in for IndexManager's own timeout: completion settles with
    // TIMEOUT when the given timeout expires
    const a = fakeIndex('a', ({ timeout }) => {
      const timedOut = new Promise<MigrationOutcome>((resolve) => {
        setTimeout(() => {
          const error = new Error('timed out');
          error.name = 'MigrationTimeoutError';
          resolve(outcome('a', 'TIMEOUT', error, 'timeout'));
        }, timeout);
      });
      return { code: 'MIGRATION_STARTED', completion: timedOut };
    });
    const b = fakeIndex('b');
    const onError = spyOn({ fn: (_: Error) => {} }, 'fn');
    const registry = new SchemaRegistry([a.index, b.index]);
    const { completion } = await registry.migrateIfNeeded({
      timeout: 30,
      onError,
    });
    const details = await completion;
    expect(a.params[0].timeout).toBeGreaterThan(0);
    expect(a.params[0].timeout).toBeLessThanOrEqual(30);
    expect(b.calls.migrateIfNeeded).toBe(0);
    expect(details.success).toBe(false);
    expect(details.summary).toEqual({ 'a~v2': 'failed', 'b~v2': 'failed' });
    expect(details.report[0]).toMatchObject({
      code: 'TIMEOUT',
      errorKind: 'timeout',
    });
    expect(details.report[1]).toMatchObject({
      code: 'TIMEOUT',
      errorKind: 'timeout',
      before: null,
      after: null,
      migration: null,
    });
    expect(details.report[1].error?.name).toBe('MigrationTimeoutError');
    // one call per distinct error
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('should ignore callbacks that throw', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const a = fakeIndex('a', () => ({
        code: 'CREATE_ERROR',
        error: new Error('boom'),
      }));
      const b = fakeIndex('b');
      const registry = new SchemaRegistry([a.index, b.index]);
      const { completion } = await registry.migrateIfNeeded({
        onError: () => {
          throw new Error('onError threw');
        },
        onAllComplete: () => {
          throw new Error('onAllComplete threw');
        },
      });
      const details = await completion;
      expect(details.summary).toEqual({
        'a~v2': 'failed',
        'b~v2': 'unchanged',
      });
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('should return an error envelope for an invalid timeout', async () => {
    const { index, calls } = fakeIndex('a');
    for (const timeout of [0, -5, Number.NaN]) {
      const response = await new SchemaRegistry([index]).migrateIfNeeded({
        timeout,
      });
      expect(response.acknowledged).toBe(false);
      expect(response.error).toBeInstanceOf(RangeError);
      expect(response.errorKind).toBe('configuration');
      expect((await response.completion).success).toBe(false);
    }
    expect(calls.migrateIfNeeded).toBe(0);
  });
});
