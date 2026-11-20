import type { Client, estypes } from '@elastic/elasticsearch';
import IndexNameManager from '../IndexNameManager/IndexNameManager';
import {
  getAllFields,
  getFulltextFields,
} from '../mappingFields/mappingFields';
import type {
  MappingFieldPath,
  MappingRecord,
} from '../mappingFields/mappingTypes';
import QueryBuilder from '../QueryBuilder/QueryBuilder';
import QueryRunner from '../QueryRunner/QueryRunner';
import type {
  AliasCreateParams,
  AliasDeleteParams,
  AliasExistParams,
  AliasMetadataParams,
  BulkRequestParams,
  DeleteRequestShape,
  ErrorCause,
  FlushRequestParams,
  GetRequestParams,
  IndexCreateParams,
  IndexExistParams,
  IndexMetadataParams,
  PatchRequestParams,
} from '../types';

export type IndexErrorShape = IndexManager['_formatError'];
export type IndexExistsShape = Awaited<ReturnType<IndexManager['exists']>>;
export type AliasExistsShape = Awaited<ReturnType<IndexManager['aliasExists']>>;
export type IndexMetadataShape = Awaited<
  ReturnType<IndexManager['getIndexMetadata']>
>;
export type AliasMetadataShape = Awaited<
  ReturnType<IndexManager['getAliasMetadata']>
>;
export type IndexFlushResult = Awaited<ReturnType<IndexManager['flush']>>;
export type IndexCreateResult = Awaited<ReturnType<IndexManager['create']>>;
export type IndexDropResult = Awaited<ReturnType<IndexManager['drop']>>;
export type IndexCreateAliasResult = Awaited<
  ReturnType<IndexManager['createAlias']>
>;
export type IndexDropAliasResult = Awaited<
  ReturnType<IndexManager['dropAlias']>
>;
export type IndexCreateIfNeededResult = Awaited<
  ReturnType<IndexManager['createIfNeeded']>
>;
export type IndexCreateAliasIfNeededResult = Awaited<
  ReturnType<IndexManager['createAliasIfNeeded']>
>;
export type IndexPutResult = Awaited<ReturnType<IndexManager['put']>>;
export type IndexPutBulkResult = Awaited<ReturnType<IndexManager['putBulk']>>;
export type IndexPatchResult = Awaited<ReturnType<IndexManager['patch']>>;
export type IndexDeleteResult = Awaited<ReturnType<IndexManager['deleteById']>>;
export type IndexStatusReport = Awaited<ReturnType<IndexManager['getStatus']>>;
export type IndexRecreateResult = Awaited<ReturnType<IndexManager['recreate']>>;
/** The creation request type an `IndexManager` was constructed with */
export type IndexInferCreate<T> = T extends IndexManager<infer C> ? C : never;
/** The document shape of an `IndexManager`'s mapping */
export type IndexInferRecordShape<T> = MappingRecord<IndexInferCreate<T>>;
/** The field paths a query may name for an `IndexManager` */
export type IndexInferFields<T> = MappingFieldPath<IndexInferCreate<T>>;
export type IndexRunShape<T extends IndexManager> = ReturnType<T['run']>;
export type MigrationParams = {
  onProgress?: (details: MigrationProgressDetails) => void;
  onComplete?: (details: MigrationProgressDetails) => void;
  onError?: (error: Error) => void;
  slices?: number;
  pollInterval?: number;
};
export type MigrationProgressDetails = {
  done: number;
  total: number;
  percent: number;
  taskId: string;
  oldIndex: string;
  newIndex: string;
  alias: string;
};
export type StatusReport = {
  took: number;
  fullName: string;
  aliasName: string;
  /** null when existence could not be determined */
  indexExists: boolean | null;
  /** null when existence could not be determined */
  aliasExists: boolean | null;
  needsMigration: boolean;
  needsCreation: boolean;
  summary: 'needsCreation' | 'needsMigration' | 'current';
};
/**
 * A callback that adds conditions to a `QueryBuilder`. `Field` is the union of
 * field names the builder accepts (`string` when not statically known).
 */
export type QueryBuilderProvider<Field extends string = string> = (
  builder: QueryBuilder<Field>,
) => void | QueryBuilder<Field> | Promise<QueryBuilder<Field>> | Promise<void>;

/**
 * Options for an `IndexManager`. The index's logical name comes from the
 * creation request's `index`; these options decide the versioned full name
 * (`prefix~language~name~vVersion`) and its alias (`prefix~language~name`).
 */
