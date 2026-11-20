import { describe, expect, expectTypeOf, it, spyOn } from 'bun:test';
import { type Client, errors } from '@elastic/elasticsearch';
import type QueryRunner from '../QueryRunner/QueryRunner';
import {
  connectionError,
  getRecordingClient,
  responseError,
  thrownError,
} from '../testFixtures/recordingClient';
import IndexManager, {
  type IndexErrorKind,
  type IndexErrorShape,
  type IndexRunShape,
} from './IndexManager';

const FULL = 'test~english~books~v1';
const ALIAS = 'test~english~books';

const booksCreate = {
  index: 'books',
  mappings: { properties: { id: { type: 'keyword' } } },
} as const;

function getBooks(client: Client) {
  // serverless: false so flush() sends its request regardless of .env
  return new IndexManager(
    { client, version: 1, prefix: 'test', serverless: false },
    booksCreate,
  );
}

/** A client whose every request rejects with `thrown` */
function getThrowingClient(thrown: unknown) {
  const fail = async () => {
    throw thrown;
  };
  return {
    indices: {
      exists: fail,
      existsAlias: fail,
      get: fail,
      getAlias: fail,
      flush: fail,
      delete: fail,
      deleteAlias: fail,
    },
  } as unknown as Client;
}

/** The 404 Elasticsearch sends for `GET /_alias/<name>` with no such alias */
function aliasMissing(name: string, found: Record<string, unknown> = {}) {
  return {
    status: 404,
    body: { error: `alias [${name}] missing`, status: 404, ...found },
  };
}

const envelopeKeys = ['error', 'errorKind', 'request', 'response', 'took'];

describe('IndexManager._formatError() kinds (S-001)', () => {
  const index = getBooks({} as Client);
  const kinds: [string, IndexErrorKind][] = [
    ['ResponseError', 'response'],
    ['ConnectionError', 'connection'],
    ['TimeoutError', 'timeout'],
    ['NoLivingConnectionsError', 'disconnected'],
    ['RequestAbortedError', 'aborted'],
    ['SerializationError', 'serialization'],
    ['DeserializationError', 'serialization'],
    ['ProductNotSupportedError', 'product'],
    ['ConfigurationError', 'configuration'],
    ['ElasticsearchClientError', 'javascript'],
  ];

  it('should classify every client error name', () => {
    for (const [name, kind] of kinds) {
      const error = new Error('failed');
      error.name = name;
      expect([name, index._formatError(error).errorKind]).toEqual([name, kind]);
    }
  });

  it('should classify the client package classes', () => {
    const meta = {} as any;
    const cases: [Error, IndexErrorKind][] = [
      [new errors.RequestAbortedError('aborted'), 'aborted'],
      [new errors.SerializationError('bad', {}), 'serialization'],
      [new errors.DeserializationError('bad', 'x'), 'serialization'],
      [new errors.ProductNotSupportedError('Elasticsearch', meta), 'product'],
      [new errors.ConfigurationError('bad'), 'configuration'],
    ];
    for (const [error, kind] of cases) {
      expect(index._formatError(error).errorKind).toBe(kind);
    }
  });

  it('should classify errors raised by the client while sending', async () => {
    const { client, script } = getRecordingClient();
    script(`HEAD /${FULL}`, thrownError('RequestAbortedError', 'aborted'));
    expect((await getBooks(client).exists()).errorKind).toBe('aborted');
    script(`HEAD /${FULL}`, thrownError('DeserializationError', 'bad json'));
    expect((await getBooks(client).exists()).errorKind).toBe('serialization');
  });

  it('should classify a server that is not Elasticsearch', async () => {
    const { client, script } = getRecordingClient();
    script(`GET /${FULL}`, {
      body: { [FULL]: {} },
      headers: { 'x-elastic-product': 'NotElasticsearch' },
    });
    const res = await getBooks(client).getIndexMetadata();
    expect(res.errorKind).toBe('product');
    expect(res.error?.name).toBe('ProductNotSupportedError');
    expect(res.response).toBe(null);
  });
});

