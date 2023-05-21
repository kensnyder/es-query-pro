import getEsClient from '../getEsClient/getEsClient.js';

export default async function withEsClient(handler: any) {
  const client = getEsClient();
  let result = null;
  let error = null;
  try {
    result = handler(client);
    if (result && typeof result.then === 'function') {
      result = await result;
    }
  } catch (e) {
    error = e;
  }
  await client.close();
  return { result, error };
}

