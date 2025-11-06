import { type Client, errors, type estypes } from '@elastic/elasticsearch';
import getEsClient from '../getEsClient/getEsClient';
import IndexNameManager, {
  type IndexNameAttributes,
} from '../IndexNameManager/IndexNameManager';
import QueryBuilder from '../QueryBuilder/QueryBuilder';
import QueryRunner from '../QueryRunner/QueryRunner';
import SchemaManager from '../SchemaManager/SchemaManager';
import type {
  AliasCreateParams,
  AliasDeleteParams,
  AliasExistParams,
  AliasMetadataParams,
  BulkRequestParams,
  DeleteRequestShape,
  ElasticsearchRecord,
  ErrorCause,
  FlushRequestParams,
  GetRequestParams,
  IndexCreateParams,
  IndexExistParams,
  IndexMetadataParams,
  IndexSettings,
  MappingProperties,
  PatchRequestParams,
  SchemaShape,
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
export type IndexMigrationReport = Awaited<
  ReturnType<IndexManager['migrateIfNeeded']>
>;
export type IndexInferSchema<T extends IndexManager<any>> =
  T extends IndexManager<infer S> ? S : never;
export type IndexInferRecordShape<T extends IndexManager<any>> =
  ElasticsearchRecord<IndexInferSchema<T>>;
export type IndexRunShape<T extends IndexManager> = ReturnType<T['run']>;
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
  indexExists: any;
  aliasExists: boolean;
  needsMigration: boolean;
  needsCreation: boolean;
  summary: 'needsCreation' | 'needsMigration' | 'current';
};

/**
 * ElasticSearch index manager for creating, searching and saving data
 * for a particular index
 */
