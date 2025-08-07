import { estypes } from '@elastic/elasticsearch';
import {
  QueryDslDecayFunctionBase,
  QueryDslFunctionScoreContainer,
} from '@elastic/elasticsearch/lib/api/types';
import isEmptyObject from '../isEmptyObject/isEmptyObject';
import TextProcessor from '../TextProcessor/TextProcessor';
import {
  AggregatesType,
  AnyAllType,
  BodyType,
  BoostType,
  EsClientType,
  FieldTypeOrTypes,
  FilterType,
  FunctionScoreItemType,
  HighlightType,
  IntervalType,
  MatchType,
  MultiMatchType,
  OperatorType,
  RangeableType,
  RunResultType,
  SizeFromSort,
  SortType,
  SourceType,
} from '../types';

/**
 * Build ElasticSearch builder
 */
export default class QueryBuilder {
  /**
   * The fields to fetch
   */
  #fields: string[] = ['*'];

  /**
   * Fields to exclude from list
   */
  #excludeFields: string[] = [];

  /**
   * The must filters
   */
  #must: estypes.QueryDslQueryContainer[] = [];

  /**
   * The must_not filters
   */
  #mustNot: estypes.QueryDslQueryContainer[] = [];

  /**
   * The "aggs" to add to the builder
   */
  #aggs: estypes.SearchRequest['aggs'] = {};

  /**
   * The function score builder
   */
  #functionScores: QueryDslDecayFunctionBase[] = [];

  /**
   * The highlight definition
   */
  #highlighter: estypes.SearchRequest['highlight'] = null;

  /**
   * The max number of records to return
   */
  #limit: number = null;

  /**
   * The page of records to fetch
   */
  #page: number = 1;

  /**
   * Fields to sort by
   */
  #sorts: estypes.SearchRequest['sort'][] = [];

  /**
   * If true, use "random_score" for a function score
   */
  #sortByRandom: boolean = false;

  /**
   * Processes text passing into and coming from ElasticSearch
   * @private
   */
  #textProcessor: TextProcessor = new TextProcessor();

  /**
   * Process text going into and coming out of ElasticSearch
   * @param {TextProcessor} textProcessor
   * @return {QueryBuilder}
   */
  setTextProcessor(textProcessor: TextProcessor) {
    this.#textProcessor = textProcessor;
    return this;
  }

  /**
   * Set the fields to fetch
   * @param fields  The fields to select
   * @return This instance
   */
  fields(fields: string[]) {
    this.#fields = fields;
    return this;
  }

  /**
   * Set the fields to exclude
   * @param fields  The fields to exclude
   * @return This instance
   */
  excludeFields(fields: string[]) {
    this.#excludeFields = fields;
    return this;
  }

