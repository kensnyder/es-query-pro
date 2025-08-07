import { estypes } from '@elastic/elasticsearch';
import dates from '../dates/dates.js';
import fulltext from '../fulltext/fulltext.js';
import getEsClient from '../getEsClient/getEsClient';
import QueryBuilder from '../QueryBuilder/QueryBuilder';

export default {
  criteria,
  boostedPhrase,
  id,
  query,
};

/**
 * Return records matching simple field-value pairs
 * @param index  The name of the index
 * @param criteria  Some simple field-value pairs
 * @param [moreBody]  Additional options such as size and from
 */
export async function criteria<T extends estypes.SearchResponse = any>({
  index,
  where,
  overrides = {},
}: {
  index: string;
  where: Record<string, any>;
  overrides?: Partial<estypes.SearchRequest>;
}) {
  const musts: estypes.QueryDslQueryContainer[] = [];

  for (const [field, value] of Object.entries(where)) {
    musts.push({ match: { [field]: value } });
  }
  try {
    const client = getEsClient();
    const result = await client.search<T>({
      index,
      query: {
        bool: {
          must: musts,
        } as estypes.QueryDslBoolQuery,
      },
      ...overrides,
    });
    return {
      result: _formatRecords(result),
      error: null,
      raw: result,
    };
  } catch (e) {
    const error = e as Error;
    return { result: null, error, raw: null };
  }
}

/**
 * Return the record with the given id, or null
 * @param index  The name of the index
 * @param id  The document id
 */
export async function id(index: string, id: string | number) {
  const { result, error, raw } = await criteria({
    index,
    where: { id },
  });
  return { result: result?.records?.[0] || null, error, raw };
}

/**
 * Find records that match the given term or phrase
 * @param index  The name of the index
 * @param phrase  The term or phrase to search for
 * @param fields  The list of fields to match agains
 * @param [boosts]  The 3-member array of numbers representing boosts for or, and, phrase
 * @param [criteria]  Some simple field-value pairs
 * @param [moreBody]  Additional options such as size and from
 */
export async function boostedPhrase<T extends estypes.SearchResponse = any>({
  index,
  phrase,
  boosts = [1, 3, 5],
  fields = ['content_*'],
  criteria = {},
  moreBody = {},
}: {
  index: string;
  phrase: string;
  fields?: string[];
  boosts?: [number, number, number];
  criteria?: Record<string, any>;
  moreBody?: Omit<estypes.SearchRequest, 'index' | 'query'>;
}) {
  phrase = fulltext.processText(phrase);

  const musts: estypes.QueryDslQueryContainer[] = [];

  for (const [field, value] of Object.entries(criteria)) {
    musts.push({ match: { [field]: value } });
  }
  try {
    const client = getEsClient();
    const result = await client.search<T>({
      index,
      query: {
        bool: {
          must: musts,
          should: [
            {
              multi_match: {
                fields,
                query: phrase,
                boost: boosts[0],
              },
            },
            {
              multi_match: {
                fields,
                query: phrase,
                boost: boosts[1],
                operator: 'and',
              },
            },
            {
              multi_match: {
                type: 'phrase',
                fields,
                query: phrase,
                boost: boosts[2],
              },
            },
          ],
        } as estypes.QueryDslBoolQuery,
      },
      ...moreBody,
    });
    return {
      result: _formatRecords(result),
      error: null,
      raw: result,
    };
  } catch (e) {
    const error = e as Error;
    return { result: null, error, raw: null };
  }
}

/**
 * Return results from a QueryBuilder object
 * @param index  The name of the index
 * @param query  The builder object
 * @param [moreBody]  Additional options such as size and from
 */
async function query<T extends estypes.SearchResponse = any>({
  index,
  builder,
  moreBody = {},
}: {
  index: string;
  builder: QueryBuilder;
  moreBody?: Partial<estypes.SearchRequest>;
}) {
  try {
    const client = getEsClient();
    const result = await client.search<T>({
      index,
      ...builder.getQuery(),
      ...moreBody,
    });
    return {
      result: _formatRecords(result),
      error: null,
      raw: result,
    };
  } catch (e) {
    const error = e as Error;
    return { result: null, error, raw: null };
  }
}

/**
 * return the returned _source for each hit
 * @param result  The result from withEsClient()
 * @private
 */
function _formatRecords<T extends estypes.SearchResponse>(result: T) {
  if (result?.hits?.hits) {
    const records: T['hits']['hits'][number]['_source'][] = [];
    for (const hit of result.hits.hits) {
      fulltext.unProcessRecord(hit._source);
      dates.unProcessRecord(hit._source);
      // if (hit.highlight) {
      //   hit._source.$highlight = hit.highlight;
      // }
      records.push(hit._source);
    }
    return {
      records,
      total:
        typeof result.hits.total === 'number'
          ? result.hits.total
          : result.hits.total?.value,
      took: result.took,
      aggregations: result.aggregations,
    };
  }
  return { records: [], total: null, took: result?.took, aggregations: null };
}
