import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { Client, type estypes, HttpConnection } from '@elastic/elasticsearch';
import { getBooksCreateRequest } from '../testFixtures/books';
import { createTestKit } from '../testFixtures/esTestKit';
import IndexManager, { type ManageOptions } from './IndexManager';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('im-metadata');

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

/** The `error.type` of a ResponseError body, if any */
function getErrorType(response: unknown) {
  const body = (response as { body?: { error?: { type?: string } } } | null)
    ?.body;
  return body?.error?.type;
}

describe('IndexManager existence and metadata - Integration', () => {
  const aliased = getManager('aliased');
  const indexOnly = getManager('indexonly');
  const missing = getManager('missing');

  beforeAll(async () => {
    const created = await aliased.create();
    if (created.error) {
      throw created.error;
    }
    const createdOnly = await indexOnly.createOnly();
    if (createdOnly.error) {
      throw createdOnly.error;
    }
  });

  it('should report an index and alias that exist', async () => {
    const index = await aliased.exists();
    expect(index).toMatchObject({ exists: true, error: null, errorKind: null });
    const alias = await aliased.aliasExists();
    expect(alias).toMatchObject({ exists: true, error: null, errorKind: null });
  });

  it('should report an index without its alias', async () => {
    expect((await indexOnly.exists()).exists).toBe(true);
    const alias = await indexOnly.aliasExists();
    expect(alias).toMatchObject({ exists: false, error: null });
  });

  it('should report a missing index and alias as false, not an error', async () => {
    const index = await missing.exists();
    expect(index).toMatchObject({ exists: false, error: null });
    const alias = await missing.aliasExists();
    expect(alias).toMatchObject({ exists: false, error: null });
  });

  it('should read the metadata of a healthy index', async () => {
    const res = await aliased.getIndexMetadata();
    if (res.error) {
      throw res.error;
    }
    expect(res.name).toBe(aliased.getFullName());
    // a null error narrows the response to the get-index response
    const metadata = res.response[aliased.getFullName()];
    expect(metadata?.mappings?.properties?.title?.type).toBe('text');
    expect(Object.keys(metadata?.aliases ?? {})).toEqual([
      aliased.getAliasName(),
    ]);
  });

  it('should name the concrete index when read through the alias', async () => {
    const res = await aliased.getIndexMetadata({
      index: aliased.getAliasName(),
    });
    expect(res.error).toBe(null);
    expect(res.name).toBe(aliased.getFullName());
    expect(res.request.endpoint).toBe(`/${aliased.getAliasName()}`);
  });

  it('should list no indexes for a missing alias', async () => {
    const res = await indexOnly.getAliasMetadata();
    expect(res).toMatchObject({ success: true, indexes: [], error: null });
  });

  it('should list the one index an alias points at', async () => {
    const res = await aliased.getAliasMetadata();
    expect(res).toMatchObject({ success: true, error: null });
    expect(res.indexes).toEqual([aliased.getFullName()]);
  });

  it('should list the found indexes when only some aliases exist', async () => {
    const res = await aliased.getAliasMetadata({
      name: [aliased.getAliasName(), indexOnly.getAliasName()],
    });
    expect(res).toMatchObject({ success: true, error: null });
    expect(res.indexes).toEqual([aliased.getFullName()]);
  });

  it('should report a nonexistent more.index as an error (S-039)', async () => {
    const res = await aliased.getAliasMetadata({
      index: missing.getFullName(),
    });
    expect(res.success).toBe(false);
    expect(res.indexes).toEqual([]);
    expect(res.errorKind).toBe('response');
    expect(res.response?.statusCode).toBe(404);
    expect(getErrorType(res.response)).toBe('index_not_found_exception');
  });

  it('should flush an index that has no alias yet (S-038)', async () => {
    // serverless: false sends the request even on Elastic Cloud Serverless,
    // which rejects it as unavailable, and flush() reports a skip
    const fresh = getManager('flushme', { serverless: false });
    const created = await fresh.createOnly();
    expect(created.error).toBe(null);
    const res = await fresh.flush();
    expect(res.error).toBe(null);
    expect(res.success).toBe(true);
    expect(res.skipped).toBe(kit.caps.serverless);
    expect(res.request.endpoint).toBe(`/${fresh.getFullName()}/_flush`);
  });

  it('should classify a real 404 as a response error', async () => {
    const res = await missing.getIndexMetadata();
    expect(res.name).toBe(null);
    expect(res.errorKind).toBe('response');
    expect(res.error?.name).toBe('ResponseError');
    expect(res.response?.statusCode).toBe(404);
    expect(getErrorType(res.response)).toBe('index_not_found_exception');
  });

  it('should classify a real 400 as a response error', async () => {
    const features = ['bogus'] as unknown as estypes.IndicesGetFeatures;
    const res = await aliased.getIndexMetadata({ features });
    expect(res.name).toBe(null);
    expect(res.errorKind).toBe('response');
    expect(res.response?.statusCode).toBe(400);
    expect(getErrorType(res.response)).toBe('illegal_argument_exception');
  });
});

describe('IndexManager on an unreachable cluster - Integration', () => {
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

  it('should resolve every metadata call with a connection error', async () => {
    const index = new IndexManager(
      { client: closedClient, prefix: kit.prefix, serverless: false },
      getBooksCreateRequest('unreachable'),
    );
    const results = {
      exists: await index.exists(),
      aliasExists: await index.aliasExists(),
      getIndexMetadata: await index.getIndexMetadata(),
      getAliasMetadata: await index.getAliasMetadata(),
      flush: await index.flush(),
      drop: await index.drop(),
    };
    for (const [method, res] of Object.entries(results)) {
      expect([method, res.errorKind]).toEqual([method, 'connection']);
      expect(res.error).toBeInstanceOf(Error);
      expect(res.response).toBe(null);
    }
    expect(results.exists.exists).toBe(null);
    expect(results.aliasExists.exists).toBe(null);
    expect(results.getAliasMetadata.success).toBe(false);
    expect(results.flush.success).toBe(false);
    expect(results.drop.acknowledged).toBe(false);
  });
});
