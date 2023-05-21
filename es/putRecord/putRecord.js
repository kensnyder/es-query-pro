const withEsClient = require('../withEsClient/withEsClient.js');
const fulltext = require('../fulltext/fulltext.js');
const dates = require('../dates/dates.js');

async function putRecord(index, data) {
  fulltext.processRecord(data);
  dates.processRecord(data);
  const { result, error } = await withEsClient(client => {
    return client.index({ index, id: data.id, body: data });
  });
  return {
    result: result?.statusCode === 201,
    error,
    details: result || error?.meta,
  };
}

module.exports = putRecord;
