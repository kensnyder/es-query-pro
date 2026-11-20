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
import QueryRunner, { type QueryRecord } from '../QueryRunner/QueryRunner';
import type {
  AliasCreateParams,
  AliasDeleteParams,
  AliasExistParams,
  AliasMetadataParams,
  DeleteRequestShape,
  ErrorCause,
  FlushRequestParams,
  IndexCreateParams,
  IndexExistParams,
  IndexMetadataParams,
} from '../types';
import {
  type MigrationParams,
  type MigrationResult,
  migrateIndex,
} from './migrate';

/**
 * The error half of every result envelope: what `_formatError()` returns and
 * what every public method spreads into its result when a request fails
 */
export type IndexErrorShape = {
  /** The thrown value; non-`Error` values are wrapped (see `cause`) */
  error: Error;
  errorKind: IndexErrorKind;
  /** The response metadata (`statusCode`, `body`, ...) of a `ResponseError` */
  response: ErrorMeta | null;
};
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
export type IndexSiblingIndexesResult = Awaited<
  ReturnType<IndexManager['getSiblingIndexes']>
>;
export type IndexRecreateResult = Awaited<ReturnType<IndexManager['recreate']>>;
export type IndexCreateOnlyResult = Awaited<
  ReturnType<IndexManager['createOnly']>
>;
/** The create-index request descriptor `getCreateRequest()` returns */
export type IndexCreateRequestShape = ReturnType<
  IndexManager['getCreateRequest']
>;
/**
 * What `create()`, `createIfNeeded()`, `recreate()` and
 * `createAliasIfNeeded()` did. `success` is true only for the first three:
 * - `CREATED`: the index (or, for `createAliasIfNeeded()`, the alias) was
 *   created and the alias points at it
 * - `ALREADY_EXISTS`: the alias already pointed at this index; nothing sent
 * - `ALIAS_CREATED`: the index existed and the missing alias was added
 * - `NEEDS_MIGRATION`: the alias points at an older version of this index
 *   (or one whose version cannot be ordered); it was left alone, run
 *   `migrateIfNeeded()`
 * - `NEWER_VERSION_PRESENT`: the alias points at a newer version; left alone
 * - `ALIAS_CONFLICT`: the alias points at an index that is not a version of
 *   this one; left alone
 * - `EXISTS_CHECK_ERROR`, `CREATE_ERROR`, `ALIAS_ERROR`, `DROP_ERROR`,
 *   `FLUSH_ERROR`: that request failed (see `error` and `errorKind`)
 */
export type IndexLifecycleCode =
  | 'CREATED'
  | 'ALREADY_EXISTS'
  | 'ALIAS_CREATED'
  | 'NEEDS_MIGRATION'
  | 'NEWER_VERSION_PRESENT'
  | 'ALIAS_CONFLICT'
  | 'EXISTS_CHECK_ERROR'
  | 'CREATE_ERROR'
  | 'ALIAS_ERROR'
  | 'DROP_ERROR'
  | 'FLUSH_ERROR';
/**
 * A record id. Numbers are sent as strings; `0` is a valid id.
 */
export type IndexRecordId = string | number;
/** Request params for `put()` (`refresh`, `if_seq_no`, `op_type`, ...) */
export type IndexPutParams = Omit<
  estypes.IndexRequest,
  'index' | 'id' | 'document'
>;
/** Request params sent with every `putBulk()` request (`refresh`, ...) */
export type IndexPutBulkParams = Omit<
  estypes.BulkRequest,
  'index' | 'operations'
>;
/** How `putBulk()` splits its records into requests */
export type IndexPutBulkOptions = {
  /** Most records per request (default 1000) */
  chunkSize?: number;
  /**
   * Most bytes of serialized records per request (default 5 MiB). A record
   * larger than this is sent in a request of its own.
   */
  chunkBytes?: number;
};
/** One row of `putBulk()`'s `report`, in the order of the records given */
export type IndexPutBulkReportRow = {
  /** The id sent (generated when the record had no `id`) */
  id: string;
  /** The row's HTTP status; null when its request was not answered */
  status: number | null;
  /** `created`, `updated`, ...; null when the row failed or was not sent */
  effect: estypes.Result | null;
  version: number | null;
  error: estypes.ErrorCause | null;
};
/** Request params for `patch()` (`refresh`, `doc_as_upsert`, ...) */
export type IndexPatchParams = Omit<
  estypes.UpdateRequest,
  'index' | 'id' | 'doc'
>;
/** Request params for `findById()` (`_source_includes`, `realtime`, ...) */
export type IndexFindByIdParams = Omit<estypes.GetRequest, 'index' | 'id'>;
/** Request params for `deleteById()` (`refresh`, `if_seq_no`, ...) */
export type IndexDeleteByIdParams = Omit<estypes.DeleteRequest, 'index' | 'id'>;
/** Request params for `deleteMany()` (`conflicts`, `refresh`, ...) */
export type IndexDeleteManyParams = Omit<
  estypes.DeleteByQueryRequest,
  'index' | 'query'
>;
/** Request params for `count()` (`min_score`, `terminate_after`, ...) */
export type IndexCountParams = Omit<estypes.CountRequest, 'index' | 'query'>;
export type IndexFindByIdResult = Awaited<ReturnType<IndexManager['findById']>>;
export type IndexDeleteManyResult = Awaited<
  ReturnType<IndexManager['deleteMany']>
>;
/** The creation request type an `IndexManager` was constructed with */
export type IndexInferCreate<T> = T extends IndexManager<infer C> ? C : never;
/** The document shape of an `IndexManager`'s mapping */
export type IndexInferRecordShape<T> = MappingRecord<IndexInferCreate<T>>;
/** The field paths a query may name for an `IndexManager` */
export type IndexInferFields<T> = MappingFieldPath<IndexInferCreate<T>>;
/** The `QueryRunner` that `run()` passes to its callback */
export type IndexRunShape<T extends IndexManager> = QueryRunner<
  IndexInferCreate<T>
>;
export type {
  MigrationCode,
  MigrationOutcome,
  MigrationOutcomeCode,
  MigrationParams,
  MigrationPassPhase,
  MigrationPassReport,
  MigrationPhase,
  MigrationProgressDetails,
  MigrationRequest,
  MigrationResult,
} from './migrate';
/** What `migrateIfNeeded()` resolves to (same as `MigrationResult`) */
export type IndexMigrateResult = MigrationResult;
/**
 * The indexes an alias points at besides this one, by how each relates to
 * this index (see `IndexNameManager.compare()`)
 */
