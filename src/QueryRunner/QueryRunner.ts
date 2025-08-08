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
   * Run this builder and return results
   */
  async _search(more: Omit<estypes.SearchRequest, 'index' | 'query'> = {}) {
    try {
      const result: estypes.SearchResponse<ElasticsearchRecord<ThisSchema>> =
        await this.index.client.search({
          index: this.index.getAliasName(),
          ...this.builder.getBody(),
          ...more,
        });
      return { result, error: null };
    } catch (e) {
      return { result: null, error: e as Error };
    }
  }

  /**
   * Run this builder and return result.hits.hits
   */
  async findMany(more: Omit<estypes.SearchRequest, 'index' | 'query'> = {}) {
    const { result, error } = await this._search(more);
    if (error) {
      throw error;
    }
    return result.hits.hits;
  }

  /**
   * Run this builder and return result.hits.hits
   */
  async findFirst(more: Omit<estypes.SearchRequest, 'index' | 'query'> = {}) {
    const hits = await this.findMany(more);
    return hits[0] || null;
  }

  // aggregate
  // count
  // groupBy
  // delete
}
