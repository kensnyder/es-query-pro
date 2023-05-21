// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'withEsClie... Remove this comment to see the full error message
const withEsClient = require('../withEsClient/withEsClient.js');

/**
 * Return true if an index exists
 * @param {String} index  The name of the index
 * @returns {Promise<{result: Boolean, details: Object, error: Error}>}
 */
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'doesIndexE... Remove this comment to see the full error message
async function doesIndexExist(index: any) {
  const { result, error } = await withEsClient((client: any) => {
    return client.indices.exists({ index });
  });
  return {
    result: result?.body === true,
    error,
    details: result || error?.meta,
  };
}

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = doesIndexExist;
