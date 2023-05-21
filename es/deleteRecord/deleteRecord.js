const withEsClient = require('../withEsClient/withEsClient.js');

async function deleteRecord(index, id) {
  const { result, error } = await withEsClient(client => {
    return client.delete({ index, id });
  });
  return {
    result: result?.statusCode === 200,
    error,
    details: result || error?.meta,
  };
}

module.exports = deleteRecord;
