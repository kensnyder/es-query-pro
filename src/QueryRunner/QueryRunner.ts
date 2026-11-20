import type { estypes } from '@elastic/elasticsearch';
import type IndexManager from '../IndexManager/IndexManager';
import type { IndexErrorShape } from '../IndexManager/IndexManager';
import { getAllFields } from '../mappingFields/mappingFields';
import type {
  MappingFieldPath,
  MappingRecord,
} from '../mappingFields/mappingTypes';
import QueryBuilder from '../QueryBuilder/QueryBuilder';

export type QueryFindManyResult<T extends QueryRunner<any>> = Awaited<
  ReturnType<T['findMany']>
>;
export type QueryFindFirstResult<T extends QueryRunner<any>> = Awaited<
  ReturnType<T['findFirst']>
>;
export type QueryCountResult<T extends QueryRunner<any>> = Awaited<
  ReturnType<T['count']>
>;
export type QueryUpdateManyResult<T extends QueryRunner<any>> = Awaited<
  ReturnType<T['updateMany']>
>;

/** Search params for `findMany()`/`findFirst()` besides the builder's */
export type QueryFindParams = Omit<estypes.SearchRequest, 'index' | 'query'>;

/** `_count` params for `count()` besides the builder's query */
export type QueryCountParams = Omit<estypes.CountRequest, 'index' | 'query'>;

/**
 * `_update_by_query` params for `updateMany()`, e.g. `refresh`,
 * `conflicts` (default `'proceed'`), `max_docs` (default `limit()`) or
 * `wait_for_completion`
 */
export type QueryUpdateManyParams = Omit<
  estypes.UpdateByQueryRequest,
  'index' | 'query' | 'script'
>;

/** The values `updateMany()` sets, by dotted field path */
export type QueryUpdateValues<Create> = Partial<
  Record<MappingFieldPath<Create>, unknown>
>;

/**
 * A search hit: the record's `_source` plus the hit's `_id`, `_score`,
 * highlights (`_highlight`, when the search highlights) and sort values
 * (`_sort`, when the search sorts; pass them to `searchAfter()` for the next
 * page). These keys win over `_source` keys of the same name.
 */
export type QueryRecord<Create> = MappingRecord<Create> & {
  _id: string;
  _score: number | null;
  _highlight?: Record<string, string[]>;
  _sort?: estypes.SortResults;
};

/** The error `findFirstOrThrow()` throws when nothing matches */
export type QueryNotFoundError = Error & {
  name: 'NotFoundError';
  status: 404;
  /** The (successful) `findFirst()` result, without `record` */
  result: Record<string, unknown>;
};

/** Search response hits typed with the index's records */
export type SearchResponse<Create> = estypes.SearchResponse<
  MappingRecord<Create>
>;

export type Aggregations = Record<string, estypes.AggregationsAggregate>;

/**
 * The fixed `updateMany()` script. Each update is `{ path, value }`, with the
 * dotted field path split into segments; the field names never become
 * script source. Missing or null objects on the way are created; when an
 * object on the way is a list (e.g. a `nested` field), every object in it is
 * updated; any other value on the way fails the update.
 */
export const UPDATE_MANY_SCRIPT = [
  'void setIn(Map map, List path, int i, def value) {',
  '  def key = path.get(i);',
  '  if (i == path.size() - 1) {',
  '    map.put(key, value);',
  '    return;',
  '  }',
  '  def child = map.get(key);',
  '  if (child == null) {',
  '    child = new HashMap();',
  '    map.put(key, child);',
  '  }',
  '  if (child instanceof Map) {',
  '    setIn((Map) child, path, i + 1, value);',
  '  } else if (child instanceof List) {',
  '    for (def item : (List) child) {',
  '      if (item instanceof Map) {',
  '        setIn((Map) item, path, i + 1, value);',
  '      }',
  '    }',
  '  } else {',
  "    throw new IllegalArgumentException('updateMany: cannot set ' + path +",
  "      ' because ' + key + ' is not an object');",
  '  }',
  '}',
  'for (def update : params.updates) {',
  '  setIn(ctx._source, update.path, 0, update.value);',
  '}',
].join('\n');

