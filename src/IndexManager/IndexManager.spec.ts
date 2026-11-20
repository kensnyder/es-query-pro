import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from 'bun:test';
import { Client, errors, type estypes } from '@elastic/elasticsearch';
import {
  BaseConnection,
  type ConnectionRequestOptions,
  type ConnectionRequestParams,
} from '@elastic/transport';
import {
  getAllFields,
  getFulltextFields,
} from '../mappingFields/mappingFields';
import { getRecordingClient } from '../testFixtures/recordingClient';
import IndexManager, {
  type IndexInferCreate,
  type IndexInferFields,
  type IndexInferRecordShape,
  type ManageOptions,
} from './IndexManager';

function getBooksIndex(client: Client, options: { serverless?: boolean } = {}) {
  return new IndexManager(
    { client, ...options, version: 1, prefix: 'test', language: 'english' },
    {
      index: 'books',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: { type: 'text' },
          body: { type: 'text' },
          year: { type: 'integer' },
        },
      },
    },
  );
}

/** A client that must never be called */
const stubClient = {} as Client;

describe('IndexManager constructor', () => {
  it('should build names from create.index and the defaults', () => {
    const index = new IndexManager({ client: stubClient }, { index: 'books' });
    expect(index.getFullName()).toBe('english~books~v1');
    expect(index.getAliasName()).toBe('english~books');
  });

  it('should build names from each naming option', () => {
    const index = new IndexManager(
      {
        client: stubClient,
        separator: '.',
        version: 3,
        prefix: 'prod',
        language: 'french',
      },
      { index: 'books' },
    );
    expect(index.getFullName()).toBe('prod.french.books.v3');
    expect(index.getAliasName()).toBe('prod.french.books');
    expect(index.index.name).toBe('books');
    expect(index.index.version).toBe(3);
  });

  it('should accept a string version', () => {
    const index = new IndexManager(
      { client: stubClient, version: '2024a' },
      { index: 'books' },
    );
    expect(index.getFullName()).toBe('english~books~v2024a');
  });

  it('should throw on an invalid create.index', () => {
    expect(() => {
      return new IndexManager({ client: stubClient }, { index: 'Books!' });
    }).toThrow('Books!');
    expect(() => {
      return new IndexManager({ client: stubClient }, { index: 'a~b' });
    }).toThrow();
  });

  it('should throw a TypeError when options are missing', () => {
    expect(() => {
      // options are required (a compile error only under strictNullChecks)
      return new IndexManager(undefined as never, { index: 'books' });
    }).toThrow(TypeError);
    expect(() => {
      // options are required (a compile error only under strictNullChecks)
      return new IndexManager(undefined as never, { index: 'books' });
    }).toThrow(/options/);
  });

  it('should throw a TypeError when the client is missing', () => {
    expect(() => {
      // @ts-expect-error  client is required
      return new IndexManager({ prefix: 'test' }, { index: 'books' });
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error  client is required
      return new IndexManager({ prefix: 'test' }, { index: 'books' });
    }).toThrow(/client/);
  });

  it('should throw a TypeError when the creation request is missing', () => {
    expect(() => {
      // @ts-expect-error  the creation request is required
      return new IndexManager({ client: stubClient });
    }).toThrow(TypeError);
  });

  it('should throw when create.aliases contains its own alias name', () => {
    expect(() => {
      return new IndexManager(
        { client: stubClient, prefix: 'test' },
        { index: 'books', aliases: { 'test~english~books': {} } },
      );
    }).toThrow('test~english~books');
  });

  it('should accept other aliases in create.aliases', () => {
    const index = new IndexManager(
      { client: stubClient, prefix: 'test' },
      { index: 'books', aliases: { 'books-read': {} } },
    );
    expect(index.createSpec.aliases).toEqual({ 'books-read': {} });
  });

  it('should keep the client, serverless flag and specification', () => {
    const create = { index: 'books' };
    const index = new IndexManager(
      { client: stubClient, serverless: true },
      create,
    );
    expect(index.client).toBe(stubClient);
    expect(index.serverless).toBe(true);
    expect(index.createSpec).toBe(create);
  });

  it('should compute allFields and fulltextFields from the mapping', () => {
    const create = {
      index: 'books',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: {
            type: 'text',
            fields: {
              exact: { type: 'keyword' },
              stems: { type: 'text', analyzer: 'english' },
            },
          },
          summary: { type: 'match_only_text' },
          categories: {
            type: 'nested',
            properties: {
              id: { type: 'integer' },
              name: { type: 'text' },
            },
          },
        },
        runtime: { day: { type: 'keyword' } },
      },
    } satisfies estypes.IndicesCreateRequest;
    const index = new IndexManager({ client: stubClient }, create);
    expect(index.allFields).toEqual(getAllFields(create));
    expect(index.fulltextFields).toEqual(getFulltextFields(create));
    expect(index.allFields).toEqual([
      'id',
      'title',
      'summary',
      'categories.id',
      'categories.name',
      'day',
    ]);
    expect(index.fulltextFields).toEqual([
      'title',
      'summary',
      'categories.name',
    ]);
  });

  it('should have empty field lists without mappings', () => {
    const index = new IndexManager({ client: stubClient }, { index: 'books' });
    expect(index.allFields).toEqual([]);
    expect(index.fulltextFields).toEqual([]);
  });
});