export type SiblingIndexes = {
  /** Every index on the alias except this one, in the server's order */
  all: string[];
  /** Lower versions of this index, oldest first */
  older: string[];
  /** Higher versions of this index, oldest first */
  newer: string[];
  /**
   * Other versions of this index that cannot be ordered against this one
   * (one of the two versions is not a plain integer, e.g. `v2024a`), by name
   */
  incomparable: string[];
  /**
   * Indexes that are not a version of this one (another prefix, language,
   * name or separator, or a name IndexManager did not make), by name
   */
  unrelated: string[];
};
/**
 * One word for `getStatus()`, from the first rule that applies:
 * - `unknown`: a check failed; see `error`
 * - `newerVersionPresent`: the alias points at a newer version
 * - `needsMigration`: the alias points at an older (or `incomparable`)
 *   version of this index
 * - `aliasConflict`: the alias points at an index that is not a version of
 *   this one
 * - `needsCreation`: neither the index nor the alias exists
 * - `needsAlias`: the index exists but the alias does not
 * - `current`: the alias points at this index only
 */
export type StatusSummary =
  | 'unknown'
  | 'newerVersionPresent'
  | 'needsMigration'
  | 'aliasConflict'
  | 'needsCreation'
  | 'needsAlias'
  | 'current';
export type StatusReport = {
  took: number;
  fullName: string;
  aliasName: string;
  /** null when existence could not be determined */
  indexExists: boolean | null;
  /** null when existence could not be determined */
  aliasExists: boolean | null;
  /** Every index the alias points at (empty if missing or unknown) */
  aliasIndexes: string[];
  /** Whether the alias points at this index; null when unknown */
  aliasAttached: boolean | null;
  /** The other indexes on the alias, classified (empty lists if unknown) */
  siblings: SiblingIndexes;
  /** `summary === 'needsMigration'` */
  needsMigration: boolean;
  /** `summary === 'needsCreation'` */
  needsCreation: boolean;
  summary: StatusSummary;
  /** The first failed check (index, then alias); null when both succeeded */
  error: Error | null;
  errorKind: IndexErrorKind | null;
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
 * How a failed request failed, from the client error's `name`:
 * - `response`: Elasticsearch answered with an error status (`ResponseError`)
 * - `connection`: the server could not be reached (`ConnectionError`)
 * - `timeout`: no answer in time (`TimeoutError`)
 * - `disconnected`: no living node to send to (`NoLivingConnectionsError`)
 * - `aborted`: the request was aborted (`RequestAbortedError`)
 * - `serialization`: a body could not be encoded or decoded
 *   (`SerializationError`, `DeserializationError`)
 * - `product`: the server is not Elasticsearch (`ProductNotSupportedError`)
 * - `configuration`: the client is misconfigured (`ConfigurationError`)
 * - `javascript`: anything else, e.g. a bug or a thrown non-client error
 */
export type IndexErrorKind =
  | 'response'
  | 'connection'
  | 'timeout'
  | 'disconnected'
  | 'aborted'
  | 'serialization'
  | 'product'
  | 'configuration'
  | 'javascript';

/**
 * The parts of a client `ResponseError` this class reads. Errors are
 * recognized by `name`, not `instanceof`, so errors from another copy of the
 * client package are classified too.
 */
export type ErrorMeta = {
  statusCode?: number | null;
  body?: unknown;
  [key: string]: unknown;
};

/** The error half of a failed step's envelope */
export type StepFailure = IndexErrorShape;

/** What one path of `create()` or `createIfNeeded()` reports */
export type CreateOutcome = {
  code: IndexLifecycleCode;
  failure?: StepFailure | null;
  aliasIndexes?: string[];
  indexResponse?: IndexCreateOnlyResult | null;
  aliasResponse?: IndexCreateAliasResult | null;
};

/** Where the alias points, from `IndexManager._getAliasState()` */
export type AliasState = {
  failure: StepFailure | null;
  indexes: string[];
  attached: boolean;
  conflict: IndexLifecycleCode | null;
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
   * `errorKind` says how the request failed (see `IndexErrorKind`). Errors are
   * recognized by their `name`, so errors thrown by another copy of the
   * client package are classified the same way.
   * @param e The error thrown by the client or runtime.
   * @returns `error` (always an `Error`; anything else is wrapped with the
   *   thrown value as its `cause`), `errorKind`, and `response`, the response
   *   metadata of a `ResponseError` (null for other kinds).
   */
  _formatError(e: unknown): IndexErrorShape {
    const errorKind = getErrorKind(e);
    return {
      error: toError(e),
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
  _formatNonError<T>(response: T): {
    error: null;
    errorKind: null;
    response: T;
  } {
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
    const body = {
      index: this.getFullName(),
      ...(more || {}),
    };
    const request = {
      method: 'HEAD',
      endpoint: `/${toPathPart(body.index)}`,
      body,
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
    const body = {
      name: this.getAliasName(),
      ...(more || {}),
    };
    const request = {
      method: 'HEAD',
      endpoint: getAliasEndpoint(body),
      body,
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
      // the client resolves a HEAD 404 to false; this covers clients that throw
      if (isResponseStatus(e, 404)) {
        return {
          exists: false,
          request,
          took: Date.now() - start,
          ...this._formatNonError(false),
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
    const body = {
      index: this.getFullName(),
      ...(more || {}),
    };
    const request = {
      method: 'GET',
      endpoint: `/${toPathPart(body.index)}`,
      body,
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
      return {
        name: null,
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Get metadata for the alias: the indexes it points at. A missing alias is
   * not an error (`success: true, indexes: []`); a missing `more.index` is.
   * When `more.name` lists several aliases and only some exist, `indexes`
   * lists the indexes of those that do.
   */
  async getAliasMetadata(more?: Partial<AliasMetadataParams>) {
    const start = Date.now();
    const body = {
      name: this.getAliasName(),
      ...(more || {}),
    };
    const request = {
      method: 'GET',
      endpoint: getAliasEndpoint(body),
      body,
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
      const found = getMissingAliasEntries(e);
      if (found) {
        return {
          success: true,
          indexes: Object.keys(found),
          request,
          took: Date.now() - start,
          ...this._formatNonError(found),
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
   * Flush the index to ensure all operations are committed to disk. Targets
   * the full (versioned) index name, so it works before the alias exists.
   * Elastic Cloud Serverless manages durability itself and rejects `_flush`;
   * there the call is a successful no-op with `skipped: true`. To skip the
   * request entirely, pass `serverless: true` or set `ES_SERVERLESS=true`.
   * @param more Optional additional flush parameters.
   * @returns Whether the flush succeeded (no shard failures), whether it was
   *   skipped because the server does not support it, plus response metadata.
   */
  async flush(more?: Partial<FlushRequestParams>) {
    const start = Date.now();
    const body = {
      index: this.getFullName(),
      ...(more || {}),
    };
    const request = {
      method: 'POST',
      endpoint: `/${toPathPart(body.index)}/_flush`,
      body,
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
      endpoint: `/${body.index}`,
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
   * Create the index, then point the alias at it.
   *
   * The alias is checked first. When it already points at another index
   * (e.g. an older version, see `IndexLifecycleCode`), the index is still
   * created but the alias is left alone, so it never points at two indexes;
   * `migrateIfNeeded()` moves it. If the check or the index creation fails,
   * nothing more is sent.
   * @param more Optional parameters merged into the create-index request.
   * @returns `success`, a `code`, `aliasIndexes` (where the alias pointed when
   *   checked), the `indexResponse` and `aliasResponse` of the steps that ran
   *   (else null), and the envelope; `request` is the create-index request
   *   and `error`/`errorKind`/`response` describe the step that failed.
   */
  async create(more?: Partial<IndexCreateParams>) {
    const start = Date.now();
    const request = this.getCreateRequest(more);
    const alias = await this._getAliasState();
    if (alias.failure) {
      return this._createResult(start, request, {
        code: 'EXISTS_CHECK_ERROR',
        failure: alias.failure,
      });
    }
    const indexResponse = await this.createOnly(more);
    const createFailure = getFailure(indexResponse);
    if (createFailure) {
      return this._createResult(start, request, {
        code: 'CREATE_ERROR',
        failure: createFailure,
        aliasIndexes: alias.indexes,
        indexResponse,
      });
    }
    return this._attachAlias(start, request, alias, indexResponse, 'CREATED');
  }

  /**
   * Delete the index and all its data. Elasticsearch removes the index's
   * aliases with it.
   * @param more Optional parameters merged into the delete-index request.
   */
  async drop(more?: Partial<DeleteRequestShape>) {
    const start = Date.now();
    const body = {
      index: this.getFullName(),
      ...(more || {}),
    };
    const request = {
      method: 'DELETE',
      endpoint: `/${toPathPart(body.index)}`,
      body,
    };
    try {
      const response = await this.client.indices.delete(request.body);
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
   * Drop the index if it exists, create it again with its alias (see
   * `create()`), then flush. Stops at the first step that fails: a failed
   * existence check or drop creates nothing, and a failed create skips the
   * flush.
   * @param more Optional parameters merged into the create-index request.
   * @returns The `create()` result plus `dropResponse` and `flushResponse`
   *   (null when the step did not run); `took` covers every step, and a
   *   failed drop or flush sets `code` to `DROP_ERROR` or `FLUSH_ERROR`.
   */
  async recreate(more?: Partial<IndexCreateParams>) {
    const start = Date.now();
    const request = this.getCreateRequest(more);
    let dropResponse: IndexDropResult | null = null;
    const finish = (
      result: IndexCreateResult,
      flushResponse: IndexFlushResult | null = null,
    ) => ({
      ...result,
      took: Date.now() - start,
      dropResponse,
      flushResponse,
    });
    const exists = await this.exists();
    const existsFailure = getFailure(exists);
    if (existsFailure) {
      return finish(
        this._createResult(start, request, {
          code: 'EXISTS_CHECK_ERROR',
          failure: existsFailure,
        }),
      );
    }
    if (exists.exists) {
      dropResponse = await this.drop();
      const dropFailure = getFailure(dropResponse);
      if (dropFailure) {
        return finish(
          this._createResult(start, request, {
            code: 'DROP_ERROR',
            failure: dropFailure,
          }),
        );
      }
    }
    const created = await this.create(more);
    if (!created.success) {
      return finish(created);
    }
    const flushResponse = await this.flush();
    const flushFailure = getFailure(flushResponse);
    if (flushFailure) {
      return finish(
        { ...created, success: false, code: 'FLUSH_ERROR', ...flushFailure },
        flushResponse,
      );
    }
    return finish(created, flushResponse);
  }

  /**
   * Point the alias at this index (`PUT /<index>/_alias/<alias>`). This adds
   * the index to the alias without checking where the alias already points;
   * `createAliasIfNeeded()` checks first.
   */
  async createAlias(more?: Partial<AliasCreateParams>) {
    const start = Date.now();
    const request = this._getPutAliasRequest(more);
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
   * Remove the alias from this index
   */
  async dropAlias(more?: Partial<AliasDeleteParams>) {
    const start = Date.now();
    const body = {
      name: this.getAliasName(),
      index: this.getFullName(),
      ...(more || {}),
    };
    const request = {
      method: 'DELETE',
      endpoint: getAliasEndpoint(body),
      body,
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
   * Make sure the index exists and the alias points at it, without moving an
   * alias that points elsewhere:
   * - `ALREADY_EXISTS`: the alias already points at this index; nothing sent
   * - `CREATED`: the index was created and the alias pointed at it
   * - `ALIAS_CREATED`: the index existed (or another process created it
   *   first) and the missing alias was added
   * - `NEEDS_MIGRATION`, `NEWER_VERSION_PRESENT`, `ALIAS_CONFLICT`: the alias
   *   points at another index; nothing is created or changed and `success`
   *   is false with `error: null` (`aliasIndexes` lists where it points)
   * - `EXISTS_CHECK_ERROR`, `CREATE_ERROR`, `ALIAS_ERROR`: a request failed
   * @param more Optional parameters merged into the create-index request.
   * @returns The same shape as `create()` on every path.
   */
  async createIfNeeded(more?: Partial<IndexCreateParams>) {
    const start = Date.now();
    const request = this.getCreateRequest(more);
    const alias = await this._getAliasState();
    if (alias.failure) {
      return this._createResult(start, request, {
        code: 'EXISTS_CHECK_ERROR',
        failure: alias.failure,
      });
    }
    if (alias.conflict) {
      return this._createResult(start, request, {
        code: alias.conflict,
        aliasIndexes: alias.indexes,
      });
    }
    if (alias.attached) {
      return this._createResult(start, request, {
        code: 'ALREADY_EXISTS',
        aliasIndexes: alias.indexes,
      });
    }
    // creating is the existence check: it is atomic, so a process that loses
    // a creation race sees "already exists" and goes on to add the alias
    const indexResponse = await this.createOnly(more);
    const createFailure = getFailure(indexResponse);
    if (createFailure && !isAlreadyExists(createFailure)) {
      return this._createResult(start, request, {
        code: 'CREATE_ERROR',
        failure: createFailure,
        aliasIndexes: alias.indexes,
        indexResponse,
      });
    }
    const code = createFailure ? 'ALIAS_CREATED' : 'CREATED';
    return this._attachAlias(start, request, alias, indexResponse, code);
  }

  /**
   * Point the alias at this index unless it already points somewhere.
   * Codes: `ALREADY_EXISTS` (on this index; nothing sent), `CREATED`,
   * `NEEDS_MIGRATION` / `NEWER_VERSION_PRESENT` / `ALIAS_CONFLICT` (the alias
   * points at another index and is left alone; `success: false`,
   * `error: null`), `EXISTS_CHECK_ERROR`, `ALIAS_ERROR`.
   * @returns The same keys on every path; `request` is the put-alias request.
   */
  async createAliasIfNeeded() {
    const start = Date.now();
    const request = this._getPutAliasRequest();
    const finish = (
      code: IndexLifecycleCode,
      aliasIndexes: string[],
      failure: StepFailure | null = null,
      aliasResponse: IndexCreateAliasResult | null = null,
    ) => ({
      success: isSuccessCode(code),
      code,
      aliasIndexes,
      aliasResponse,
      request,
      took: Date.now() - start,
      ...(failure ?? this._formatNonError(null)),
    });
    const alias = await this._getAliasState();
    if (alias.failure) {
      return finish('EXISTS_CHECK_ERROR', [], alias.failure);
    }
    if (alias.conflict) {
      return finish(alias.conflict, alias.indexes);
    }
    if (alias.attached) {
      return finish('ALREADY_EXISTS', alias.indexes);
    }
    const aliasResponse = await this.createAlias();
    const failure = getFailure(aliasResponse);
    if (failure) {
      return finish('ALIAS_ERROR', alias.indexes, failure, aliasResponse);
    }
    return finish('CREATED', alias.indexes, null, aliasResponse);
  }

  /**
   * The put-alias request for this index and alias
   */
  private _getPutAliasRequest(more?: Partial<AliasCreateParams>) {
    const body = {
      name: this.getAliasName(),
      index: this.getFullName(),
      ...(more || {}),
    };
    return {
      method: 'PUT',
      endpoint: getAliasEndpoint(body),
      body,
    };
  }

  /**
   * Where the alias points and what that means for this index: `attached`
   * when it includes this index, and `conflict`, the code for any other
   * index it includes (null when there is none)
   */
  private async _getAliasState(): Promise<AliasState> {
    const meta = await this.getAliasMetadata();
    const fullName = this.getFullName();
    const indexes: string[] = meta.indexes;
    const others = indexes.filter((name) => name !== fullName);
    return {
      failure: getFailure(meta),
      indexes,
      attached: indexes.includes(fullName),
      conflict: getAliasConflict(this.index, others),
    };
  }

  /**
   * The last step of `create()` and `createIfNeeded()`, after the index
   * exists: add the alias unless it points at another index
   */
  private async _attachAlias(
    start: number,
    request: IndexCreateRequestShape,
    alias: AliasState,
    indexResponse: IndexCreateOnlyResult,
    code: 'CREATED' | 'ALIAS_CREATED',
  ) {
    if (alias.conflict) {
      return this._createResult(start, request, {
        code: alias.conflict,
        aliasIndexes: alias.indexes,
        indexResponse,
      });
    }
    const aliasResponse = await this.createAlias();
    const failure = getFailure(aliasResponse);
    return this._createResult(start, request, {
      code: failure ? 'ALIAS_ERROR' : code,
      failure,
      aliasIndexes: alias.indexes,
      indexResponse,
      aliasResponse,
    });
  }

  /**
   * The result of `create()` and `createIfNeeded()`: the same keys on every
   * path
   */
  private _createResult(
    start: number,
    request: IndexCreateRequestShape,
    outcome: CreateOutcome,
  ) {
    return {
      success: isSuccessCode(outcome.code),
      code: outcome.code,
      aliasIndexes: outcome.aliasIndexes ?? [],
      indexResponse: outcome.indexResponse ?? null,
      aliasResponse: outcome.aliasResponse ?? null,
      request,
      took: Date.now() - start,
      ...(outcome.failure ?? this._formatNonError(null)),
    };
  }

  /**
   * Save the given record under the given id, replacing any record with that
   * id (uses PUT)
   * @param id  The record id
   * @param body  The record to save
   * @param [more]  Request params such as `refresh`, `if_seq_no` with
   *   `if_primary_term`, `op_type: 'create'` or `routing`
   * @returns `result` (`created` or `updated`; null on failure) plus the
   *   envelope
   */
  async put(
    id: IndexRecordId,
    body: MappingRecord<Create>,
    more?: IndexPutParams,
  ) {
    const start = Date.now();
    const index = this.getAliasName();
    const request = {
      method: 'PUT',
      endpoint: `/${index}/_doc/${id}`,
      body: {
        ...more,
        index,
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
   * Save the given records with `_bulk`, replacing records with the same ids.
   *
   * Each record's `id` is its document id (numbers become strings; `0` is
   * kept). A record without an `id` (undefined or null) gets a random UUID,
   * returned in `report`. An empty string is sent as is, and Elasticsearch
   * rejects that row. An empty array sends nothing.
   *
   * Records are sent in chunks (see `options`), one request at a time. If a
   * request fails, no further chunks are sent: rows that were not answered
   * have `status: null`.
   *
   * @param records  The records to save
   * @param [more]  Request params sent with every chunk (`refresh`, ...)
   * @param [options]  `chunkSize` (records per request, default 1000) and
   *   `chunkBytes` (serialized bytes per request, default 5 MiB)
   * @returns `success`; `report` with one row per record, in order; `errors`,
   *   the error of each rejected row; `response`, the chunks' responses merged
   *   into one. When rows were rejected, `error` is an `AggregateError` of
   *   them with `errorKind: 'response'` and `response` is
   *   `{ statusCode: 200, body: <merged response> }`.
   */
  async putBulk(
    records: MappingRecord<Create>[],
    more?: IndexPutBulkParams,
    options?: IndexPutBulkOptions,
  ) {
    const start = Date.now();
    const index = this.getAliasName();
    const ids = records.map(getBulkId);
    const operations: BulkOperation<Create>[] = [];
    records.forEach((record, i) => {
      operations.push({ index: { _index: index, _id: ids[i] } }, record);
    });
    const request = {
      method: 'POST',
      endpoint: `/${index}/_bulk`,
      body: { ...more, index, operations },
    };
    const report: IndexPutBulkReportRow[] = ids.map((id) => ({
      id,
      status: null,
      effect: null,
      version: null,
      error: null,
    }));
    const errors: ErrorCause[] = [];
    const response: estypes.BulkResponse = {
      errors: false,
      items: [],
      took: 0,
    };
    const result = () => ({
      success: false,
      errors,
      report,
      request,
      took: Date.now() - start,
    });
    let chunks: number[][];
    try {
      chunks = getBulkChunks(records, options);
    } catch (e) {
      return { ...result(), ...this._formatError(e) };
    }
    for (const chunk of chunks) {
      const chunkOps = chunk.flatMap((i) => [
        operations[2 * i],
        operations[2 * i + 1],
      ]);
      try {
        const res = await this.client.bulk({
          ...more,
          index,
          operations: chunkOps,
        });
        response.took += res.took;
        response.errors ||= res.errors;
        response.items.push(...res.items);
        res.items.forEach((item, j) => {
          applyBulkItem(report[chunk[j]], item, errors);
        });
      } catch (e) {
        return { ...result(), ...this._formatError(e) };
      }
    }
    if (errors.length > 0) {
      const message =
        `putBulk: ${errors.length} of ${records.length} records were ` +
        `rejected; the first: ${describeCause(errors[0])}`;
      return {
        ...result(),
        error: toAggregateError(errors, message),
        errorKind: 'response' as const,
        response: { statusCode: 200, body: response } as ErrorMeta,
      };
    }
    return { ...result(), success: true, ...this._formatNonError(response) };
  }

  /**
   * Merge the given fields into an existing record (uses POST _update).
   * Conflicting concurrent updates are retried 3 times
   * (`retry_on_conflict: 3`) unless `more` sets `retry_on_conflict` or
   * `if_seq_no`/`if_primary_term` (Elasticsearch rejects retries combined
   * with those).
   * @param id  The record id
   * @param body  The fields to change; other fields keep their values
   * @param [more]  Request params such as `refresh`, `doc_as_upsert`,
   *   `upsert` or `detect_noop`
   * @returns `success`; `result` as Elasticsearch reports it (`updated`,
   *   `noop` when nothing changed, `created` by an upsert; null on failure)
   *   plus the envelope
   */
  async patch(
    id: IndexRecordId,
    body: Partial<MappingRecord<Create>>,
    more?: IndexPatchParams,
  ) {
    const start = Date.now();
    const index = this.getAliasName();
    const optimistic =
      more?.if_seq_no !== undefined || more?.if_primary_term !== undefined;
    const request = {
      method: 'POST',
      endpoint: `/${index}/_update/${id}`,
      body: {
        ...(optimistic ? {} : { retry_on_conflict: PATCH_RETRY_ON_CONFLICT }),
        ...more,
        index,
        id: String(id),
        // Elasticsearch merges the fields given under `doc` into the record
        doc: body,
      },
    };
    try {
      const response = await this.client.update(request.body);
      return {
        success: true,
        result: response.result,
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      return {
        success: false,
        result: null,
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * A snapshot of this index and its alias: whether each exists, where the
   * alias points, how the other indexes on it relate to this one, and a
   * one-word `summary` (see `StatusSummary`). Sends the index check and the
   * alias lookup in parallel, and never rejects. If either check fails,
   * `summary` is `unknown`, `needsCreation` and `needsMigration` are false,
   * and `error`/`errorKind` describe the first failure.
   */
  async getStatus(): Promise<StatusReport> {
    const start = Date.now();
    const fullName = this.getFullName();
    const [index, alias] = await Promise.all([
      this.exists(),
      this.getSiblingIndexes(),
    ]);
    const failure = getFailure(index) ?? getFailure(alias);
    const aliasIndexes = alias.aliasIndexes;
    let aliasExists: boolean | null = null;
    let aliasAttached: boolean | null = null;
    if (alias.success) {
      aliasExists = aliasIndexes.length > 0;
      aliasAttached = aliasIndexes.includes(fullName);
    }
    const summary = getStatusSummary({
      failed: failure !== null,
      indexExists: index.exists,
      aliasAttached,
      siblings: alias.siblings,
    });
    return {
      took: Date.now() - start,
      fullName,
      aliasName: this.getAliasName(),
      indexExists: index.exists,
      aliasExists,
      aliasIndexes,
      aliasAttached,
      siblings: alias.siblings,
      needsMigration: summary === 'needsMigration',
      needsCreation: summary === 'needsCreation',
      summary,
      error: failure?.error ?? null,
      errorKind: failure?.errorKind ?? null,
    };
  }

  /**
   * Whether `migrateIfNeeded()` would create this index from scratch:
   * neither the index nor the alias exists (`getStatus().needsCreation`).
   * @returns null when the checks failed; use `getStatus()` for the error
   */
  async needsCreation(): Promise<boolean | null> {
    const status = await this.getStatus();
    if (status.error) {
      return null;
    }
    return status.needsCreation;
  }

  /**
   * Whether the alias points at an older (or `incomparable`) version of this
   * index and at no newer one (`getStatus().needsMigration`). Only the alias
   * is looked up.
   * @returns null when the lookup failed; use `getSiblingIndexes()` for the
   *   error
   */
  async needsMigration(): Promise<boolean | null> {
    const { error, siblings } = await this.getSiblingIndexes();
    if (error) {
      return null;
    }
    return isMigrationNeeded(siblings);
  }

  /**
   * The indexes the alias points at other than this one, classified as
   * older or newer versions of this index, versions that cannot be ordered,
   * and unrelated indexes (see `SiblingIndexes`). Names are parsed with this
   * manager's separator.
   * @returns `success`, `aliasIndexes` (every index on the alias, this one
   *   included), `siblings`, plus `getAliasMetadata()`'s `request`, `took`
   *   and envelope. A missing alias is not an error: everything is empty.
   *   On error the lists are empty and `success` is false.
   */
  async getSiblingIndexes() {
    const { indexes, ...meta } = await this.getAliasMetadata();
    const aliasIndexes: string[] = indexes;
    const fullName = this.getFullName();
    const others = aliasIndexes.filter((name) => name !== fullName);
    return {
      ...meta,
      aliasIndexes,
      siblings: classifySiblings(this.index, others),
    };
  }

  /**
   * Bring the index and alias up to date with zero downtime, and never
   * reject. Decides from `getStatus()`:
   * - a failed status check: `STATUS_ERROR`, nothing changed
   * - the alias on a newer version: `NEWER_VERSION_PRESENT`; on a version
   *   that cannot be ordered against this one: `INCOMPARABLE_VERSION`;
   *   nothing changed (no downgrade, no guessed order)
   * - the alias on older versions: create the new index (not in the alias),
   *   copy the old index(es) into it in the background with
   *   `version_type: 'external'`, run a catch-up copy, move the alias in one
   *   atomic update (the new index becomes the write index), run a final
   *   catch-up copy, compare counts, then delete the old index(es). Reads
   *   and writes use the old index until the swap. A second call while this
   *   runs (or after a crash) resumes: it follows a copy that is still
   *   running or starts one again.
   * - no index and no alias: create both (`CREATED`); the index without its
   *   alias: add the alias (`ALIAS_CREATED`); already current: `CURRENT`
   *
   * Indexes on the alias that are not versions of this one are never copied
   * or removed; if they are all the alias holds, `ALIAS_CONFLICT`.
   *
   * Known limitation: a document deleted from the old index while the copy
   * runs is present again in the new index.
   * @param params  Callbacks, `timeout`, `maxPollErrors`, `slices`,
   *   `requestsPerSecond`, `batchSize` and `pollInterval` (see
   *   `MigrationParams`)
   * @returns `success`, a `code` (see `MigrationCode`), what was done, and
   *   `completion`, a promise of the `MigrationOutcome` that never rejects
   *   (already settled unless a migration started). `onComplete` fires only
   *   on success; `onError` fires once on failure.
   */
  migrateIfNeeded(params: MigrationParams = {}): Promise<MigrationResult> {
    return migrateIndex(this, params);
  }

  /**
   * Find a single record by the given id
   * @param id  The record id
   * @param [more]  Request params such as `_source_includes` or `realtime`
   * @returns `record` (null when not found), `found`, plus the envelope. A
   *   missing record is not an error: `found: false`, `error: null` and
   *   `response` is Elasticsearch's `{ _index, _id, found: false }`. A missing
   *   index or alias is an error. On any error `found` is false.
   */
  async findById(id: IndexRecordId, more?: IndexFindByIdParams) {
    const start = Date.now();
    const index = this.getAliasName();
    const request = {
      method: 'GET',
      endpoint: `/${index}/_doc/${id}`,
      body: { ...more, index, id: String(id) },
    };
    try {
      const response = await this.client.get<MappingRecord<Create>>(
        request.body,
      );
      return {
        record: response._source ?? null,
        found: response.found,
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      const notFound = getDocumentNotFound(e);
      if (notFound) {
        return {
          record: null,
          found: false,
          request,
          took: Date.now() - start,
          ...this._formatNonError(notFound),
        };
      }
      return {
        record: null,
        found: false,
        request,
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
   * @returns A search result from `QueryRunner.findMany`. An error thrown by
   *   the callback or while building the request is returned as the error
   *   envelope (`request: null`), never thrown.
   */
  async findMany(
    withQueryBuilder?: QueryBuilderProvider<MappingFieldPath<Create>>,
    more?: Omit<estypes.SearchRequest, 'index' | 'query'>,
  ) {
    const start = Date.now();
    try {
      const runner = await this._getRunner(withQueryBuilder);
      return await runner.findMany(more);
    } catch (e) {
      return {
        records: [] as QueryRecord<Create>[],
        total: null,
        request: null,
        took: Date.now() - start,
        aggregations: null,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Find the first record matching the built query.
   * @param withQueryBuilder Optional callback to configure the query.
   * @param more Optional additional search request options (excluding `index` and `query`).
   * @returns The first matching record result from `QueryRunner.findFirst`.
   *   An error thrown by the callback or while building the request is
   *   returned as the error envelope (`record: null`, `request: null`),
   *   never thrown.
   */
  async findFirst(
    withQueryBuilder?: QueryBuilderProvider<MappingFieldPath<Create>>,
    more?: Omit<estypes.SearchRequest, 'index' | 'query'>,
  ) {
    const start = Date.now();
    try {
      const runner = await this._getRunner(withQueryBuilder);
      return await runner.findFirst(more);
    } catch (e) {
      return {
        record: null as QueryRecord<Create> | null,
        total: null,
        request: null,
        took: Date.now() - start,
        aggregations: null,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Count documents matching the built query.
   * @param withQueryBuilder Optional callback to configure the query.
   * @param more Optional `_count` request params (excluding `index` and
   *   `query`), e.g. `min_score` or `terminate_after`.
   * @returns The count result from `QueryRunner.count`. An error thrown by
   *   the callback or while building the request is returned as the error
   *   envelope (`total: null`, `request: null`), never thrown.
   */
  async count(
    withQueryBuilder?: QueryBuilderProvider<MappingFieldPath<Create>>,
    more?: IndexCountParams,
  ) {
    const start = Date.now();
    try {
      const runner = await this._getRunner(withQueryBuilder);
      return await runner.count(more);
    } catch (e) {
      return {
        total: null,
        took: Date.now() - start,
        request: null,
        ...this._formatError(e),
      };
    }
  }

  /**
   * A `QueryRunner` whose builder the callback has configured
   */
  private async _getRunner(
    withQueryBuilder?: QueryBuilderProvider<MappingFieldPath<Create>>,
  ) {
    const runner = new QueryRunner(this);
    if (withQueryBuilder) {
      await withQueryBuilder(runner.builder);
    }
    return runner;
  }

  /**
   * Remove a record by id
   * @param id  The id of the record
   * @param [more]  Request params such as `refresh` or `if_seq_no` with
   *   `if_primary_term`
   * @returns `success`, `result` (`deleted`; null on failure) plus the
   *   envelope. A missing record is an error (404, `result: 'not_found'` in
   *   `response.body`).
   */
  async deleteById(id: IndexRecordId, more?: IndexDeleteByIdParams) {
    const start = Date.now();
    const index = this.getAliasName();
    const request = {
      method: 'DELETE',
      endpoint: `/${index}/_doc/${id}`,
      body: { ...more, index, id: String(id) },
    };
    try {
      const response = await this.client.delete(request.body);
      return {
        success: true,
        result: response.result,
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      return {
        success: false,
        result: null,
        request,
        took: Date.now() - start,
        ...this._formatError(e),
      };
    }
  }

  /**
   * Delete the documents that match a built query (`_delete_by_query`).
   *
   * There is no confirmation and no warning, as in Elasticsearch itself:
   * **without a callback, or with a callback that adds no conditions, every
   * document in the index is deleted** (`match_all`). A builder that
   * produces no `query` (only retrievers such as `knn()` or `semantic()`)
   * cannot select documents: nothing is sent and an error envelope is
   * returned.
   *
   * Version conflicts abort the request (a 409 error) unless `more` sets
   * `conflicts: 'proceed'`; then conflicting documents are skipped and
   * counted in `versionConflicts`, and `success` stays true.
   *
   * @param withQueryBuilder Optional callback to configure the query.
   * @param more `_delete_by_query` request params (excluding `index` and
   *   `query`), e.g. `conflicts`, `refresh`, `max_docs` or `slices`.
   * @returns `success` (false when the request failed, the response lists
   *   `failures` or it timed out), `deleted`, `versionConflicts`, `failures`
   *   (null when there is no response), plus the envelope. With failures or a
   *   timeout, `error` is set, `errorKind` is `response` and `response` is
   *   `{ statusCode: 200, body: <response> }`.
   */
  async deleteMany(
    withQueryBuilder?: QueryBuilderProvider<MappingFieldPath<Create>>,
    more?: IndexDeleteManyParams,
  ) {
    const start = Date.now();
    const index = this.getAliasName();
    const request = {
      method: 'POST',
      endpoint: `/${index}/_delete_by_query`,
      body: {
        ...more,
        index,
        query: undefined as estypes.QueryDslQueryContainer | undefined,
      },
    };
    const result = (response: estypes.DeleteByQueryResponse | null) => ({
      success: false,
      deleted: response?.deleted ?? null,
      versionConflicts: response?.version_conflicts ?? null,
      failures: response?.failures ?? null,
      request,
      took: Date.now() - start,
    });
    try {
      const builder = new QueryBuilder<MappingFieldPath<Create>>();
      if (withQueryBuilder) {
        await withQueryBuilder(builder);
      }
      request.body.query = builder.getBody().query;
    } catch (e) {
      return { ...result(null), ...this._formatError(e) };
    }
    if (!request.body.query) {
      const error = new Error(
        'deleteMany: the builder produced no "query" (retrievers such as ' +
          'knn() or semantic() cannot select documents to delete); ' +
          'nothing was deleted',
      );
      return { ...result(null), ...this._formatError(error) };
    }
    let response: estypes.DeleteByQueryResponse;
    try {
      response = await this.client.deleteByQuery(request.body);
    } catch (e) {
      return { ...result(null), ...this._formatError(e) };
    }
    const error = getDeleteByQueryError(response);
    if (error) {
      return {
        ...result(response),
        failures: response.failures ?? [],
        error,
        errorKind: 'response' as const,
        response: { statusCode: 200, body: response } as ErrorMeta,
      };
    }
    return {
      ...result(response),
      success: true,
      failures: response.failures ?? [],
      ...this._formatNonError(response),
    };
  }
}

/** `retry_on_conflict` that `patch()` sends unless told otherwise */
const PATCH_RETRY_ON_CONFLICT = 3;

/** Default most records per `putBulk()` request */
const BULK_CHUNK_SIZE = 1000;

/** Default most serialized record bytes per `putBulk()` request (5 MiB) */
const BULK_CHUNK_BYTES = 5 * 1024 * 1024;

/** One line of a `putBulk()` request: an action or a record */
export type BulkOperation<Create> =
  | estypes.BulkOperationContainer
  | MappingRecord<Create>;

const utf8 = new TextEncoder();

/**
 * The `_id` for a bulk record: its `id` as a string, or a random UUID when
 * it has none. `0` and `''` are kept (`''` is rejected by Elasticsearch).
 */
function getBulkId(record: unknown) {
  const id = (record as { id?: unknown } | null)?.id;
  if (id === undefined || id === null) {
    return crypto.randomUUID();
  }
  return String(id);
}

/**
 * The record indexes of each `putBulk()` request, split so that no request
 * has more than `chunkSize` records or `chunkBytes` serialized bytes (a
 * larger record goes alone)
 * @throws {RangeError} When an option is not a positive number
 */
function getBulkChunks(records: unknown[], options?: IndexPutBulkOptions) {
  const chunkSize = options?.chunkSize ?? BULK_CHUNK_SIZE;
  const chunkBytes = options?.chunkBytes ?? BULK_CHUNK_BYTES;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError(
      `putBulk: chunkSize must be a positive integer, got ${chunkSize}`,
    );
  }
  if (!(chunkBytes > 0)) {
    throw new RangeError(
      `putBulk: chunkBytes must be a positive number, got ${chunkBytes}`,
    );
  }
  const chunks: number[][] = [];
  let chunk: number[] = [];
  let bytes = 0;
  records.forEach((record, i) => {
    const size = utf8.encode(JSON.stringify(record)).byteLength;
    const full = chunk.length >= chunkSize || bytes + size > chunkBytes;
    if (chunk.length > 0 && full) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(i);
    bytes += size;
  });
  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * Copy a bulk response item into its report row, collecting its error
 */
function applyBulkItem(
  row: IndexPutBulkReportRow,
  item: Partial<Record<estypes.BulkOperationType, estypes.BulkResponseItem>>,
  errors: ErrorCause[],
) {
  // only `index` actions are sent
  const op = item.index ?? Object.values(item)[0];
  if (!op) {
    return;
  }
  row.status = op.status;
  if (op.error) {
    row.error = op.error;
    errors.push(op.error);
    return;
  }
  // the client types `result` as string; Elasticsearch sends a `Result`
  row.effect = (op.result ?? null) as estypes.Result | null;
  row.version = op._version ?? null;
}

/**
 * `type: reason` of an Elasticsearch error cause
 */
function describeCause(cause: ErrorCause) {
  return `${cause.type}: ${cause.reason ?? ''}`;
}

/**
 * One error for the rejected rows of a request that itself succeeded
 */
function toAggregateError(causes: ErrorCause[], message: string) {
  const errors = causes.map(
    (cause) => new Error(describeCause(cause), { cause }),
  );
  return new AggregateError(errors, message);
}

/**
 * The `{ _index, _id, found: false }` body of a `GET <index>/_doc/<id>` for
 * a missing document, or null for any other error (including the 404 for a
 * missing index, whose body has `error`)
 */
function getDocumentNotFound<T>(e: unknown): estypes.GetResponse<T> | null {
  if (!isResponseStatus(e, 404)) {
    return null;
  }
  const body = getErrorMeta(e)?.body;
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  if (!('found' in body) || body.found !== false) {
    return null;
  }
  return body as estypes.GetResponse<T>;
}

/**
 * The error a successful `_delete_by_query` response describes: its
 * `failures`, or a timeout. Null when there is none.
 */
function getDeleteByQueryError(response: estypes.DeleteByQueryResponse) {
  const failures = response.failures ?? [];
  if (failures.length > 0) {
    const causes = failures.map((failure) => failure.cause);
    const message =
      `deleteMany: ${failures.length} documents could not be deleted; ` +
      `the first: ${describeCause(causes[0])}`;
    return toAggregateError(causes, message);
  }
  if (response.timed_out) {
    return new Error(
      'deleteMany: the request timed out; some matching documents may ' +
        'not have been deleted',
    );
  }
  return null;
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
    case 'RequestAbortedError':
      return 'aborted';
    case 'SerializationError':
    case 'DeserializationError':
      return 'serialization';
    case 'ProductNotSupportedError':
      return 'product';
    case 'ConfigurationError':
      return 'configuration';
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
 * The thrown value as an `Error`. Anything else is wrapped in one that keeps
 * the value as `cause` and, for error-like objects, its `name` and `message`.
 */
function toError(e: unknown): Error {
  if (e instanceof Error) {
    return e;
  }
  let message = String(e);
  if (typeof e === 'object' && e !== null && 'message' in e) {
    message = String(e.message);
  }
  const error = new Error(message, { cause: e });
  const name = getErrorName(e);
  if (name) {
    error.name = name;
  }
  return error;
}

/**
 * Whether the thrown value is a `ResponseError` with the given status code
 */
function isResponseStatus(e: unknown, statusCode: number) {
  if (getErrorName(e) !== 'ResponseError') {
    return false;
  }
  return getErrorMeta(e)?.statusCode === statusCode;
}

/**
 * For the 404 that `GET _alias/<name>` answers when a named alias does not
 * exist (`{ error: 'alias [x] missing', status: 404, ...found }`), the
 * entries of the aliases that were found (often none). Null for any other
 * error, including the 404 for a missing index, whose `error` is an object
 * (`index_not_found_exception`).
 */
function getMissingAliasEntries(e: unknown) {
  if (!isResponseStatus(e, 404)) {
    return null;
  }
  const body = getErrorMeta(e)?.body;
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  if (!('error' in body) || typeof body.error !== 'string') {
    return null;
  }
  const found: estypes.IndicesGetAliasResponse = {};
  for (const [key, value] of Object.entries(body)) {
    if (key !== 'error' && key !== 'status') {
      found[key] = value as estypes.IndicesGetAliasIndexAliases;
    }
  }
  return found;
}

/**
 * Index or alias names as one path part (`a,b` for a list)
 */
function toPathPart(names: string | string[] | undefined) {
  if (Array.isArray(names)) {
    return names.join(',');
  }
  return names ?? '';
}

/**
 * The endpoint of an alias request: `/<index>/_alias/<name>` or
 * `/_alias/<name>`
 */
function getAliasEndpoint(body: {
  name?: string | string[];
  index?: string | string[];
}) {
  const name = toPathPart(body.name);
  if (body.index === undefined) {
    return `/_alias/${name}`;
  }
  return `/${toPathPart(body.index)}/_alias/${name}`;
}

/**
 * The error half of a step's envelope, or null when the step succeeded
 */
function getFailure(step: {
  error: Error | null;
  errorKind: IndexErrorKind | null;
  response?: unknown;
}): StepFailure | null {
  if (!step.error) {
    return null;
  }
  const errorKind = step.errorKind ?? 'javascript';
  return {
    error: step.error,
    errorKind,
    response:
      errorKind === 'response' ? ((step.response ?? null) as ErrorMeta) : null,
  };
}

/**
 * Whether a failed create-index request failed because the index exists
 */
function isAlreadyExists(failure: StepFailure) {
  const body = failure.response?.body as
    | { error?: { type?: string } }
    | null
    | undefined;
  return body?.error?.type === 'resource_already_exists_exception';
}

/**
 * Whether a lifecycle code means the index and alias are in place
 */
function isSuccessCode(code: IndexLifecycleCode) {
  return (
    code === 'CREATED' || code === 'ALREADY_EXISTS' || code === 'ALIAS_CREATED'
  );
}

/**
 * The lifecycle code for an alias that points at `others` besides this
 * index: a newer version wins, then any index that is not a version of this
 * one; otherwise (older versions, or versions that cannot be ordered) a
 * migration is needed. Null when `others` is empty.
 */
function getAliasConflict(
  index: IndexNameManager,
  others: string[],
): IndexLifecycleCode | null {
  if (others.length === 0) {
    return null;
  }
  const siblings = classifySiblings(index, others);
  if (siblings.newer.length > 0) {
    return 'NEWER_VERSION_PRESENT';
  }
  if (siblings.unrelated.length > 0) {
    return 'ALIAS_CONFLICT';
  }
  return 'NEEDS_MIGRATION';
}

/**
 * Sort sibling index names by how they relate to `index`. Versions are
 * ordered with `IndexNameManager.compare()`, never guessed: a version that
 * cannot be ordered goes in `incomparable`.
 * @param index  This manager's name
 * @param others  The other indexes on the alias (this index excluded)
 */
function classifySiblings(
  index: IndexNameManager,
  others: string[],
): SiblingIndexes {
  const older: ParsedSibling[] = [];
  const newer: ParsedSibling[] = [];
  const incomparable: string[] = [];
  const unrelated: string[] = [];
  for (const name of others) {
    const parsed = IndexNameManager.tryParseByName(name, index.separator);
    const relation = parsed ? IndexNameManager.compare(index, parsed) : null;
    if (parsed && relation === 'older') {
      older.push({ name, parsed });
    } else if (parsed && relation === 'newer') {
      newer.push({ name, parsed });
    } else if (relation === 'incomparable') {
      incomparable.push(name);
    } else {
      // 'same' cannot happen: that would be this index, excluded above
      unrelated.push(name);
    }
  }
  return {
    all: [...others],
    older: older.sort(byVersion).map((sibling) => sibling.name),
    newer: newer.sort(byVersion).map((sibling) => sibling.name),
    incomparable: incomparable.sort(),
    unrelated: unrelated.sort(),
  };
}

/** A sibling index name and its parsed parts */
type ParsedSibling = { name: string; parsed: IndexNameManager };

/**
 * Sort comparator for versions of one index, oldest first
 */
function byVersion(a: ParsedSibling, b: ParsedSibling) {
  const relation = IndexNameManager.compare(a.parsed, b.parsed);
  if (relation === 'newer') {
    return -1;
  }
  if (relation === 'older') {
    return 1;
  }
  return 0;
}

/**
 * Whether the alias holds an older (or `incomparable`) version of this
 * index and no newer one
 */
function isMigrationNeeded(siblings: SiblingIndexes) {
  if (siblings.newer.length > 0) {
    return false;
  }
  return siblings.older.length > 0 || siblings.incomparable.length > 0;
}

/**
 * The one-word status summary for `getStatus()` (see `StatusSummary`)
 */
function getStatusSummary(state: {
  failed: boolean;
  indexExists: boolean | null;
  aliasAttached: boolean | null;
  siblings: SiblingIndexes;
}): StatusSummary {
  if (state.failed) {
    return 'unknown';
  }
  if (state.siblings.newer.length > 0) {
    return 'newerVersionPresent';
  }
  if (isMigrationNeeded(state.siblings)) {
    return 'needsMigration';
  }
  if (state.siblings.unrelated.length > 0) {
    return 'aliasConflict';
  }
  if (!state.indexExists) {
    return 'needsCreation';
  }
  if (!state.aliasAttached) {
    return 'needsAlias';
  }
  return 'current';
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