describe('IndexManager._formatError() error value', () => {
  const index = getBooks({} as Client);

  it('should keep Error instances', () => {
    const error = new TypeError('oops');
    expect(index._formatError(error).error).toBe(error);
  });

  it('should always give an Error, even for null or undefined', () => {
    for (const value of [null, undefined, 'a string', 42]) {
      const { error } = index._formatError(value);
      expect(error).toBeInstanceOf(Error);
      expect(error.cause).toBe(value);
    }
    expect(index._formatError('a string').error.message).toBe('a string');
  });

  it('should keep the name and message of error-like objects', () => {
    const value = { name: 'ConnectionError', message: 'down' };
    const formatted = index._formatError(value);
    expect(formatted.error).toBeInstanceOf(Error);
    expect(formatted.error.name).toBe('ConnectionError');
    expect(formatted.error.message).toBe('down');
    expect(formatted.errorKind).toBe('connection');
  });
});

describe('IndexManager._formatNonError()', () => {
  it('should give null error and errorKind with the response', () => {
    const response = { acknowledged: true };
    const formatted = getBooks({} as Client)._formatNonError(response);
    expect(formatted).toEqual({ error: null, errorKind: null, response });
    expect(formatted.response).toBe(response);
  });
});

describe('IndexManager.exists()', () => {
  it('should send HEAD for the full name and report true', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).exists();
    expect(sent[0]).toMatchObject({ method: 'HEAD', path: `/${FULL}` });
    expect(res.exists).toBe(true);
    expect(res.error).toBe(null);
    expect(res.request.endpoint).toBe(`/${FULL}`);
    expect(Object.keys(res).sort()).toEqual(['exists', ...envelopeKeys].sort());
  });

  it('should report false on 404', async () => {
    const { client, script } = getRecordingClient();
    script(`HEAD /${FULL}`, { status: 404 });
    const res = await getBooks(client).exists();
    expect(res.exists).toBe(false);
    expect(res.error).toBe(null);
  });

  it('should report null and the error kind on failure', async () => {
    const { client, script } = getRecordingClient();
    script(`HEAD /${FULL}`, connectionError());
    const res = await getBooks(client).exists();
    expect(res.exists).toBe(null);
    expect(res.errorKind).toBe('connection');
    expect(res.error?.name).toBe('ConnectionError');
  });

  it('should describe the overridden index in request.endpoint (S-040)', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).exists({ index: ['a', 'b'] });
    expect(decodeURIComponent(sent[0].path)).toBe('/a,b');
    expect(res.request.endpoint).toBe('/a,b');
  });
});

describe('IndexManager.aliasExists() (B-007)', () => {
  it('should send HEAD for the alias and report true', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).aliasExists();
    expect(sent[0]).toMatchObject({ method: 'HEAD', path: `/_alias/${ALIAS}` });
    expect(res.exists).toBe(true);
    expect(res.error).toBe(null);
    expect(Object.keys(res).sort()).toEqual(['exists', ...envelopeKeys].sort());
  });

  it('should report false on 404', async () => {
    const { client, script } = getRecordingClient();
    script(`HEAD /_alias/${ALIAS}`, { status: 404 });
    const res = await getBooks(client).aliasExists();
    expect(res.exists).toBe(false);
    expect(res.error).toBe(null);
  });

  it('should return the error envelope without logging', async () => {
    const log = spyOn(console, 'log');
    try {
      const { client, script } = getRecordingClient();
      script(`HEAD /_alias/${ALIAS}`, connectionError());
      const res = await getBooks(client).aliasExists();
      expect(res.exists).toBe(null);
      expect(res.errorKind).toBe('connection');
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('should report other response errors as errors', async () => {
    const { client, script } = getRecordingClient();
    script(`HEAD /_alias/${ALIAS}`, { status: 500 });
    const res = await getBooks(client).aliasExists();
    expect(res.exists).toBe(null);
    expect(res.errorKind).toBe('response');
    // errorKind narrows the response to the error metadata
    const status = res.errorKind === 'response' && res.response?.statusCode;
    expect(status).toBe(500);
  });

  it('should resolve when the client throws a non-Error', async () => {
    for (const thrown of [undefined, null, 'boom']) {
      const res = await getBooks(getThrowingClient(thrown)).aliasExists();
      expect(res.exists).toBe(null);
      expect(res.error).toBeInstanceOf(Error);
      expect(res.errorKind).toBe('javascript');
    }
  });

  it('should describe the overridden alias in request.endpoint (S-040)', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).aliasExists({ name: 'x', index: 'i' });
    expect(sent[0].path).toBe('/i/_alias/x');
    expect(res.request.endpoint).toBe('/i/_alias/x');
  });
});