describe('IndexManager.getCreateRequest()', () => {
  function getSpec(): estypes.IndicesCreateRequest {
    return {
      index: 'books',
      settings: {
        analysis: {
          analyzer: {
            englishplus: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase'],
            },
          },
        },
      },
      mappings: {
        properties: {
          title: {
            type: 'text',
            analyzer: 'englishplus',
            fields: { exact: { type: 'keyword', ignore_above: 256 } },
          },
        },
      },
      aliases: { 'books-read': { is_hidden: true } },
      wait_for_active_shards: 1,
      timeout: '30s',
    };
  }

  it('should use the full name and pass everything else through', () => {
    const spec = getSpec();
    const index = new IndexManager(
      { client: stubClient, prefix: 'test', version: 2 },
      spec,
    );
    const request = index.getCreateRequest();
    expect(request.method).toBe('PUT');
    expect(request.endpoint).toBe('/test~english~books~v2');
    expect(request.body).toEqual({
      ...getSpec(),
      index: 'test~english~books~v2',
    });
  });

  it('should let "more" override the specification', () => {
    const index = new IndexManager({ client: stubClient }, getSpec());
    const request = index.getCreateRequest({
      timeout: '5s',
      settings: { number_of_replicas: 0 },
    });
    expect(request.body.timeout).toBe('5s');
    expect(request.body.settings).toEqual({ number_of_replicas: 0 });
    expect(request.body.mappings).toEqual(getSpec().mappings);
  });

  it('should not change createSpec or the caller object', () => {
    const spec = getSpec();
    const index = new IndexManager({ client: stubClient }, spec);
    const request = index.getCreateRequest({ timeout: '5s' });
    request.body.mappings = {};
    expect(spec).toEqual(getSpec());
    expect(index.createSpec).toEqual(getSpec());
    expect(index.createSpec.index).toBe('books');
  });

  it('should send that body from createOnly()', async () => {
    const { client, sent } = getRecordingClient();
    const spec = getSpec();
    delete spec.wait_for_active_shards;
    delete spec.timeout;
    const index = new IndexManager({ client, prefix: 'test' }, spec);
    const res = await index.createOnly();
    expect(res.error).toBe(null);
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('PUT');
    expect(sent[0].path).toBe('/test~english~books~v1');
    expect(sent[0].body).toEqual({
      settings: spec.settings,
      mappings: spec.mappings,
      aliases: spec.aliases,
    });
  });
});

