import { estypes } from '@elastic/elasticsearch';
import IndexManager from '../IndexManager/IndexManager';
import QueryBuilder from '../QueryBuilder/QueryBuilder';
import { ElasticsearchRecord, SchemaShape } from '../types';

export default class QueryRunner<ThisSchema extends SchemaShape> {
  public index: IndexManager<ThisSchema>;
  public builder: QueryBuilder;

  constructor(index: IndexManager<ThisSchema>) {
    this.index = index;
    this.builder = new QueryBuilder();
  }

  /**
   * return the returned _source for each hit
   * @param response  The result from withEsClient()
   * @private
   */
  formatResponse(
    response: estypes.SearchResponse<ElasticsearchRecord<ThisSchema>>
  ) {
    if (response?.hits?.hits) {
      const records: ElasticsearchRecord<ThisSchema>[] = [];
      for (const hit of response.hits.hits) {
        records.push(this.index.textProcessor.prepareResult(hit._source));
      }
      return {
        records,
        total:
          typeof response.hits.total === 'number'
            ? response.hits.total
            : response.hits.total?.value,
        took: response.took,
        aggregations: response.aggregations,
        response,
        error: null,
      };
    }
    return {
      records: [],
      total: 0,
      took: response?.took,
      aggregations: {},
      response,
      error: new Error('response.hits.hits not found'),
    };
  }

  /**
   * Run this builder and return results
   */
  async findMany(more: Omit<estypes.SearchRequest, 'index' | 'query'> = {}) {
    try {
      const result: estypes.SearchResponse<ElasticsearchRecord<ThisSchema>> =
        await this.index.client.search({
          index: this.index.getAliasName(),
          ...this.builder.getBody(),
          ...more,
        });
      return this.formatResponse(result);
    } catch (e) {
      return {
        records: [],
        total: null,
        took: null,
        aggregations: null,
        response: null,
        error: e as Error,
      };
    }
  }

  /**
   * Run this builder and return result.hits.hits[0]
   */
  async findFirst(more: Omit<estypes.SearchRequest, 'index' | 'query'> = {}) {
    const { records, ...result } = await this.findMany(more);
    return { record: records[0], ...result };
  }

  /**
   * Run this builder and return result.hits.hits[0]
   */
  async findFirstOrThrow(
    more: Omit<estypes.SearchRequest, 'index' | 'query'> = {}
  ) {
    const { records, ...result } = await this.findMany(more);
    if (records.length === 0) {
      const error = new Error('No record found');
      error.name = 'NotFoundError';
      error.status = 404;
      error.result = result;
      throw error;
    }
    return { record: records[0], ...result };
  }

  /**
   * Count the number of documents matching the current query
   * @returns The count of matching documents
   */
  async count(more: Omit<estypes.CountRequest, 'index' | 'query'>) {
    try {
      const response = await this.index.client.count({
        index: this.index.getAliasName(),
        ...this.builder.getBody(),
        ...more,
      });
      return { total: response.count, error: null, response };
    } catch (e) {
      return { total: null, error: e as Error, response: null };
    }
  }

  // aggregate
  // groupBy
  // delete
}