describe('IndexManager.drop() never rejects (B-007)', () => {
  it('should resolve with the error when the cluster is unreachable', async () => {
    const { client, script } = getRecordingClient();
    script(/.*/, connectionError());
    const res = await getBooks(client).drop();
    expect(res.acknowledged).toBe(false);
    expect(res.errorKind).toBe('connection');
  });

  it('should not depend on the alias check (B-006)', async () => {
    const { client, script, sent } = getRecordingClient();
    script(`DELETE /${FULL}`, { body: { acknowledged: true } });
    const index = getBooks(client);
    index.aliasExists = async () => {
      throw new TypeError('alias check failed');
    };
    const res = await index.drop();
    expect(res.acknowledged).toBe(true);
    expect(res.error).toBe(null);
    expect(sent.map((req) => `${req.method} ${req.path}`)).toEqual([
      `DELETE /${encodeURIComponent(FULL)}`,
    ]);
  });

  it('should resolve when the client throws a non-Error', async () => {
    const res = await getBooks(getThrowingClient(undefined)).drop();
    expect(res.acknowledged).toBe(false);
    expect(res.error).toBeInstanceOf(Error);
  });
});

describe('IndexManager.getIndexMetadata()', () => {
  it('should name the concrete index the response is keyed by', async () => {
    const { client, script, sent } = getRecordingClient();
    script(`GET /${ALIAS}`, { body: { [FULL]: { aliases: {} } } });
    const res = await getBooks(client).getIndexMetadata({ index: ALIAS });
    expect(sent[0].path).toBe(`/${ALIAS}`);
    expect(res.name).toBe(FULL);
    expect(res.error).toBe(null);
    expect(res.request.endpoint).toBe(`/${ALIAS}`);
    expect(Object.keys(res).sort()).toEqual(['name', ...envelopeKeys].sort());
  });

  it('should report a missing index as a response error', async () => {
    const { client, script } = getRecordingClient();
    script(`GET /${FULL}`, responseError(404, 'index_not_found_exception'));
    const res = await getBooks(client).getIndexMetadata();
    expect(res.name).toBe(null);
    expect(res.errorKind).toBe('response');
    expect(res.response?.statusCode).toBe(404);
  });

  it('should report connection errors', async () => {
    const { client, script } = getRecordingClient();
    script(`GET /${FULL}`, connectionError());
    const res = await getBooks(client).getIndexMetadata();
    expect(res.name).toBe(null);
    expect(res.errorKind).toBe('connection');
  });
});

describe('IndexManager.getAliasMetadata() (S-039)', () => {
  it('should list the indexes the alias points at', async () => {
    const { client, script, sent } = getRecordingClient();
    script(`GET /_alias/${ALIAS}`, {
      body: { [FULL]: { aliases: { [ALIAS]: {} } } },
    });
    const res = await getBooks(client).getAliasMetadata();
    expect(sent[0].path).toBe(`/_alias/${ALIAS}`);
    expect(res.success).toBe(true);
    expect(res.indexes).toEqual([FULL]);
    expect(res.error).toBe(null);
    const keys = ['indexes', 'success', ...envelopeKeys].sort();
    expect(Object.keys(res).sort()).toEqual(keys);
  });

  it('should report no indexes when the alias is missing', async () => {
    const { client, script } = getRecordingClient();
    script(`GET /_alias/${ALIAS}`, aliasMissing(ALIAS));
    const res = await getBooks(client).getAliasMetadata();
    expect(res.success).toBe(true);
    expect(res.indexes).toEqual([]);
    expect(res.error).toBe(null);
    expect(res.errorKind).toBe(null);
  });

  it('should keep the indexes found when only some names are missing', async () => {
    const { client, script } = getRecordingClient();
    const found = { [FULL]: { aliases: { [ALIAS]: {} } } };
    script('GET /_alias/*', aliasMissing('other', found));
    const res = await getBooks(client).getAliasMetadata({
      name: [ALIAS, 'other'],
    });
    expect(res.success).toBe(true);
    expect(res.indexes).toEqual([FULL]);
    expect(res.response).toEqual(found);
  });

  it('should report a missing index as an error, not as no alias', async () => {
    const { client, script, sent } = getRecordingClient();
    script(
      'GET /nope/_alias/*',
      responseError(404, 'index_not_found_exception'),
    );
    const res = await getBooks(client).getAliasMetadata({ index: 'nope' });
    expect(sent[0].path).toBe(`/nope/_alias/${ALIAS}`);
    expect(res.request.endpoint).toBe(`/nope/_alias/${ALIAS}`);
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe('response');
    expect(res.response?.statusCode).toBe(404);
  });

  it('should report a 404 without an Elasticsearch body as an error', async () => {
    const { client, script } = getRecordingClient();
    script(`GET /_alias/${ALIAS}`, {
      status: 404,
      body: 'Not Found',
      headers: { 'content-type': 'text/plain' },
    });
    const res = await getBooks(client).getAliasMetadata();
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe('response');
  });

  it('should report connection errors', async () => {
    const { client, script } = getRecordingClient();
    script(`GET /_alias/${ALIAS}`, connectionError());
    const res = await getBooks(client).getAliasMetadata();
    expect(res.success).toBe(false);
    expect(res.indexes).toEqual([]);
    expect(res.errorKind).toBe('connection');
  });
});

