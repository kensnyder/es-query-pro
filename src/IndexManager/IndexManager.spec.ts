import { describe, expect, it } from 'bun:test';
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

function getBooksIndex(client: Client) {
  return new IndexManager({
    client,
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
