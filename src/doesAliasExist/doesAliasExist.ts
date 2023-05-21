import withEsClient from '../withEsClient/withEsClient.js';

export default async function doesAliasExist(name: any, body = {}) {
  const { result, error } = await withEsClient((client: any) => {
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

