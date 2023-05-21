import indexName from '../indexName/indexName';
import doesIndexExist from '../doesIndexExist/doesIndexExist';
import schemaToMappings from '../schemaToMappings/schemaToMappings';
import createIndex from '../createIndex/createIndex';
import findBy from '../findBy/findBy';
import createSlug from '../createSlug/createSlug';
import putRecord from '../putRecord/putRecord';
import updateRecord from '../updateRecord/updateRecord';
import deleteRecord from '../deleteRecord/deleteRecord';
import createAlias from '../createAlias/createAlias';
import doesAliasExist from '../doesAliasExist/doesAliasExist';

/**
 * ElasticSearch index manager for creating, searching and saving data
 * for a particular index
 */
export default class IndexManager {
  index: any;
  language: any;
  schema: any;
  settings: any;
  version: any;
  /**
   * Define the index with the given configuration
   * @param {String} index  The base index name such as
   * @param {Number} version  Digit indicating the revision for this configuration
   * @param {Object} schema  The schema definition (see schemaToMappings.spec.js)
   * @param {Object} settings  The ElasticSearch settings; e.g. for sort hints
   */
  constructor({
    index,
    version,
    schema,
    settings
  }: any) {
    this.index = index;
    this.version = version;
    this.schema = schema;
    this.settings = settings;
    this.language = 'englishplus';
  }

  /**
   * Return the full name including prefix, language and version
   * @returns {String}
   */
  getIndexName() {
    return indexName.build({
      prefix: 'bw',
      language: 'englishplus',
      index: this.index,
      version: this.version,
    });
  }

  /**
   * Return the full name including prefix, language and version
   * @returns {String}
   */
  getAliasName() {
    return indexName.alias({
      prefix: 'bw',
      language: 'englishplus',
      index: this.index,
    });
  }

  /**
   * Update the language which will be reflected in getIndexName()
   * @param {String} language  An analyzer name such as cjk, spanish, englishplus
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/7.17/analysis-lang-analyzer.html
   * @returns {IndexManager}
   */
  setLanguage(language: any) {
    this.language = language;
    return this;
  }

  /**
   * Return { result: true } if the index already exists in the database
   * @returns {Promise<{result: Boolean, details: Object, error: Error}>}
   */
  async exists() {
    return await doesIndexExist(this.getIndexName());
  }

  /**
   * Return { result: true } if the alias already exists in the database
   * @returns {Promise<{result: Boolean, details: Object, error: Error}>}
   */
  async aliasExists() {
    return await doesAliasExist(this.getAliasName());
  }

  /**
   * Create a new index with these specifications
   * @returns {Promise<{result: Boolean, details: Object, error: Error}>}
   */
  async create() {
    const mappings = schemaToMappings(this.schema);
    const settings = this.settings;
    return createIndex(this.getIndexName(), { mappings, settings });
  }

  /**
   * Create an alias for this index
   * @returns {Promise<{result: Boolean, details: Object, error: Error}>}
   */
  async createAlias() {
    return createAlias(this.getIndexName(), this.getAliasName());
  }

  async createIfNeeded() {
    const { result: alreadyExists, error, details } = await this.exists();
    if (alreadyExists === true) {
      return { result: 'already exists', error, details };
    } else {
      const { result: createdOk, error, details } = await this.create();
      if (createdOk === true) {
        return { result: 'created ok', error, details };
      } else {
        return { result: 'error', error, details };
      }
    }
  }

  async createAliasIfNeeded() {
    const { result: alreadyExists, error, details } = await this.aliasExists();
    if (alreadyExists === true) {
      return { result: 'already exists', error, details };
    } else {
      const { result: createdOk, error, details } = await this.createAlias();
      if (createdOk === true) {
        return { result: 'created ok', error, details };
      } else {
        return { result: 'error', error, details };
      }
    }
  }

  /**
   * Find a single record by the given id
   * @param {String} id
   * @returns {Promise<{result: Object, details: Object, error:Error}>}
   */
  async findById(id: any) {
    return await findBy.id(this.getIndexName(), id);
  }

  /**
   * Find records that match the given criteria
   * @param {Object} criteria  Field-value pairs of fields to match
   * @param {Object} [moreBody]  Additional body params such as size and from
   * @returns {Promise<{result: {records: Object[], total: Number}, details: Object, error:Error}>}
   */
  async findByCriteria(criteria: any, moreBody: any) {
    return await findBy.criteria(this.getAliasName(), criteria, moreBody);
  }

  /**
   * Find records that have content_* columns matching the given term or phrase
   * @param {String} phrase  A word or phrase to search for
   * @param {Object} criteria  Field-value pairs of fields to match
   * @param {Object} [moreBody]  Additional body params such as size and from
   * @returns {Promise<{result: {records: Object[], total: Number}, details: Object, error:Error}>}
   */
  async findByPhrase(phrase: any, criteria: any, moreBody: any) {
    return await findBy.phrase(this.getAliasName(), phrase, criteria, moreBody);
  }

  /**
   * Find records matching the given QueryBuilder object
   * @param {QueryBuilder} query  Criteria
   * @returns {Promise<{result: {records: Object[], total: Number}, details: Object, error:Error}>}
   */
  async findByQuery(query: any) {
    return await findBy.query(this.getAliasName(), query);
  }

  /**
   * Save the given record and return its id (uses PUT)
   * @param {String} savedBy  The user who saved it
   * @param {Object} data  The record to save
   * @returns {Promise<{result: String, details: Object, error: Error}>}
   */
  async put({
    savedBy,
    data
  }: any) {
    if (!data.id) {
      data.id = createSlug(25);
      if (savedBy !== undefined) {
        data.created_at = Date.now();
        data.created_by = savedBy;
      }
    }
    if (savedBy !== undefined) {
      data.modified_at = Date.now();
      data.modified_by = savedBy;
    }
    const { result, error, details } = await putRecord(
      this.getAliasName(),
      data
    );
    return { result: result === true ? data.id : false, error, details };
  }

  /**
   * Save the given partial record (uses updateRecord())
   * @param {String} savedBy  The user who saved it
   * @param {Object} data  The record to save
   * @returns {Promise<{result: String, details: Object, error: Error}>}
   */
  async patch({
    id,
    savedBy,
    data
  }: any) {
    if (savedBy !== undefined) {
      data.modified_at = Date.now();
      data.modified_by = savedBy;
    }
    const { result, error, details } = await updateRecord(
      this.getAliasName(),
      id,
      data
    );
    return { result: result === true ? data.id : false, error, details };
  }

  /**
   * Update the modified_* and deleted_* fields to signify record was deleted
   * @param {String} id  The id of the record
   * @param {String} deletedBy  The user who deleted it
   * @returns {Promise<{result: Boolean, details: Object, error: Error}>}
   */
  async softDelete(id: any, deletedBy: any) {
    if (!id) {
      return { result: true, error: null, details: 'Not yet in database' };
    }
    return await updateRecord(this.getAliasName(), id, {
      modified_at: Date.now(),
      modified_by: deletedBy,
      deleted_at: Date.now(),
      deleted_by: deletedBy,
    });
  }

  /**
   * Remove record from database
   * @param {String} id  The id of the record
   * @returns {Promise<{result: Boolean, details: Object, error: Error}>}
   */
  async delete(id: any) {
    if (!id) {
      return { result: true, error: null, details: 'Not yet in database' };
    }
    return await deleteRecord(this.getAliasName(), id);
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