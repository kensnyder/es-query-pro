import { describe, expect, expectTypeOf, it } from 'bun:test';
import type {
  IndexDropResult,
  IndexRecreateResult,
  StatusReport,
  StatusSummary,
} from '../IndexManager/IndexManager';
import IndexManager from '../IndexManager/IndexManager';
import {
  getRecordingClient,
  responseError,
} from '../testFixtures/recordingClient';
import SchemaRegistry, { runLimited } from './SchemaRegistry';

type Step = 'ok' | 'fail' | 'throw' | 'missing';

/** Counts concurrent calls across every fake sharing it */
function makeGauge() {
  const gauge = {
    inFlight: 0,
    max: 0,
    order: [] as string[],
    async enter(name: string) {
      gauge.inFlight++;
      gauge.max = Math.max(gauge.max, gauge.inFlight);
      gauge.order.push(name);
      // let every other worker reach its own call before this one ends
      await new Promise((resolve) => setTimeout(resolve, 1));
    },
    leave() {
      gauge.inFlight--;
    },
  };
  return gauge;
}

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
    error: failed ? new Error(`${name} status failed`) : null,
    errorKind: failed ? 'connection' : null,
  };
}

function dropResult(name: string, step: Step) {
  const base = {
    request: { method: 'DELETE', endpoint: `/${name}~v2`, body: {} },
    took: 1,
  };
  if (step === 'ok') {
    return {
      ...base,
      acknowledged: true,
      shards: null,
      error: null,
      errorKind: null,
      response: { acknowledged: true },
    } as unknown as IndexDropResult;
  }
  const statusCode = step === 'missing' ? 404 : 500;
  const type =
    step === 'missing' ? 'index_not_found_exception' : 'internal_error';
  return {
    ...base,
    acknowledged: false,
    shards: null,
    error: new Error(`${name}: ${type}`),
    errorKind: 'response',
    response: { statusCode, body: { error: { type } } },
  } as unknown as IndexDropResult;
}

function recreateResult(name: string, step: Step) {
  if (step === 'ok') {
    return {
      success: true,
      code: 'CREATED',
      took: 1,
      error: null,
      errorKind: null,
    } as unknown as IndexRecreateResult;
  }
  if (step === 'missing') {
    // the alias points at an older version: refused, nothing changed
    return {
      success: false,
      code: 'NEEDS_MIGRATION',
      took: 1,
      error: null,
      errorKind: null,
    } as unknown as IndexRecreateResult;
  }
  return {
    success: false,
    code: 'CREATE_ERROR',
    took: 1,
    error: new Error(`${name}: create failed`),
    errorKind: 'response',
  } as unknown as IndexRecreateResult;
}

type FakeOptions = {
  gauge?: ReturnType<typeof makeGauge>;
  summary?: StatusSummary | 'throw';
  drop?: Step;
  recreate?: Step;
  version?: number;
};

/** A stand-in IndexManager for the fleet operations */
function fakeIndex(name: string, options: FakeOptions = {}) {
  const gauge = options.gauge ?? makeGauge();
  const version = options.version ?? 2;
  const calls = { getStatus: 0, drop: 0, recreate: 0 };
  async function track<T>(make: () => T) {
    await gauge.enter(name);
    try {
      return make();
    } finally {
      gauge.leave();
    }
  }
  const index = {
    index: { version },
    getFullName: () => `${name}~v${version}`,
    getAliasName: () => name,
    getStatus: async () => {
      calls.getStatus++;
      return track(() => {
        if (options.summary === 'throw') {
          throw new Error(`${name} getStatus threw`);
        }
        return status(name, options.summary ?? 'current');
      });
    },
    drop: async () => {
      calls.drop++;
      return track(() => {
        if (options.drop === 'throw') {
          throw new Error(`${name} drop threw`);
        }
        return dropResult(name, options.drop ?? 'ok');
      });
    },
    recreate: async () => {
      calls.recreate++;
      return track(() => {
        if (options.recreate === 'throw') {
          throw new Error(`${name} recreate threw`);
        }
        return recreateResult(name, options.recreate ?? 'ok');
      });
    },
  };
  return { index: index as unknown as IndexManager, calls };
}