describe('IndexManager._formatError()', () => {
  const index = getBooksIndex(stubClient);
  const kinds = [
    ['ResponseError', 'response'],
    ['ConnectionError', 'connection'],
    ['TimeoutError', 'timeout'],
    ['NoLivingConnectionsError', 'disconnected'],
  ] as const;

  it('should classify Errors by name', () => {
    for (const [name, kind] of kinds) {
      const error = new Error('failed');
      error.name = name;
      const formatted = index._formatError(error);
      expect(formatted.errorKind).toBe(kind);
      expect(formatted.error).toBe(error);
    }
  });

  it('should classify plain objects by name', () => {
    for (const [name, kind] of kinds) {
      const error = { name, message: 'failed' };
      expect(index._formatError(error).errorKind).toBe(kind);
    }
  });

  it('should classify a different class with the same name', () => {
    // e.g. a second copy of the client package in the application
    class ResponseError extends Error {
      meta = { statusCode: 400, body: { error: { type: 'x' } } };
      constructor() {
        super('bad request');
        this.name = 'ResponseError';
      }
    }
    const error = new ResponseError();
    const formatted = index._formatError(error);
    expect(formatted.errorKind).toBe('response');
    expect(formatted.response).toBe(error.meta);
  });

  it('should classify the client package errors', () => {
    expect(
      index._formatError(new errors.ConnectionError('down')).errorKind,
    ).toBe('connection');
    expect(index._formatError(new errors.TimeoutError('slow')).errorKind).toBe(
      'timeout',
    );
    expect(
      index._formatError(new errors.NoLivingConnectionsError('none', {} as any))
        .errorKind,
    ).toBe('disconnected');
  });

  it('should give null response for non-response errors', () => {
    const error = new Error('down');
    error.name = 'ConnectionError';
    expect(index._formatError(error).response).toBe(null);
  });

  it('should classify anything else as javascript', () => {
    const values: unknown[] = [
      new TypeError('oops'),
      { name: 'SomethingElse' },
      { name: 42 },
      'a string',
      null,
      undefined,
    ];
    for (const value of values) {
      const formatted = index._formatError(value);
      expect(formatted.errorKind).toBe('javascript');
      expect(formatted.response).toBe(null);
    }
  });
});

describe('IndexManager.put()', () => {
  it('should send the record itself as the document', async () => {
    const { client, sent } = getRecordingClient();
    const record = { id: 'b1', title: 'Dune', body: 'Arrakis', year: 1965 };
    const res = await getBooksIndex(client).put('b1', record);
    expect(res.error).toBe(null);
    expect(res.result).toBe('updated');
    expect(sent).toEqual([
      { method: 'PUT', path: '/test~english~books/_doc/b1', body: record },
    ]);
  });

  it('should not nest the record under a "body" key', async () => {
    const { client, sent } = getRecordingClient();
    const record = { id: '7', title: 'Emma', body: 'Highbury', year: 1815 };
    await getBooksIndex(client).put(7, record);
    expect(sent[0].path).toBe('/test~english~books/_doc/7');
    expect(sent[0].body).toEqual(record);
  });

  it('should name the record "document" when calling the client', async () => {
    // Clients other than @elastic/elasticsearch do not treat `body` as the
    // record: elasticsearch-fetch stored `{ body: record }` when given one.
    const calls: Record<string, unknown>[] = [];
    const client = {
      index: async (params: Record<string, unknown>) => {
        calls.push(params);
        return { result: 'created' };
      },
    } as unknown as Client;
    const record = { id: 'b1', title: 'Dune', body: 'Arrakis', year: 1965 };
    const res = await getBooksIndex(client).put('b1', record);
    expect(res.result).toBe('created');
    expect(calls).toEqual([
      { index: 'test~english~books', id: 'b1', document: record },
    ]);
  });
});

describe('IndexManager.patch()', () => {
  it('should send the fields to merge under "doc"', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooksIndex(client).patch('b1', { year: 1966 });
    expect(res.error).toBe(null);
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/test~english~books/_update/b1',
        body: { doc: { year: 1966 } },
        // IM3 (S-014): patch() retries conflicting updates by default
        querystring: 'retry_on_conflict=3',
      },
    ]);
  });

  it('should keep a field named "body" inside "doc"', async () => {
    const { client, sent } = getRecordingClient();
    await getBooksIndex(client).patch('b1', { body: 'Caladan' });
    expect(sent[0].body).toEqual({ doc: { body: 'Caladan' } });
  });

  it('should send additional params beside "doc"', async () => {
    const { client, sent } = getRecordingClient();
    await getBooksIndex(client).patch(
      'b1',
      { year: 1966 },
      { doc_as_upsert: true },
    );
    expect(sent[0].body).toEqual({ doc: { year: 1966 }, doc_as_upsert: true });
  });
});

/**
 * A client whose every request gets the given status code and JSON body.
 * `requests.count` is how many requests were sent.
 */
