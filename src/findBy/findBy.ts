import { type Client, type estypes } from '@elastic/elasticsearch';
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
 * @param [client]  An ElasticSearch client
 * @param [more]  Additional options such as size and from
 */
export async function criteria<T extends estypes.SearchResponse = any>({
  client = getEsClient(),
  index,
  where,
  more = {},
}: {
  client?: Client;
  index: string;
  where: Record<string, any>;
  more?: Partial<estypes.SearchRequest>;
}) {
  const musts: estypes.QueryDslQueryContainer[] = [];

  for (const [field, value] of Object.entries(where)) {
    musts.push({ match: { [field]: value } });
  }
  try {
    const result = await client.search<T>({
      index,
      query: {
        bool: {
          must: musts,
        } as estypes.QueryDslBoolQuery,
      },
      ...more,
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
 * @param [client]  The elasticsearch client
 * @param index  The name of the index
 * @param id  The document id
 */
export async function id<T extends estypes.GetResponse>({
  client = getEsClient(),
  index,
  id,
}: {
  client?: Client;
  index: string;
  id: string;
}) {
  try {
    const result = await client.get<T>({
      index,
      id,
    });
    const record = { ...result._source };
    fulltext.unProcessRecord(record);
    dates.unProcessRecord(record);
    return { result: record, error: null, raw: result };
  } catch (e) {
    return { result: null, error: e as Error };
  }
}

/**
 * Find records that match the given term or phrase
 * @param [client]  The elasticsearch client
 * @param index  The name of the index
 * @param phrase  The term or phrase to search for
 * @param fields  The list of fields to match agains
 * @param [boosts]  The 3-member array of numbers representing boosts for or, and, phrase
 * @param [where]  Some simple field-value pairs
 * @param [more]  Additional options such as size and from
 */
export async function boostedPhrase<T extends estypes.SearchResponse = any>({
  client = getEsClient(),
  index,
  phrase,
  boosts = [1, 3, 5],
  fields = ['content_*'],
  where = {},
  more = {},
}: {
  client?: Client;
  index: string;
  phrase: string;
  fields?: string[];
  boosts?: [number, number, number];
  where?: Record<string, any>;
  more?: Omit<estypes.SearchRequest, 'index' | 'query'>;
}) {
  phrase = fulltext.processText(phrase);

  const musts: estypes.QueryDslQueryContainer[] = [];

  for (const [field, value] of Object.entries(where)) {
    musts.push({ match: { [field]: value } });
  }
  try {
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
      ...more,
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
 * @param [more]  Additional options such as size and from
 */
async function query<T extends estypes.SearchResponse = any>({
  index,
  builder,
  more = {},
}: {
  index: string;
  builder: QueryBuilder;
  more?: Partial<estypes.SearchRequest>;
}) {
  try {
    const client = getEsClient();
    const result = await client.search<T>({
      index,
      ...builder.getQuery(),
      ...more,
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