function fleet(count: number, options: FakeOptions = {}) {
  const gauge = options.gauge ?? makeGauge();
  const fakes = Array.from({ length: count }, (_, i) =>
    fakeIndex(`idx${i}`, { ...options, gauge }),
  );
  return { gauge, fakes, indexes: fakes.map((fake) => fake.index) };
}

const operations = ['getStatus', 'recreateAll', 'dropAll'] as const;

function runOperation(
  registry: SchemaRegistry,
  operation: (typeof operations)[number],
  concurrency?: number,
) {
  return registry[operation](concurrency);
}

describe('runLimited()', () => {
  it('should never run more than `concurrency` calls at once (B-016)', async () => {
    for (const concurrency of [1, 2, 3, 5, 10, 20]) {
      const gauge = makeGauge();
      const items = Array.from({ length: 10 }, (_, i) => `item${i}`);
      await runLimited(items, concurrency, async (item) => {
        await gauge.enter(item);
        gauge.leave();
      });
      expect(gauge.max).toBe(Math.min(concurrency, items.length));
      expect(gauge.order).toEqual(items);
    }
  });

  it('should return settled results in input order (B-105)', async () => {
    const delays = [30, 1, 15, 5];
    const results = await runLimited(delays, 4, async (delay, i) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (i === 2) {
        throw new Error('third');
      }
      return delay * 2;
    });
    expect(results.map((r) => r.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'rejected',
      'fulfilled',
    ]);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 60 });
    expect(results[3]).toEqual({ status: 'fulfilled', value: 10 });
  });

  it('should keep going after a failure and settle only when all are done (B-063)', async () => {
    const finished: number[] = [];
    const results = await runLimited([0, 1, 2, 3, 4], 2, async (item) => {
      if (item === 0) {
        throw new Error('first');
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished.push(item);
      return item;
    });
    expect(finished.sort()).toEqual([1, 2, 3, 4]);
    expect(results).toHaveLength(5);
    expect(results[0].status).toBe('rejected');
  });

  it('should treat a synchronous throw as a rejection', async () => {
    const results = await runLimited([1], 1, () => {
      throw new Error('sync');
    });
    expect(results[0].status).toBe('rejected');
  });

  it('should resolve to an empty list for no items', async () => {
    expect(await runLimited([], 3, async () => 1)).toEqual([]);
  });

  it('should run one at a time for 0, negative or NaN (B-064)', async () => {
    for (const concurrency of [0, -2, Number.NaN]) {
      const gauge = makeGauge();
      const results = await runLimited([1, 2, 3], concurrency, async (item) => {
        await gauge.enter(String(item));
        gauge.leave();
        return item;
      });
      expect(gauge.max).toBe(1);
      expect(results).toHaveLength(3);
    }
  });

  it('should treat Infinity as "all at once"', async () => {
    const gauge = makeGauge();
    await runLimited([1, 2, 3], Number.POSITIVE_INFINITY, async (item) => {
      await gauge.enter(String(item));
      gauge.leave();
    });
    expect(gauge.max).toBe(3);
  });
});

describe('SchemaRegistry fleet operations', () => {
  for (const operation of operations) {
    describe(`${operation}()`, () => {
      it('should honor the concurrency limit (B-016)', async () => {
        for (const concurrency of [1, 2, 5]) {
          const { gauge, indexes } = fleet(10);
          await runOperation(
            new SchemaRegistry(indexes),
            operation,
            concurrency,
          );
          expect(gauge.max).toBe(concurrency);
        }
      });

      it('should default to 2 at a time', async () => {
        const { gauge, indexes } = fleet(6);
        await runOperation(new SchemaRegistry(indexes), operation);
        expect(gauge.max).toBe(2);
      });

      for (const bad of [0, -1, Number.NaN, 0.5]) {
        it(`should return an error envelope for concurrency ${bad} (B-064)`, async () => {
          const { gauge, indexes } = fleet(3);
          const result = await runOperation(
            new SchemaRegistry(indexes),
            operation,
            bad,
          );
          expect(result.success).toBe(false);
          expect(result.error).toBeInstanceOf(RangeError);
          expect(result.errorKind).toBe('configuration');
          expect(result.report).toEqual([]);
          expect(result.summary).toEqual({});
          expect(gauge.order).toEqual([]);
        });
      }

      it('should floor a fractional concurrency', async () => {
        const { gauge, indexes } = fleet(6);
        const result = await runOperation(
          new SchemaRegistry(indexes),
          operation,
          2.9,
        );
        expect(result.error).toBeNull();
        expect(gauge.max).toBe(2);
      });

      it('should report every index in registration order (B-105)', async () => {
        const { indexes } = fleet(7);
        const result = await runOperation(
          new SchemaRegistry(indexes),
          operation,
          3,
        );
        const names = indexes.map((index) => index.getFullName());
        expect(result.report.map((entry) => entry.fullName)).toEqual(names);
        expect(Object.keys(result.summary)).toEqual(names);
      });

      it('should return an error envelope for an empty registry (S-031)', async () => {
        const result = await runOperation(new SchemaRegistry(), operation);
        expect(result).toMatchObject({
          success: false,
          report: [],
          summary: {},
          errorKind: 'configuration',
        });
        expect(result.error).toBeInstanceOf(Error);
        expect(typeof result.took).toBe('number');
      });
    });
  }
});

