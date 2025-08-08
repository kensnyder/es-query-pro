import { Client, estypes } from '@elastic/elasticsearch';
import { Merge } from 'type-fest';
import englishplus from '../analyzers/englishplus';
import getEsClient from '../getEsClient/getEsClient';

export default async function createIndex({
  client = getEsClient(),
  index,
  settings,
  body,
  ...request
}: Merge<estypes.IndicesCreateRequest, { client?: Client }>) {
  try {
    const result = await client.indices.create({
      index,
      body,
      settings: {
        ...englishplus,
        ...settings,
      },
      ...request,
    });
    return {
      result,
      error: null,
    };
  } catch (e) {
    const error = e as Error;
    return { result: null, error };
  }
}
