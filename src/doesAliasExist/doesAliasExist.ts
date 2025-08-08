import { Client, estypes } from '@elastic/elasticsearch';
import { Merge } from 'type-fest';
import { getEsClient } from '../index';

export default async function doesAliasExist({
  client = getEsClient(),
  ...request
}: Merge<estypes.IndicesExistsAliasRequest, { client?: Client }>) {
  try {
    const result = await client.indices.existsAlias(request);
    return { result, error: null };
  } catch (e) {
    return { result: null, error: e as Error };
  }
}
