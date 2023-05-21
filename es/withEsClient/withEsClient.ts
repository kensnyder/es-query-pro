// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'getEsClien... Remove this comment to see the full error message
const getEsClient = require('../getEsClient/getEsClient.js');

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'withEsClie... Remove this comment to see the full error message
async function withEsClient(handler: any) {
  const client = getEsClient();
  let result = null;
  let error = null;
  try {
    result = handler(client);
    if (result && typeof result.then === 'function') {
      result = await result;
    }
  } catch (e) {
    error = e;
  }
  await client.close();
  return { result, error };
}

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = withEsClient;
