import { Client, estypes } from '@elastic/elasticsearch';
import { Merge } from 'type-fest';
import { getEsClient } from '../index';

/**
 * Return the record with the given id, or null
 * @param [client]  The elasticsearch client
 * @param index  The name of the index
 * @param id  The document id
 */
export default async function deleteRecord({
  client = getEsClient(),
  ...request
}: Merge<estypes.DeleteRequest, { client?: Client }>) {
  try {
    const result = await client.delete(request);
    return { result, error: null };
  } catch (e) {
    return { result: null, error: e as Error };
  }
}
