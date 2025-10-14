import { estypes } from "@elastic/elasticsearch";
import IndexManager from "../IndexManager/IndexManager";
import QueryBuilder from "../QueryBuilder/QueryBuilder";
import { ElasticsearchRecord, SchemaShape } from "../types";

export type QueryFindManyResult<T extends QueryRunner<any>> = Awaited<
  ReturnType<T["findMany"]>
>;
export type QueryFindFirstResult<T extends QueryRunner<any>> = Awaited<
  ReturnType<T["findFirst"]>
>;
export type QueryCountResult<T extends QueryRunner<any>> = Awaited<
  ReturnType<T["count"]>
>;

export default class QueryRunner<ThisSchema extends SchemaShape> {
  public index: IndexManager<ThisSchema>;
  public builder: QueryBuilder;

  constructor(index: IndexManager<ThisSchema>) {
    this.index = index;
    this.builder = new QueryBuilder({
      index: this.index.getAliasName(),
      nestedSeparator: this.index.nestedSeparator,
    });
  }

  /**
   * return the returned _source for each hit
   * @param response  The result from withEsClient()
   * @private
   */
  formatResponse(
    response: estypes.SearchResponse<ElasticsearchRecord<ThisSchema>>,
  ) {
    if (response?.hits?.hits) {
      const records: ElasticsearchRecord<ThisSchema>[] = [];
      for (const hit of response.hits.hits) {
        records.push(this.index.textProcessor.prepareResult(hit._source));
      }
      return {
        records,
        total:
          typeof response.hits.total === "number"
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
      error: new Error("response.hits.hits not found"),
    };
  }

  mget(more: Omit<estypes.MgetRequest, "index" | "ids"> = {}) {
    // const request = {
    //   index: this.index.getAliasName(),
    //   ...this.builder.getBody(),
    //   ...more,
    // };
    // return this.index.client.mget(request);
  }

  msearch(queries: QueryBuilder[]) {
    // this.client.msearch({
    //
    // });
  }

  /**
   * Run this builder and return results
   */
  async findMany(more: Omit<estypes.SearchRequest, "index" | "query"> = {}) {
    const request = {
      ...this.builder.getQuery(),
      ...more,
    };
    try {
      const result: estypes.SearchResponse<ElasticsearchRecord<ThisSchema>> =
        await this.index.client.search(request);
      return { request, ...this.formatResponse(result) };
    } catch (e) {
      return {
        records: [],
        total: null,
        request,
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
  async findFirst(more: Omit<estypes.SearchRequest, "index" | "query"> = {}) {
    const { records, ...result } = await this.findMany(more);
    return { record: records[0], ...result };
  }

  /**
   * Run this builder and return result.hits.hits[0]
   */
  async findFirstOrThrow(
    more: Omit<estypes.SearchRequest, "index" | "query"> = {},
  ) {
    const { records, ...result } = await this.findMany(more);
    if (records.length === 0) {
      const error = new Error("No record found");
      error.name = "NotFoundError";
      // @ts-ignore  Adding some metadata
      error.status = 404;
      // @ts-ignore  Adding some metadata
      error.result = result;
      throw error;
    }
    return { record: records[0], ...result };
  }

  /**
   * Count the number of documents matching the current query
   * @returns The count of matching documents
   */
  async count(more: Omit<estypes.CountRequest, "index" | "query"> = {}) {
    const now = Date.now();
    const { _source, retriever, ...other } = this.builder.getQuery();
    const request = {
      ...other,
      query: retriever.standard.query,
      ...more,
    };
    try {
      const response = await this.index.client.count(request);
      return {
        total: response.count,
        took: Date.now() - now,
        request,
        response,
        error: null,
      };
    } catch (e) {
      return {
        total: null,
        took: Date.now() - now,
        request,
        response: e.meta || null,
        error: e as Error,
      };
    }
  }

  // aggregate
  // groupBy
  // delete
}
