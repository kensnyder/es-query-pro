// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'fulltext'.
const fulltext = require('../fulltext/fulltext.js');

/**
 * Build ElasticSearch query
 */
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'QueryBuild... Remove this comment to see the full error message
class QueryBuilder {
  _aggs: any;
  _fields: any;
  _functionScore: any;
  _highlighter: any;
  _limit: any;
  _must: any;
  _mustNot: any;
  _page: any;
  _sortByRandom: any;
  _sorts: any;
  /**
   * Initialize all private properties
   */
  constructor() {
    /**
     * @var {Array} The fields that should return
     */
    this._fields = ['*'];

    /**
     * @var {Array} The must filters
     */
    this._must = [];

    /**
     * @var {Array} The must_not filters
     */
    this._mustNot = [];

    /**
     * @var {Object} The "aggs" to add to the query
     */
    this._aggs = {};

    /**
     * @var {Array} The function score query
     */
    this._functionScore = null;

    /**
     * @var {Array} The highlight definition
     */
    this._highlighter = null;

    /**
     * @var {Number} The max number of records to return
     */
    this._limit = null;

    /**
     * @var {Number} The page to fetch
     */
    this._page = 1;

    /**
     * @var {Array} Fields to sort by
     */
    this._sorts = [];

    /**
     * @var {Boolean} If true, use "random_score" for a function score
     */
    this._sortByRandom = false;
  }
  /**
   * Set the fields to fetch
   * @param {String[]} fields  The fields to select
   * @return QueryBuilder
   */
  fields(fields: any) {
    this._fields = fields;
    return this;
  }
  /**
   * Append filters to the given filter object (match any of the given values)
   * @param {Array} filters  Either this._must or this._mustNot
   * @param {String} matchType  Either "match" or "term"
   * @param {String} field  The name of the field to search
   * @param {*} valueOrValues  A value or array of possible values
   */
  _addFilterAny(filters: any, matchType: any, field: any, valueOrValues: any) {
    if (!Array.isArray(valueOrValues)) {
      valueOrValues = [valueOrValues];
    }
    if (matchType === 'term' && valueOrValues.length > 1) {
      filters.push({ terms: { [field]: valueOrValues } });
      return;
    }
    const terms = [];
    for (const value of valueOrValues) {
      terms.push({ [matchType]: { [field]: value } });
    }
    if (terms.length === 1) {
      filters.push(terms[0]);
    } else {
      filters.push({ bool: { should: terms } });
    }
  }
  /**
   * Append a multi_match condition to the given filter object (match any of the given values against the given fields)
   * @param {Array} filters  Either this._must or this._mustNot
   * @param {String[]} fields  The name of the fields to search
   * @param {*} valueOrValues  A value or array of possible values
   */
  _addMultiMatchAny(filters: any, fields: any, valueOrValues: any) {
    if (!Array.isArray(valueOrValues)) {
      valueOrValues = [valueOrValues];
    }
    const terms = [];
    for (const value of valueOrValues) {
      terms.push({
        multi_match: {
          fields: fields,
          query: value,
        },
      });
    }
    if (terms.length === 1) {
      filters.push(terms[0]);
    } else {
      filters.push({ bool: { should: terms } });
    }
  }
  /**
   * Add a series of term condition to the given filter object (find full-word matches any of the given values against the given field)
   * @param {Array} filters  Either this._must or .this._mustNot
   * @param {Array} fields  The name of the fields to search
   * @param {*} value  A value
   */
  _addMultiTermAny(filters: any, fields: any, value: any) {
    const terms = [];
    for (const field of fields) {
      terms.push({
        term: {
          [field]: value,
        },
      });
    }
    filters.push({ bool: { should: terms } });
  }
  /**
   * Append filters to the given filter object (match all the values given)
   * @param {Array} filters  Either this._must or this._mustNot
   * @param {String} matchType  Either "match" or "term"
   * @param {String|Array} fieldOrFields  The name of the field to search (or names for multiMatch)
   * @param {String|Array} valueOrValues  A value or array of possible values
   */
  _addFilterAll(filters: any, matchType: any, fieldOrFields: any, valueOrValues: any) {
    if (!Array.isArray(valueOrValues)) {
      valueOrValues = [valueOrValues];
    }
    console.log('_addFilterAll', { matchType, fieldOrFields, valueOrValues });
    for (const value of valueOrValues) {
      filters.push({ [matchType]: { [fieldOrFields]: value } });
    }
  }
  /**
   * Append a multi_match condition to the given filter object (match any of the given values against the given fields)
   * @param {Array} filters  Either this._must or this._mustNot
   * @param {Array} fields  The name of the fields to search
   * @param {String|Array} valueOrValues  A value or array of possible values
   */
  _addMultiMatchAll(filters: any, fields: any, valueOrValues: any) {
    if (!Array.isArray(valueOrValues)) {
      valueOrValues = [valueOrValues];
    }
    for (const value of valueOrValues) {
      filters.push({
        multi_match: {
          fields: fields,
          query: value,
        },
      });
    }
  }
  /**
   * Add a series of term condition to the given filter object (find full-word matches any of the given values against the given field)
   * @param {Array} filters  Either this._must or this._mustNot
   * @param {Array} fields  The name of the fields to search
   * @param {*} value  A value
   */
  _addMultiTermAll(filters: any, fields: any, value: any) {
    for (const field of fields) {
      filters.push({
        term: {
          [field]: value,
        },
      });
    }
  }
  /**
   * Append filters for the given range expression
   * @param {Array} filters  Either this._must or this._mustNot
   * @param {String} field  The name of the field to search
   * @param {String} op  One of the following: > < >= <= gt lt gte lte between
   * @param {String|Number|String[]|Number[]} value  The limit(s) to search against
   */
  _addRange(filters: any, field: any, op: any, value: any) {
    const ops = {
      '<': 'lt',
      '<=': 'lte',
      '>': 'gt',
      '>=': 'gte',
    };
    if (op.toLowerCase() === 'between' && Array.isArray(value)) {
      filters.push({
        range: {
          [field]: {
            gte: value[0],
            lte: value[1],
          },
        },
      });
      return;
    }
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    const opName = ops[op] || op.toLowerCase();
    filters.push({
      range: {
        [field]: { [opName]: value },
      },
    });
  }
  /**
   * Add a full-text matching condition
   * @param {String} field  The name of the field to search
   * @param {String|Number|String[]|Number[]} valueOrValues  A value or array of possible values
   * @param {String} type  Use "ALL" to require document to contain all values, otherwise match any value
   * @return {QueryBuilder}
   * @chainable
   */
  match(field: any, valueOrValues: any, type = 'ANY') {
    if (type.toUpperCase() === 'ALL') {
      this._addFilterAll(this._must, 'match', field, valueOrValues);
    } else {
      this._addFilterAny(this._must, 'match', field, valueOrValues);
    }
    return this;
  }
  /**
   * Add a full-text phrase matching condition
   * @param {String} field  The name of the field to search
   * @param {String|Array} phraseOrPhrases  A value or array of possible phrase values
   * @return {QueryBuilder}
   * @chainable
   */
  matchPhrase(field: any, phraseOrPhrases: any) {
    if (!Array.isArray(phraseOrPhrases)) {
      phraseOrPhrases = [phraseOrPhrases];
    }
    const terms = [];
    for (const phrase of phraseOrPhrases) {
      const value = fulltext.processText(phrase);
      terms.push({ match_phrase: { [field]: value } });
    }
    if (terms.length === 1) {
      this._must.push(terms[0]);
    } else {
      this._must.push({ bool: { should: terms } });
    }
    return this;
  }
  /**
   * Add a full-text phrase prefix matching condition
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/6.8/query-dsl-match-query-phrase-prefix.html
   * @param {String|Array} fieldOrFields  The name of the field to search
   * @param {String|Array} phraseOrPhrases  A value or array of possible phrase values
   * @return {QueryBuilder}
   * @chainable
   */
  matchPhrasePrefix(fieldOrFields: any, phraseOrPhrases: any) {
    if (!Array.isArray(phraseOrPhrases)) {
      phraseOrPhrases = [phraseOrPhrases];
    }
    if (Array.isArray(fieldOrFields)) {
      // we want to do a phrase prefix on more than one fields
      // so we multi_match with a phrase_prefix type
      const clauses = [];
      for (const value of phraseOrPhrases) {
        clauses.push({
          multi_match: {
            fields: fieldOrFields,
            type: 'phrase_prefix',
            query: value,
          },
        });
      }
      if (clauses.length === 1) {
        this._must.push(clauses[0]);
      } else {
        this._must.push({ bool: { should: clauses } });
      }
      return this;
    }
    // fieldOrFields is a string so we can use match_phrase_prefix directly
    const clauses = [];
    for (const phrase of phraseOrPhrases) {
      const value = fulltext.processText(phrase);
      clauses.push({ match_phrase_prefix: { [fieldOrFields]: value } });
    }
    if (clauses.length === 1) {
      this._must.push(clauses[0]);
    } else {
      this._must.push({ bool: { should: clauses } });
    }
    return this;
  }
  /**
   * Match a term with boosted relevancy for exact phrases and AND matches.
   * This approach is described in the "Combining OR, AND, and match phrase queries" section of
   * https://www.elastic.co/blog/how-to-improve-elasticsearch-search-relevance-with-boolean-queries
   * It gives more weight to the phrase as a whole so results with the whole phrase will be higher
   * in the results.
   * @param {String[]} fields  The names of the fields to search (often ['content_*.fulltext'])
   * @param {String|String[]} terms  The search phrase or phrases (often ['my search here'])
   * @param {Object} options  Additional options
   * @property {Boolean} expand  If true, also match with OR but at a lower relevance
   * @property {Array} boosts  The boosts for OR, AND, then phrase; default is [1,2,3]
   * @return {QueryBuilder}
   * @chainable
   */
  matchBoostedPhrase(fields: any, terms: any, options = {}) {
    if (typeof terms === 'string') {
      terms = [terms];
    }
    // enumerate options
    // @ts-expect-error TS(2339): Property 'expand' does not exist on type '{}'.
    const expand = options.expand || true;
    // @ts-expect-error TS(2339): Property 'boosts' does not exist on type '{}'.
    const boosts = options.boosts || [1, 3, 5];
    // build subquery
    // @ts-expect-error TS(2351): This expression is not constructable.
    const subquery = new this.constructor();
    if (expand) {
      subquery.multiMatchWithPhrase(fields, terms, {
        operator: 'or',
        boost: boosts[0],
      });
    }
    subquery.multiMatchWithPhrase(fields, terms, {
      operator: 'and',
      boost: boosts[1],
    });
    subquery.multiMatchWithPhrase(fields, terms, {
      type: 'phrase',
      boost: boosts[2],
    });
    this.should(subquery);
    return this;
  }
  /**
   * Add a full-text matching condition across multiple fields
   * @param {Array} fields  The names of the fields to search. Wildcards such as content_* are allowed.
   * @param {String|Array} valueOrValues  A value or array of possible values
   * @param {String} type  Use "ALL" to require document to contain all values, otherwise match any value
   * @return {QueryBuilder}
   * @chainable
   */
  multiMatch(fields: any, valueOrValues: any, type = 'ANY') {
    if (type.toUpperCase() === 'ALL') {
      this._addMultiMatchAll(this._must, fields, valueOrValues);
    } else {
      this._addMultiMatchAny(this._must, fields, valueOrValues);
    }
    return this;
  }
  /**
   * Create a basic multi_match clause and add any of the available options.
   * than they would be in a regular multi_match query
   * See the "Combining OR, AND, and match phrase queries" section of https://www.elastic.co/blog/how-to-improve-elasticsearch-search-relevance-with-boolean-queries.
   * @param {Array} fields
   * @param {Array} valueOrValues
   * @param {Object} options  Possible keys are `analyzer`, `boost`, `operator`, `minimum_should_match`, `fuzziness`, `lenient`, `prefix_length`, `max_expansions`, `fuzzy_rewrite`, `zero_terms_query`, `cutoff_frequency`, and `fuzzy_transpositions`
   * @return {QueryBuilder}
   * @chainable
   */
  multiMatchWithPhrase(fields: any, valueOrValues: any, options = {}) {
    if (typeof valueOrValues === 'string') {
      valueOrValues = [valueOrValues];
    }
    for (const value of valueOrValues) {
      const baseMultiMatch = {
        fields,
        query: fulltext.processText(value),
      };
      this._must.push({
        multi_match: { ...baseMultiMatch, ...options },
      });
    }
    return this;
  }
  /**
   * Add a keyword matching condition across multiple fields
   * @param {Array} fields  The names of the fields to search. Wildcards are not allowed.
   * @param {*} value  A value to search for
   * @param {String} type  Use "ALL" to require all fields to contain the value, otherwise match any value
   * @return {QueryBuilder}
   * @chainable
   */
  multiTerm(fields: any, value: any, type = 'ANY') {
    if (type.toUpperCase() === 'ALL') {
      this._addMultiTermAll(this._must, fields, value);
    } else {
      this._addMultiTermAny(this._must, fields, value);
    }
    return this;
  }
  /**
   * Add a negative full-text matching condition
   * @param {String} field  The name of the field to search
   * @param {String|Array} valueOrValues  A value or array of possible values to reject
   * @return {QueryBuilder}
   * @chainable
   */
  notMatch(field: any, valueOrValues: any) {
    this._addFilterAny(this._mustNot, 'match', field, valueOrValues);
    return this;
  }
  /**
   * Add a negative full-text matching condition across multiple fields
   * @param {Array} fields  The names of the fields to search
   * @param {String|Array} valueOrValues  A value or array of possible values to reject
   * @return {QueryBuilder}
   * @chainable
   */
  notMultiMatch(fields: any, valueOrValues: any) {
    this._addMultiMatchAny(this._mustNot, fields, valueOrValues);
    return this;
  }
  /**
   * Add a negative keyword matching condition across multiple fields
   * @param {Array} fields  The names of the fields to search. Wildcards are not allowed.
   * @param {String} value  A value to reject
   * @return {QueryBuilder}
   * @chainable
   */
  notMultiTerm(fields: any, value: any) {
    this._addMultiTermAny(this._mustNot, fields, value);
    return this;
  }
  /**
   * Add an exact matching condition
   * @param {String|String[]} fieldOrFields  The name of the field(s) to search
   * @param {*|*[]} valueOrValues  A value or array of possible values
   * @param {String} type  Use "ALL" to require document to contain all values, otherwise match any value
   * @return {QueryBuilder}
   * @chainable
   */
  term(fieldOrFields: any, valueOrValues: any, type = 'ANY') {
    if (valueOrValues === null) {
      this.notExists(fieldOrFields);
      return this;
    }
    if (type.toUpperCase() === 'ALL') {
      this._addFilterAll(this._must, 'term', fieldOrFields, valueOrValues);
    } else {
      this._addFilterAny(this._must, 'term', fieldOrFields, valueOrValues);
    }
    return this;
  }
  /**
   * Require that the given field or fields contain values (i.e. non-missing, non-null)
   * @param {String|String[]} fieldOrFields  The name or names of the fields
   * @returns {QueryBuilder}
   */
  exists(fieldOrFields: any) {
    const fields = Array.isArray(fieldOrFields)
      ? fieldOrFields
      : [fieldOrFields];
    for (const field of fields) {
      this._must.push({ exists: { field } });
    }
    return this;
  }
  /**
   * Require that the given field or fields contain no values (i.e. missing or null)
   * @param {String|String[]} fieldOrFields  The name or names of the fields
   * @returns {QueryBuilder}
   */
  notExists(fieldOrFields: any) {
    const fields = Array.isArray(fieldOrFields)
      ? fieldOrFields
      : [fieldOrFields];
    for (const field of fields) {
      this._mustNot.push({ exists: { field } });
    }
    return this;
  }
  /**
   * Add a Lucene expression condition
   * @param {String|Array} fieldOrFields  The name of the field(s) to search
   * @param {String} query  A query string containing special operators such as AND, NOT, OR, ~, *
   * @return {QueryBuilder}
   * @chainable
   */
  queryString(fieldOrFields: any, query: any) {
    const fields = Array.isArray(fieldOrFields)
      ? fieldOrFields
      : [fieldOrFields];
    this._must.push({
      query_string: {
        fields: fields,
        query: query,
      },
    });
    return this;
  }
  /**
   * Add a negative exact matching condition
   * @param {String} field  The name of the field to search
   * @param {*|*[]} valueOrValues  A value or array of possible values to reject
   * @return {QueryBuilder}
   * @chainable
   */
  notTerm(field: any, valueOrValues: any) {
    this._addFilterAny(this._mustNot, 'match', field, valueOrValues);
    return this;
  }
  /**
   * Add a numeric range matching condition
   * @param {String} field  The name of the field to search
   * @param {String} op  One of the following: > < >= <= gt lt gte lte between
   * @param {String|Number|String[]|Number[]} value  A value to search against
   * @return {QueryBuilder}
   * @chainable
   */
  range(field: any, op: any, value: any) {
    this._addRange(this._must, field, op, value);
    return this;
  }
  /**
   * Add a numeric range negative matching condition
   * @param {String} field  The name of the field to search
   * @param {String} op  One of the following: > < >= <= gt lt gte lte between
   * @param {String|Number|String[]|Number[]} value  A value to search against@return {QueryBuilder}
   * @return {QueryBuilder}
   * @chainable
   */
  notRange(field: any, op: any, value: any) {
    this._addRange(this._mustNot, field, op, value);
    return this;
  }
  /**
   * Return faceted data using ElasticSearch's "aggregation" feature
   * @param {String[]|Object} forFields  The names of fields to aggregate into buckets. Can be a list of strings or an object of label-field pairs
   * @param {Number} limit  The maximum number of buckets to return for each facet before an "other" option
   * @return {QueryBuilder}
   * @chainable
   */
  includeFacets(forFields: any, limit = 25) {
    let entries;
    if (Array.isArray(forFields)) {
      entries = forFields.map(field => [field, field]);
    } else {
      // @ts-expect-error TS(2550): Property 'entries' does not exist on type 'ObjectC... Remove this comment to see the full error message
      entries = Object.entries(forFields);
    }
    for (const [name, field] of entries) {
      this._aggs[name] = {
        terms: {
          field,
          size: limit,
          show_term_doc_count_error: true,
          order: { _count: 'desc' },
        },
      };
    }
    return this;
  }
  /**
   * Add an "aggs" entry for term aggregation. Similar to COUNT(*) with GROUP BY
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/current/search-aggregations-bucket-terms-aggregation.html
   * @param {String} field  The field to group by
   * @param {Number} limit  The maximum number of counts to return
   * @param {Array} exclusions  Values that should be excluded from the counts
   * @return {QueryBuilder}
   * @chainable
   */
  aggregateTerm(field: any, limit = 10, exclusions = []) {
    this._aggs[field] = {
      terms: {
        field: field,
        size: limit,
        show_term_doc_count_error: true,
        order: { _count: 'desc' },
        exclude: exclusions,
      },
    };
    // don't return any records; just aggregates
    this.limit(0);
    return this;
  }
  /**
   * Add an "aggs" entry for date histogram aggregation. Similar to COUNT(*) over a timer period with GROUP BY
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/6.3/search-aggregations-bucket-datehistogram-aggregation.html
   * @param {String} dateField  The date field
   * @param {String} intervalName  Interval of year, quarter, month, week, day, hour minute, second
   * @param {String|Number}  The timezone offset (e.g. 360 or "-06:00")
   * @return {QueryBuilder}
   * @chainable
   */
  dateHistogram(dateField: any, intervalName: any, timezone: any) {
    // see https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping-date-format.html
    const intervals = {
      year: { code: '1y', format: 'yyyy' },
      quarter: { code: '1q', format: 'yyyy-Q' },
      month: { code: '1M', format: 'yyyy-MM' },
      week: { code: '1w', format: 'xxxx-ww' },
      day: { code: '1d', format: 'yyyy-MM-dd' },
      hour: { code: '1H', format: 'yyyy-MM-ddTHH' },
      minute: { code: '1m', format: 'yyyy-MM-ddTHH:mm' },
      second: { code: '1s', format: 'yyyy-MM-ddTHH:mm:ss' },
    };
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    const interval = intervals[intervalName];
    if (!interval) {
      const supported = Object.keys(intervals).join(', ');
      throw new Error(
        `QueryBuilder.dateHistogram(): intervalName not supported. Supported intervals are ${supported}.`
      );
    }
    const timezoneString =
      typeof timezone === 'number'
        ? this._offsetIntToString(timezone)
        : timezone;
    if (!/^[+-]\d\d:\d\d$/.test(timezoneString)) {
      throw new Error(
        'QueryBuilder.dateHistogram(): timezone must be a numeric offset in minutes OR a string in the form "+02:00".'
      );
    }

    this._aggs[dateField] = {
      date_histogram: {
        field: dateField,
        interval: interval.code,
        // TODO: get timezone working?
        // Error: Field [published_by] of type [integer] does not support custom time zones
        time_zone: timezoneString,
        format: interval.format,
      },
    };
    // don't return any records; just the histogram
    this.limit(0);
    return this;
  }
  /**
   * Get a timezone string from integer offset
   * @example
   * 		360 => -06:00
   * 		-300 => +05:00
   * 		0 => +00:00
   * @param {Number} timezone
   * @return {String}
   */
  _offsetIntToString(offset: any) {
    const pad2 = (n: any) => `${n < 10 ? '0' : ''}${n}`;
    const timezone = offset * -1;
    // @ts-expect-error TS(2304): Cannot find name 'n'.
    const sign = n < 1 ? '-' : '+';
    const hour = Math.floor(timezone / 60);
    const min = timezone % 60;
    return `${sign}${pad2(hour)}:${pad2(min)}`;
  }