/** `dynamic` values that let Elasticsearch add fields on its own */
const LOOSE_DYNAMIC = new Set<unknown>([true, 'true', 'runtime']);

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True when a path that is not a mapped field may still be written: some
 * object on the way (or the mapping itself) has a loose `dynamic`
 * (`true`, `'true'`, `'runtime'`; inherited when omitted), or the path goes
 * into a `flattened` field. Mirrors when `MappingFieldPath` is `string`.
 */
function isDynamicPath(create: estypes.IndicesCreateRequest, path: string[]) {
  const mappings: unknown = create?.mappings;
  if (!isPlainObject(mappings)) {
    return false;
  }
  let node: PlainObject = mappings;
  let loose = LOOSE_DYNAMIC.has(mappings.dynamic);
  let isContainer = true;
  for (const segment of path) {
    const properties = node.properties;
    const child =
      isPlainObject(properties) && Object.hasOwn(properties, segment)
        ? properties[segment]
        : undefined;
    if (!isPlainObject(child)) {
      if (node.type === 'flattened') {
        return true;
      }
      return isContainer && loose;
    }
    if (Object.hasOwn(child, 'dynamic')) {
      loose = LOOSE_DYNAMIC.has(child.dynamic);
    }
    isContainer =
      isPlainObject(child.properties) ||
      child.type === 'object' ||
      child.type === 'nested';
    node = child;
  }
  return true;
}

/**
 * Check `updateMany()` values and turn them into the script's `updates`
 * param. Keys must be mapped fields or object/nested containers (see
 * `getAllFields(create, { containers: true })`), or paths the mapping lets
 * Elasticsearch add (loose `dynamic`, `flattened`). Undefined values are
 * skipped.
 * @throws TypeError when `values` is not a plain object
 * @throws RangeError for no values, an empty path segment, an unknown field,
 *   or a key inside another key's object
 */
function toUpdates(create: estypes.IndicesCreateRequest, values: unknown) {
  if (!isPlainObject(values)) {
    throw new TypeError(
      'updateMany: newValues must be an object of field paths to values',
    );
  }
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    throw new RangeError(
      'updateMany: newValues must set at least one field; nothing was updated',
    );
  }
  const allowed = new Set(getAllFields(create, { containers: true }));
  const unknown: string[] = [];
  const updates = entries.map(([key, value]) => {
    const path = key.split('.');
    if (path.some((segment) => segment === '')) {
      throw new RangeError(
        `updateMany: ${JSON.stringify(key)} is not a field path ` +
          '(empty segment); nothing was updated',
      );
    }
    if (!allowed.has(key) && !isDynamicPath(create, path)) {
      unknown.push(key);
    }
    return { path, value };
  });
  if (unknown.length > 0) {
    throw new RangeError(
      `updateMany: unknown field(s) ${unknown.map((k) => JSON.stringify(k)).join(', ')}; ` +
        'keys must be fields or objects of the mapping (sub-fields such as ' +
        '"title.raw" are not stored in _source); nothing was updated',
    );
  }
  const keys = entries.map(([key]) => key);
  for (const key of keys) {
    const parent = keys.find((other) => key.startsWith(`${other}.`));
    if (parent !== undefined) {
      throw new RangeError(
        `updateMany: ${JSON.stringify(key)} is inside ${JSON.stringify(parent)}, ` +
          'which is also set; set one or the other. Nothing was updated',
      );
    }
  }
  return updates;
}

/**
 * The error for an `_update_by_query` that answered 200 but did not update
 * every matching document: `failures` or `timed_out`
 */
function getUpdateByQueryError(response: estypes.UpdateByQueryResponse) {
  const failures = response.failures ?? [];
  if (failures.length > 0) {
    return new AggregateError(
      failures.map((failure) => {
        const cause = failure.cause;
        return new Error(
          `${failure.id ?? '?'}: ${cause?.type ?? 'error'}: ${cause?.reason ?? ''}`,
        );
      }),
      `updateMany: ${failures.length} document(s) failed; the update ` +
        'stopped there, documents before them were updated',
    );
  }
  if (response.timed_out) {
    return new Error(
      'updateMany: the request timed out; some documents were updated',
    );
  }
  return null;
}

