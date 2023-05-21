import withEsClient from '../withEsClient/withEsClient.js';

export default async function deleteIndex(index: any) {
  const { result, error } = await withEsClient((client: any) => {
    return client.indices.delete({ index });
  });
  return {
    result: result?.statusCode === 200,
    error,
    details: result || error?.meta,
  };
}

