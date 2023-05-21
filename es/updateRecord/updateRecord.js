const withEsClient = require('../withEsClient/withEsClient.js');
const fulltext = require('../fulltext/fulltext.js');
const dates = require('../dates/dates.js');

async function updateRecord(index, id, data) {
  fulltext.processRecord(data);
  dates.processRecord(data);
  const { result, error } = await withEsClient(client => {
    return client.update({ index, id, body: { doc: data } });
  });
  return {
    result: result?.statusCode === 200,
    error,
    details: result || error?.meta,
  };
}

module.exports = updateRecord;