/**
 * Runs a `QueryBuilder` against an `IndexManager`'s alias. Methods never
 * throw (except `findFirstOrThrow()`, by design): failures, including
 * errors thrown by the builder, come back as `{ error, errorKind, response }`
 * like `IndexManager` results. `request` is what was passed to the client
 * (null when nothing was sent) and `took` is the elapsed milliseconds.
 */
export default class QueryRunner<
  Create extends estypes.IndicesCreateRequest = estypes.IndicesCreateRequest,
> {
  public index: IndexManager<Create>;
  public builder: QueryBuilder<MappingFieldPath<Create>>;

  constructor(index: IndexManager<Create>) {
    this.index = index;
    this.builder = new QueryBuilder<MappingFieldPath<Create>>({
      index: this.index.getAliasName(),
    });
  }

  /**
   * Turn a search response into records: each hit's `_source` plus `_id`,
   * `_score`, `_highlight` and `_sort` (see `QueryRecord`)
   * @param response  The search response
   * @returns `records`, `total` (null when not tracked), `aggregations`
   *   (null when none) and the envelope fields; an error envelope when the
   *   response has no `hits.hits`
   */
  formatResponse(response: SearchResponse<Create>) {
    const hits = response?.hits?.hits;
    if (!Array.isArray(hits)) {
      const error = new Error('response.hits.hits not found', {
        cause: response,
      });
      return {
        records: [] as QueryRecord<Create>[],
        total: null,
        aggregations: null,
        ...this.index._formatError(error),
      };
    }
    const total = response.hits.total;
    return {
      records: hits.map((hit) => this._toRecord(hit)),
      total: typeof total === 'number' ? total : (total?.value ?? null),
      aggregations: (response.aggregations ?? null) as Aggregations | null,
      ...this.index._formatNonError(response),
    };
  }

  /** One search hit as a record */
  private _toRecord(hit: estypes.SearchHit<MappingRecord<Create>>) {
    const record = {
      ...hit._source,
      _id: hit._id ?? '',
      _score: hit._score ?? null,
    } as QueryRecord<Create>;
    if (hit.highlight) {
      record._highlight = hit.highlight;
    }
    if (hit.sort) {
      record._sort = hit.sort;
    }
    return record;
  }

  /** The index the builder targets, defaulting to the alias */
  private _getIndex() {
    return this.builder.getIndex() || this.index.getAliasName();
  }

  /**
   * Set fields on every document the builder's query matches, with
   * `_update_by_query` and a fixed Painless script; the values and field
   * paths travel as script params.
   *
   * Keys are dotted field paths checked against the mapping: fields and
   * object/nested containers (`{ publishing: {...} }` replaces the whole
   * object). Missing parent objects are created; a path through a list
   * (e.g. a `nested` field) sets the field on every object in it. `limit()`
   * becomes `max_docs`; sorting and paging are ignored.
   * @param newValues  The values to set, e.g. `{ 'publishing.year': 2001 }`;
   *   `undefined` values are skipped
   * @param more  `_update_by_query` params (`conflicts` defaults to
   *   `'proceed'`, so version conflicts are counted instead of stopping the
   *   update); `refresh: true` to see the changes in the next search
   * @returns `success`, `updated`, `total`, `versionConflicts`, `noops`,
   *   `failures` plus the envelope. No request is sent (error envelope) for
   *   empty `newValues`, an unknown key, a builder without a `query`
   *   (retrievers) or `limit(0)`.
   */
  async updateMany(
    newValues: QueryUpdateValues<Create>,
    more: QueryUpdateManyParams = {},
  ) {
    const start = Date.now();
    let request: estypes.UpdateByQueryRequest | null = null;
    const result = (response: estypes.UpdateByQueryResponse | null) => ({
      success: false,
      updated: response?.updated ?? null,
      total: response?.total ?? null,
      versionConflicts: response?.version_conflicts ?? null,
      noops: response?.noops ?? null,
      failures: response?.failures ?? null,
      request,
      took: Date.now() - start,
    });
    let response: estypes.UpdateByQueryResponse;
    try {
      const updates = toUpdates(this.index.createSpec, newValues);
      const query = this.builder.getBody().query;
      if (!query) {
        throw new Error(
          'updateMany: the builder produced no "query" (retrievers such as ' +
            'knn() or semantic() cannot select documents to update); ' +
            'nothing was updated',
        );
      }
      const limit = this.builder.getLimit();
      if (limit === 0) {
        throw new RangeError(
          'updateMany: limit is 0 (aggregate*() methods set it unless ' +
            'limit() is called), which would update no documents; nothing ' +
            'was updated',
        );
      }
      request = {
        conflicts: 'proceed',
        ...(limit === null ? {} : { max_docs: limit }),
        ...more,
        index: this._getIndex(),
        query,
        script: {
          lang: 'painless',
          source: UPDATE_MANY_SCRIPT,
          params: { updates },
        },
      };
      response = await this.index.client.updateByQuery(request);
    } catch (e) {
      return { ...result(null), ...this.index._formatError(e) };
    }
    const error = getUpdateByQueryError(response);
    if (error) {
      return {
        ...result(response),
        failures: response.failures ?? [],
        error,
        errorKind: 'response' as const,
        response: { statusCode: 200, body: response },
      };
    }
    return {
      ...result(response),
      success: true,
      failures: response.failures ?? [],
      ...this.index._formatNonError(response),
    };
  }

  /**
   * Run the builder's search and return its records
   * @param more  Search params that replace the builder's (e.g. `size`)
   * @returns `records`, `total`, `aggregations` plus the envelope
   */
  async findMany(more: QueryFindParams = {}) {
    const start = Date.now();
    let request: estypes.SearchRequest | null = null;
    try {
      request = this.builder.getQuery(more);
      const response =
        await this.index.client.search<MappingRecord<Create>>(request);
      return {
        request,
        took: Date.now() - start,
        ...this.formatResponse(response),
      };
    } catch (e) {
      return {
        records: [] as QueryRecord<Create>[],
        total: null,
        aggregations: null,
        request,
        took: Date.now() - start,
        ...this.index._formatError(e),
      };
    }
  }

  /**
   * Run the builder's search for one record (`size: 1` unless `more` sets a
   * size; the builder is not changed)
   * @returns `record` (null when nothing matched) plus the `findMany()`
   *   fields
   */
  async findFirst(more: QueryFindParams = {}) {
    const { records, ...result } = await this.findMany({ size: 1, ...more });
    const record: QueryRecord<Create> | null = records[0] ?? null;
    return { record, ...result };
  }

  /**
   * Like `findFirst()`, but throws instead of returning an error or no record
   * @throws The request's error (connection, response, builder errors)
   * @throws QueryNotFoundError (`name: 'NotFoundError'`, `status: 404`) when
   *   nothing matched
   */
  async findFirstOrThrow(more: QueryFindParams = {}) {
    const result = await this.findFirst(more);
    if (result.error) {
      throw result.error;
    }
    const { record, ...rest } = result;
    if (record === null) {
      const error = Object.assign(new Error('No record found'), {
        name: 'NotFoundError' as const,
        status: 404 as const,
        result: rest,
      });
      throw error satisfies QueryNotFoundError;
    }
    return { record, ...rest };
  }

  /**
   * Count the documents matching the builder's query (and `minScore()`).
   * Paging, sorting, aggregations, highlighting and source filtering are not
   * sent: `_count` rejects them.
   * @param more  `_count` params, e.g. `terminate_after` or `min_score`
   * @returns `total` plus the envelope. A builder with retrievers (`knn()`,
   *   `semantic()`, `rrf()`, ...) is not counted: `total` is null and
   *   `error` says retrievers are unsupported (nothing is sent).
   */
  async count(more: QueryCountParams = {}) {
    const start = Date.now();
    let request: estypes.CountRequest | null = null;
    try {
      if (this.builder.getRetrievers().length > 0) {
        throw new Error(
          'count() does not support retrievers (knn, semantic, rrf, ' +
            'weightedSemantic): _count takes a query only; nothing was sent',
        );
      }
      const query = this.builder.getBody().query;
      const minScore = this.builder.getMinScore();
      request = {
        ...(typeof minScore === 'number' ? { min_score: minScore } : {}),
        ...more,
        index: this._getIndex(),
        query,
      };
      const response = await this.index.client.count(request);
      return {
        total: response.count as number | null,
        request,
        took: Date.now() - start,
        ...this.index._formatNonError(response),
      };
    } catch (e) {
      return {
        total: null,
        request,
        took: Date.now() - start,
        ...this.index._formatError(e),
      };
    }
  }
}
