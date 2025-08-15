import IndexNameManager, {
  IndexNameAttributes,
} from '../IndexNameManager/IndexNameManager';
import QueryBuilder from '../QueryBuilder/QueryBuilder';
import getEsClient from '../getEsClient/getEsClient';
import { Client, estypes, errors } from '@elastic/elasticsearch';
import {
  AliasCreateParams,
  AliasDeleteParams,
  AliasExistParams,
  AliasMetadataParams,
  BoostType,
  BulkRequestParams,
  DeleteRequestShape,
  ElasticsearchRecord,
  FlushRequestParams,
  GetRequestParams,
  IndexCreateParams,
  IndexExistParams,
  IndexMetadataParams,
  IndexSettings,
  PatchRequestParams,
  SchemaShape,
} from '../types';
import TextProcessor from '../TextProcessor/TextProcessor';
import QueryRunner from '../QueryRunner/QueryRunner';
import SchemaManager from '../SchemaManager/SchemaManager';

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
  public nestedSeparator: string;
  public textProcessor: TextProcessor;
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
   * @param schema  The schema definition (see schemaToMappings.spec.js)
   * @param settings  The ElasticSearch settings; e.g. for sort hints
   * @param textProcessor  A TextProcessor to use
   * @param nestedSeparator  The separator to use for nested fields
   */
  constructor({
    index,
    schema,
    settings = {},
    textProcessor = new TextProcessor(),
    client = getEsClient(),
    nestedSeparator = '/',
  }: {
    client?: Client;
    index: IndexNameAttributes;
    schema: ThisSchema;
    settings?: IndexSettings;
    textProcessor?: TextProcessor;
    nestedSeparator?: string;
  }) {
    this.client = client;
    this.settings = settings;
    this.nestedSeparator = nestedSeparator;
    this.textProcessor = textProcessor;
    this.textProcessor.registerSchema(schema);
    this.index = new IndexNameManager(index);
    this.schema = new SchemaManager({
      schema,
      nestedSeparator: this.nestedSeparator,
    });
    this.fulltextFields = this.schema.getFulltextFields();
    this.allFields = this.schema.getAllFields();
  }

  /**
   * Update the analyzer which will be reflected in getIndexName()
   * @param analyzerName  An analyzer name such as cjk, spanish, englishplus
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/7.17/analysis-lang-analyzer.html
   */
  setAnalyzer(analyzerName: string) {
    this.analyzer = analyzerName;
    return this;
  }

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
      const response = await this.client.indices.exists(request.body);
      return {
        exists: response,
        took: Date.now() - start,
        request,
        ...this._formatNonError(null),
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

  getAliasName() {
    return this.index.getAliasName();
  }

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
      const response = this.client.indices.existsAlias(request.body);
      return {
        exists: Object.keys(response)[0],
        request,
        took: Date.now() - start,
        ...this._formatNonError(response),
      };
    } catch (e) {
      const error = e as errors.ResponseError;
      if (error.statusCode === 404) {
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
      const indexName = Object.keys(response.body)[0];
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
   * Save the given records
   * @param [more]  Additional body params
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
   * Create a new index with these specifications
   */
  async create(more?: Partial<IndexCreateParams>) {
    const start = Date.now();
    const sm = new SchemaManager(this.schema);
    const settings = this.settings;
    const request = {
      method: 'PUT',
      endpoint: `/${this.getFullName()}`,
      body: {
        index: this.getFullName(),
        mappings: sm.toMappings(),
        settings,
        ...(more || {}),
      },
    };
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
      this.textProcessor.prepareResult(record);
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
   * Find records that have content_* columns matching the given term or phrase
   * @param searchFields  specify a subset of fields to search
   * @param fetchFields  specify a subset of fields to fetch
   * @param phrase  A word or phrase to search for
   * @param boosts  boost options (defaults to { boosts: [1, 3, 5] })
   * @param where  Field-value pairs of fields to match
   * @param [more]  Additional body params such as size and from
   */
  async findByPhrase({
    searchFields = this.fulltextFields,
    fetchFields = ['*'],
    phrase,
    boosts = {},
    where = {},
    more = {},
  }: {
    searchFields?: string[];
    fetchFields?: string[];
    phrase: string;
    more?: Partial<estypes.SearchRequest>;
    where?: Record<string, any>;
    boosts?: BoostType;
  }) {
    return this.run(runner => {
      const builder = runner.builder;
      builder.fields(fetchFields);
      builder.matchBoostedPhrase(searchFields, phrase, boosts);
      for (const [field, value] of Object.entries(where)) {
        builder.match(field, value);
      }
      return runner.findMany(more);
    });
  }

  /**
   * Find records that have content_* columns matching the given term or phrase
   * @param fetchFields  specify a subset of fields to fetch
   * @param where  Field-value pairs of fields to match
   * @param [more]  Additional body params such as size and from
   */
  async findByCriteria({
    fetchFields = ['*'],
    where = {},
    more = {},
  }: {
    searchFields?: string[];
    fetchFields?: string[];
    more?: Partial<estypes.SearchRequest>;
    where?: Record<string, any>;
    boosts?: BoostType;
  } = {}) {
    return this.run(runner => {
      const builder = runner.builder;
      builder.fields(fetchFields);
      for (const [field, value] of Object.entries(where)) {
        builder.match(field, value);
      }
      return runner.findMany(more);
    });
  }

  run<T>(withQueryRunner: (runner: QueryRunner<ThisSchema>) => T) {
    return withQueryRunner(new QueryRunner(this));
  }

  findMany(withQueryBuilder: (builder: QueryBuilder) => void | Promise<void>) {
    return this.run(async runner => {
      const builder = runner.builder;
      await withQueryBuilder(builder);
      return runner.findMany();
    });
  }

  findFirst(withQueryBuilder: (builder: QueryBuilder) => void | Promise<void>) {
    return this.run(async runner => {
      const builder = runner.builder;
      await withQueryBuilder(builder);
      return runner.findFirst();
    });
  }

  /**
   * Save the given record and return its id (uses PUT)
   * @param id  The record id
   * @param body  The record to save
   */
  async put(id: string, body: ElasticsearchRecord<ThisSchema>) {
    const start = Date.now();
    this.textProcessor.prepareInsertion(body);
    const request = {
      method: 'PUT',
      endpoint: `/${this.getAliasName()}/_doc/${id}`,
      body: {
        index: this.getAliasName(),
        id: id,
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
    more?: Partial<BulkRequestParams>
  ) {
    const start = Date.now();
    records.forEach(r => this.textProcessor.prepareInsertion(r));
    const index = this.getAliasName();
    const bulkBody: any[] = [];
    for (const record of records) {
      bulkBody.push(
        { index: { _index: index, _id: record.id || crypto.randomUUID() } },
        record
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
      return {
        success: response.errors === null,
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
   * Save the given partial record (uses updateRecord())
   * @param id  The record id
   * @param body  The record to save
   * @param [more]  Additional body params
   */
  async patch(
    id: string,
    body: ElasticsearchRecord<ThisSchema>,
    more?: Partial<PatchRequestParams>
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
    this.textProcessor.prepareInsertion(body);
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
   * Migrate the index if needed
   * - Index may exist
   *   - If not, create it and create an alias
   *   - If it does, create alias if needed
   * - Otherwise check the alias name in ElasticSearch matches this alias name
   *   - If it matches, do nothing
   *   - If it doesn't create a new index, copy old data to new index, then update alias to point to the new index
   *   - Note that ElasticSearch may support an alias pointing to old and new indexes at the same time + deleting on copy
   */
  async migrateIfNeeded() {
    const start = Date.now();
    const currentIndexName = this.getFullName();
    const aliasName = this.getAliasName();
    try {
      // Check if the index exists
      const indexExists = await this.exists();

      if (!indexExists.exists) {
        // There is no index at all OR the version number has changed
        await this.create();

        // Get the index that the alias points to
        const indexInfo = await this.getIndexMetadata();
        const oldIndexName = indexInfo.name;

        if (oldIndexName === null || oldIndexName === currentIndexName) {
          // No index at all
          await this.createAlias();
          return {
            success: true,
            took: Date.now() - start,
            code: 'CREATED_INDEX',
            oldName: null,
            newName: currentIndexName,
            ...this._formatNonError(indexExists),
          };
        }

        // Get the current sequence number before starting reindex
        const stats = await this.client.indices.stats({
          index: oldIndexName,
        });
        const maxSeqNo =
          stats.indices?.[oldIndexName]?.total?.translog?.operations || 0;

        // Version number has changed - perform initial reindex
        await this.client.reindex({
          wait_for_completion: true,
          source: { index: oldIndexName },
          dest: { index: currentIndexName },
          conflicts: 'proceed',
        });

        try {
          // Stop writes to old index
          await this.client.indices.putSettings({
            index: oldIndexName,
            body: { 'index.blocks.write': true },
          });

          // Update alias to point to the new index atomically
          await this.client.indices.updateAliases({
            actions: [
              {
                remove: {
                  index: oldIndexName,
                  alias: aliasName,
                },
              },
              {
                add: {
                  index: currentIndexName,
                  alias: aliasName,
                },
              },
            ],
          });

          let manualMigrationCount = 0;

          const migrateChanges = async (batchSize = 100, from = 0) => {
            // Fetch any documents that were updated/created during reindex
            const changes = await this.client.search({
              index: oldIndexName,
              query: {
                range: {
                  _seq_no: { gt: maxSeqNo },
                },
              },
              from,
              size: batchSize,
            });

            // Migrate any other writes that happened during reindex
            if (changes.hits.hits.length > 0) {
              const bulkBody = [];
              for (const hit of changes.hits.hits) {
                bulkBody.push(
                  { index: { _index: currentIndexName, _id: hit._id } },
                  hit._source
                );
              }
              await this.client.bulk({
                body: bulkBody,
                refresh: true,
              });
            }

            manualMigrationCount += changes.hits.hits.length;

            if (changes.hits.hits.length === batchSize) {
              await migrateChanges(from + batchSize);
            }
          };

          await migrateChanges();

          // Allow writes to new index so we can delete
          await this.client.indices.putSettings({
            index: oldIndexName,
            body: { 'index.blocks.write': null },
          });

          // We should be good to delete
          await this.client.indices.delete({ index: oldIndexName });

          return {
            success: true,
            took: Date.now() - start,
            code: 'MIGRATED',
            oldName: oldIndexName,
            newName: currentIndexName,
            ...this._formatNonError(indexExists),
          };
        } catch (e) {
          return {
            success: false,
            took: Date.now() - start,
            code: 'MIGRATION_FAILED',
            oldName: oldIndexName,
            newName: currentIndexName,
            ...this._formatError(e),
          };
        } finally {
          // Ensure we reinstate writes to old index upon error
          await this.client.indices.putSettings({
            index: oldIndexName,
            body: { 'index.blocks.write': null },
          });
        }
      }

      // Alias already points to the correct index
      return {
        success: true,
        took: Date.now() - start,
        code: 'NO_CHANGE',
        oldName: currentIndexName,
        newName: currentIndexName,
        ...this._formatNonError(indexExists),
      };
    } catch (e) {
      return {
        success: false,
        took: Date.now() - start,
        code: 'ERROR',
        oldName: null,
        newName: null,
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