export type ManageOptions = {
  /** The Elasticsearch client to send requests with */
  client: Client;
  /** Separator between name parts (default `~`) */
  separator?: string;
  /** Index version; changing it triggers a migration (default 1) */
  version?: number | string;
  /** A prefix such as `prod` or `app1` (default none) */
  prefix?: string;
  /** The language part of the name (default `english`) */
  language?: string;
  /**
   * Whether the cluster is Elastic Cloud Serverless, so APIs it does not
   * support (e.g. `_flush`) are skipped without a request. Defaults to the
   * `ES_SERVERLESS` env var.
   */
  serverless?: boolean;
};

/**
 * How a failed request failed: a response from Elasticsearch, a connection
 * problem, a timeout, no living nodes, or anything else (`javascript`)
 */
export type IndexErrorKind =
  | 'response'
  | 'connection'
  | 'timeout'
  | 'disconnected'
  | 'javascript';

/**
 * The parts of a client `ResponseError` this class reads. Errors are
 * recognized by `name`, not `instanceof`, so errors from another copy of the
 * client package are classified too.
 */
type ErrorMeta = {
  statusCode?: number | null;
  body?: unknown;
  [key: string]: unknown;
};

/**
 * ElasticSearch index manager for creating, searching and saving data
 * for a particular index
 */
export default class IndexManager<
  const Create extends
    estypes.IndicesCreateRequest = estypes.IndicesCreateRequest,