export default class IndexManager<
  ThisSchema extends SchemaShape = SchemaShape,
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
   *
   */
  public analyzer: string;
  public schema: SchemaManager<ThisSchema>;
  public settings: any;
  public fulltextFields: string[];
  public allFields: string[];
  /**
   * Define the index with the given configuration
   * @param client  The client to use (defaults to getEsClient())
   * @param index  The index information (see IndexNameManager.ts)
   * @property name
   * @property version
   * @property prefix
   * @property language
   * @property separator
   * @param analyzer
   * @param schema  The schema definition (see schemaToMappings.spec.js)
   * @param properties  Additional ElasticSearch mapping properties to add to schema; e.g. for custom fields
   * @param settings  The ElasticSearch settings; e.g. for sort hints
   */
  constructor({
    index,
    schema = {} as ThisSchema,
    settings = {} as IndexSettings,
    analyzer = 'english',
    properties = {} as MappingProperties,
    client = getEsClient(),
  }: {
    client?: Client;
    index: IndexNameAttributes;
    schema?: ThisSchema;
    properties?: MappingProperties;
    analyzer?: string;
    settings?: IndexSettings;
  }) {
    this.client = client;
    this.settings = settings;
    this.analyzer = analyzer || 'english';
    this.index = new IndexNameManager(index);
    this.schema = new SchemaManager({
      schema,
      properties,
    });
    this.fulltextFields = this.schema.getFulltextFields();
    this.allFields = this.schema.getAllFields();
  }

  /**
   * Normalize errors thrown by the Elasticsearch client into a consistent shape.
   * Distinguishes between response, connection, timeout, disconnected, and generic JS errors.
   * @param e The error thrown by the client or runtime.
   * @returns A normalized error object with `error`, `errorKind`, and optional `response`.
   */
  _formatError(e: any) {
    if (e instanceof errors.ResponseError) {
      // Handle Elasticsearch response errors
      return {
        error: e,
        errorKind: 'response',
        response: e.meta || null,
      };
    }
    if (e instanceof errors.ConnectionError) {
      return {
        error: e,
        errorKind: 'connection',
        response: null,
      };
    }
    if (e instanceof errors.TimeoutError) {
      return {
        error: e,
        errorKind: 'timeout',
        response: null,
      };
    }
    if (e instanceof errors.NoLivingConnectionsError) {
      return {
        error: e,
        errorKind: 'disconnected',
        response: null,
      };
    }
    // Handle other types of errors
    return {
      error: e as Error,
      errorKind: 'javascript',
      response: null,
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
      const error = e as errors.ResponseError;
      console.log('aliasExists error', error);
      if (error.meta.statusCode === 404) {
        return {
          exists: false,
          request,
          took: Date.now() - start,
          ...this._formatNonError(e.meta || null),
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
      const indexName = Object.keys(response.body)[0];
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
      if (e.meta?.statusCode === 404) {
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
   * Flush the index to ensure all operations are committed to disk.
   * @param more Optional additional flush parameters.
   * @returns Whether the flush succeeded (no shard failures) plus response metadata.
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
    try {
      const response = await this.client.indices.flush(request.body);
      return {
        success: response._shards.failed === 0,
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      return {
        success: false,
        request,
        took: Date.now() - start,
        ...this._formatError(e as Error),
      };
    }
  }

  /**
   * Build the request payload to create this index with mappings and settings.
   * @param more Optional additional create-index parameters to merge into the request.
   * @returns A request descriptor containing method, endpoint and body.
   */
  getCreateRequest(more?: Partial<IndexCreateParams>) {
    const sm = new SchemaManager(this.schema);
    return {
      method: 'PUT',
      endpoint: `/${this.getFullName()}`,
      body: {
        index: this.getFullName(),
        mappings: sm.toMappings(),
        settings: this.settings,
        ...(more || {}),
      },
    };
  }

  /**
   * Create a new index with these specifications
   */
  async create(more?: Partial<IndexCreateParams>) {
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
  async createWithAlias() {
    const start = Date.now();
    const indexResponse = await this.create();
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
        code: 'ERROR',
        error: res.error,
        errorKind: res.errorKind,
      };
    } else {
      const res = await this.create();
      if (res.index === null) {
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
          code: 'CREATED',
          request: res.request,
          took: Date.now() - start,
          error: null,
          errorKind: null,
        };
      }
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
  async put(id: number | string, body: ElasticsearchRecord<ThisSchema>) {
    const start = Date.now();
    const request = {
      method: 'PUT',
      endpoint: `/${this.getAliasName()}/_doc/${id}`,
      body: {
        index: this.getAliasName(),
        id: String(id),
        body,
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
        ...this._formatError(e as Error),
      };
    }
  }

  /**
   * Save the given records
   * @param records  The records to save
   * @param [more]  Additional body params
   */
  async putBulk(
    records: ElasticsearchRecord<ThisSchema>[],
    more?: Partial<BulkRequestParams>,
  ) {
    const start = Date.now();
    const index = this.getAliasName();
    const bulkBody: any[] = [];
    for (const record of records) {
      bulkBody.push(
        { index: { _index: index, _id: record.id || crypto.randomUUID() } },
        record,
      );
    }
    const request = {
      method: 'PUT',
      endpoint: `/_bulk`,
      body: {
        index,
        body: bulkBody,
        ...(more || {}),
      },
    };
    try {
      const response = await this.client.bulk(request.body);
      const errors: ErrorCause[] = [];
      const report = response.items.map((item) => {
        if (item.index.error) {
          errors.push(item.index.error);
        }
        return {
          status: item.index.status,
          error: item.index.error,
          effect: item.index.result,
          version: item.index._version,
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
        ...this._formatError(e as Error),
      };
    }
  }

  /**
   * Save the given partial record (uses updateRecord())
   * @param id  The record id
   * @param body  The record to save
   * @param [more]  Additional body params
   */
  async patch(
    id: string,
    body: ElasticsearchRecord<ThisSchema>,
    more?: Partial<PatchRequestParams>,
  ) {
    const start = Date.now();
    const request = {
      method: 'POST',
      endpoint: `/${this.getAliasName()}/_update/${id}`,
      body: {
        index: this.getAliasName(),
        id,
        body,
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
    const needsCreation = await this.needsCreation();
    const needsMigration = !needsCreation && (await this.needsMigration());
    return {
      took: Date.now() - start,
      fullName,
      aliasName,
      indexExists: indexExists.exists,
      aliasExists: aliasExists.exists,
      needsMigration,
      needsCreation,
      summary: needsCreation
        ? ('needsCreation' as const)
        : needsMigration
          ? ('needsMigration' as const)
          : ('current' as const),
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
    slices = 1,
    pollInterval = 1000,
  }: {
    onProgress?: (details: MigrationProgressDetails) => void;
    slices?: number;
    pollInterval?: number;
  } = {}) {
    const start = Date.now();
    const meta = {
      recordsToMigrate: 0,
      createdAlias: false,
      createdIndex: false,
      oldNames: [],
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
          if (pollInterval < 200) {
            pollInterval = 200;
          }
          const taskInfo = await this.client.reindex({
            wait_for_completion: false,
            conflicts: 'proceed',
            source: { index: oldIndex },
            dest: { index: status.fullName, op_type: 'index' },
            slices,
          });
          while (true) {
            await new Promise((r) => setTimeout(r, pollInterval));
            const taskStatus = await this.client.tasks.get({
              task_id: taskInfo.task,
            });
            const updatedCount = taskStatus.task.status.updated;
            const createdCount = taskStatus.task.status.created;
            const total = taskStatus.task.status.total;
            const done = updatedCount + createdCount;
            const percent = Math.floor(Math.max(99, (done / total) * 100));
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
                taskId: taskInfo.task,
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
                taskId: taskInfo.task,
                newIndex: status.fullName,
                alias: status.aliasName,
              });
            }
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
            ...this._formatError(createResult),
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
      const response = await this.client.get(request.body);
      const record = response._source;
      return {
        record,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      return {
        record: null,
        took: Date.now() - start,
        ...this._formatError(e as Error),
      };
    }
  }

  /**
   * Execute arbitrary operations with a `QueryRunner` instance.
   * @param withQueryRunner Callback that receives a `QueryRunner` bound to this index.
   * @returns The value returned by the callback.
   */
  run<T>(withQueryRunner: (runner: QueryRunner<ThisSchema>) => T) {
    return withQueryRunner(new QueryRunner(this));
  }

  /**
   * Find many records using a `QueryBuilder` callback.
   * @param withQueryBuilder Optional callback to configure the query.
   * @param more Optional additional search request options (excluding `index` and `query`).
   * @returns A search result from `QueryRunner.findMany`.
   */
  findMany(
    withQueryBuilder?: (builder: QueryBuilder) => void | Promise<void>,
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
    withQueryBuilder?: (builder: QueryBuilder) => void | Promise<void>,
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
    withQueryBuilder?: (builder: QueryBuilder) => void | Promise<void>,
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
    withQueryBuilder?: (builder: QueryBuilder) => void | Promise<void>,
    more?: Omit<estypes.SearchRequest, 'index' | 'query'>,
  ) {
    const start = Date.now();
    const builder = new QueryBuilder();
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

/*
Example:

export const postIndex = new IndexManager({
  index: {
    name: 'post',
    version: '1',
    analyzer: 'english',
    prefix: 'prod',
  }
  schema: {
    id: 'integer',
    uuid: 'keyword',
    copiedFrom: 'keyword',
    externalRef: 'keyword',
    title: 'text',
    body: 'text',
    postType: 'keyword',
    postSubType: 'keyword',
    createdAt: 'date',
    divisionId: 'integer',
    divisionUuid: 'keyword',
    mediaFilenames: 'text',
    mediaContents: 'text',
    taxonomy: {
      taxId: 'integer',
      taxName: 'keyword',
      taxUuid: 'keyword',
      choiceId: 'integer',
      choiceUuid: 'keyword',
      choiceName: 'keyword',
    },
  },
  settings: {
    // Specify fields (other than relevance) we might sort by to make sorting faster
    // See https://www.elastic.co/blog/index-sorting-elasticsearch-6-0
    index: {
      'sort.field': ['createdAt'],
      'sort.order': ['desc'],
    },
  },
});

 */
