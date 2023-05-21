import withEsClient from '../withEsClient/withEsClient.js';
import fulltext from '../fulltext/fulltext.js';
import dates from '../dates/dates.js';

export default async function putRecord(index: any, data: any) {
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

