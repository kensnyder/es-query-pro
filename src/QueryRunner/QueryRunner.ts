import type { estypes } from '@elastic/elasticsearch';
import type IndexManager from '../IndexManager/IndexManager';
import QueryBuilder from '../QueryBuilder/QueryBuilder';
import type { ElasticsearchRecord, SchemaShape } from '../types';

export type QueryFindManyResult<T extends QueryRunner<any>> = Awaited<
  ReturnType<T['findMany']>
>;
export type QueryFindFirstResult<T extends QueryRunner<any>> = Awaited<
  ReturnType<T['findFirst']>
>;
export type QueryCountResult<T extends QueryRunner<any>> = Awaited<
  ReturnType<T['count']>
>;

export default class QueryRunner<ThisSchema extends SchemaShape> {
  public index: IndexManager<ThisSchema>;
  public builder: QueryBuilder;

  constructor(index: IndexManager<ThisSchema>) {
    this.index = index;
    this.builder = new QueryBuilder({
      index: this.index.getAliasName(),
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
      const records: ElasticsearchRecord<ThisSchema>[] = response.hits.hits.map(
        (hit) => ({
          ...hit._source,
          _score: hit._score,
        }),
      );
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
      aggregations: {} as any,
      response,
      error: new Error('response.hits.hits not found'),
    };
  }

  // mget(more: Omit<estypes.MgetRequest, 'index' | 'ids'> = {}) {
  //   // const request = {
  //   //   index: this.index.getAliasName(),
  //   //   ...this.builder.getBody(),
  //   //   ...more,
  //   // };
  //   // return this.index.client.mget(request);
  // }
  //
  // msearch(queries: QueryBuilder[]) {
  //   // this.client.msearch({
  //   //
  //   // });
  // }

  async updateMany(
    newValues: Record<string, unknown>,
    more: Omit<estypes.UpdateByQueryRequest, 'index' | 'query'> = {},
  ) {
    const body = this.builder.getBody();
    if (!body.query) {
      throw new Error(
        'QueryRunner.updateMany requires plain criteria with a .query object',
      );
    }
    // TODO: put in try-catch block with post-processing of result?
    const scriptLines: string[] = [];
    const params: Record<string, unknown> = {};
    let i = 0;
    for (const [field, value] of Object.entries(newValues)) {
      const paramKey = `v${i++}`;
      const targetPath = this.toPainlessSourcePath(field);
      scriptLines.push(`${targetPath} = params['${paramKey}'];`);
      params[paramKey] = value;
    }
    const request: estypes.UpdateByQueryRequest = {
      index: this.index.getAliasName(),
      query: body.query,
      script: {
        lang: 'painless',
        source: scriptLines.join('\n'),
        params,
      },
      ...more,
    };
    return this.index.client.updateByQuery(request);
  }

  toPainlessSourcePath(path: string): string {
    const parts = path.split('.').filter(Boolean);
    if (parts.length === 0) {
      return `ctx._source`;
    }
    return `ctx._source${parts.map((p) => `['${p}']`).join('')}`;
  }
  /*
  function toPainlessSourcePath(path: string): string {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return `ctx._source`;
  return `ctx._source${parts.map((p) => `['${p}']`).join('')}`;
}

export async function updateMany({
  client,
  index,
  query,
  updates,
  options = {},
}: UpdateManyArgs): Promise<UpdateManyResult> {
  if (!updates || Object.keys(updates).length === 0) {
    throw new Error('updateMany: "updates" must contain at least one field.');
  }

  // Build a static painless script assigning each field from params
  // We avoid iterating over a map in Painless for clarity and performance.
  const scriptLines: string[] = [];
  const params: Record<string, unknown> = {};
  let i = 0;
  for (const [field, value] of Object.entries(updates)) {
    const paramKey = `v${i++}`;
    const targetPath = toPainlessSourcePath(field);
    scriptLines.push(`${targetPath} = params['${paramKey}'];`);
    params[paramKey] = value;
  }

  const body: any = {
    index,
    query,
    script: {
      lang: 'painless',
      source: scriptLines.join('\n'),
      params,
    },
    conflicts: options.conflicts ?? 'proceed',
    refresh: options.refresh ?? true,
  };

   */

  /**
   * Run this builder and return results
   */
  async findMany(more: Omit<estypes.SearchRequest, 'index' | 'query'> = {}) {
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
  async findFirst(more: Omit<estypes.SearchRequest, 'index' | 'query'> = {}) {
    const { records, ...result } = await this.findMany(more);
    return { record: records[0], ...result };
  }

  /**
   * Run this builder and return result.hits.hits[0]
   */
  async findFirstOrThrow(
    more: Omit<estypes.SearchRequest, 'index' | 'query'> = {},
  ) {
    const { records, ...result } = await this.findMany(more);
    if (records.length === 0) {
      const error = new Error('No record found');
      error.name = 'NotFoundError';
      // @ts-expect-error  Adding some metadata
      error.status = 404;
      // @ts-expect-error  Adding some metadata
      error.result = result;
      throw error;
    }
    return { record: records[0], ...result };
  }

  /**
   * Count the number of documents matching the current query
   * @returns The count of matching documents
   */
  async count(more: Omit<estypes.CountRequest, 'index' | 'query'> = {}) {
    const start = Date.now();
    const { _source, retriever, query, ...other } = this.builder.getQuery();
    const request = {
      ...other,
      query: query || retriever.standard.query,
      ...more,
    };
    try {
      const response = await this.index.client.count(request);
      return {
        total: response.count,
        took: Date.now() - start,
        request,
        response,
        error: null,
      };
    } catch (e) {
      return {
        total: null,
        took: Date.now() - start,
        request,
        response: e.meta || null,
        error: e as Error,
      };
    }
  }

  // aggregate
  // groupBy
}