describe('SchemaRegistry.getStatus()', () => {
  it('should succeed with one status per index', async () => {
    const a = fakeIndex('a', { summary: 'current' });
    const b = fakeIndex('b', { summary: 'needsMigration' });
    const result = await new SchemaRegistry([a.index, b.index]).getStatus();
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.errorKind).toBeNull();
    expect(result.summary).toEqual({
      'a~v2': 'current',
      'b~v2': 'needsMigration',
    });
    expect(result.report[1].summary).toBe('needsMigration');
  });

  it('should fail when a status check fails, but report the rest (B-062)', async () => {
    const a = fakeIndex('a', { summary: 'unknown' });
    const b = fakeIndex('b', { summary: 'current' });
    const result = await new SchemaRegistry([a.index, b.index]).getStatus();
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('a status failed');
    expect(result.errorKind).toBe('connection');
    expect(result.summary).toEqual({ 'a~v2': 'unknown', 'b~v2': 'current' });
  });

  it('should record a thrown status as unknown and finish the others (B-063)', async () => {
    const { gauge, fakes, indexes } = fleet(5);
    const broken = fakeIndex('broken', { gauge, summary: 'throw' });
    const registry = new SchemaRegistry([broken.index, ...indexes]);
    const result = await registry.getStatus(2);
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('broken getStatus threw');
    expect(result.errorKind).toBe('javascript');
    expect(result.report).toHaveLength(6);
    expect(result.report[0]).toMatchObject({
      fullName: 'broken~v2',
      aliasName: 'broken',
      summary: 'unknown',
      indexExists: null,
      aliasExists: null,
    });
    for (const fake of fakes) {
      expect(fake.calls.getStatus).toBe(1);
    }
    // nothing still running after the method returned
    expect(gauge.inFlight).toBe(0);
  });

  it('should type the summary as StatusSummary (S-063)', async () => {
    const result = await new SchemaRegistry().getStatus();
    expectTypeOf(result.summary).toEqualTypeOf<Record<string, StatusSummary>>();
    expectTypeOf(result.report).toEqualTypeOf<StatusReport[]>();
  });
});

describe('SchemaRegistry.recreateAll()', () => {
  it('should succeed when every index is recreated', async () => {
    const { indexes } = fleet(3);
    const result = await new SchemaRegistry(indexes).recreateAll();
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.summary).toEqual({
      'idx0~v2': 'CREATED',
      'idx1~v2': 'CREATED',
      'idx2~v2': 'CREATED',
    });
    expect(result.report[0]).toMatchObject({
      fullName: 'idx0~v2',
      aliasName: 'idx0',
      success: true,
      code: 'CREATED',
      error: null,
      errorKind: null,
    });
    expect(result.report[0].result?.code).toBe('CREATED');
  });

  it('should read each result instead of marking it SUCCESS (B-062)', async () => {
    const a = fakeIndex('a', { recreate: 'fail' });
    const b = fakeIndex('b');
    const c = fakeIndex('c', { recreate: 'missing' });
    const registry = new SchemaRegistry([a.index, b.index, c.index]);
    const result = await registry.recreateAll();
    expect(result.success).toBe(false);
    expect(result.summary).toEqual({
      'a~v2': 'CREATE_ERROR',
      'b~v2': 'CREATED',
      'c~v2': 'NEEDS_MIGRATION',
    });
    expect(result.error?.message).toBe('a: create failed');
    expect(result.errorKind).toBe('response');
    expect(result.report[0].success).toBe(false);
    // refused without an error: unsuccessful, error stays null
    expect(result.report[2]).toMatchObject({ success: false, error: null });
  });

  it('should keep an index that threw in the report (B-062)', async () => {
    const a = fakeIndex('a');
    const b = fakeIndex('b', { recreate: 'throw' });
    const result = await new SchemaRegistry([a.index, b.index]).recreateAll();
    expect(result.success).toBe(false);
    expect(result.report).toHaveLength(2);
    expect(result.report[1]).toMatchObject({
      fullName: 'b~v2',
      success: false,
      code: 'ERROR',
      result: null,
      errorKind: 'javascript',
    });
    expect(result.report[1].error?.message).toBe('b recreate threw');
    expect(result.summary['b~v2']).toBe('ERROR');
  });

  it('should not throw for an empty registry (S-031)', async () => {
    const result = await new SchemaRegistry().recreateAll();
    expect(result.success).toBe(false);
  });
});

