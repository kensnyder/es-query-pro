const withEsClient = require('../withEsClient/withEsClient.js');

async function doesAliasExist(name, body = {}) {
  const { result, error } = await withEsClient(client => {
    return client.indices.existsAlias({
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

module.exports = doesAliasExist;