function getRespondingClient(statusCode: number, body: unknown) {
  const requests = { count: 0 };
  class RespondingConnection extends BaseConnection {
    async request(
      _params: ConnectionRequestParams,
      _options: ConnectionRequestOptions,
    ): Promise<any> {
      requests.count++;
      return {
        statusCode,
        headers: {
          'content-type': 'application/json',
          'x-elastic-product': 'Elasticsearch',
        },
        body: JSON.stringify(body),
      };
    }
  }
  const client = new Client({
    node: 'http://localhost:9200',
    Connection: RespondingConnection,
  });
  return { client, requests };
}

function getFlushOkClient() {
  return getRespondingClient(200, {
    _shards: { total: 1, successful: 1, failed: 0 },
  });
}

/**
 * The response Elastic Cloud Serverless gives for _flush
 */
function getServerlessClient() {
  const reason =
    'Request for uri [/test~english~books/_flush] with method [GET] ' +
    'exists but is not available when running in serverless mode';
  return getRespondingClient(410, {
    error: {
      root_cause: [{ type: 'api_not_available_exception', reason }],
      type: 'api_not_available_exception',
      reason,
    },
    status: 410,
  });
}

describe('IndexManager.flush()', () => {
  // a contributor's .env may set ES_SERVERLESS; these tests control it
  const originalEnv = process.env.ES_SERVERLESS;
  beforeEach(() => {
    delete process.env.ES_SERVERLESS;
  });
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ES_SERVERLESS;
    } else {
      process.env.ES_SERVERLESS = originalEnv;
    }
  });

  it('should report success when no shards fail', async () => {
    const { client, requests } = getFlushOkClient();
    const res = await getBooksIndex(client).flush();
    expect(res.success).toBe(true);
    expect(res.skipped).toBe(false);
    expect(res.error).toBe(null);
    expect(requests.count).toBe(1);
  });

  it('should skip without error when the API is unavailable', async () => {
    const { client } = getServerlessClient();
    const res = await getBooksIndex(client).flush();
    expect(res.success).toBe(true);
    expect(res.skipped).toBe(true);
    expect(res.error).toBe(null);
    expect(res.errorKind).toBe(null);
  });

  it('should skip for any ResponseError-named api_not_available error', async () => {
    // e.g. thrown by a second copy of the client package
    const thrown = Object.assign(new Error('gone'), {
      name: 'ResponseError',
      meta: {
        statusCode: 410,
        body: { error: { type: 'api_not_available_exception' } },
      },
    });
    const client = {
      indices: {
        flush: async () => {
          throw thrown;
        },
      },
    } as unknown as Client;
    const res = await getBooksIndex(client).flush();
    expect(res.success).toBe(true);
    expect(res.skipped).toBe(true);
    expect(res.error).toBe(null);
  });

  it('should not skip for other errors with that body', async () => {
    const thrown = Object.assign(new Error('gone'), {
      name: 'SomethingElse',
      meta: { body: { error: { type: 'api_not_available_exception' } } },
    });
    const client = {
      indices: {
        flush: async () => {
          throw thrown;
        },
      },
    } as unknown as Client;
    const res = await getBooksIndex(client).flush();
    expect(res.success).toBe(false);
    expect(res.skipped).toBe(false);
    expect(res.errorKind).toBe('javascript');
  });

  it('should still report other errors', async () => {
    const { client } = getRespondingClient(404, {
      error: { type: 'index_not_found_exception', reason: 'no such index' },
      status: 404,
    });
    const res = await getBooksIndex(client).flush();
    expect(res.success).toBe(false);
    expect(res.skipped).toBe(false);
    expect(res.errorKind).toBe('response');
  });

  it('should send nothing when the serverless option is true', async () => {
    const { client, requests } = getFlushOkClient();
    const index = getBooksIndex(client, { serverless: true });
    const res = await index.flush();
    expect(res.success).toBe(true);
    expect(res.skipped).toBe(true);
    expect(res.error).toBe(null);
    expect(requests.count).toBe(0);
  });

  it('should send nothing when ES_SERVERLESS is true', async () => {
    for (const value of ['true', 'TRUE', '1']) {
      process.env.ES_SERVERLESS = value;
      const { client, requests } = getFlushOkClient();
      const res = await getBooksIndex(client).flush();
      expect(res.skipped).toBe(true);
      expect(requests.count).toBe(0);
    }
  });

  it('should flush when ES_SERVERLESS is not a true value', async () => {
    for (const value of ['false', '0', '']) {
      process.env.ES_SERVERLESS = value;
      const { client, requests } = getFlushOkClient();
      const res = await getBooksIndex(client).flush();
      expect(res.skipped).toBe(false);
      expect(requests.count).toBe(1);
    }
  });

  it('should let the serverless option override ES_SERVERLESS', async () => {
    process.env.ES_SERVERLESS = 'true';
    const { client, requests } = getFlushOkClient();
    const index = getBooksIndex(client, { serverless: false });
    const res = await index.flush();
    expect(res.skipped).toBe(false);
    expect(requests.count).toBe(1);
  });

  it('should stop sending flushes after the server rejects one', async () => {
    const { client, requests } = getServerlessClient();
    await getBooksIndex(client).flush();
    expect(requests.count).toBe(1);
    // remembered per client, so other indexes sharing it skip too
    const res = await getBooksIndex(client).flush();
    expect(res.skipped).toBe(true);
    expect(requests.count).toBe(1);
    // a different client is unaffected
    const other = getFlushOkClient();
    await getBooksIndex(other.client).flush();
    expect(other.requests.count).toBe(1);
  });
});