describe('SchemaRegistry.dropAll()', () => {
  it('should drop every registered index with no options (D6)', async () => {
    const { fakes, indexes } = fleet(3);
    const result = await new SchemaRegistry(indexes).dropAll();
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.summary).toEqual({
      'idx0~v2': 'DROPPED',
      'idx1~v2': 'DROPPED',
      'idx2~v2': 'DROPPED',
    });
    for (const fake of fakes) {
      expect(fake.calls.drop).toBe(1);
    }
    expect(result.report[0]).toMatchObject({
      fullName: 'idx0~v2',
      aliasName: 'idx0',
      success: true,
      error: null,
    });
    expect(result.report[0].result?.acknowledged).toBe(true);
  });

  it('should report a failed drop envelope as a failure (B-062)', async () => {
    const a = fakeIndex('a');
    const b = fakeIndex('b', { drop: 'fail' });
    const result = await new SchemaRegistry([a.index, b.index]).dropAll();
    expect(result.success).toBe(false);
    expect(result.summary).toEqual({ 'a~v2': 'DROPPED', 'b~v2': 'ERROR' });
    expect(result.error?.message).toBe('b: internal_error');
    expect(result.errorKind).toBe('response');
    expect(result.report[1]).toMatchObject({ success: false });
  });

  it('should count an index that does not exist as already dropped', async () => {
    const a = fakeIndex('a', { drop: 'missing' });
    const result = await new SchemaRegistry([a.index]).dropAll();
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.summary).toEqual({ 'a~v2': 'MISSING' });
    expect(result.report[0].result?.errorKind).toBe('response');
  });

  it('should keep dropping after a throw and return only when all settled (B-063)', async () => {
    const { gauge, fakes, indexes } = fleet(5);
    const broken = fakeIndex('broken', { gauge, drop: 'throw' });
    const registry = new SchemaRegistry([broken.index, ...indexes]);
    const result = await registry.dropAll(2);
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('broken drop threw');
    expect(result.summary.broken).toBeUndefined();
    expect(result.summary['broken~v2']).toBe('ERROR');
    expect(result.report[0]).toMatchObject({ result: null, success: false });
    for (const fake of fakes) {
      expect(fake.calls.drop).toBe(1);
    }
    expect(gauge.inFlight).toBe(0);
  });

  it('should drop real IndexManagers through the client', async () => {
    const { client, sent, script } = getRecordingClient();
    script('DELETE /p~english~a~v1', { body: { acknowledged: true } });
    script(
      'DELETE /p~english~b~v1',
      responseError(404, 'index_not_found_exception'),
    );
    script('DELETE /p~english~c~v1', responseError(503, 'unavailable'));
    const make = (name: string) =>
      new IndexManager({ client, prefix: 'p' }, { index: name });
    const registry = new SchemaRegistry([make('a'), make('b'), make('c')]);
    const result = await registry.dropAll(1);
    expect(sent.map((req) => `${req.method} ${req.path}`)).toEqual([
      'DELETE /p~english~a~v1',
      'DELETE /p~english~b~v1',
      'DELETE /p~english~c~v1',
    ]);
    expect(result.summary).toEqual({
      'p~english~a~v1': 'DROPPED',
      'p~english~b~v1': 'MISSING',
      'p~english~c~v1': 'ERROR',
    });
    expect(result.success).toBe(false);
    expect(result.errorKind).toBe('response');
  });
});
