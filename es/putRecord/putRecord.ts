// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'withEsClie... Remove this comment to see the full error message
const withEsClient = require('../withEsClient/withEsClient.js');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'fulltext'.
const fulltext = require('../fulltext/fulltext.js');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'dates'.
const dates = require('../dates/dates.js');

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'putRecord'... Remove this comment to see the full error message
async function putRecord(index: any, data: any) {
  fulltext.processRecord(data);
  dates.processRecord(data);
  const { result, error } = await withEsClient((client: any) => {
    return client.index({ index, id: data.id, body: data });
  });
  return {
    result: result?.statusCode === 201,
    error,
    details: result || error?.meta,
  };
}

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = putRecord;