  /**
   * Set the max number of results to return
   * @param {Number} limit  The max
   * @return {QueryBuilder}
   * @chainable
   */
  limit(limit: any) {
    this._limit = limit;
    return this;
  }

  /**
   * Set the page of results to return
   * @param {Number} page  Where 1 is the first page
   * @return {QueryBuilder}
   * @chainable
   */
  page(page: any) {
    this._page = page;
    return this;
  }

  /**
   * Add a sort field
   * @param {String|Object} field  The field to sort by
   * @param {String|Object|Object[]} directionOrOptions  The direction, asc or desc or an array of direction options
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/current/sort-search-results.html
   * @return {QueryBuilder}
   * @chainable
   */
  sort(field: any, directionOrOptions = null) {
    // DESC string such as "-created_at"
    if (typeof field === 'string' && field.slice(0, 1) === '-') {
      // @ts-expect-error TS(2322): Type '"desc"' is not assignable to type 'null'.
      directionOrOptions = 'desc';
      field = field.slice(1);
    }
    if (
      // object such as {"order" : "asc", "format": "strict_date_optional_time_nanos"}
      typeof directionOrOptions === 'object' ||
      // the string "asc" or "desc"
      /^(asc|desc)$/i.test(directionOrOptions)
    ) {
      this._sorts.push({ [field]: directionOrOptions });
    } else {
      // keyword such as "_score"
      // or object such as { "name" : "desc" }
      this._sorts.push(field);
    }
    return this;
  }
  /**
   * Clear out a query property
   * @param {String} field  Valid values: sort, page, limit, must, mustNot, aggs, fields, highlighter, functionScore
   */
  clear(field: any) {
    if (field === 'sort') {
      this._sorts = [];
      this._sortByRandom = false;
    } else if (field === 'page') {
      this._page = 1;
    } else if (field === 'limit') {
      this._limit = null;
    } else if (field === 'must') {
      this._must = [];
    } else if (field === 'mustNot') {
      this._mustNot = [];
    } else if (field === 'aggs') {
      this._aggs = {};
    } else if (field === 'fields') {
      this._fields = [];
    } else if (field === 'highlighter') {
      this._highlighter = null;
    } else if (field === 'functionScore') {
      this._functionScore = null;
    }
  }
  /**
   * Enable or disable sorting by random
   * @param {Boolean} trueOrFalse
   * @return {QueryBuilder}
   * @chainable
   */
  sortByRandom(trueOrFalse = true) {
    this._sortByRandom = trueOrFalse;
    return this;
  }
  /**
   * Add a decay function score query
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/7.17/query-dsl-function-score-query.html#function-decay
   * @param {String} field  The name of the field to apply the decay function
   * @param {QueryBuilder} query  The QueryBuilder object to apply the function score to
   * @param {String} decayFunction  One of gauss, exp or linear
   * @param {Number} decayOffset  The central point from which distance is calculated
   * @param {String} decayScale  For dates, a scale in format such as 90d, 2M, 1y etc; For geo, can be distance in km
   * @param {Number} decayNumber  A number between 0 and 1 designating the rate of decay
   * @param {String} decayOrigin
   * @return {QueryBuilder}
   * @chainable
   */
  decayFunctionScore({
    field,

    // TODO: consider sticking the body of this instance into a function score instead
    query,

    decayFunction = 'gauss',
    decayOffset = 0,
    decayScale = '30d',
    decayNumber = 0.5,
    multiValueMode = undefined,
    decayOrigin = undefined
  }: any) {
    const functions = [
      {
        [decayFunction]: {
          [field]: {
            offset: decayOffset,
            scale: decayScale,
            decay: decayNumber,
            origin: decayOrigin,
          },
          multi_value_mode: multiValueMode,
        },
      },
    ];
    this._functionScore = {
      functions,
      query: query.getBody().query,
    };
    return this;
  }
  /**
   * Get the function score definition
   * @return {Array|null}
   */
  getFunctionScore() {
    return this._functionScore;
  }
  /**
   * Get the current array of must filters
   * @return {Array}
   */
  getMust() {
    return this._must;
  }
  /**
   * Require matching of a subquery
   * @param {QueryBuilder} subquery  The query object
   * @return {QueryBuilder}
   * @chainable
   */
  should(subquery: any) {
    this._must.push({
      bool: {
        should: subquery.getMust(),
      },
    });
    return this;
  }
  /**
   * Build a nested bool "must" query inside a bool "should"
   * @param {QueryBuilder[]} subqueries - An array of subqueries to add
   * @return {QueryBuilder}
   * @chainable
   */
  shouldAny(subqueries: any) {
    const shoulds = [];
    for (const query of subqueries) {
      shoulds.push({
        bool: {
          must: query.getMust(),
        },
      });
    }
    this._must.push({
      bool: {
        should: shoulds,
      },
    });
    return this;
  }
  /**
   * Require non matching of a subquery
   * @param {QueryBuilder} subquery  The query object
   * @return {QueryBuilder}
   * @chainable
   */
  shouldNot(subquery: any) {
    this._must.push({
      bool: {
        should: {
          bool: {
            must_not: subquery.getMust(),
          },
        },
      },
    });
    return this;
  }
  /**
   * Pass a highlight definition to use
   * @param {Object} value  The value of the "highlight" option
   * @return {QueryBuilder}
   * @chainable
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/7.17/highlighting.html
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/7.17/term-vector.html
   * @example
   * {
   *   order: 'score',
   *   fields: {
   *     'content_*.fulltext': {
   *       type: 'fvh',
   *       fragment_size: 100,
   *       number_of_fragments: 3,
   *     },
   *   },
   *   tags_schema: 'styled'
   * }
   */
  useHighlighter(value: any) {
    this._highlighter = value;
    return this;
  }
  /**
   * Return the fields we will fetch
   * @return {String[]}
   */
  getFields() {
    return this._fields;
  }
  /**
   * Return the query body
   * @return {Object}
   */
  getBody() {
    const body = {};
    if (this._must.length > 0) {
      // @ts-expect-error TS(2339): Property 'query' does not exist on type '{}'.
      body.query = { bool: { must: this._must } };
    }
    if (this._mustNot.length > 0) {
      // @ts-expect-error TS(2339): Property 'query' does not exist on type '{}'.
      if (!body.query) {
        // @ts-expect-error TS(2339): Property 'query' does not exist on type '{}'.
        body.query = { bool: {} };
      }
      // @ts-expect-error TS(2339): Property 'query' does not exist on type '{}'.
      body.query.bool.must_not = this._mustNot;
    }
    if (this._highlighter) {
      // @ts-expect-error TS(2339): Property 'highlight' does not exist on type '{}'.
      body.highlight = this._highlighter;
    }
    if (!isEmptyObject(this._aggs)) {
      // @ts-expect-error TS(2339): Property 'aggs' does not exist on type '{}'.
      body.aggs = this._aggs;
    }
    if (this._sortByRandom) {
      // @ts-expect-error TS(2339): Property 'query' does not exist on type '{}'.
      if (!body.query) {
        // @ts-expect-error TS(2339): Property 'query' does not exist on type '{}'.
        body.query = {};
      }
      // @ts-expect-error TS(2339): Property 'query' does not exist on type '{}'.
      body.query.function_score = {
        // @ts-expect-error TS(2339): Property 'query' does not exist on type '{}'.
        query: { bool: body.query.bool },
        // random_store must be an empty JSON object
        random_score: {},
      };
      // @ts-expect-error TS(2339): Property 'query' does not exist on type '{}'.
      body.query.bool = undefined;
    } else if (this._functionScore) {
      // @ts-expect-error TS(2339): Property 'query' does not exist on type '{}'.
      if (!body.query) {
        // @ts-expect-error TS(2339): Property 'query' does not exist on type '{}'.
        body.query = {};
      }
      // @ts-expect-error TS(2339): Property 'query' does not exist on type '{}'.
      body.query.function_score = this._functionScore;
    }
    return body;
  }
  /**
   * Return the "size" and "from" based on "limit" and page
   * @return {Object}
   */
  getOptions() {
    const options = {};
    if (this._limit !== null) {
      // @ts-expect-error TS(2339): Property 'size' does not exist on type '{}'.
      options.size = this._limit;
      if (this._page > 1) {
        // @ts-expect-error TS(2339): Property 'from' does not exist on type '{}'.
        options.from = this._limit * (this._page - 1);
      }
    }
    if (this._sorts.length > 0) {
      // @ts-expect-error TS(2339): Property 'sort' does not exist on type '{}'.
      options.sort = this._sorts;
    }
    return options;
  }
  /**
   * Get an object representation of the query body
   * suitable for the ElasticSearch SDK or Kibana
   * @return string
   */
  getQuery() {
    const source = this._fields.length > 0 ? { _source: this._fields } : {};
    return {
      ...source,
      ...this.getBody(),
      ...this.getOptions(),
    };
  }
  /**
   * For JSON serialization, simply use the value returned from getQuery()
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#tojson_behavior
   * @returns {String}
   */
  toJSON() {
    return this.getQuery();
  }
  /**
   * For getting value, simply use the value returned from getQuery()
   * @returns {String}
   */
  valueOf() {
    return this.getQuery();
  }
  /**
   * Get a full Kibana query string for the given query
   * @param {String} index  The index to pull the name from
   * @return {String}
   */
  toKibana(index: any) {
    const json = JSON.stringify(this.getQuery(), null, 4);
    return `GET ${index}/_search\n${json}`;
  }
}

function isEmptyObject(obj: any) {
  if (!obj) {
    // not an object
    return false;
  }
  for (const prop in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, prop)) {
      // not empty
      return false;
    }
  }
  return true;
}

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = QueryBuilder;