> {
  /**
   * Builds the index name and alias
   */
  public index: IndexNameManager;

  /**
   * The ElasticSearch client
   */
  public client: Client;

  /**
   * The creation request given to the constructor, unchanged. Its `index` is
   * the logical name; `getCreateRequest()` sends the full name instead.
   */
  public readonly createSpec: Create;

  /**
   * Full-text field paths of the mapping (see `getFulltextFields()`)
   */
  public fulltextFields: string[];

  /**
   * Field paths of the mapping (see `getAllFields()`)
   */
  public allFields: string[];

  /**
   * Whether the cluster is Elastic Cloud Serverless. When undefined, the
   * `ES_SERVERLESS` env var decides (see `isServerless()`).
   */
  public serverless?: boolean;

  /**
   * Define the index with the given configuration
   * @param options  The client plus naming options (see `ManageOptions`)
   * @param create  The Elasticsearch index creation request; `index` is the
   *   logical name and everything else (`settings`, `mappings`, `aliases`,
   *   ...) is sent unchanged when the index is created
   * @throws {TypeError} When `options`, `options.client` or `create` is missing
   * @throws {Error} When `create.index` is not a valid index name, or
   *   `create.aliases` contains this manager's own alias name
   */
  constructor(options: ManageOptions, create: Create) {
    if (!options || typeof options !== 'object') {
      throw new TypeError(
        'IndexManager: the first argument (options) is required and must ' +
          'be an object with a "client"',
      );
    }
    if (!options.client) {
      throw new TypeError(
        'IndexManager: options.client is required; pass an ' +
          'Elasticsearch Client instance',
      );
    }
    if (!create || typeof create !== 'object') {
      throw new TypeError(
        'IndexManager: the second argument (create) is required and must ' +
          'be an index creation request with an "index" name',
      );
    }
    this.client = options.client;
    this.serverless = options.serverless;
    this.createSpec = create;
    this.index = new IndexNameManager({
      name: create.index,
      separator: options.separator,
      version: options.version,
      prefix: options.prefix,
      language: options.language,
    });
    const aliasName = this.getAliasName();
    if (create.aliases && Object.hasOwn(create.aliases, aliasName)) {
      throw new Error(
        `IndexManager: create.aliases must not contain "${aliasName}"; ` +
          'IndexManager creates and moves that alias itself',
      );
    }
    this.fulltextFields = getFulltextFields(create);
    this.allFields = getAllFields(create);
  }

  /**
   * Normalize errors thrown by the Elasticsearch client into a consistent shape.
   * Distinguishes between response, connection, timeout, disconnected, and generic JS errors.
   * Errors are recognized by their `name`, so errors thrown by another copy
   * of the client package are classified the same way.
   * @param e The error thrown by the client or runtime.
   * @returns A normalized error object with `error`, `errorKind`, and optional `response`.
   */
  _formatError(e: unknown): {
    error: Error;
    errorKind: IndexErrorKind;
    response: ErrorMeta | null;
  } {
    const errorKind = getErrorKind(e);
    return {
      error: e as Error,
      errorKind,
      // only Elasticsearch response errors carry response metadata
      response: errorKind === 'response' ? getErrorMeta(e) : null,
    };
  }

  /**
   * Wrap a successful client response in a normalized shape.
   * @param response The raw response from the Elasticsearch client.
   * @returns An object with `error` and `errorKind` null plus the original response.
   */
  _formatNonError<T>(response: T) {
    return {
      error: null,
      errorKind: null,
      response,
    };
  }

  /**
   * Check if the index already exists in the database
   */
  async exists(more?: Partial<IndexExistParams>) {
    const start = Date.now();
    const request = {
      method: 'HEAD',
      endpoint: `/${this.getFullName()}`,
      body: {
        index: this.getFullName(),
        ...(more || {}),
      },
    };
    try {
      const exists = await this.client.indices.exists(request.body);
      return {
        exists,
        took: Date.now() - start,
        request,
        ...this._formatNonError(exists),
      };
    } catch (e) {
      return {
        exists: null,
        took: Date.now() - start,
        request,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Get the alias name used to read/write to the current index version.
   * @returns The alias name string.
   */
  getAliasName() {
    return this.index.getAliasName();
  }

  /**
   * Get the full concrete index name (including version suffix, if any).
   * @returns The fully-qualified index name.
   */
  getFullName() {
    return this.index.getFullName();
  }

  /**
   * Check if the alias already exists in the database
   */
  async aliasExists(more?: Partial<AliasExistParams>) {
    const start = Date.now();
    const request = {
      method: 'HEAD',
      endpoint: `/_alias/${this.getAliasName()}`,
      body: {
        name: this.getAliasName(),
        ...(more || {}),
      },
    };
    try {
      const exists = await this.client.indices.existsAlias(request.body);
      return {
        exists,
        request,
        took: Date.now() - start,
        ...this._formatNonError(exists),
      };
    } catch (e) {
      console.log('aliasExists error', e);
      const meta = getErrorMeta(e);
      if (meta?.statusCode === 404) {
        return {
          exists: false,
          request,
          took: Date.now() - start,
          ...this._formatNonError(meta),
        };
      }
      return {
        exists: null,
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Get metadata for the index
   */
  async getIndexMetadata(more?: Partial<IndexMetadataParams>) {
    const start = Date.now();
    const request = {
      method: 'GET',
      endpoint: `/${this.getFullName()}`,
      body: {
        index: this.getFullName(),
        ...(more || {}),
      },
    };
    try {
      const response = await this.client.indices.get(request.body);
      // keyed by concrete index name
      const indexName = Object.keys(response)[0];
      return {
        name: indexName,
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      // const exists = e.statusCode === 404;
      return {
        name: null,
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Get metadata for the alias
   */
  async getAliasMetadata(more?: Partial<AliasMetadataParams>) {
    const start = Date.now();
    const request = {
      method: 'GET',
      endpoint: `/_alias/${this.getAliasName()}`,
      body: {
        name: this.getAliasName(),
        ...(more || {}),
      },
    };
    try {
      const response = await this.client.indices.getAlias(request.body);
      if (typeof response !== 'object') {
        throw new Error(
          `Unexpected indices.getAlias() response: ${JSON.stringify(response, null, 2)}`,
        );
      }
      const indexes: string[] = [];
      for (const indexName of Object.keys(response)) {
        indexes.push(indexName);
      }
      return {
        success: true,
        indexes,
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      if (getErrorMeta(e)?.statusCode === 404) {
        return {
          success: true,
          indexes: [],
          request,
          took: Date.now() - start,
          ...this._formatNonError({}),
        };
      }
      return {
        success: false,
        indexes: [],
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Whether the cluster is Elastic Cloud Serverless. Checked in order:
   * 1. the `serverless` constructor option, if given
   * 2. the `ES_SERVERLESS` env var (`true` or `1`)
   * 3. whether this client has already been rejected by a serverless-only
   *    `api_not_available_exception`
   */
  isServerless() {
    if (this.serverless !== undefined) {
      return this.serverless;
    }
    if (isServerlessEnv()) {
      return true;
    }
    return serverlessClients.has(this.client);
  }

  /**
   * Flush the index to ensure all operations are committed to disk.
   * Elastic Cloud Serverless manages durability itself and rejects `_flush`;
   * there the call is a successful no-op with `skipped: true`. To skip the
   * request entirely, pass `serverless: true` or set `ES_SERVERLESS=true`.
   * @param more Optional additional flush parameters.
   * @returns Whether the flush succeeded (no shard failures), whether it was
   *   skipped because the server does not support it, plus response metadata.
   */
  async flush(more?: Partial<FlushRequestParams>) {
    const start = Date.now();
    const request = {
      method: 'POST',
      endpoint: `/${this.getAliasName()}/_flush`,
      body: {
        index: this.getAliasName(),
        ...(more || {}),
      },
    };
    if (this.isServerless()) {
      return {
        success: true,
        skipped: true,
        request,
        took: Date.now() - start,
        ...this._formatNonError(null),
      };
    }
    try {
      const response = await this.client.indices.flush(request.body);
      return {
        success: (response._shards?.failed ?? 0) === 0,
        skipped: false,
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      if (isApiNotAvailable(e)) {
        // remember, so later calls on this client skip the request
        serverlessClients.add(this.client);
        return {
          success: true,
          skipped: true,
          request,
          took: Date.now() - start,
          ...this._formatNonError(null),
        };
      }
      return {
        success: false,
        skipped: false,
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Build the request payload to create this index: the creation request
   * given to the constructor with `index` replaced by the full name.
   * `createSpec` is not changed.
   * @param more Optional additional create-index parameters to merge into the request.
   * @returns A request descriptor containing method, endpoint and body.
   */
  getCreateRequest(more?: Partial<IndexCreateParams>) {
    const body: estypes.IndicesCreateRequest = {
      ...this.createSpec,
      index: this.getFullName(),
      ...(more || {}),
    };
    return {
      method: 'PUT',
      endpoint: `/${this.getFullName()}`,
      body,
    };
  }

  /**
   * Create a new index with these specifications (no alias)
   */
  async createOnly(more?: Partial<IndexCreateParams>) {
    const start = Date.now();
    const request = this.getCreateRequest(more || {});
    try {
      const response = await this.client.indices.create(request.body);
      return {
        index: response.index,
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      return {
        index: null,
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Create the index and then create its alias.
   * If index creation fails, the alias step is skipped and the error is returned.
   * @returns A result object including both index and alias responses, timing and error info.
   */
  async create() {
    const start = Date.now();
    const indexResponse = await this.createOnly();
    if (indexResponse.error) {
      return {
        success: false,
        took: Date.now() - start,
        indexResponse,
        alias: null,
        error: indexResponse.error,
        errorKind: indexResponse.errorKind,
      };
    }
    const aliasResponse = await this.createAlias();
    return {
      took: Date.now() - start,
      success: aliasResponse.acknowledged,
      indexResponse,
      aliasResponse,
      ...(aliasResponse.error
        ? {
            error: aliasResponse.error,
            errorKind: aliasResponse.errorKind,
          }
        : {}),
    };
  }

  /**
   * Drop index and all data; delete alias if exists
   */
  async drop(more?: Partial<DeleteRequestShape>) {
    const start = Date.now();
    const request = {
      method: 'DELETE',
      endpoint: `/${this.getFullName()}`,
      body: {
        index: this.getFullName(),
        ...(more || {}),
      },
    };
    const { exists } = await this.aliasExists();
    try {
      const response = await this.client.indices.delete(request.body);
      if (response.acknowledged && exists) {
        await this.client.indices.deleteAlias({
          index: this.getFullName(),
          name: this.getAliasName(),
        });
      }
      return {
        acknowledged: response.acknowledged,
        shards: response._shards,
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      return {
        acknowledged: false,
        shards: null,
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Drop and recreate the index, flushing afterwards.
   * If the index exists, it will be deleted first; then a new one is created.
   * @returns The result of the create operation.
   */
  async recreate() {
    const exists = await this.exists();
    if (exists.exists) {
      await this.drop();
    }
    const res = await this.create();
    await this.flush();
    return res;
  }

  /**
   * Create an alias for this index
   */
  async createAlias(more?: Partial<AliasCreateParams>) {
    const start = Date.now();
    const request = {
      method: 'PUT',
      endpoint: `/${this.getFullName()}/_alias/${this.getAliasName()}`,
      body: {
        name: this.getAliasName(),
        index: this.getFullName(),
        ...(more || {}),
      },
    };
    try {
      const response = await this.client.indices.putAlias(request.body);
      return {
        acknowledged: response.acknowledged,
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      return {
        acknowledged: false,
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Drop alias
   */
  async dropAlias(more?: Partial<AliasDeleteParams>) {
    const start = Date.now();
    const request = {
      method: 'DELETE',
      endpoint: `/${this.getFullName()}/_alias/${this.getAliasName()}`,
      body: {
        name: this.getAliasName(),
        index: this.getFullName(),
        ...(more || {}),
      },
    };
    try {
      const response = await this.client.indices.deleteAlias(request.body);
      return {
        acknowledged: response.acknowledged,
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      return {
        acknowledged: false,
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Create the index, but only if needed
   */
  async createIfNeeded() {
    const start = Date.now();
    const res = await this.exists();
    if (res.exists) {
      return {
        success: true,
        took: Date.now() - start,
        request: res.request,
        code: 'ALREADY_EXISTS',
        error: null,
        errorKind: null,
      };
    } else if (res.error) {
      return {
        success: false,
        took: Date.now() - start,
        request: res.request,
        code: 'EXISTS_CHECK_ERROR',
        error: res.error,
        errorKind: res.errorKind,
      };
    } else {
      const res = await this.create();
      return {
        code: res.error ? 'CREATE_ERROR' : 'CREATED',
        ...res,
      };
    }
  }

  /**
   * Create the alias, but only if needed
   *
   */
  async createAliasIfNeeded() {
    const start = Date.now();
    const res = await this.aliasExists();
    if (res.exists) {
      return {
        success: true,
        took: Date.now() - start,
        request: res.request,
        code: 'ALREADY_EXISTS',
        error: null,
        errorKind: null,
      };
    } else if (res.error) {
      return {
        success: false,
        took: Date.now() - start,
        request: res.request,
        code: 'ERROR',
        error: res.error,
        errorKind: res.errorKind,
      };
    } else {
      const res = await this.createAlias();
      if (res.acknowledged === false) {
        return {
          success: false,
          took: Date.now() - start,
          request: res.request,
          code: 'ERROR',
          error: res.error,
          errorKind: res.errorKind,
        };
      } else {
        return {
          success: true,
          request: res.request,
          code: 'CREATED',
          error: null,
          errorKind: null,
        };
      }
    }
  }

  /**
   * Save the given record and return its id (uses PUT)
   * @param id  The record id
   * @param body  The record to save
   */
  async put(id: number | string, body: MappingRecord<Create>) {
    const start = Date.now();
    const request = {
      method: 'PUT',
      endpoint: `/${this.getAliasName()}/_doc/${id}`,
      body: {
        index: this.getAliasName(),
        id: String(id),
        // `document` is the client's name for the record. A key the client
        // does not know (such as `body`) may be sent as part of the record.
        document: body,
      },
    };
    try {
      const response = await this.client.index(request.body);
      return {
        result: response.result,
        took: Date.now() - start,
        request,
        ...this._formatNonError(response),
      };
    } catch (e) {
      return {
        result: null,
        took: Date.now() - start,
        request,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Save the given records
   * @param records  The records to save
   * @param [more]  Additional body params
   */
  async putBulk(
    records: MappingRecord<Create>[],
    more?: Partial<BulkRequestParams>,
  ) {
    const start = Date.now();
    const index = this.getAliasName();
    const bulkBody: any[] = [];
    for (const record of records) {
      const id = (record as { id?: unknown }).id;
      const _id = id ? String(id) : crypto.randomUUID();
      bulkBody.push({ index: { _index: index, _id } }, record);
    }
    const request = {
      method: 'PUT',
      endpoint: `/_bulk`,
      body: {
        index,
        operations: bulkBody,
        ...(more || {}),
      },
    };
    try {
      const response = await this.client.bulk(request.body);
      const errors: ErrorCause[] = [];
      const report = response.items.map((item) => {
        // only `index` operations are sent
        const op = item.index;
        if (op?.error) {
          errors.push(op.error);
        }
        return {
          status: op?.status,
          error: op?.error,
          effect: op?.result,
          version: op?._version,
        };
      });
      return {
        success: errors.length === 0,
        errors,
        report,
        request,
        took: Date.now() - start,
        ...more,
      };
    } catch (e) {
      return {
        success: false,
        report: [],
        errors: [],
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Merge the given fields into an existing record (uses POST _update)
   * @param id  The record id
   * @param body  The fields to change; other fields keep their values
   * @param [more]  Additional body params
   */
  async patch(
    id: string,
    body: Partial<MappingRecord<Create>>,
    more?: Partial<PatchRequestParams>,
  ) {
    const start = Date.now();
    const request = {
      method: 'POST',
      endpoint: `/${this.getAliasName()}/_update/${id}`,
      body: {
        index: this.getAliasName(),
        id,
        // Elasticsearch merges the fields given under `doc` into the record
        doc: body,
        ...(more || {}),
      },
    };
    try {
      const response = await this.client.update(request.body);
      return {
        success: true,
        result: 'updated',
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      return {
        success: false,
        result: 'error',
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Retrieve a status snapshot for this index and alias.
   * Includes names, existence flags, and whether creation or migration is needed.
   * @returns An object containing timing, names, and status booleans.
   */
  async getStatus(): Promise<StatusReport> {
    const start = Date.now();
    const fullName = this.getFullName();
    const aliasName = this.getAliasName();
    const indexExists = await this.exists();
    const aliasExists = await this.aliasExists();
    const needsMigration = await this.needsMigration();
    const needsCreation = !indexExists.exists && !needsMigration;
    return {
      took: Date.now() - start,
      fullName,
      aliasName,
      indexExists: indexExists.exists,
      aliasExists: aliasExists.exists,
      needsMigration,
      needsCreation,
      summary: getStatusSummary(needsCreation, needsMigration),
    };
  }

  /**
   * Determine whether the index needs to be created.
   * @returns True if the index does not exist yet; otherwise false.
   */
  async needsCreation() {
    const indexExists = await this.exists();
    return !indexExists;
  }

  /**
   * Determine whether a migration is required based on sibling indexes.
   * @returns True if there are sibling indexes under the alias that are not the current full name.
   */
  async needsMigration() {
    const siblings = await this.getSiblingIndexes();
    return siblings.length > 0;
  }

  /**
   * List sibling index names currently attached to this alias, excluding this index.
   * @returns An array of index names other than the current full name.
   */
  async getSiblingIndexes() {
    const meta = await this.getAliasMetadata();
    const fullName = this.getFullName();
    return meta.indexes.filter((name) => name !== fullName);
  }

  /**
   * Migrate the index if needed
   * - Index may exist
   *   - If not, create it and create an alias
   *   - If it does, create alias if needed
   * - Otherwise check the alias name in ElasticSearch matches this alias name
   *   - If it matches, do nothing
   *   - If it doesn't create a new index, copy old data to new index, then update alias to point to the new index
   *   - Note that ElasticSearch may support an alias pointing to old and new indexes at the same time + deleting on copy
   */
  async migrateIfNeeded({
    onProgress,
    onComplete,
    onError,
    slices = 1,
    pollInterval = 1000,
  }: MigrationParams = {}) {
    const start = Date.now();
    const meta = {
      recordsToMigrate: 0,
      createdAlias: false,
      createdIndex: false,
      oldNames: [] as string[],
      newName: this.getFullName(),
    };
    try {
      const status = await this.getStatus();
      meta.newName = status.fullName;

      if (status.needsMigration) {
        // we need to create new index, assign it an alias, and migrate from old index
        const aliasInfo = await this.getAliasMetadata();
        meta.oldNames = aliasInfo.indexes;
        // check now if we have any data to migrate
        const { count } = await this.client.count({
          index: aliasInfo.indexes.join(','),
        });
        meta.recordsToMigrate = count;

        await this.create();
        meta.createdIndex = true;
        await this.client.indices.updateAliases({
          actions: [
            {
              add: {
                index: status.fullName,
                alias: status.aliasName,
                // all new records will start writing to this new index
                // this will stop writes to other indexes pointing to the alias
                is_write_index: true,
              },
            },
          ],
        });
        if (count === 0) {
          // no records to migrate
          for (const name of aliasInfo.indexes) {
            if (name === status.fullName) {
              // normally shouldn't happen unless alias was associated manually before
              continue;
            }
            console.log('about to drop index', name);
            await this.client.indices.delete({
              index: name,
            });
            console.log('deleted index in loop', name);
          }
          for (const name of aliasInfo.indexes) {
            onProgress?.({
              oldIndex: name,
              done: 0,
              total: 0,
              percent: 100,
              taskId: '',
              newIndex: status.fullName,
              alias: status.aliasName,
            });
          }
          return {
            success: true,
            ...meta,
            took: Date.now() - start,
            ...this._formatNonError({}),
          };
        }
        const _kickoffReindex = async (oldIndex: string) => {
          try {
            if (pollInterval < 200) {
              pollInterval = 200;
            }
            const { task: taskId } = await this.client.reindex({
              wait_for_completion: false,
              // make migrated records searchable as soon as the task completes
              refresh: true,
              conflicts: 'proceed',
              source: { index: oldIndex },
              dest: { index: status.fullName, op_type: 'index' },
              slices,
            });
            if (taskId === undefined) {
              throw new Error(
                `Reindexing ${oldIndex} did not return a task id to follow`,
              );
            }
            while (true) {
              await new Promise((r) => setTimeout(r, pollInterval));
              const taskStatus = await this.client.tasks.get({
                task_id: taskId,
              });
              // TODO: check if there is a task error and abort
              const updatedCount = taskStatus.task.status.updated;
              const createdCount = taskStatus.task.status.created;
              const total = taskStatus.task.status.total;
              const done = updatedCount + createdCount;
              const percent = Math.floor(Math.min(99, (done / total) * 100));
              if (taskStatus.completed) {
                await this.flush();
                try {
                  // note that conflicting records could still be in old index
                  // but we will consider new index to have canonical version
                  await this.client.indices.delete({
                    index: oldIndex,
                  });
                } catch (_) {
                  // doesn't matter if it fails
                }
                onProgress?.({
                  oldIndex,
                  done,
                  total,
                  percent: 100,
                  taskId,
                  newIndex: status.fullName,
                  alias: status.aliasName,
                });
                onComplete?.({
                  oldIndex,
                  done,
                  total,
                  percent: 100,
                  taskId,
                  newIndex: status.fullName,
                  alias: status.aliasName,
                });
                break;
              } else {
                onProgress?.({
                  oldIndex,
                  done,
                  total,
                  percent,
                  taskId,
                  newIndex: status.fullName,
                  alias: status.aliasName,
                });
              }
            }
          } catch (e) {
            onError?.(toError(e));
          }
        };
        for (const name of aliasInfo.indexes) {
          // typically there will be just one
          _kickoffReindex(name);
        }
        return {
          success: true,
          ...meta,
          took: Date.now() - start,
          ...this._formatNonError({}),
        };
      } else if (status.needsCreation) {
        // There is no index at all
        const createResult = await this.create();
        meta.createdIndex = true;

        if (createResult.error !== null) {
          return {
            success: false,
            ...meta,
            took: Date.now() - start,
            ...this._formatError(createResult.error),
          };
        }

        // No alias previously
        if (!status.aliasExists) {
          await this.createAlias();
          meta.createdAlias = true;
        }
        onProgress?.({
          oldIndex: '',
          done: -1,
          total: -1,
          percent: 100,
          taskId: '',
          newIndex: status.fullName,
          alias: status.aliasName,
        });
        onComplete?.({
          oldIndex: '',
          done: -1,
          total: -1,
          percent: 100,
          taskId: '',
          newIndex: status.fullName,
          alias: status.aliasName,
        });
        return {
          success: true,
          ...meta,
          took: Date.now() - start,
          ...this._formatNonError(createResult),
        };
      } else {
        // Alias already points to the correct index
        return {
          success: true,
          ...meta,
          took: Date.now() - start,
          ...this._formatNonError(status.indexExists),
        };
      }
    } catch (e) {
      onError?.(toError(e));
      return {
        success: false,
        ...meta,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Find a single record by the given id
   * @param id  The record id
   * @param [more]  Additional body params
   */
  async findById(id: string, more?: Partial<GetRequestParams>) {
    const start = Date.now();
    const request = {
      method: 'GET',
      endpoint: `/${this.getAliasName()}/_doc/${id}`,
      body: {
        index: this.getAliasName(),
        id,
        ...(more || {}),
      },
    };
    try {
      const response = await this.client.get<MappingRecord<Create>>(
        request.body,
      );
      const record = response._source ?? null;
      return {
        record,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      return {
        record: null,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Execute arbitrary operations with a `QueryRunner` instance.
   * @param withQueryRunner Callback that receives a `QueryRunner` bound to this index.
   * @returns The value returned by the callback.
   */
  run<T>(withQueryRunner: (runner: QueryRunner<Create>) => T) {
    return withQueryRunner(new QueryRunner(this));
  }

  /**
   * Find many records using a `QueryBuilder` callback.
   * @param withQueryBuilder Optional callback to configure the query.
   * @param more Optional additional search request options (excluding `index` and `query`).
   * @returns A search result from `QueryRunner.findMany`.
   */
  findMany(
    withQueryBuilder?: QueryBuilderProvider<MappingFieldPath<Create>>,
    more?: Omit<estypes.SearchRequest, 'index' | 'query'>,
  ) {
    return this.run(async (runner) => {
      if (withQueryBuilder) {
        await withQueryBuilder(runner.builder);
      }
      return runner.findMany(more);
    });
  }

  /**
   * Find the first record matching the built query.
   * @param withQueryBuilder Optional callback to configure the query.
   * @param more Optional additional search request options (excluding `index` and `query`).
   * @returns The first matching record result from `QueryRunner.findFirst`.
   */
  findFirst(
    withQueryBuilder?: QueryBuilderProvider<MappingFieldPath<Create>>,
    more?: Omit<estypes.SearchRequest, 'index' | 'query'>,
  ) {
    return this.run(async (runner) => {
      if (withQueryBuilder) {
        await withQueryBuilder(runner.builder);
      }
      return runner.findFirst(more);
    });
  }

  /**
   * Count documents matching the built query.
   * @param withQueryBuilder Optional callback to configure the query.
   * @param more Optional additional search request options (excluding `index` and `query`).
   * @returns The count result from `QueryRunner.count`.
   */
  count(
    withQueryBuilder?: QueryBuilderProvider<MappingFieldPath<Create>>,
    more?: Omit<estypes.SearchRequest, 'index' | 'query'>,
  ) {
    return this.run(async (runner) => {
      if (withQueryBuilder) {
        await withQueryBuilder(runner.builder);
      }
      return runner.count(more);
    });
  }

  /**
   * Remove record from database
   * @param {String} id  The id of the record
   */
  async deleteById(id: string) {
    const start = Date.now();
    const request = {
      method: 'DELETE',
      endpoint: `/${this.getAliasName()}/_doc/${id}`,
      body: {
        index: this.getAliasName(),
        id,
      },
    };
    try {
      const response = await this.client.delete(request.body);
      return {
        success: true,
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      return {
        success: false,
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Delete many documents that match a built query using `_delete_by_query`.
   * Note: This is a potentially expensive operation; prefer targeted deletes when possible.
   * @param withQueryBuilder Optional callback to configure the query.
   * @param more Optional additional search request options (excluding `index` and `query`).
   * @returns A result with success flag, request info, timing, and client response/error.
   */
  async deleteMany(
    withQueryBuilder?: QueryBuilderProvider<MappingFieldPath<Create>>,
    more?: Omit<estypes.SearchRequest, 'index' | 'query'>,
  ) {
    const start = Date.now();
    const builder = new QueryBuilder<MappingFieldPath<Create>>();
    if (withQueryBuilder) {
      await withQueryBuilder(builder);
    }
    const request = {
      index: this.getAliasName(),
      query: builder.getBody().query,
    };
    try {
      const response = await this.client.deleteByQuery(request, more);
      return {
        success: true,
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      return {
        success: false,
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }
}

/**
 * Clients that have answered with `api_not_available_exception`, i.e. that
 * point at Elastic Cloud Serverless. Weak so discarded clients are collected.
 */
const serverlessClients = new WeakSet<Client>();

/**
 * Whether the `ES_SERVERLESS` env var marks the cluster as serverless.
 */
function isServerlessEnv() {
  const value = (process.env.ES_SERVERLESS || '').trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Whether the server rejected a request because the API does not exist in
 * its deployment mode (e.g. `_flush` on Elastic Cloud Serverless, which
 * responds 410 with `api_not_available_exception`).
 */
function isApiNotAvailable(e: unknown) {
  if (getErrorName(e) !== 'ResponseError') {
    return false;
  }
  const body = getErrorMeta(e)?.body as
    | { error?: { type?: string } }
    | null
    | undefined;
  return body?.error?.type === 'api_not_available_exception';
}

/**
 * The `name` of a thrown value, or '' when it has none
 */
function getErrorName(e: unknown) {
  if (typeof e === 'object' && e !== null && 'name' in e) {
    if (typeof e.name === 'string') {
      return e.name;
    }
  }
  return '';
}

/**
 * Classify a thrown value by its `name`. The client's error classes set
 * these names (see `@elastic/transport`'s `errors.js`); comparing names
 * instead of using `instanceof` also works for errors from another copy of
 * the client package.
 */
function getErrorKind(e: unknown): IndexErrorKind {
  switch (getErrorName(e)) {
    case 'ResponseError':
      return 'response';
    case 'ConnectionError':
      return 'connection';
    case 'TimeoutError':
      return 'timeout';
    case 'NoLivingConnectionsError':
      return 'disconnected';
    default:
      return 'javascript';
  }
}

/**
 * The response metadata (`statusCode`, `body`, ...) of a client error, or
 * null when the thrown value has none
 */
function getErrorMeta(e: unknown): ErrorMeta | null {
  if (typeof e === 'object' && e !== null && 'meta' in e) {
    const meta = e.meta;
    if (typeof meta === 'object' && meta !== null) {
      return meta as ErrorMeta;
    }
  }
  return null;
}

/**
 * The thrown value as an `Error` (wrapped when it is not one)
 */
function toError(e: unknown) {
  if (e instanceof Error) {
    return e;
  }
  return new Error(String(e));
}

/**
 * The one-word status summary for `getStatus()`
 */
function getStatusSummary(needsCreation: boolean, needsMigration: boolean) {
  if (needsCreation) {
    return 'needsCreation' as const;
  }
  if (needsMigration) {
    return 'needsMigration' as const;
  }
  return 'current' as const;
}

/*
Example:

import { Client } from '@elastic/elasticsearch';
import { IndexManager } from 'es-query-pro';

const client = new Client({ node: process.env.ES_ENDPOINT });

export const postIndex = new IndexManager(
  { client, version: 1, prefix: 'prod' },
  {
    index: 'post',
    settings: {
      // Specify fields (other than relevance) we might sort by to make
      // sorting faster.
      // See https://www.elastic.co/blog/index-sorting-elasticsearch-6-0
      index: {
        sort: { field: ['createdAt'], order: ['desc'] },
      },
    },
    mappings: {
      properties: {
        id: { type: 'integer' },
        uuid: { type: 'keyword' },
        title: {
          type: 'text',
          analyzer: 'english',
          fields: { exact: { type: 'keyword', ignore_above: 256 } },
        },
        body: { type: 'text', analyzer: 'english' },
        postType: { type: 'keyword' },
        createdAt: { type: 'date' },
        taxonomy: {
          type: 'nested',
          properties: {
            taxId: { type: 'integer' },
            taxName: { type: 'keyword' },
          },
        },
      },
    },
  },
);
// prod~english~post~v1 (index), prod~english~post (alias)

 */
