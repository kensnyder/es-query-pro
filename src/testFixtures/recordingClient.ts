import { Client } from '@elastic/elasticsearch';
import {
  BaseConnection,
  type ConnectionRequestOptions,
  type ConnectionRequestParams,
} from '@elastic/transport';

export type SentRequest = {
  method: string;
  path: string;
  body: unknown;
};

/**
 * A client that sends nothing and records what would have gone over the wire,
 * so these tests check the request Elasticsearch receives, not only the
 * arguments passed to the client.
 */
export function getRecordingClient() {
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
