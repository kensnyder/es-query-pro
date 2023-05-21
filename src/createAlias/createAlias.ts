import withEsClient from '../withEsClient/withEsClient.js';

export default async function createAlias(index: any, name: any, body = {}) {
  const { result, error } = await withEsClient((client: any) => {
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
