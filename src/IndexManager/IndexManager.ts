import indexName from '../indexName/indexName';
import schemaToMappings  from '../schemaToMappings/schemaToMappings';
import findBy from '../findBy/findBy';
import QueryBuilder from '../QueryBuilder/QueryBuilder';
import getEsClient from '../getEsClient/getEsClient';
import { Client, estypes } from '@elastic/elasticsearch';
import fulltext from '../fulltext/fulltext';
import { ElasticsearchRecord, IndexName, SchemaShape } from '../types';
import TextProcessor from '../TextProcessor/TextProcessor';

/**
 * ElasticSearch index manager for creating, searching and saving data
 * for a particular index
 */
export default class IndexManager<ThisSchema extends SchemaShape = SchemaShape> {
  public index: IndexName;
  public client: Client;
  public language: string;
  public schema: ThisSchema;
  public settings: any;
  public version: number | string;
  public prefix: string;
  public textProcessor: TextProcessor;
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
    textProcessor = new TextProcessor(),
  }: {
    client?: Client;
    name: IndexName;
    version?: number | string;
    schema: ThisSchema;
    settings?: estypes.IndicesCreateRequest['settings'];
    prefix?: string;
    language?: string;
    textProcessor?: TextProcessor;
  }) {
    this.client = client;
    this.index = name;
    if (!/^\w+$/.test(name)) {
      throw new Error(
        'IndexManager: Index name must be only alphanumeric and underscores'
      );
    }
    this.textProcessor = textProcessor;
    this.version = version;
    this.schema = schema;
    this.settings = settings;
    this.language = language;
    this.prefix = prefix;
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

  /**
   * Return { result: true } if the index already exists in the database
   */
  async exists() {
    try {
      const result = await this.client.indices.exists({
        index: this.getIndexName(),
      });
      return { result, error: null };
    } catch (e) {
      return { result: null, error: e as Error };
    }
  }

  /**
   * Return { result: true } if the alias already exists in the database
   */
  async aliasExists() {
    try {
      const result = this.client.indices.existsAlias({
        name: this.getAliasName(),
      });
      return { result, error: null };
    } catch (e) {
      return { result: null, error: e as Error };
    }
  }

  /**
   * Create a new index with these specifications
   */
  async create() {
    const mappings = schemaToMappings(this.schema, this.language);
    const settings = this.settings;
    try {
      const result = await this.client.indices.create({
        index: this.getIndexName(),
        mappings,
        settings,
      });
      return { result, error: null };
    } catch (e) {
      return { result: null, error: e as Error };
    }
  }

  /**
   * Create an alias for this index
   */
  async createAlias() {
    try {
      const result = await this.client.indices.putAlias({
        name: this.getAliasName(),
        index: this.getIndexName(),
      });
      return { result, error: null };
    } catch (e) {
      return { result: null, error: e as Error };
    }
  }

  /**
   * Create the index, but only if needed
   */
  async createIfNeeded() {
    const { result: alreadyExists, error } = await this.exists();
    if (error) {
      return { result: 'error', error };
    } else if (alreadyExists === true) {
      return { result: 'already exists', error: null };
    } else {
      const { result: createdOk, error } = await this.create();
      if (createdOk === true) {
        return { result: 'created ok', error };
      } else {
        return { result: 'error', error };
      }
    }
  }

  /**
   * Create the alias, but only if needed
   *
   */
  async createAliasIfNeeded() {
    const { result: alreadyExists, error } = await this.aliasExists();
    if (error) {
      return { result: 'error', error };
    } else if (alreadyExists === true) {
      return { result: 'already exists', error: null };
    } else {
      const { result: createdOk, error } = await this.createAlias();
      if (createdOk === true) {
        return { result: 'created ok', error };
      } else {
        return { result: 'error', error };
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
   * @param phrase  A word or phrase to search for
   * @param where  Field-value pairs of fields to match
   * @param [more]  Additional body params such as size and from
   */
  async findByPhrase(
    phrase: string,
    where: Record<string, any>,
    more?: Omit<estypes.SearchRequest, 'index' | 'query'>
  ) {
    return await findBy.boostedPhrase({
      client: this.client,
      index: this.getAliasName(),
      phrase,
      where,
      more,
    });
  }

  getBuilder() {
    return new QueryBuilder(this);
  }

  /**
   * Find records matching the given QueryBuilder object
   * @param builder  A QueryBuilder instance
   * @param [more]  Additional options such as size and from
   */
  async findByQuery(
    builder: QueryBuilder,
    more?: Partial<estypes.SearchRequest>
  ) {
    return await findBy.query({ index: this.getAliasName(), builder, more });
  }

  /**
   * Save the given record and return its id (uses PUT)
   * @param id  The record id
   * @param body  The record to save
   */
  async put(id: string, body: ElasticsearchRecord<ThisSchema>) {
    fulltext.processRecord(body);
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
   * Save the given partial record (uses updateRecord())
   * @param id  The record id
   * @param body  The record to save
   */
  async patch(id: string, body: ElasticsearchRecord<ThisSchema>) {
    fulltext.processRecord(body);
    try {
      const result = await this.client.update({
        index: this.getAliasName(),
        id,
        body,
      });
      return { result, error: null };
    } catch (e) {
      return { result: null, error: e as Error };
    }
  }

  /**
   * Remove record from database
   * @param {String} id  The id of the record
   */
  async delete(id: string) {
    try {
      const result = await this.client.delete({
        index: this.getAliasName(),
        id,
      });
      return { result, error: null };
    } catch (e) {
      return { result: null, error: e as Error };
    }
  }
}

/*
Example:

const usersIndex = new IndexManager({
  index: 'users',
  version: 1,
  schema: {
    id: 'keyword',
    email: 'keyword',
    full_name: 'keyword',
    domain: 'keyword',
    service: 'keyword',
    avatar: 'keyword',
    content_bio: 'fulltext',
    last_login_at: 'date.epoch_millis',
    last_login_ip: 'keyword',
    created_at: 'date.epoch_millis',
    created_by: 'keyword',
    modified_at: 'date.epoch_millis',
    modified_by: 'keyword',
    deleted_at: 'date.epoch_millis',
    deleted_by: 'keyword',
  },
  settings: {
    // Specify fields we might sort by to make sorting faster
    // See https://www.elastic.co/blog/index-sorting-elasticsearch-6-0
    index: {
      'sort.field': ['full_name', 'email', 'last_login_at'],
      'sort.order': ['asc', 'asc', 'desc'],
    },
  },
});

 */