  /**
   * Append a multi_match condition to the given filter object (match any of the given values against the given fields)
   * @param filters  Either this.#must or this.#mustNot
   * @param fields  The name of the fields to search
   * @param valueOrValues  A value or array of possible values
   */
  #addMultiMatchAny(
    filters: FilterType[],
    fields: string[],
    valueOrValues: any | any[]
  ) {
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
   * @param filters  Either this.#must or this.#mustNot
   * @param fields  The name of the fields to search
   * @param value  A value
   */
  #addMultiTermAny(filters: FilterType[], fields: string[], value: any) {
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
   * Add a series of term condition to the given filter object (find full-word matches any of the given values against the given field)
   * @param filters  Either this.#must or this.#mustNot
   * @param fields  The name of the fields to search
   * @param value  A value to search for
   */
  #addMultiTermAll(filters: FilterType[], fields: string[], value: any) {
    for (const field of fields) {
      filters.push({
        term: {
          [field]: value,
        },
      });
    }
  }

  /**
   * Append filters to the given filter object (match any of the given values)
   * @param filters  Either this.#must or this.#mustNot
   * @param matchType  Either "match" or "term"
   * @param field  The name of the field to search
   * @param valueOrValues  A value or array of possible values
   */
  #addFilterAny(
    filters: FilterType[],
    matchType: 'match' | 'term',
    field: string,
    valueOrValues: any | any[]
  ) {
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
   * Append filters to the given filter object (match all the values given)
   * @param filters  Either this.#must or this.#mustNot
   * @param matchType  Either "match" or "term"
   * @param field  The name of the field to search
   * @param valueOrValues  A value or array of possible values
   */
  #addFilterAll(
    filters: FilterType[],
    matchType: MatchType,
    field: string,
    valueOrValues: any | any[]
  ) {
    if (!Array.isArray(valueOrValues)) {
      valueOrValues = [valueOrValues];
    }
    for (const value of valueOrValues) {
      filters.push({ [matchType]: { [field]: value } });
    }
  }

  /**
   * Append a multi_match condition to the given filter object (match any of the given values against the given fields)
   * @param filters  Either this.#must or this.#mustNot
   * @param fields  The name of the fields to search
   * @param valueOrValues  A value or array of possible values
   */
  #addMultiMatchAll(
    filters: FilterType[],
    fields: string[],
    valueOrValues: any | any[]
  ) {
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
   * Append filters for the given range expression
   * @param filters  Either this.#must or this.#mustNot
   * @param field  The name of the field to search
   * @param op  One of the following: > < >= <= gt lt gte lte between
   * @param value  The limit(s) to search against
   */
  #addRange(
    filters: FilterType[],
    field: string,
    op: OperatorType,
    value: RangeableType
  ) {
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
    const opName = ops[op] || op.toLowerCase();
    filters.push({
      range: {
        [field]: { [opName]: value },
      },
    });
  }

  /**
   * Add a full-text matching condition
   * @param field  The name of the field to search
   * @param valueOrValues  A value or array of possible values
   * @param type  Use "ALL" to require document to contain all values, otherwise match any value
   * @return {QueryBuilder}
   * @chainable
   */
  match(
    field: string,
    valueOrValues: string | string[],
    type: AnyAllType = 'ANY'
  ) {
    valueOrValues = this.#textProcessor.processText(valueOrValues);
    if (type.toUpperCase() === 'ALL') {
      this.#addFilterAll(this.#must, 'match', field, valueOrValues);
    } else {
      this.#addFilterAny(this.#must, 'match', field, valueOrValues);
    }
    return this;
  }

  /**
   * Add a full-text phrase matching condition
   * @param field  The name of the field to search
   * @param phraseOrPhrases  A value or array of possible phrase values
   * @return {QueryBuilder}
   * @chainable
   */
  matchPhrase(field: string, phraseOrPhrases: string | string[]) {
    phraseOrPhrases = this.#textProcessor.processText(phraseOrPhrases);
    if (!Array.isArray(phraseOrPhrases)) {
      phraseOrPhrases = [phraseOrPhrases];
    }
    const terms = [];
    for (const phrase of phraseOrPhrases) {
      terms.push({ match_phrase: { [field]: phrase } });
    }
    if (terms.length === 1) {
      this.#must.push(terms[0]);
    } else {
      this.#must.push({ bool: { should: terms } });
    }
    return this;
  }

  /**
   * Add a full-text phrase prefix matching condition
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/6.8/query-dsl-match-query-phrase-prefix.html
   * @param fieldOrFields  The name of the field to search
   * @param phraseOrPhrases  A value or array of possible phrase values
   * @return {QueryBuilder}
   * @chainable
   */
  matchPhrasePrefix(
    fieldOrFields: string | string[],
    phraseOrPhrases: string | string[]
  ) {
    phraseOrPhrases = this.#textProcessor.processText(phraseOrPhrases);
    if (!Array.isArray(phraseOrPhrases)) {
      phraseOrPhrases = [phraseOrPhrases];
    }
    if (Array.isArray(fieldOrFields)) {
      // we want to do a phrase prefix on more than one fields
      // so we multi_match with a phrase_prefix type
      const clauses = [];
      for (const phrase of phraseOrPhrases) {
        clauses.push({
          multi_match: {
            fields: fieldOrFields,
            type: 'phrase_prefix',
            query: phrase,
          },
        });
      }
      if (clauses.length === 1) {
        this.#must.push(clauses[0]);
      } else {
        this.#must.push({ bool: { should: clauses } });
      }
      return this;
    }
    // fieldOrFields is a string so we can use match_phrase_prefix directly
    const clauses = [];
    for (const phrase of phraseOrPhrases) {
      clauses.push({ match_phrase_prefix: { [fieldOrFields]: phrase } });
    }
    if (clauses.length === 1) {
      this.#must.push(clauses[0]);
    } else {
      this.#must.push({ bool: { should: clauses } });
    }
    return this;
  }

  /**
   * Match a term with boosted relevancy for exact phrases and "AND" matches.
   * This approach is described in the "Combining OR, AND, and match phrase queries" section of
   * https://www.elastic.co/blog/how-to-improve-elasticsearch-search-relevance-with-boolean-queries
   * It gives more weight to the phrase as a whole so results with the whole phrase will be higher
   * in the results.
   * @param fieldOrFields  The names of the fields to search (often ['content_*.fulltext'])
   * @param termOrTerms  The search phrase or phrases (often ['my search here'])
   * @param options  Additional options
   * @property options.expand  If true, also match with "OR" but at a lower relevance (default true)
   * @property options.boosts  The boosts for "OR", "AND", then "phrase" (default [1,3,5])
   * @return {QueryBuilder}
   * @chainable
   */
  matchBoostedPhrase(
    fieldOrFields: string | string[],
    termOrTerms: string | string[],
    options: BoostType = {}
  ) {
    const fields = Array.isArray(fieldOrFields)
      ? fieldOrFields
      : [fieldOrFields];
    const terms = Array.isArray(termOrTerms) ? termOrTerms : [termOrTerms];
    // enumerate options
    const expand = 'expand' in options ? options.expand : true;
    const boosts = options.boosts || [1, 3, 5];
    // build subquery
    const subquery = new QueryBuilder();
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
    // TODO: if fieldOrFields is a string with a dot, use a nested multi_match like this:
    /*
      should: [
        // OR match on fulltext_* fields
        {
          multi_match: {
            fields: ['fulltext_*'],
            operator: 'or',
            builder: 'Sports medicine doctor',
            boost: 1,
          },
        },

        // AND match on fulltext_* fields
        {
          multi_match: {
            fields: ['fulltext_*'],
            operator: 'and',
            builder: 'Sports medicine doctor',
            boost: 3,
          },
        },

        // PHRASE match on fulltext_* fields
        {
          multi_match: {
            fields: ['fulltext_*'],
            type: 'phrase',
            builder: 'Sports medicine doctor',
            boost: 5,
          },
        },

        // OR match in nested categories.value
        {
          nested: {
            path: 'categories',
            builder: {
              match: {
                'categories.value': {
                  builder: 'Sports medicine doctor',
                  operator: 'or',
                },
              },
            },
            boost: 1,
          },
        },

        // AND match in nested categories.value
        {
          nested: {
            path: 'categories',
            builder: {
              match: {
                'categories.value': {
                  builder: 'Sports medicine doctor',
                  operator: 'and',
                },
              },
            },
            boost: 3,
          },
        },

        // PHRASE match in nested categories.value
        {
          nested: {
            path: 'categories',
            builder: {
              match_phrase: {
                'categories.value': {
                  builder: 'Sports medicine doctor',
                },
              },
            },
            boost: 5,
          },
        },
      ],

     */
    return this;
  }

  /**
   * Add a full-text matching condition across multiple fields
   * @param fields  The names of the fields to search. Wildcards such as content_* are allowed.
   * @param valueOrValues  A value or array of possible values
   * @param type  Use "ALL" to require document to contain all values, otherwise match any value
   * @return {QueryBuilder}
   * @chainable
   */
  multiMatch(
    fields: string[],
    valueOrValues: string | string[],
    type: AnyAllType = 'ANY'
  ) {
    if (type.toUpperCase() === 'ALL') {
      this.#addMultiMatchAll(this.#must, fields, valueOrValues);
    } else {
      this.#addMultiMatchAny(this.#must, fields, valueOrValues);
    }
    return this;
  }

  /**
   * Create a basic multi_match clause and add any of the available options.
   * than they would be in a regular multi_match builder
   * See the "Combining OR, AND, and match phrase queries" section of https://www.elastic.co/blog/how-to-improve-elasticsearch-search-relevance-with-boolean-queries.
   * @param fieldOrFields The field(s) to search
   * @param valueOrValues  The value(s) to match on
   * @param options  Additional options, including `type`, `analyzer`, `boost`, `operator`, `minimum_should_match`, `fuzziness`, `lenient`, `prefix_length`, `max_expansions`, `fuzzy_rewrite`, `zero_terms_query`, `cutoff_frequency`, and `fuzzy_transpositions`
   * @return {QueryBuilder}
   * @chainable
   */
  multiMatchWithPhrase(
    fieldOrFields: string | string[],
    valueOrValues: string | string[],
    options: MultiMatchType = {}
  ) {
    const fields = Array.isArray(fieldOrFields)
      ? fieldOrFields
      : [fieldOrFields];
    const values = Array.isArray(valueOrValues)
      ? valueOrValues
      : [valueOrValues];
    for (const value of values) {
      const baseMultiMatch = {
        fields,
        query: this.#textProcessor.processText(value),
      };
      this.#must.push({
        multi_match: { ...baseMultiMatch, ...options },
      });
    }
    return this;
  }

  /**
   * Add a keyword matching condition across multiple fields
   * @param fields  The names of the fields to search. Wildcards are not allowed.
   * @param value  A value to search for
   * @param type  Use "ALL" to require all fields to contain the value, otherwise match any value
   * @return {QueryBuilder}
   * @chainable
   */
  multiTerm(fields: string[], value: any, type: AnyAllType = 'ANY') {
    if (type.toUpperCase() === 'ALL') {
      this.#addMultiTermAll(this.#must, fields, value);
    } else {
      this.#addMultiTermAny(this.#must, fields, value);
    }
    return this;
  }

  /**
   * Add a negative full-text matching condition
   * @param field  The name of the field to search
   * @param valueOrValues  A value or array of possible values to reject
   * @return {QueryBuilder}
   * @chainable
   */
  notMatch(field: string, valueOrValues: any | any[]) {
    this.#addFilterAny(this.#mustNot, 'match', field, valueOrValues);
    return this;
  }

  /**
   * Add a negative full-text matching condition across multiple fields
   * @param fields  The names of the fields to search
   * @param valueOrValues  A value or array of possible values to reject
   * @return {QueryBuilder}
   * @chainable
   */
  notMultiMatch(fields: string[], valueOrValues: any | any[]) {
    this.#addMultiMatchAny(this.#mustNot, fields, valueOrValues);
    return this;
  }

  /**
   * Add a negative keyword matching condition across multiple fields
   * @param fields  The names of the fields to search. Wildcards are not allowed.
   * @param value  A value to reject
   * @return {QueryBuilder}
   * @chainable
   */
  notMultiTerm(fields: string[], value: any) {
    this.#addMultiTermAny(this.#mustNot, fields, value);
    return this;
  }

  /**
   * Add an exact matching condition
   * @param field  The name of the field to search
   * @param valueOrValues  A value or array of possible values
   * @param type  Use "ALL" to require document to contain all values, otherwise match any value
   * @return {QueryBuilder}
   * @chainable
   */
  term(field: string, valueOrValues: any | any[], type: AnyAllType = 'ANY') {
    if (valueOrValues === null) {
      this.notExists(field);
    } else if (type.toUpperCase() === 'ALL') {
      this.#addFilterAll(this.#must, 'term', field, valueOrValues);
    } else {
      this.#addFilterAny(this.#must, 'term', field, valueOrValues);
    }
    return this;
  }

  /**
   * Require that the given field or fields contain values (i.e. non-missing, non-null)
   * @param fieldOrFields  The name or names of the fields
   * @returns {QueryBuilder}
   */
  exists(fieldOrFields: string | string[]) {
    const fields = Array.isArray(fieldOrFields)
      ? fieldOrFields
      : [fieldOrFields];
    for (const field of fields) {
      this.#must.push({ exists: { field } });
    }
    return this;
  }

  /**
   * Require that the given field or fields contain no values (i.e. missing or null)
   * @param fieldOrFields  The name or names of the fields
   * @returns {QueryBuilder}
   */
  notExists(fieldOrFields: string | string[]) {
    const fields = Array.isArray(fieldOrFields)
      ? fieldOrFields
      : [fieldOrFields];
    for (const field of fields) {
      this.#mustNot.push({ exists: { field } });
    }
    return this;
  }

  /**
   * Add a Lucene expression condition
   * @param fieldOrFields  The name of the field(s) to search
   * @param query A builder string containing special operators such as AND, NOT, OR, ~, *
   * @return {QueryBuilder}
   * @chainable
   */
  queryString(fieldOrFields: string | string[], query: string) {
    const fields = Array.isArray(fieldOrFields)
      ? fieldOrFields
      : [fieldOrFields];
    this.#must.push({
      query_string: {
        fields: fields,
        query: query,
      },
    });
    return this;
  }

  /**
   * Add a negative exact matching condition
   * @param field  The name of the field to search
   * @param valueOrValues  A value or array of possible values to reject
   * @return {QueryBuilder}
   * @chainable
   */
  notTerm(field: string, valueOrValues: any | any[]) {
    this.#addFilterAny(this.#mustNot, 'match', field, valueOrValues);
    return this;
  }

  /**
   * Add a numeric range matching condition
   * @param field  The name of the field to search
   * @param op  One of the following: > < >= <= gt lt gte lte between
   * @param value  A string or number to search against
   * @return {QueryBuilder}
   * @chainable
   */
  range(field: string, op: OperatorType, value: RangeableType) {
    this.#addRange(this.#must, field, op, value);
    return this;
  }

  /**
   * Add a numeric range negative matching condition
   * @param field  The name of the field to search
   * @param op  One of the following: > < >= <= gt lt gte lte between
   * @param value  A value to search against@return {QueryBuilder}
   * @return {QueryBuilder}
   * @chainable
   */
  notRange(field: string, op: OperatorType, value: RangeableType) {
    this.#addRange(this.#mustNot, field, op, value);
    return this;
  }

  /**
   * Return faceted data using ElasticSearch's "aggregation" feature
   * @param forFields  The names of fields to aggregate into buckets. Can be a list of strings or an object of label-field pairs
   * @param limit  The maximum number of buckets to return for each facet before an "other" option
   * @return {QueryBuilder}
   * @chainable
   */
  includeFacets(forFields: string[] | Object, limit: number = 25) {
    let entries;
    if (Array.isArray(forFields)) {
      entries = forFields.map(field => [field, field]);
    } else {
      entries = Object.entries(forFields);
    }
    for (const [name, field] of entries) {
      this.#aggs[name] = {
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
   * @param field  The field to group by
   * @param limit  The maximum number of counts to return (default 10)
   * @param exclusions  Values that should be excluded from the counts (default [])
   * @return {QueryBuilder}
   * @chainable
   */
  aggregateTerm(field: string, limit: number = 10, exclusions: any[] = []) {
    this.#aggs[field] = {
      terms: {
        field: field,
        size: limit,
        show_term_doc_count_error: true,
        order: { _count: 'desc' },
        exclude: exclusions,
      },
    };
    // use limit to return no records, just counts
    this.limit(0);
    return this;
  }

  /**
   * Add an "aggs" entry for date histogram aggregation. Similar to COUNT(*) over a timer period with GROUP BY
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/6.3/search-aggregations-bucket-datehistogram-aggregation.html
   * @param dateField  The date field
   * @param intervalName  Interval of year, quarter, month, week, day, hour minute, second
   * @param timezone  The timezone offset (e.g. 360 or "-06:00")
   * @returns This instance
   * @chainable
   */
  dateHistogram(
    dateField: string,
    intervalName: IntervalType,
    timezone: string | number
  ) {
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
    const interval = intervals[intervalName];
    if (!interval) {
      const supported = Object.keys(intervals).join(', ');
      throw new Error(
        `QueryBuilder.dateHistogram(): intervalName not supported. Supported intervals are ${supported}.`
      );
    }
    const timezoneString =
      typeof timezone === 'number'
        ? this.#offsetIntToString(timezone)
        : timezone;
    if (!/^[+-]\d\d:\d\d$/.test(timezoneString)) {
      throw new Error(
        'QueryBuilder.dateHistogram(): timezone must be a numeric offset in minutes OR a string in the form "+02:00".'
      );
    }

    this.#aggs[dateField] = {
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
   *    360 => -06:00
   *    -300 => +05:00
   *    0 => +00:00
   * @param offset
   */
  #offsetIntToString(offset) {
    const pad2 = n => `${n < 10 ? '0' : ''}${n}`;
    const timezone = offset * -1;
    const sign = offset < 1 ? '-' : '+';
    const hour = Math.floor(timezone / 60);
    const min = timezone % 60;
    return `${sign}${pad2(hour)}:${pad2(min)}`;
  }

  /**
   * Set the max number of results to return
   * @param limit  The max
   * @return {QueryBuilder}
   * @chainable
   */
  limit(limit: number) {
    this.#limit = limit;
    return this;
  }

  /**
   * Set the page of results to return
   * @param page  Where 1 is the first page
   * @return {QueryBuilder}
   * @chainable
   */
  page(page: number) {
    this.#page = page;
    return this;
  }

  /**
   * Add a sort field
   * @param field  The field to sort by
   * @param  directionOrOptions  The direction, asc or desc or an array of direction options
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/current/sort-search-results.html
   * @return {QueryBuilder}
   * @chainable
   * @examples:
   *   qb.sort('-created_at');
   *   qb.sort('created_at', 'desc');
   *   qb.sort('_score');
   *   qb.sort({ created_at: 'desc' });
   *   qb.sort([ { name: 'asc' }, { created_at: 'desc' } ]);
   */
  sort(
    field: string | SortType,
    directionOrOptions: string | object | object[] = null
  ) {
    // DESC string such as "-created_at"
    if (typeof field === 'string' && field.slice(0, 1) === '-') {
      directionOrOptions = 'desc';
      field = field.slice(1);
    }
    if (
      // object such as {"order" : "asc", "format": "strict_date_optional_time_nanos"}
      typeof directionOrOptions === 'object' ||
      // the string "asc" or "desc"
      /^(asc|desc)$/i.test(directionOrOptions)
    ) {
      this.#sorts.push({ [field as string]: directionOrOptions } as SortType);
    } else {
      // keyword such as "_score"
      // or object such as { "name" : "desc" }
      this.#sorts.push(field as SortType);
    }
    return this;
  }

  /**
   * Clear out one or more builder properties
   * @param field  Valid values: sort, page, limit, must, mustNot, aggs, fields, highlighter, functionScore, textProcessor
   */
  clear(field: FieldTypeOrTypes = null) {
    const all: FieldTypeOrTypes = [
      'sort',
      'page',
      'limit',
      'must',
      'mustNot',
      'aggs',
      'fields',
      'excludeFields',
      'highlighter',
      'functionScores',
      'textProcessor',
    ];
    if (field === null) {
      field = all;
    }
    if (Array.isArray(field)) {
      field.forEach(name => this.clear(name));
    } else if (field === 'sort') {
      this.#sorts = [];
      this.#sortByRandom = false;
    } else if (field === 'page') {
      this.#page = 1;
    } else if (field === 'limit') {
      this.#limit = null;
    } else if (field === 'must') {
      this.#must = [];
    } else if (field === 'mustNot') {
      this.#mustNot = [];
    } else if (field === 'aggs') {
      this.#aggs = {};
    } else if (field === 'fields') {
      this.#fields = [];
    } else if (field === 'excludeFields') {
      this.#excludeFields = [];
    } else if (field === 'highlighter') {
      this.#highlighter = null;
    } else if (field === 'functionScores') {
      this.#functionScores = [];
    } else if (field === 'textProcessor') {
      this.#textProcessor = new TextProcessor();
    }
  }

  /**
   * Enable or disable sorting by random
   * @param trueOrFalse
   * @return {QueryBuilder}
   * @chainable
   */
  sortByRandom(trueOrFalse: boolean = true) {
    this.#sortByRandom = trueOrFalse;
    return this;
  }

  /**
   * Add a decay function score builder
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/7.17/query-dsl-function-score-query.html#function-decay
   * @return {QueryBuilder}
   * @chainable
   */
  decayFunctionScore(functionScore: estypes.QueryDslDecayFunctionBase) {
    this.#functionScores.push(functionScore);
    return this;
  }

  /**
   * Get the function score definition
   * @return
   */
  getFunctionScores() {
    return this.#functionScores;
  }

  /**
   * Get the current array of "must" filters
   * @return
   */
  getMust(): Record<string, any> {
    return this.#must;
  }

  /**
   * Require matching of a subquery
   * @param subquery  The builder object
   * @return This instance
   * @chainable
   */
  should(subquery: QueryBuilder) {
    this.#must.push({
      bool: {
        should: subquery.getMust(),
      },
    });
    return this;
  }

  /**
   * Build a nested bool "must" builder inside a bool "should"
   * @param subqueries - An array of subqueries to add
   * @return This instance
   * @chainable
   */
  shouldAny(subqueries: QueryBuilder[]) {
    const shoulds = [];
    for (const query of subqueries) {
      shoulds.push({
        bool: {
          must: query.getMust(),
        },
      });
    }
    this.#must.push({
      bool: {
        should: shoulds,
      },
    });
    return this;
  }

  /**
   * Require non-matching of a subquery
   * @param subquery  The builder object
   * @return This instance
   * @chainable
   */
  shouldNot(subquery: QueryBuilder) {
    this.#must.push({
      bool: {
        should: {
          bool: {
            must_not: subquery.getMust(),
          } as estypes.QueryDslBoolQuery,
        },
      },
    });
    return this;
  }

  /**
   * Pass a highlight definition to use
   * @param value  The value of the "highlight" option
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
  useHighlighter(value: estypes.SearchRequest['highlight']) {
    this.#highlighter = value;
    return this;
  }

  /**
   * Return the fields we will fetch
   * @return
   */
  getFields(): string[] {
    return this.#fields;
  }

  /**
   * Run this builder using the given client object and index name
   * @param client
   * @param index
   */
  async run(client: EsClientType, index: string): Promise<RunResultType> {
    let result = null;
    let error = null;
    try {
      result = await client.search({
        index: index,
        body: this.getBody(),
      });
      return { result, error };
    } catch (e) {
      error = e as Error;
      return { result: null, error };
    } finally {
      try {
        // Only try to close the client if it has a close method
        if (client && typeof client.close === 'function') {
          await client.close().catch((e: Error) => {
            console.error(
              'Error closing Elasticsearch client in QueryBuilder:',
              e
            );
          });
        }
      } catch (e) {
        console.error(
          'Unexpected error when closing Elasticsearch client in QueryBuilder:',
          e
        );
      }
    }
  }

  /**
   * Return the builder body
   * @return {Object}
   */
  getBody() {
    const body: Pick<estypes.SearchRequest, 'query' | 'highlight' | 'aggs'> =
      {};
    if (this.#must.length > 0) {
      body.query = { bool: { must: this.#must } as estypes.QueryDslBoolQuery };
    }
    if (this.#mustNot.length > 0) {
      if (!body.query) {
        body.query = { bool: {} as estypes.QueryDslBoolQuery };
      }
      body.query.bool.must_not = this.#mustNot;
    }
    if (this.#highlighter) {
      body.highlight = this.#highlighter;
    }
    if (!isEmptyObject(this.#aggs)) {
      body.aggs = this.#aggs;
    }
    if (this.#sortByRandom) {
      if (!body.query) {
        body.query = {};
      }
      body.query.function_score = {
        query: { bool: body.query.bool },
        // random_store must be an empty JSON object
        random_score: {},
      } as estypes.QueryDslFunctionScoreQuery;
      body.query.bool = undefined;
    }
    // if (this.#functionScores.length > 0) {
    //   body.functions = this.#functionScores.map(
    //     ({
    //       field,
    //       decayFunction,
    //       decayOffset,
    //       decayScale,
    //       decayNumber,
    //       decayOrigin,
    //       multiValueMode,
    //     }) => {
    //       return {
    //         [decayFunction]: {
    //           [field]: {
    //             offset: decayOffset,
    //             scale: decayScale,
    //             decay: decayNumber,
    //             origin: decayOrigin,
    //           },
    //           multi_value_mode: multiValueMode,
    //         },
    //       };
    //     }
    //   );
    // }
    return body;
  }

  /**
   * Return the "size" and "from" based on "limit" and "page"
   * @return The options to send in the builder
   */
  getOptions(): Pick<estypes.SearchRequest, 'size' | 'from' | 'sort'> {
    const options = {} as SizeFromSort;
    if (this.#limit !== null) {
      options.size = this.#limit;
      if (this.#page > 1) {
        options.from = this.#limit * (this.#page - 1);
      }
    }
    if (this.#sorts.length > 0) {
      options.sort = this.#sorts;
    }
    return options;
  }

  /**
   * Get an object representation of the builder body
   * suitable for the Elasticsearch SDK or Kibana
   * @return {Object}
   */
  getQuery(
    overrides: Partial<estypes.SearchRequest> = {}
  ): estypes.SearchRequest {
    const source: Pick<estypes.SearchRequest, '_source' | '_source_excludes'> =
      {};
    if (this.#fields.length > 0) {
      source._source = this.#fields;
    }
    if (this.#excludeFields.length > 0) {
      source._source_excludes = this.#excludeFields;
    }
    return {
      ...source,
      ...this.getBody(),
      ...this.getOptions(),
      ...overrides,
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
   */
  valueOf() {
    return this.getQuery();
  }

  /**
   * Get a full Kibana builder string for the given builder
   * @param {String} index  The index to pull the name from
   * @return {String}
   */
  toKibana(index: string): string {
    const json = JSON.stringify(this.getQuery(), null, 4);
    return `GET ${index}/_search\n${json}`;
  }
}
