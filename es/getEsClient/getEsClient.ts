const {
  ES_ENDPOINT,
  ES_USERNAME,
  ES_PASSWORD,
} = require('../../libs/secrets/secrets.js');
const { Client } = require('@elastic/elasticsearch');

function getEsClient() {
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
    agent: false,
  });
  return client;
}

module.exports = getEsClient;
