const withEsClient = require('../withEsClient/withEsClient.js');

/**
 * Return true if an index exists
 * @param {String} index  The name of the index
 * @returns {Promise<{result: Boolean, details: Object, error: Error}>}
 */
async function doesIndexExist(index) {
  const { result, error } = await withEsClient(client => {
    return client.indices.exists({ index });
  });
  return {
    result: result?.body === true,
    error,
    details: result || error?.meta,
  };
}

module.exports = doesIndexExist;
