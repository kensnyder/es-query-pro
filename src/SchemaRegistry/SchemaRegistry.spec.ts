import { describe, expect, it, spyOn } from 'bun:test';
import type IndexManager from '../IndexManager/IndexManager';
import type {
  MigrationParams,
  MigrationProgressDetails,
  StatusReport,
} from '../IndexManager/IndexManager';
import SchemaRegistry from './SchemaRegistry';

type Summary = StatusReport['summary'];
type MigrateResult = {
  error: Error | null;
  recordsToMigrate: number;
  oldNames: string[];
};

function status(name: string, summary: Summary): StatusReport {
  return {
    took: 0,
    fullName: `${name}~v2`,
    aliasName: name,
    indexExists: summary !== 'needsCreation',
    aliasExists: summary !== 'needsCreation',
    needsMigration: summary === 'needsMigration',
    needsCreation: summary === 'needsCreation',
    summary,
  };
}

function progress(
  name: string,
  oldIndex: string,
  percent: number,
): MigrationProgressDetails {
  return {
    done: percent,
    total: 100,
    percent,
    taskId: 'task',
    oldIndex,
    newIndex: `${name}~v2`,
    alias: name,
  };
}

const ok: MigrateResult = { error: null, recordsToMigrate: 0, oldNames: [] };

/**
 * Build a stand-in IndexManager
 * @param name  Alias name; full name is `${name}~v2`
 * @param statuses  Summaries returned by successive getStatus() calls
 *   (the last one repeats); an Error makes that call reject
 * @param migrate  Stand-in for IndexManager.migrateIfNeeded
 */
function fakeIndex(
  name: string,
  statuses: Array<Summary | Error>,
  migrate: (
    params: MigrationParams,
  ) => MigrateResult | Promise<MigrateResult> = () => ok,
) {
  const calls = { getStatus: 0, migrateIfNeeded: 0 };
  const index = {
    getFullName: () => `${name}~v2`,
    getAliasName: () => name,
    getStatus: async () => {
      const next = statuses[Math.min(calls.getStatus, statuses.length - 1)];
      calls.getStatus++;
      if (next instanceof Error) {
        throw next;
      }
      return status(name, next);
    },
    migrateIfNeeded: async (params: MigrationParams) => {
      calls.migrateIfNeeded++;
      return migrate(params);
    },
  };
  return { index: index as unknown as IndexManager, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SchemaRegistry', () => {
  it('should properly chunkify', () => {
    const registry = new SchemaRegistry();
    const input = [1, 2, 3, 4, 5, 6, 7];
    const chunks = registry.chunkify(input, 3);
    expect(chunks).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });
});

