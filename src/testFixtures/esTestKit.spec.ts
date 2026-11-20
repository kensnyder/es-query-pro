import { describe, expect, it } from 'bun:test';
import {
  createTestKit,
  detectCapabilities,
  makeRunPrefix,
  parseRunPrefixTime,
  sweep,
  waitFor,
} from './esTestKit';
import { getRecordingClient, responseError } from './recordingClient';

const HOUR = 3_600_000;

/** A recording client scripted to look like a stateful cluster. */
function getStatefulClient() {
  const recording = getRecordingClient();
  const { script } = recording;
  script('GET /', {
    body: { version: { number: '9.1.10', build_flavor: 'default' } },
  });
  script('GET /_tasks', { body: { nodes: {} } });
  script('GET /_cat/indices*', { body: [] });
  script('GET /_inference/_all', { body: { endpoints: [] } });
  script('POST /*/_search', { body: { hits: { hits: [] } } });
  return recording;
}

describe('makeRunPrefix() / parseRunPrefixTime()', () => {
  it('should build esqpt_<time>_<label>_<random>', () => {
    const now = Date.UTC(2026, 10, 20);
    const prefix = makeRunPrefix('QB match!', now, 'abc123');
    expect(prefix).toBe(`esqpt_${now.toString(36)}_qbmatch_abc123`);
  });

  it('should only produce characters valid in an index name prefix', () => {
    for (let i = 0; i < 20; i++) {
      expect(makeRunPrefix('Any Label-Ü_9')).toMatch(
        /^esqpt_[0-9a-z]+_[0-9a-z]+_[0-9a-z]{6}$/,
      );
    }
  });

  it('should fall back to "run" for an empty label', () => {
    expect(makeRunPrefix('---', 1, 'zzzzzz')).toBe('esqpt_1_run_zzzzzz');
  });

  it('should read the time back from any index under the prefix', () => {
    const now = Date.now();
    const prefix = makeRunPrefix('kit', now);
    expect(parseRunPrefixTime(prefix)).toBe(now);
    expect(parseRunPrefixTime(`${prefix}~english~books~v1`)).toBe(now);
    expect(parseRunPrefixTime(`${prefix}_books_1`)).toBe(now);
  });

  it('should return null for names the kit did not make', () => {
    expect(parseRunPrefixTime('development~english~verse~v1')).toBe(null);
    expect(parseRunPrefixTime('test~english~books_1')).toBe(null);
    expect(parseRunPrefixTime('esqpt_x')).toBe(null);
    expect(parseRunPrefixTime('esqpt_1_kit_abc123x~a')).toBe(null);
    expect(parseRunPrefixTime('xesqpt_1_kit_abc123')).toBe(null);
  });
});

describe('waitFor()', () => {
  it('should resolve with the first truthy value', async () => {
    let calls = 0;
    const value = await waitFor(() => (++calls >= 3 ? 'done' : null), {
      interval: 1,
    });
    expect(value).toBe('done');
    expect(calls).toBe(3);
  });

  it('should treat a throwing probe as not ready yet', async () => {
    let calls = 0;
    const value = await waitFor(
      async () => {
        calls++;
        if (calls < 2) {
          throw new Error('not yet');
        }
        return 42;
      },
      { interval: 1 },
    );
    expect(value).toBe(42);
  });

  it('should reject after the timeout with the message and last error', async () => {
    const promise = waitFor(
      () => {
        throw new Error('still red');
      },
      { timeout: 30, interval: 5, message: 'cluster green' },
    );
    await expect(promise).rejects.toThrow(/cluster green.*still red/);
  });
});