describe('IndexManager.flush() target (S-038)', () => {
  it('should flush the full name, not the alias', async () => {
    const { client, script, sent } = getRecordingClient();
    script('/*/_flush', { body: { _shards: { total: 1, failed: 0 } } });
    const res = await getBooks(client).flush();
    expect(sent[0]).toMatchObject({ path: `/${FULL}/_flush` });
    expect(res.request.endpoint).toBe(`/${FULL}/_flush`);
    expect(res.success).toBe(true);
    expect(res.skipped).toBe(false);
  });

  it('should describe an overridden index in request.endpoint', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).flush({ index: ALIAS });
    expect(sent[0].path).toBe(`/${ALIAS}/_flush`);
    expect(res.request.endpoint).toBe(`/${ALIAS}/_flush`);
  });

  it('should report a missing index as a response error', async () => {
    const { client, script } = getRecordingClient();
    script('/*/_flush', responseError(404, 'index_not_found_exception'));
    const res = await getBooks(client).flush();
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe('response');
  });
});

/**
 * Type-level tests, enforced by `bun run typecheck`
 */
describe('IndexManager metadata types', () => {
  it('should export the error envelope, not the function type (B-077)', () => {
    expectTypeOf<IndexErrorShape['error']>().toEqualTypeOf<Error>();
    expectTypeOf<
      IndexErrorShape['errorKind']
    >().toEqualTypeOf<IndexErrorKind>();
    expectTypeOf<IndexErrorShape>().toHaveProperty('response');
    expectTypeOf<
      ReturnType<IndexManager['_formatError']>
    >().toEqualTypeOf<IndexErrorShape>();
    expect(true).toBe(true);
  });

  it('should list every error kind (S-001)', () => {
    expectTypeOf<IndexErrorKind>().toEqualTypeOf<
      | 'response'
      | 'connection'
      | 'timeout'
      | 'disconnected'
      | 'aborted'
      | 'serialization'
      | 'product'
      | 'configuration'
      | 'javascript'
    >();
    expect(true).toBe(true);
  });

  it('should type IndexRunShape as the runner run() passes (S-037)', () => {
    const books = getBooks({} as Client);
    type Runner = IndexRunShape<typeof books>;
    expectTypeOf<Runner>().toEqualTypeOf<QueryRunner<typeof booksCreate>>();
    expectTypeOf<Runner>().not.toBeUnknown();
    expectTypeOf<
      Parameters<Parameters<typeof books.run>[0]>[0]
    >().toEqualTypeOf<Runner>();
    expect(true).toBe(true);
  });

  it('should type the success envelope', () => {
    const books = getBooks({} as Client);
    const ok = books._formatNonError({ a: 1 });
    expectTypeOf(ok.error).toEqualTypeOf<null>();
    expectTypeOf(ok.errorKind).toEqualTypeOf<null>();
    expectTypeOf(ok.response).toEqualTypeOf<{ a: number }>();
    expect(ok.response.a).toBe(1);
  });
});
