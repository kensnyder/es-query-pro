const withEsClient = require('../withEsClient/withEsClient.js');

async function createAlias(index, name, body = {}) {
  const { result, error } = await withEsClient(client => {
    return client.indices.putAlias({
      index,
      name,
      body,
    });
  });
  return {
    result: result?.statusCode === 200,
    error,
    details: result || error?.meta,
  };
}

module.exports = createAlias;
