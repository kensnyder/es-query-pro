import {
  Client,
  type ClientOptions,
  HttpConnection,
} from '@elastic/elasticsearch';

/**
 * The environment variables the test client reads. `process.env` fits.
 */
export type TestClientEnv = Record<string, string | undefined>;

/**
 * Build client options from ES_ENDPOINT plus ES_API_KEY, or ES_USERNAME and
 * ES_PASSWORD when no API key is set.
 */
export function getTestClientOptions(env: TestClientEnv): ClientOptions {
  let auth: ClientOptions['auth'];
  if (env.ES_API_KEY) {
    auth = { apiKey: env.ES_API_KEY };
  } else {
    auth = {
      username: env.ES_USERNAME || '',
      password: env.ES_PASSWORD || '',
    };
  }
  return {
    node: env.ES_ENDPOINT || 'http://localhost:9200',
    auth,
    Connection: HttpConnection,
  };
}

let testClient: Client | undefined;

/**
 * The Elasticsearch client tests use, configured from `process.env`.
 * One client is shared by the whole process.
 */
export function getTestClient(): Client {
  if (!testClient) {
    testClient = new Client(getTestClientOptions(process.env));
  }
  return testClient;
}
