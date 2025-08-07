import type { Client } from '@elastic/elasticsearch';
import getEsClient from '../getEsClient/getEsClient';

export default async function withEsClient<T>(
  handler: (client: Client) => T | Promise<T>
) {
  const client = getEsClient();
  try {
    const handlerResult = handler(client);
    const result: T =
      handlerResult instanceof Promise ? await handlerResult : handlerResult;
    console.log('withEsClient result -------------\n', result);
    return { result, error: null };
  } catch (e) {
    const error = e as Error;
    return { result: null, error };
  }
}
