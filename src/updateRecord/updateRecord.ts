import withEsClient from '../withEsClient/withEsClient.js';
import fulltext from '../fulltext/fulltext.js';
import dates from '../dates/dates.js';

export default async function updateRecord(index: any, id: any, data: any) {
  fulltext.processRecord(data);
  dates.processRecord(data);
  const { result, error } = await withEsClient((client: any) => {
    return client.update({ index, id, body: { doc: data } });
  });
  return {
    result: result?.statusCode === 200,
    error,
    details: result || error?.meta,
  };
}