/**
 * Type-level tests. The `expectTypeOf` and `@ts-expect-error` assertions are
 * only enforced by `bunx tsc --noEmit -p .`; `bun test` runs the rest.
 */
describe('IndexManager types', () => {
  const typed = new IndexManager(
    { client: stubClient },
    {
      index: 'books',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: {
            type: 'text',
            fields: { exact: { type: 'keyword' } },
          },
          year: { type: 'integer' },
          categories: {
            type: 'nested',
            properties: { id: { type: 'integer' } },
          },
        },
      },
    },
  );
  const widenedSpec: estypes.IndicesCreateRequest = { index: 'books' };
  const widened = new IndexManager({ client: stubClient }, widenedSpec);

  it('should check record value types in put()', async () => {
    const { client } = getRecordingClient();
    const index = new IndexManager({ client }, typed.createSpec);
    await index.put('1', { id: '1', year: 2001, title: ['a', 'b'] });
    // @ts-expect-error  year is an integer
    await index.put('1', { year: 'nope' });
    // @ts-expect-error  categories.id is an integer
    await index.patch('1', { categories: [{ id: 'x' }] });
    // @ts-expect-error  records are objects
    await index.putBulk([['1']]);
    // a widened specification accepts any record
    await new IndexManager({ client }, widenedSpec).put('1', { year: 'x' });
    expect(true).toBe(true);
  });

  it('should infer the creation request and fields', () => {
    expectTypeOf<IndexInferCreate<typeof typed>>().toEqualTypeOf<
      typeof typed.createSpec
    >();
    expectTypeOf<IndexInferFields<typeof typed>>().toEqualTypeOf<
      'id' | 'title' | 'title.exact' | 'year' | 'categories' | 'categories.id'
    >();
    type Shape = IndexInferRecordShape<typeof typed>;
    expectTypeOf<{ year: 2001; categories: [{ id: 1 }] }>().toExtend<Shape>();
    expectTypeOf<{ year: '2001' }>().not.toExtend<Shape>();
    expectTypeOf<{ categories: [{ id: '1' }] }>().not.toExtend<Shape>();
    expect(typed.createSpec.index).toBe('books');
  });

  it('should fall back for a widened specification', () => {
    expectTypeOf<
      IndexInferCreate<typeof widened>
    >().toEqualTypeOf<estypes.IndicesCreateRequest>();
    expectTypeOf<IndexInferFields<typeof widened>>().toEqualTypeOf<string>();
    expectTypeOf<IndexInferRecordShape<typeof widened>>().toEqualTypeOf<
      Record<string, any>
    >();
    expect(widened.createSpec.index).toBe('books');
  });

  it('should hold differently-typed managers in IndexManager[]', () => {
    const all: IndexManager[] = [typed, widened, getBooksIndex(stubClient)];
    expect(all).toHaveLength(3);
  });

  it('should require a client in ManageOptions', () => {
    expectTypeOf<ManageOptions['client']>().toEqualTypeOf<Client>();
    // @ts-expect-error  client is required
    const options: ManageOptions = { prefix: 'x' };
    expect(options.prefix).toBe('x');
  });
});
