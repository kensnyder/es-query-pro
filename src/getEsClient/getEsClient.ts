import { Client, HttpConnection } from '@elastic/elasticsearch';

export default function getEsClient() {
  const version = process.env.ES_VERSION || '9';
  const auth = process.env.ES_API_KEY
    ? {
        apiKey: process.env.ES_API_KEY,
      }
    : {
        username: process.env.ES_USERNAME || '',
        password: process.env.ES_PASSWORD || '',
      };
  const client = new Client({
    node: process.env.ES_ENDPOINT || 'http://localhost:9200',
    auth,
    Connection: HttpConnection,
    // Explicitly set the API compatibility header
    headers: {
      Accept: `application/vnd.elasticsearch+json; compatible-with=${version}`,
    },
  });
  return client;
}
