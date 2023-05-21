import withEsClient from '../withEsClient/withEsClient.js';

/**
 * Return true if an index exists
 * @param {String} index  The name of the index
 * @returns {Promise<{result: Boolean, details: Object, error: Error}>}
 */
export default async function doesIndexExist(index: any) {
  const { result, error } = await withEsClient((client: any) => {
    return client.indices.exists({ index });
  });
  return {
    result: result?.body === true,
    error,
    details: result || error?.meta,
  };
}

