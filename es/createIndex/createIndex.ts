// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'withEsClie... Remove this comment to see the full error message
const withEsClient = require('../withEsClient/withEsClient.js');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'settings'.
const settings = require('../analyzers/englishplus.js');

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'createInde... Remove this comment to see the full error message
async function createIndex(index: any, body = {}) {
  const { result, error } = await withEsClient((client: any) => {
    return client.indices.create({
      index,
      body: {
        ...body,
        settings: {
          ...settings,
          // @ts-expect-error TS(2339): Property 'settings' does not exist on type '{}'.
          ...(body.settings || {}),
        },
      },
    });
  });
  return {
    result: result?.statusCode === 200,
    error,
    details: result || error?.meta,
  };
}

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = createIndex;