describe('SchemaRegistry.migrateIfNeeded', () => {
  it('should not acknowledge when no indexes are registered', async () => {
    const onAllComplete = spyOn({ fn: () => {} }, 'fn');
    const result = await new SchemaRegistry().migrateIfNeeded({
      onAllComplete,
    });
    expect(result.acknowledged).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(await result.completion).toEqual({
      success: false,
      took: 0,
      report: [],
      summary: {},
    });
    expect(onAllComplete).not.toHaveBeenCalled();
  });

  it('should acknowledge before the work finishes', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { index } = fakeIndex('books', ['current'], async () => {
      await gate;
      return ok;
    });
    const onAllComplete = spyOn({ fn: () => {} }, 'fn');
    const result = await new SchemaRegistry([index]).migrateIfNeeded({
      onAllComplete,
    });
    expect(result.acknowledged).toBe(true);
    expect(result.error).toBeNull();
    await tick();
    expect(onAllComplete).not.toHaveBeenCalled();
    release();
    await result.completion;
    expect(onAllComplete).toHaveBeenCalledTimes(1);
  });

  it('should report up-to-date indexes as unchanged', async () => {
    // an up-to-date index never fires onProgress
    const { index } = fakeIndex('books', ['current']);
    const onError = spyOn({ fn: () => {} }, 'fn');
    const { completion } = await new SchemaRegistry([index]).migrateIfNeeded({
      onError,
    });
    const details = await completion;
    expect(details.success).toBe(true);
    expect(details.summary).toEqual({ 'books~v2': 'unchanged' });
    expect(details.report).toHaveLength(1);
    expect(details.report[0]).toMatchObject({
      fullName: 'books~v2',
      aliasName: 'books',
      outcome: 'unchanged',
      error: null,
    });
    expect(details.report[0].before?.summary).toBe('current');
    expect(details.report[0].after?.summary).toBe('current');
    expect(onError).not.toHaveBeenCalled();
  });

  it('should report created indexes with before and after status', async () => {
    const { index } = fakeIndex(
      'books',
      ['needsCreation', 'current'],
      ({ onProgress, onComplete }) => {
        onProgress?.(progress('books', '', 100));
        onComplete?.(progress('books', '', 100));
        return ok;
      },
    );
    const onProgress = spyOn({ fn: () => {} }, 'fn');
    const onComplete = spyOn({ fn: () => {} }, 'fn');
    const { completion } = await new SchemaRegistry([index]).migrateIfNeeded({
      onProgress,
      onComplete,
    });
    const details = await completion;
    expect(details.summary).toEqual({ 'books~v2': 'created' });
    expect(details.report[0].before?.summary).toBe('needsCreation');
    expect(details.report[0].after?.summary).toBe('current');
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('should pass slices and pollInterval to each index', async () => {
    const seen: MigrationParams[] = [];
    const { index } = fakeIndex('books', ['current'], (params) => {
      seen.push(params);
      return ok;
    });
    const registry = new SchemaRegistry([index]);
    await (await registry.migrateIfNeeded()).completion;
    await (await registry.migrateIfNeeded({ slices: 4, pollInterval: 250 }))
      .completion;
    expect(seen[0]).toMatchObject({ slices: 1, pollInterval: 1000 });
    expect(seen[1]).toMatchObject({ slices: 4, pollInterval: 250 });
  });

  it('should wait for every background reindex task', async () => {
    let params: MigrationParams = {};
    const { index } = fakeIndex(
      'books',
      ['needsMigration', 'current'],
      (given) => {
        params = given;
        return {
          error: null,
          recordsToMigrate: 10,
          oldNames: ['books~v0', 'books~v1'],
        };
      },
    );
    const percents: number[] = [];
    let settled = false;
    const { completion } = await new SchemaRegistry([index]).migrateIfNeeded({
      onProgress: (details) => {
        percents.push(details.percent);
      },
    });
    completion.then(() => {
      settled = true;
    });
    await tick();
    params.onProgress?.(progress('books', 'books~v0', 50));
    params.onProgress?.(progress('books', 'books~v0', 100));
    await tick();
    // one of two old indexes is done; still waiting on the other
    expect(settled).toBe(false);
    params.onProgress?.(progress('books', 'books~v1', 100));
    const details = await completion;
    expect(percents).toEqual([50, 100, 100]);
    expect(details.success).toBe(true);
    expect(details.report).toHaveLength(1);
    expect(details.summary).toEqual({ 'books~v2': 'migrated' });
    expect(details.report[0].before?.summary).toBe('needsMigration');
    expect(details.report[0].after?.summary).toBe('current');
  });

  it('should migrate indexes one at a time in registration order', async () => {
    const order: string[] = [];
    let paramsA: MigrationParams = {};
    const a = fakeIndex('a', ['needsMigration', 'current'], (given) => {
      order.push('a');
      paramsA = given;
      return { error: null, recordsToMigrate: 1, oldNames: ['a~v1'] };
    });
    const b = fakeIndex('b', ['current'], () => {
      order.push('b');
      return ok;
    });
    const registry = new SchemaRegistry([a.index, b.index]);
    const { completion } = await registry.migrateIfNeeded();
    await tick();
    expect(order).toEqual(['a']);
    paramsA.onProgress?.(progress('a', 'a~v1', 100));
    const details = await completion;
    expect(order).toEqual(['a', 'b']);
    expect(details.report.map((entry) => entry.fullName)).toEqual([
      'a~v2',
      'b~v2',
    ]);
    expect(details.summary).toEqual({
      'a~v2': 'migrated',
      'b~v2': 'unchanged',
    });
  });

  it('should include failed indexes and continue with the rest', async () => {
    const boom = new Error('boom');
    const a = fakeIndex('a', ['needsCreation'], () => {
      return { error: boom, recordsToMigrate: 0, oldNames: [] };
    });
    const b = fakeIndex('b', ['needsCreation', 'current']);
    const onError = spyOn({ fn: (_: Error) => {} }, 'fn');
    const onAllComplete = spyOn({ fn: () => {} }, 'fn');
    const registry = new SchemaRegistry([a.index, b.index]);
    const { completion } = await registry.migrateIfNeeded({
      onError,
      onAllComplete,
    });
    const details = await completion;
    expect(details.success).toBe(false);
    expect(details.summary).toEqual({ 'a~v2': 'failed', 'b~v2': 'created' });
    expect(details.report[0]).toMatchObject({
      fullName: 'a~v2',
      outcome: 'failed',
      error: boom,
    });
    expect(details.report[0].before?.summary).toBe('needsCreation');
    expect(details.report[0].after?.summary).toBe('needsCreation');
    expect(details.report[1].error).toBeNull();
    expect(b.calls.migrateIfNeeded).toBe(1);
    // error came only through the result envelope; forwarded exactly once
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
    expect(onAllComplete).toHaveBeenCalledTimes(1);
    expect(onAllComplete).toHaveBeenCalledWith(details);
  });

  it('should call onError once when an index reports an error twice', async () => {
    // IndexManager calls onError AND returns the same error in its envelope
    const boom = new Error('boom');
    const { index } = fakeIndex('books', ['needsMigration'], ({ onError }) => {
      onError?.(boom);
      return { error: boom, recordsToMigrate: 0, oldNames: [] };
    });
    const onError = spyOn({ fn: (_: Error) => {} }, 'fn');
    const { completion } = await new SchemaRegistry([index]).migrateIfNeeded({
      onError,
    });
    const details = await completion;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
    expect(details.report[0]).toMatchObject({ outcome: 'failed', error: boom });
  });

  it('should fail an index whose background reindex errors', async () => {
    const boom = new Error('reindex failed');
    let params: MigrationParams = {};
    const a = fakeIndex('a', ['needsMigration'], (given) => {
      params = given;
      return { error: null, recordsToMigrate: 5, oldNames: ['a~v1'] };
    });
    const b = fakeIndex('b', ['current']);
    const onError = spyOn({ fn: (_: Error) => {} }, 'fn');
    const registry = new SchemaRegistry([a.index, b.index]);
    const { completion } = await registry.migrateIfNeeded({ onError });
    await tick();
    params.onProgress?.(progress('a', 'a~v1', 40));
    params.onError?.(boom);
    const details = await completion;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(details.success).toBe(false);
    expect(details.summary).toEqual({ 'a~v2': 'failed', 'b~v2': 'unchanged' });
    expect(details.report[0].error).toBe(boom);
    expect(details.report[0].after?.summary).toBe('needsMigration');
  });

  it('should fail an index whose status cannot be read', async () => {
    const boom = new Error('no connection');
    const a = fakeIndex('a', [boom]);
    const b = fakeIndex('b', ['current']);
    const onError = spyOn({ fn: (_: Error) => {} }, 'fn');
    const registry = new SchemaRegistry([a.index, b.index]);
    const { completion } = await registry.migrateIfNeeded({ onError });
    const details = await completion;
    expect(a.calls.migrateIfNeeded).toBe(0);
    // status is not re-read, so the same outage is not reported twice
    expect(a.calls.getStatus).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(details.report[0]).toMatchObject({
      outcome: 'failed',
      before: null,
      after: null,
      error: boom,
    });
    expect(details.summary).toEqual({ 'a~v2': 'failed', 'b~v2': 'unchanged' });
  });

  it('should call onError once when migration and final status fail', async () => {
    const boom = new Error('boom');
    const { index } = fakeIndex(
      'books',
      ['needsMigration', new Error('status failed')],
      () => {
        return { error: boom, recordsToMigrate: 0, oldNames: [] };
      },
    );
    const onError = spyOn({ fn: (_: Error) => {} }, 'fn');
    const { completion } = await new SchemaRegistry([index]).migrateIfNeeded({
      onError,
    });
    const details = await completion;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(details.report[0]).toMatchObject({
      outcome: 'failed',
      error: boom,
      after: null,
    });
  });

  it('should fail an index whose final status cannot be read', async () => {
    const boom = new Error('status failed');
    const { index } = fakeIndex('books', ['needsCreation', boom]);
    const onError = spyOn({ fn: (_: Error) => {} }, 'fn');
    const { completion } = await new SchemaRegistry([index]).migrateIfNeeded({
      onError,
    });
    const details = await completion;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(details.report[0]).toMatchObject({
      outcome: 'failed',
      error: boom,
      after: null,
    });
    expect(details.report[0].before?.summary).toBe('needsCreation');
  });

  it('should survive callbacks that throw', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const boom = new Error('boom');
      const a = fakeIndex('a', ['needsCreation'], () => {
        return { error: boom, recordsToMigrate: 0, oldNames: [] };
      });
      const b = fakeIndex('b', ['current']);
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
      expect(details.report[0].error).toBe(boom);
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
});
