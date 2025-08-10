import indexName from '../indexName/indexName';
import findBy from '../findBy/findBy';
import QueryBuilder from '../QueryBuilder/QueryBuilder';
import getEsClient from '../getEsClient/getEsClient';
import { Client, estypes, errors } from '@elastic/elasticsearch';
import {
  BoostType,
  ElasticsearchRecord,
  IndexName,
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
  public index: IndexName;
  public client: Client;
  public language: string;
  public schema: SchemaManager<ThisSchema>;
  public settings: any;
  public version: number | string;
  public prefix: string;
  public textProcessor: TextProcessor;
  public fulltextFields: string[];
  public allFields: string[];
  /**
   * Define the index with the given configuration
   * @param client  The client to use
   * @param name  The base index name such as "blogPosts" or "blog_posts"
   * @param version  Digit indicating the revision for this configuration
   * @param schema  The schema definition (see schemaToMappings.spec.js)
   * @param settings  The ElasticSearch settings; e.g. for sort hints
   * @param prefix  A prefix to isolate these tables from another application or environment
   * @param language  A language code or analyzer
   * @param textProcessor  A TextProcessor to use
   */
  constructor({
    client = getEsClient(),
    name,
    version = 1,
    schema,
    settings = {},
    prefix = '',
    language = 'englishplus',
  }: {
    client?: Client;
    name: IndexName;
    version?: number | string;
    schema: ThisSchema;
    settings?: estypes.IndicesCreateRequest['settings'];
    prefix?: string;
    language?: string;
  }) {
    this.client = client;
    this.index = name;
    if (!/^\w+$/.test(name)) {
      throw new Error(
        'IndexManager: Index name must be only alphanumeric and underscores'
      );
    }
    this.textProcessor = new TextProcessor();
    this.textProcessor.registerSchema(schema);
    this.version = version;
    this.schema = new SchemaManager(schema);
    this.settings = settings;
    this.language = language;
    this.prefix = prefix;
    this.fulltextFields = this.schema.getFulltextFields();
    this.allFields = this.schema.getAllFields();
  }

  /**
   * Return the full name including prefix, language and version
   */
  getIndexName() {
    return indexName.build({
      prefix: this.prefix,
      language: this.language,
      index: this.index,
      version: this.version,
    });
  }

  /**
   * Return the full name including prefix, language and version
   */
  getAliasName() {
    return indexName.alias({
      prefix: this.prefix,
      language: this.language,
      index: this.index,
    });
  }

  /**
   * Update the language which will be reflected in getIndexName()
   * @param language  An analyzer name such as cjk, spanish, englishplus
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/7.17/analysis-lang-analyzer.html
   */
  setLanguage(language: string) {
    this.language = language;
    return this;
  }

  private formatError(e: any) {
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

  private formatNonError<T>(response: T) {
    return {
      error: null,
      errorKind: null,
      response,
    };
  }

  /**
   * Return { result: true } if the index already exists in the database
   */
  async exists() {
    try {
      const response = await this.client.indices.exists({
        index: this.getIndexName(),
      });
      return { exists: response, ...this.formatNonError(null) };
    } catch (e) {
      return { exists: null, ...this.formatError(e) };
    }
  }

  /**
   * Return { result: "index_name" } if the alias exists and points to an index
   */
  async getIndexNameByAlias() {
    try {
      const response = await this.client.indices.getAlias({
        name: this.getAliasName(),
      });
      const indexName = Object.keys(response.body)[0];
      return { name: indexName, ...this.formatNonError(response) };
    } catch (e) {
      return { name: null, ...this.formatError(e) };
    }
  }

  /**
   * Return { result: true } if the alias already exists in the database
   */
  async aliasExists() {
    try {
      const response = this.client.indices.existsAlias({
        name: this.getAliasName(),
      });
      return {
        exists: Object.keys(response)[0],
        ...this.formatNonError(response),
      };
    } catch (e) {
      const error = e as errors.ResponseError;
      if (error.statusCode === 404) {
        return { exists: false, ...this.formatNonError(e.meta || null) };
      }
      return { exists: null, ...this.formatError(e) };
    }
  }

  /**
   * Create a new index with these specifications
   */
  async create() {
    const sm = new SchemaManager(this.schema);
    const settings = this.settings;
    try {
      const response = await this.client.indices.create({
        index: this.getIndexName(),
        mappings: sm.toMappings(),
        settings,
      });
      return { index: response.index, ...this.formatNonError(response) };
    } catch (e) {
      return { index: null, ...this.formatError(e) };
    }
  }

  /**
   * Create an alias for this index
   */
  async createAlias() {
    try {
      const response = await this.client.indices.putAlias({
        name: this.getAliasName(),
        index: this.getIndexName(),
      });
      return {
        success: response.acknowledged,
        ...this.formatNonError(response),
      };
    } catch (e) {
      return { success: false, ...this.formatError(e) };
    }
  }

  /**
   * Create the index, but only if needed
   */
  async createIfNeeded() {
    const res = await this.exists();
    if (res.exists) {
      return {
        success: true,
        code: 'ALREADY_EXISTS',
        error: null,
        errorKind: null,
      };
    } else if (res.error) {
      return {
        success: false,
        code: 'ERROR',
        error: res.error,
        errorKind: res.errorKind,
      };
    } else {
      const res = await this.create();
      if (res.index === null) {
        return {
          success: false,
          code: 'ERROR',
          error: res.error,
          errorKind: res.errorKind,
        };
      } else {
        return { success: true, code: 'CREATED', error: null, errorKind: null };
      }
    }
  }

  /**
   * Create the alias, but only if needed
   *
   */
  async createAliasIfNeeded() {
    const res = await this.aliasExists();
    if (res.exists) {
      return {
        success: true,
        code: 'ALREADY_EXISTS',
        error: null,
        errorKind: null,
      };
    } else if (res.error) {
      return {
        success: false,
        code: 'ERROR',
        error: res.error,
        errorKind: res.errorKind,
      };
    } else {
      const res = await this.createAlias();
      if (res.success === false) {
        return {
          success: false,
          code: 'ERROR',
          error: res.error,
          errorKind: res.errorKind,
        };
      } else {
        return { success: true, code: 'CREATED', error: null, errorKind: null };
      }
    }
  }

  /**
   * Find a single record by the given id
   * @param id  The record id
   */
  async findById(id: string) {
    return findBy.id({ client: this.client, index: this.getAliasName(), id });
  }

  /**
   * Find records that match the given where
   * @param where  Field-value pairs of fields to match
   * @param [more]  Additional body params such as size and from
   */
  async findByCriteria(
    where: Record<string, any>,
    more?: Partial<estypes.SearchRequest>
  ) {
    return findBy.criteria({
      client: this.client,
      index: this.getAliasName(),
      where,
      more,
    });
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
    phrase: string | string[];
    more?: Omit<estypes.SearchRequest, 'index' | 'query'>;
    where?: Record<string, any>;
    boosts: BoostType;
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
  async findWhere({
    fetchFields = ['*'],
    where = {},
    more = {},
  }: {
    searchFields?: string[];
    fetchFields?: string[];
    more?: Omit<estypes.SearchRequest, 'index' | 'query'>;
    where?: Record<string, any>;
    boosts: BoostType;
  }) {
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
    this.textProcessor.prepareInsertion(body);
    try {
      const result = await this.client.index({
        index: this.getAliasName(),
        id: id,
        body,
      });
      return { result, error: null };
    } catch (e) {
      return { result: null, error: e as Error };
    }
  }

  /**
   * Save the given records
   * @param records  The records to save
   */
  async putBulk(records: ElasticsearchRecord<ThisSchema>[]) {
    records.forEach(r => this.textProcessor.prepareInsertion(r));
    try {
      const result = await this.client.bulk({
        index: this.getAliasName(),
        body: records,
      });
      return { result, error: null };
    } catch (e) {
      return { result: null, error: e as Error };
    }
  }

  /**
   * Save the given partial record (uses updateRecord())
   * @param id  The record id
   * @param body  The record to save
   */
  async patch(id: string, body: ElasticsearchRecord<ThisSchema>) {
    this.textProcessor.prepareInsertion(body);
    try {
      const response = await this.client.update({
        index: this.getAliasName(),
        id,
        body,
      });
      return {
        success: true,
        result: 'updated',
        ...this.formatNonError(response),
      };
    } catch (e) {
      return { success: false, result: 'error', ...this.formatError(e) };
    }
  }

  /**
   * Remove record from database
   * @param {String} id  The id of the record
   */
  async delete(id: string) {
    try {
      const response = await this.client.delete({
        index: this.getAliasName(),
        id,
      });
      return { success: true, ...this.formatNonError(response) };
    } catch (e) {
      return { success: false, ...this.formatError(e) };
    }
  }

  /**
   * Migrate the index if needed
   * - Index may need to be crea
   *   - If not, create it and create an alias
   *   - If it does, create alias if needed
   * - Otherwise check the alias name in ElasticSearch matches this alias name
   *   - If it matches, do nothing
   *   - If it doesn't create a new index, copy old data to new index, then update alias to point to the new index
   *   - Note that ElasticSearch may support an alias pointing to old and new indexes at the same time + deleting on copy
   */
  async migrateIfNeeded() {
    const start = Date.now();
    const currentIndexName = this.getIndexName();
    try {
      // Check if the index exists
      const indexExists = await this.exists();

      if (!indexExists.exists) {
        // There is no index at all OR the version number has changed
        await this.create();

        // Get the index that the alias points to
        const indexInfo = await this.getIndexNameByAlias();
        const oldIndexName = indexInfo.name;

        if (oldIndexName === currentIndexName) {
          // No index at all
          await this.createAlias();
          return {
            success: true,
            took: Date.now() - start,
            code: 'CREATED_INDEX',
            oldName: null,
            newName: currentIndexName,
            ...this.formatNonError(indexExists),
          };
        }

        // Get the current sequence number before starting reindex
        const stats = await this.client.indices.stats({
          index: oldIndexName,
          metric: ['seq_no'],
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
              { remove: { index: oldIndexName, alias: this.getAliasName() } },
              { add: { index: currentIndexName, alias: this.getAliasName() } },
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
            ...this.formatNonError(indexExists),
          };
        } catch (e) {
          return {
            success: false,
            took: Date.now() - start,
            code: 'MIGRATION_FAILED',
            oldName: oldIndexName,
            newName: currentIndexName,
            ...this.formatError(e),
          };
        } finally {
          // Ensure we reinstate writes to old index
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
        ...this.formatNonError(indexExists),
      };
    } catch (e) {
      return {
        success: false,
        took: Date.now() - start,
        code: 'ERROR',
        oldName: null,
        newName: null,
        ...this.formatError(e),
      };
    }
  }
}

/*
Example:

export const postIndex = new IndexManager({
  name: 'post',
  version: '1',
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
