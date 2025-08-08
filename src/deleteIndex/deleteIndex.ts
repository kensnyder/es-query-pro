import { Client, estypes } from '@elastic/elasticsearch';
import getEsClient from '../getEsClient/getEsClient';

export default async function deleteIndex({
  client = getEsClient(),
  index,
}: {
  client?: Client;
  index: string;
}) {
  try {
    const result = await client.indices.delete({ index });
    return { result, error: null };
  } catch (e) {
    const error = e as Error;
    return { result: null, error };
  }
}