describe('detectCapabilities()', () => {
  it('should detect a stateful cluster with a basic license', async () => {
    const { client, script, sent } = getStatefulClient();
    script(
      'POST /*/_search',
      responseError(
        403,
        'security_exception',
        'current license is non-compliant',
      ),
    );
    const caps = await detectCapabilities(client, {});
    expect(caps).toEqual({
      version: '9.1.10',
      serverless: false,
      tasksApi: true,
      retrievers: false,
      inference: false,
      inferenceId: null,
    });
    // the probe index is created and deleted under the kit prefix
    const probe = sent.find((r) => r.method === 'PUT')?.path ?? '';
    expect(probe).toMatch(/^\/esqpt_[0-9a-z]+_caps_[0-9a-z]{6}_probe$/);
    expect(sent.some((r) => r.method === 'DELETE' && r.path === probe)).toBe(
      true,
    );
  });

  it('should detect serverless, no task list, retrievers and EIS inference', async () => {
    const { client, script } = getStatefulClient();
    script('GET /', {
      body: { version: { number: '9.7.0', build_flavor: 'serverless' } },
    });
    script('GET /_tasks', responseError(410, 'api_not_available_exception'));
    script('GET /_inference/_all', {
      body: {
        endpoints: [
          {
            inference_id: '.chat',
            task_type: 'completion',
            service: 'elastic',
          },
          {
            inference_id: '.e5',
            task_type: 'text_embedding',
            service: 'elasticsearch',
          },
          {
            inference_id: '.jina',
            task_type: 'text_embedding',
            service: 'elastic',
          },
          {
            inference_id: '.elser-2-elastic',
            task_type: 'sparse_embedding',
            service: 'elastic',
          },
        ],
      },
    });
    script('POST /_inference/.elser-2-elastic', {
      body: { sparse_embedding: [] },
    });
    const caps = await detectCapabilities(client, {});
    expect(caps).toEqual({
      version: '9.7.0',
      serverless: true,
      tasksApi: false,
      retrievers: true,
      inference: true,
      inferenceId: '.elser-2-elastic',
    });
  });

  it('should try the next endpoint when one fails', async () => {
    const { client, script } = getStatefulClient();
    script('GET /_inference/_all', {
      body: {
        endpoints: [
          {
            inference_id: 'a',
            task_type: 'sparse_embedding',
            service: 'elastic',
          },
          {
            inference_id: 'b',
            task_type: 'text_embedding',
            service: 'elastic',
          },
        ],
      },
    });
    script('POST /_inference/a', responseError(408, 'timeout_exception'));
    script('POST /_inference/b', { body: { text_embedding: [] } });
    const caps = await detectCapabilities(client, {});
    expect(caps.inferenceId).toBe('b');
  });

  it('should use only ES_TEST_INFERENCE_ID when it is set', async () => {
    const { client, script, sent } = getStatefulClient();
    script('POST /_inference/my-e5', { body: { text_embedding: [] } });
    const caps = await detectCapabilities(client, {
      ES_TEST_INFERENCE_ID: 'my-e5',
    });
    expect(caps.inferenceId).toBe('my-e5');
    expect(sent.some((r) => r.path === '/_inference/_all')).toBe(false);
  });

  it('should turn inference off with ES_TEST_INFERENCE_ID=none', async () => {
    const { client, sent } = getStatefulClient();
    const caps = await detectCapabilities(client, {
      ES_TEST_INFERENCE_ID: 'none',
    });
    expect(caps.inference).toBe(false);
    expect(sent.some((r) => r.path.startsWith('/_inference'))).toBe(false);
  });

  it('should reject with a clear message when the cluster is unreachable', async () => {
    const { client, script } = getRecordingClient();
    script('GET /', responseError(401, 'security_exception'));
    await expect(detectCapabilities(client, {})).rejects.toThrow(
      /esTestKit: cannot reach Elasticsearch/,
    );
  });
});

