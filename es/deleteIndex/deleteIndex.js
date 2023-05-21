const withEsClient = require('../withEsClient/withEsClient.js');

async function deleteIndex(index) {
  const { result, error } = await withEsClient(client => {
    return client.indices.delete({ index });
  });
  return {
    result: result?.statusCode === 200,
    error,
    details: result || error?.meta,
  };
}

module.exports = deleteIndex;
