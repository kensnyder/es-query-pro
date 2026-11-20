import { test } from 'bun:test';
import type { Client, estypes } from '@elastic/elasticsearch';
import { getTestClient } from './testClient';

/**
 * Shared harness for `*.integration.test.ts` files. One kit per test file:
 *
 * ```ts
 * import { afterAll, describe, expect, setDefaultTimeout } from 'bun:test';
 * import { createTestKit } from '../testFixtures/esTestKit';
 * import { getBooksCreateRequest, getBooksData } from '../testFixtures/books';
 *
 * setDefaultTimeout(30_000);
 * const kit = await createTestKit('qb-match');
 * afterAll(() => kit.cleanup());
 *
 * describe('match', () => {
 *   kit.testIf('retrievers')('rrf ranks both lists', async () => {
 *     const index = await kit.makeIndex(getBooksCreateRequest('books'), getBooksData());
 *     const res = await kit.client.search({ index, query: { match_all: {} } });
 *     expect(res.hits.hits).toHaveLength(3);
 *   });
 * });
 * ```
 *
 * For an `IndexManager`, pass `kit.prefix` as its `prefix`; every index and
 * alias it creates then starts with `kit.prefix` and `cleanup()` removes it.
 */

/** Every index the kit creates starts with this, then `_`. */
export const KIT_INDEX_PREFIX = 'esqpt';

const HOUR = 3_600_000;

/** `sweep()` default: remove kit indexes older than this many ms (3 hours). */
export const DEFAULT_SWEEP_AGE_MS = 3 * HOUR;

/** What the target cluster can do; detected once per client. */
export type EsCapabilities = {
  /** Server version number from `GET /`, e.g. `9.1.10` */
  version: string;
  /** `GET /` reports `build_flavor: 'serverless'` */
  serverless: boolean;
  /** `GET _tasks` (list) works. `GET _tasks/<id>` works on serverless too. */
  tasksApi: boolean;
  /** Both an `rrf` and a `linear` retriever search succeed (license) */
  retrievers: boolean;
  /** `inferenceId` names an endpoint that answered a test inference */
  inference: boolean;
  /** Endpoint to use as `semantic_text` `inference_id`, or null */
  inferenceId: string | null;
};

/** The boolean capability flags `testIf()` accepts */
export type CapabilityName =
  | 'serverless'
  | 'tasksApi'
  | 'retrievers'
  | 'inference';

/** Environment the capability detection reads (`process.env` fits) */
export type KitEnv = Record<string, string | undefined>;

export type WaitForOptions = {
  /** Give up after this many ms (default 10 000) */
  timeout?: number;
  /** Wait this many ms between attempts (default 100) */
  interval?: number;
  /** What is being waited for, used in the timeout error */
  message?: string;
};

export type SweepOptions = {
  /** Remove kit indexes older than this; at least one hour (default 3h) */
  maxAgeMs?: number;
  /** Current time in ms, for tests (default `Date.now()`) */
  now?: number;
};

/** A creation request whose `index` is only a label (default `idx`) */
export type KitCreateRequest = Omit<estypes.IndicesCreateRequest, 'index'> & {
  index?: string;
};

export type EsTestKit = {
  /** The shared test client (`getTestClient()`) unless one was passed */
  client: Client;
  /** Unique run prefix, `esqpt_<time36>_<label>_<random6>` */
  prefix: string;
  /** Capabilities of the target cluster */
  caps: EsCapabilities;
  /** A new unique index name `<prefix>_<label>_<n>`, tracked for cleanup */
  indexName(label?: string): string;
  /**
   * Create an index named `indexName(create.index)` and, if `docs` are
   * given, bulk-load them with `refresh: true` (`_id` = `doc.id` when set).
   * Throws if creation or any bulk row fails. Resolves to the index name.
   */
  makeIndex(
    create?: KitCreateRequest,
    docs?: readonly Record<string, unknown>[],
  ): Promise<string>;
  /** Poll until `probe` returns a truthy value (see `waitFor()`) */
  waitFor: typeof waitFor;
  /**
   * Delete every index named `<prefix>*` plus every tracked name, by exact
   * names (aliases go with them). Resolves to the deleted names.
   */
  cleanup(): Promise<string[]>;
  /** `sweep()` with this kit's client */
  sweep(options?: SweepOptions): Promise<string[]>;
  /**
   * `test` when `caps[cap] === expected`, otherwise `test.skip`, logging one
   * line per capability saying what is skipped and why.
   */
  testIf(
    cap: CapabilityName,
    expected?: boolean,
  ): ReturnType<typeof test.skipIf>;
};

function sanitizeLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join('');
}

/**
 * Build a run prefix `esqpt_<now in base 36>_<label>_<6 random>`. The label
 * keeps only `[a-z0-9]`, so no run prefix is a prefix of another.
 */
