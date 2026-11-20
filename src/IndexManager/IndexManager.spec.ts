import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Client } from '@elastic/elasticsearch';
import {
  BaseConnection,
  type ConnectionRequestOptions,
  type ConnectionRequestParams,
} from '@elastic/transport';
import IndexManager from './IndexManager';

type SentRequest = {
  method: string;
  path: string;
  body: unknown;
};

/**
 * A client that sends nothing and records what would have gone over the wire,
 * so these tests check the request Elasticsearch receives, not only the
 * arguments passed to the client.
 */
function getRecordingClient() {
  const sent: SentRequest[] = [];
  class RecordingConnection extends BaseConnection {
    async request(
      params: ConnectionRequestParams,
      _options: ConnectionRequestOptions,
    ): Promise<any> {
      sent.push({
        method: params.method,
        path: params.path,
        body:
          typeof params.body === 'string'
            ? JSON.parse(params.body)
            : params.body,
      });
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
          'x-elastic-product': 'Elasticsearch',
        },
        body: JSON.stringify({ result: 'updated' }),
      };
    }
  }
  const client = new Client({
    node: 'http://localhost:9200',
    Connection: RecordingConnection,
  });
  return { client, sent };
}

function getBooksIndex(client: Client, options: { serverless?: boolean } = {}) {
  return new IndexManager({
    client,
    ...options,
    index: { name: 'books', version: 1, prefix: 'test', language: 'english' },
    schema: { id: 'keyword', title: 'text', body: 'text', year: 'integer' },
  });
}

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
