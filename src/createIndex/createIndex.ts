import { Client, estypes } from '@elastic/elasticsearch';
import englishplus from '../analyzers/englishplus';
import getEsClient from '../getEsClient/getEsClient';

export default async function createIndex({
  client = getEsClient(),
  index,
  settings,
  body,
}: {
  client?: Client;
  index: string;
  settings?: estypes.IndicesIndexSettings;
  body?: Record<string, any>;
}) {
  try {
    const result = await client.indices.create({
      index,
      body,
      settings: {
        ...englishplus,
        ...settings,
      },
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