export function makeRunPrefix(
  label: string,
  now = Date.now(),
  random = randomId(),
) {
  const clean = sanitizeLabel(label) || 'run';
  return `${KIT_INDEX_PREFIX}_${now.toString(36)}_${clean}_${random}`;
}

/**
 * The creation time encoded in a kit index name, or null if `name` does not
 * start with a run prefix (followed by the end, `_` or `~`).
 */
export function parseRunPrefixTime(name: string): number | null {
  const match = /^esqpt_([0-9a-z]+)_[0-9a-z]+_[0-9a-z]{6}(?:$|[_~])/.exec(name);
  if (!match) {
    return null;
  }
  const time = Number.parseInt(match[1], 36);
  return Number.isSafeInteger(time) ? time : null;
}

/**
 * Poll `probe` until it returns a truthy value and resolve with it. A probe
 * that throws counts as not ready. Rejects after `timeout` with `message`
 * and the last error. Use this instead of fixed sleeps.
 */
export async function waitFor<T>(
  probe: () => T | Promise<T>,
  options: WaitForOptions = {},
): Promise<T> {
  const { timeout = 10_000, interval = 100, message = 'condition' } = options;
  const deadline = Date.now() + timeout;
  let lastError: unknown = null;
  while (true) {
    try {
      const value = await probe();
      if (value) {
        return value;
      }
    } catch (e) {
      lastError = e;
    }
    if (Date.now() >= deadline) {
      let detail = '';
      if (lastError) {
        detail = `; last error: ${String((lastError as Error).message ?? lastError)}`;
      }
      throw new Error(
        `waitFor timed out after ${timeout}ms waiting for ${message}${detail}`,
      );
    }
    await Bun.sleep(interval);
  }
}

async function deleteByName(client: Client, names: string[]) {
  for (let i = 0; i < names.length; i += 50) {
    const chunk = names.slice(i, i + 50);
    await client.indices.delete({
      index: chunk.join(','),
      ignore_unavailable: true,
    });
  }
}

async function listIndexes(client: Client, pattern: string) {
  const rows = await client.cat.indices({
    index: pattern,
    format: 'json',
    h: 'index',
  });
  const names: string[] = [];
  for (const row of rows) {
    if (row.index) {
      names.push(row.index);
    }
  }
  return names;
}

/**
 * Delete kit indexes (names starting with a run prefix) older than
 * `maxAgeMs`, left behind by crashed runs. Never touches other indexes.
 * Resolves to the deleted names.
 */
export async function sweep(client: Client, options: SweepOptions = {}) {
  const { maxAgeMs = DEFAULT_SWEEP_AGE_MS, now = Date.now() } = options;
  if (!(maxAgeMs >= HOUR)) {
    throw new RangeError('sweep() maxAgeMs must be at least one hour');
  }
  const names = await listIndexes(client, `${KIT_INDEX_PREFIX}_*`);
  const stale = names
    .filter((name) => {
      const time = parseRunPrefixTime(name);
      return time !== null && time < now - maxAgeMs;
    })
    .sort();
  await deleteByName(client, stale);
  return stale;
}

async function probeTasksApi(client: Client) {
  try {
    await client.tasks.list({ actions: 'cluster:monitor/tasks/lists' });
    return true;
  } catch {
    return false;
  }
}

async function probeRetrievers(client: Client) {
  const index = `${makeRunPrefix('caps')}_probe`;
  const standard = (text: string): estypes.RetrieverContainer => ({
    standard: { query: { match: { t: text } } },
  });
  try {
    await client.indices.create({
      index,
      mappings: { properties: { t: { type: 'text' } } },
    });
    await client.index({
      index,
      id: '1',
      document: { t: 'probe' },
      refresh: true,
    });
    await client.search({
      index,
      retriever: { rrf: { retrievers: [standard('probe'), standard('x')] } },
    });
    await client.search({
      index,
      retriever: {
        linear: {
          retrievers: [
            { retriever: standard('probe'), weight: 1 },
            { retriever: standard('x'), weight: 1 },
          ],
        },
      },
    });
    return true;
  } catch {
    return false;
  } finally {
    await client.indices
      .delete({ index, ignore_unavailable: true })
      .catch(() => {});
  }
}

async function getInferenceCandidates(client: Client) {
  try {
    const res = await client.inference.get({ inference_id: '_all' });
    const usable = res.endpoints.filter(
      (e) =>
        e.service === 'elastic' &&
        (e.task_type === 'sparse_embedding' ||
          e.task_type === 'text_embedding'),
    );
    // sparse (ELSER) first; it needs no dimensions in the mapping
    usable.sort((a, b) => {
      const rank = (e: typeof a) =>
        e.task_type === 'sparse_embedding' ? 0 : 1;
      return rank(a) - rank(b);
    });
    return usable.slice(0, 2).map((e) => e.inference_id);
  } catch {
    return [];
  }
}

