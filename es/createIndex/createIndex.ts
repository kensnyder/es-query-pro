const withEsClient = require('../withEsClient/withEsClient.js');
const settings = require('../analyzers/englishplus.js');

async function createIndex(index, body = {}) {
  const { result, error } = await withEsClient(client => {
    return client.indices.create({
      index,
      body: {
        ...body,
        settings: {
          ...settings,
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

module.exports = createIndex;
