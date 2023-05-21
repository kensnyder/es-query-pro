// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'withEsClie... Remove this comment to see the full error message
const withEsClient = require('../withEsClient/withEsClient.js');

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'deleteInde... Remove this comment to see the full error message
async function deleteIndex(index: any) {
  const { result, error } = await withEsClient((client: any) => {
    return client.indices.delete({ index });
  });
  return {
    result: result?.statusCode === 200,
    error,
    details: result || error?.meta,
  };
}

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = deleteIndex;
