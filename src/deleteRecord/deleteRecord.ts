import withEsClient from '../withEsClient/withEsClient.js';

export default async function deleteRecord(index: any, id: any) {
  const { result, error } = await withEsClient((client: any) => {
    return client.delete({ index, id });
  });
  return {
    result: result?.statusCode === 200,
    error,
    details: result || error?.meta,
  };
}

