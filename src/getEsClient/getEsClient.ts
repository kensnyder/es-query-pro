import { Client } from '@elastic/elasticsearch';

export default function getEsClient() {
  const client = new Client({
    node: process.env.ES_ENDPOINT,
    auth: {
      username: process.env.ES_USERNAME,
      password: process.env.ES_PASSWORD,
    },
    // ES uses http.Agent which is only a stub on Cloudflare Workers
    // see https://github.com/jhiesey/stream-http#features-missing-compared-to-node
    // which is a dependency of https://www.npmjs.com/package/node-libs-browser
    // which cfw uses internally
    // agent: false,
  });
  return client;
}