async function probeInference(client: Client, env: KitEnv) {
  const override = env.ES_TEST_INFERENCE_ID?.trim();
  if (override === 'none') {
    return null;
  }
  let candidates: string[];
  if (override) {
    candidates = [override];
  } else {
    candidates = await getInferenceCandidates(client);
  }
  for (const id of candidates) {
    try {
      await client.inference.inference(
        { inference_id: id, input: ['probe'], timeout: '10s' },
        { requestTimeout: 20_000, maxRetries: 0 },
      );
      return id;
    } catch {
      // try the next one
    }
  }
  return null;
}

/**
 * Detect what the cluster behind `client` supports. `inference` considers
 * only Elastic Inference Service endpoints (`service: 'elastic'`), which need
 * no local ML deployment, unless `ES_TEST_INFERENCE_ID` names one endpoint
 * (or is `none` to turn inference off). Rejects if `GET /` fails.
 */
export async function detectCapabilities(
  client: Client,
  env: KitEnv = process.env,
): Promise<EsCapabilities> {
  let info: estypes.InfoResponse;
  try {
    info = await client.info();
  } catch (e) {
    throw new Error(
      `esTestKit: cannot reach Elasticsearch (check ES_ENDPOINT and credentials): ${(e as Error).message}`,
    );
  }
  const [tasksApi, retrievers, inferenceId] = await Promise.all([
    probeTasksApi(client),
    probeRetrievers(client),
    probeInference(client, env),
  ]);
  return {
    version: info.version?.number ?? 'unknown',
    serverless: info.version?.build_flavor === 'serverless',
    tasksApi,
    retrievers,
    inference: inferenceId !== null,
    inferenceId,
  };
}

const capsByClient = new WeakMap<Client, Promise<EsCapabilities>>();
const sweptClients = new WeakSet<Client>();

/**
 * Create the kit for one test file: detects capabilities (once per client
 * per process), sweeps stale kit indexes (once per client per process,
 * errors ignored) and makes a fresh run prefix from `label`.
 */
export async function createTestKit(
  label: string,
  options: { client?: Client } = {},
): Promise<EsTestKit> {
  const client = options.client ?? getTestClient();
  let capsPromise = capsByClient.get(client);
  if (!capsPromise) {
    capsPromise = detectCapabilities(client);
    capsByClient.set(client, capsPromise);
  }
  const caps = await capsPromise;
  if (!sweptClients.has(client)) {
    sweptClients.add(client);
    await sweep(client).catch(() => []);
  }
  const prefix = makeRunPrefix(label);
  const tracked = new Set<string>();
  const logged = new Set<string>();
  let counter = 0;

  function indexName(base = 'idx') {
    const name = `${prefix}_${sanitizeLabel(base) || 'idx'}_${++counter}`;
    tracked.add(name);
    return name;
  }

  async function makeIndex(
    create: KitCreateRequest = {},
    docs: readonly Record<string, unknown>[] = [],
  ) {
    const index = indexName(create.index);
    await client.indices.create({ ...create, index });
    if (docs.length === 0) {
      return index;
    }
    const operations: object[] = [];
    for (const doc of docs) {
      if (doc.id === undefined || doc.id === null) {
        operations.push({ index: { _index: index } });
      } else {
        operations.push({ index: { _index: index, _id: String(doc.id) } });
      }
      operations.push(doc);
    }
    const res = await client.bulk({ operations, refresh: true });
    if (res.errors) {
      const reasons = res.items
        .map((item) => Object.values(item)[0]?.error?.reason)
        .filter(Boolean);
      throw new Error(`makeIndex(${index}) bulk failed: ${reasons.join('; ')}`);
    }
    return index;
  }

  async function cleanup() {
    const names = new Set(tracked);
    for (const name of await listIndexes(client, `${prefix}*`)) {
      names.add(name);
    }
    const sorted = [...names].sort();
    await deleteByName(client, sorted);
    tracked.clear();
    return sorted;
  }

  function testIf(cap: CapabilityName, expected = true) {
    const runs = caps[cap] === expected;
    if (!runs && !logged.has(cap)) {
      logged.add(cap);
      const target = `${caps.serverless ? 'serverless' : 'stateful'} ${caps.version}`;
      console.log(
        `[esTestKit] ${label}: skipping tests that need caps.${cap} === ${expected} (target: ${target})`,
      );
    }
    return test.skipIf(!runs);
  }

  return {
    client,
    prefix,
    caps,
    indexName,
    makeIndex,
    waitFor,
    cleanup,
    sweep: (sweepOptions) => sweep(client, sweepOptions),
    testIf,
  };
}
