import { Client, estypes } from '@elastic/elasticsearch';
import { Merge } from 'type-fest';
import dates from '../dates/dates.js';
import fulltext from '../fulltext/fulltext.js';
import getEsClient from '../getEsClient/getEsClient';

export default async function putRecord({
  client = getEsClient(),
  index,
  document,
}: Merge<estypes.IndicesExistsAliasRequest, { client?: Client }>) {
  fulltext.processRecord(document);
  dates.processRecord(document);
  try {
    const result = await client.index({
      index,
      id: document.id,
      body: document,
    });
    return { result, error: null };
  } catch (e) {
    return { result: null, error: e as Error };
  }
}