describe('createTestKit()', () => {
  it('should name indexes under its own prefix and track them', async () => {
    const { client } = getStatefulClient();
    const kit = await createTestKit('unit', { client });
    expect(kit.prefix).toMatch(/^esqpt_[0-9a-z]+_unit_[0-9a-z]{6}$/);
    const a = kit.indexName('books');
    const b = kit.indexName('books');
    expect(a).toBe(`${kit.prefix}_books_1`);
    expect(b).toBe(`${kit.prefix}_books_2`);
    expect(kit.indexName()).toBe(`${kit.prefix}_idx_3`);
  });

  it('should create an index and bulk load docs with ids and refresh', async () => {
    const { client, sent } = getStatefulClient();
    const kit = await createTestKit('unit', { client });
    sent.length = 0;
    const name = await kit.makeIndex(
      { index: 'books', mappings: { properties: { id: { type: 'keyword' } } } },
      [{ id: 7, t: 'x' }, { t: 'no id' }],
    );
    expect(name).toBe(`${kit.prefix}_books_1`);
    expect(sent[0]).toEqual({
      method: 'PUT',
      path: `/${name}`,
      body: { mappings: { properties: { id: { type: 'keyword' } } } },
    });
    expect(sent[1].path).toBe('/_bulk');
    expect(sent[1].querystring).toBe('refresh=true');
    expect(sent[1].body).toEqual([
      { index: { _index: name, _id: '7' } },
      { id: 7, t: 'x' },
      { index: { _index: name } },
      { t: 'no id' },
    ]);
  });

  it('should throw when a bulk row fails', async () => {
    const { client, script } = getStatefulClient();
    const kit = await createTestKit('unit', { client });
    script('POST /_bulk', {
      body: {
        errors: true,
        items: [{ index: { status: 400, error: { reason: 'bad price' } } }],
      },
    });
    await expect(kit.makeIndex({}, [{ price: 'x' }])).rejects.toThrow(
      'bad price',
    );
  });

  it('should clean up by exact names under its prefix, never a wildcard delete', async () => {
    const { client, script, sent } = getStatefulClient();
    const kit = await createTestKit('unit', { client });
    const tracked = kit.indexName('gone');
    script(`GET /_cat/indices/${kit.prefix}*`, {
      body: [
        { index: `${kit.prefix}~english~books~v1` },
        { index: `${kit.prefix}~english~books~v2` },
      ],
    });
    sent.length = 0;
    const deleted = await kit.cleanup();
    expect(deleted).toEqual([
      `${kit.prefix}_gone_1`,
      `${kit.prefix}~english~books~v1`,
      `${kit.prefix}~english~books~v2`,
    ]);
    const deletes = sent.filter((r) => r.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(decodeURIComponent(deletes[0].path)).toBe(
      `/${tracked},${kit.prefix}~english~books~v1,${kit.prefix}~english~books~v2`,
    );
    expect(deletes[0].querystring).toBe('ignore_unavailable=true');
    for (const req of sent) {
      if (req.method === 'DELETE') {
        expect(req.path).not.toContain('*');
      }
    }
  });

  it('should send no delete when there is nothing to clean up', async () => {
    const { client, sent } = getStatefulClient();
    const kit = await createTestKit('unit', { client });
    sent.length = 0;
    expect(await kit.cleanup()).toEqual([]);
    expect(sent.filter((r) => r.method === 'DELETE')).toEqual([]);
  });

  it('should report whether a test runs for a capability', async () => {
    const { client } = getStatefulClient();
    const kit = await createTestKit('unit', { client });
    expect(typeof kit.testIf('tasksApi')).toBe('function');
    expect(typeof kit.testIf('serverless', false)).toBe('function');
  });
});

describe('sweep()', () => {
  const now = Date.UTC(2026, 10, 20, 12);
  const old = makeRunPrefix('old', now - 5 * HOUR, 'aaaaaa');
  const recent = makeRunPrefix('new', now - 1 * HOUR, 'bbbbbb');

  it('should delete only kit indexes older than the age limit', async () => {
    const { client, script, sent } = getRecordingClient();
    script('GET /_cat/indices/esqpt_*', {
      body: [
        { index: `${old}~english~books~v1` },
        { index: `${old}_places_1` },
        { index: `${recent}~english~books~v1` },
        { index: 'esqpt_notakit' },
      ],
    });
    const deleted = await sweep(client, { now });
    expect(deleted).toEqual([`${old}_places_1`, `${old}~english~books~v1`]);
    const deletes = sent.filter((r) => r.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(decodeURIComponent(deletes[0].path)).toBe(
      `/${old}_places_1,${old}~english~books~v1`,
    );
  });

  it('should refuse an age limit under one hour', async () => {
    const { client, sent } = getRecordingClient();
    await expect(sweep(client, { maxAgeMs: HOUR - 1 })).rejects.toThrow(
      RangeError,
    );
    expect(sent).toEqual([]);
  });
});
