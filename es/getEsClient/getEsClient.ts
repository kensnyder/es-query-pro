const {
  ES_ENDPOINT,
  ES_USERNAME,
  ES_PASSWORD,
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
} = require('../../libs/secrets/secrets.js');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const { Client } = require('@elastic/elasticsearch');

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'getEsClien... Remove this comment to see the full error message
function getEsClient() {
  const client = new Client({
    // @ts-expect-error TS(2580): Cannot find name 'process'. Do you need to install... Remove this comment to see the full error message
    node: process.env.ES_ENDPOINT,
    auth: {
      // @ts-expect-error TS(2580): Cannot find name 'process'. Do you need to install... Remove this comment to see the full error message
      username: process.env.ES_USERNAME,
      // @ts-expect-error TS(2580): Cannot find name 'process'. Do you need to install... Remove this comment to see the full error message
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

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = getEsClient;
