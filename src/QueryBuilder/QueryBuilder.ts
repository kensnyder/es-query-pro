import { estypes } from '@elastic/elasticsearch'; // TypeScript needs this even if we don't use it
import isEmptyObject from '../isEmptyObject/isEmptyObject';
import NestedFieldsProcessor from '../NestedFieldsProcessor/NestedFieldsProcessor';
import TextProcessor from '../TextProcessor/TextProcessor';
import {
  AnyAllType,
  BoolQueryShape,
  BoostType,
  FieldTypeOrTypes,
  FunctionScoreShape,
  IntervalType,
  MatchType,
  MoreLikeThisLikeParams,
  MoreLikeThisOptions,
  MultiMatchQueryShape,
  OperatorType,
  Prettify,
  QueryShape,
  RangeShape,
  RetrieverContainer,
  SearchRequestShape,
  SortShape,
} from '../types';

export type QueryBuilderBody = QueryBuilder['getBody'];

/**
 * Build ElasticSearch builder (ElasticSearch 9 only)
 */
export default class QueryBuilder {
  public textProcessor: TextProcessor;
  public nestedFieldsProcessor: NestedFieldsProcessor;
  /**
   * The index to query from
   */
  private _index: string;
  /**
   * The fields to fetch
   */
  private _fields: string[] = ['*'];

  /**
   * Fields to exclude from list
   */
  private _excludeFields: string[] = [];

  /**
   * The must filters
   */
  private _must: QueryShape[] = [];

  /**
   * The must_not filters
   */
  private _mustNot: QueryShape[] = [];

  /**
   * The "aggs" to add to the builder
   */
  private _aggs: SearchRequestShape['aggs'] = {};

  /**
   * The function score builder
   */
  private _functionScores: FunctionScoreShape[] = [];

  /**
   * The highlight definition
   */
  private _highlighter: SearchRequestShape['highlight'] = null;

  /**
   * The max number of records to return
   */
  private _limit: number = null;

  /**
   * The page of records to fetch
   */
  private _page: number = 1;

  /**
   * Fields to sort by
   */
  private _sorts: SortShape[] = [];

  /** Retrievers to use */
  private _retrievers: estypes.LinearRetriever['retrievers'] = [];

  /** type of normalizer for retrievers */
  private _normalizer: 'minmax' | 'l2_norm' | 'none' = 'minmax';

  /** The number of results to find before ranking */
  private _rankWindowSize = 50;

  /** How much to consider lower ranking content, on a scale of 0-100 */
  private _rankConstant = 20;

  /** Optional rescore phase */
  private _rescore: SearchRequestShape['rescore'] = undefined;

  /** Optional minimum score */
  private _minScore: number = undefined;

  /**
   * If true, use "random_score" for a function score
   */
  private _shouldSortByRandom: boolean = false;

  constructor({
    textProcessor = new TextProcessor(),
    nestedSeparator = '/',
    index,
  }: {
    textProcessor?: TextProcessor;
    nestedSeparator?: string;
    index?: string;
  } = {}) {
    this.textProcessor = textProcessor;
    this.nestedFieldsProcessor = new NestedFieldsProcessor(nestedSeparator);
    this._index = index;
  }

  /**
   * Set the index name (optional)
   * @param name
   */
  index(name: string) {
    this._index = name;
    return this;
  }

  /**
   * Set the fields to fetch
   * @param fields  The fields to select
   * @return This instance
   */
  fields(fields: string[]) {
    this._fields = fields;
    return this;
  }

  /**
   * Set rank_window_size
   * @param size
   */
  rankWindowSize(size: number) {
    this._rankWindowSize = size;
    return this;
  }

  /**
   * Set rank_constant
   * @param constant
   */
  rankConstant(constant: number) {
    this._rankConstant = constant;
    return this;
  }

  /**
   * Set the fields to exclude
   * @param fields  The fields to exclude
   * @return This instance
   */
  excludeFields(fields: string[]) {
    this._excludeFields = fields;
    return this;
  }

  /**
   * Append a multi_match condition to the given filter object (match any of the given values against the given fields)
   * @param filters  Either this._must or this._mustNot
   * @param fields  The name of the fields to search
   * @param valueOrValues  A value or array of possible values
   */
  addMultiMatchAny(
    filters: QueryShape[],
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
   * @param filters  Either this._must or this._mustNot
   * @param fields  The name of the fields to search
   * @param value  A value
   */
  addMultiTermAny(filters: QueryShape[], fields: string[], value: any) {
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
   * @param filters  Either this._must or this._mustNot
   * @param fields  The name of the fields to search
   * @param value  A value to search for
   */
  addMultiTermAll(filters: QueryShape[], fields: string[], value: any) {
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
   * @param filters  Either this._must or this._mustNot
   * @param matchType  Either "match" or "term"
   * @param field  The name of the field to search
   * @param valueOrValues  A value or array of possible values
   */
  addFilterAny(
    filters: QueryShape[],
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
      if (matchType === 'match') {
        terms.push({ match: { [field]: value } });
      } else {
        terms.push({ term: { [field]: value } });
      }
    }
    if (terms.length === 1) {
      filters.push(terms[0]);
    } else {
      // Don't include minimum_should_match for OR queries to match test expectations
      filters.push({ bool: { should: terms } });
    }
  }

  /**
   * Append filters to the given filter object (match all the values given)
   * @param filters  Either this._must or this._mustNot
   * @param matchType  Either "match" or "term"
   * @param field  The name of the field to search
   * @param valueOrValues  A value or array of possible values
   */
  addFilterAll(
    filters: QueryShape[],
    matchType: MatchType,
    field: string,
    valueOrValues: any | any[]
  ) {
    if (!Array.isArray(valueOrValues)) {
      valueOrValues = [valueOrValues];
    }
    for (const value of valueOrValues) {
      if (matchType === 'match') {
        filters.push({ match: { [field]: value } });
      } else {
        filters.push({ [matchType]: { [field]: value } });
      }
    }
  }

  /**
   * Append a multi_match condition to the given filter object (match any of the given values against the given fields)
   * @param filters  Either this._must or this._mustNot
   * @param fields  The name of the fields to search
   * @param valueOrValues  A value or array of possible values
   */
  addMultiMatchAll(
    filters: QueryShape[],
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
   * @param filters  Either this._must or this._mustNot
   * @param field  The name of the field to search
   * @param op  One of the following: > < >= <= gt lt gte lte between
   * @param value  The limit(s) to search against
   */
  addRange(
    filters: QueryShape[],
    field: string,
    op: OperatorType,
    value: RangeShape
  ) {
    // Map operator aliases to their canonical form
    const opMap: Record<string, string> = {
      '<': 'lt',
      lt: 'lt',
      '<=': 'lte',
      lte: 'lte',
      '>': 'gt',
      gt: 'gt',
      '>=': 'gte',
      gte: 'gte',
      between: 'between',
    };

    const normalizedOp = op.toLowerCase();
    let opName = opMap[normalizedOp] || normalizedOp;
    if (opName === 'between' && Array.isArray(value)) {
      if (!value[0] && !value[1]) {
        return this;
      }
      if (!value[0]) {
        opName = 'lt';
        value = value[0];
      }
      if (!value[1]) {
        opName = 'gt';
        value = value[1];
      }
    }
    if (opName === 'between' && Array.isArray(value)) {
      // Handle 'between' operator with array of [min, max]
      filters.push({
        range: {
          [field]: {
            gte: value[0],
            lte: value[1],
          },
        },
      });
    } else if (opName in opMap) {
      // Handle standard comparison operators
      filters.push({
        range: {
          [field]: { [opName]: value },
        },
      });
    } else {
      // Fallback for unknown operators
      throw new Error(`Unsupported range operator: ${op}`);
    }
    return this;
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
    const values = Array.isArray(valueOrValues)
      ? valueOrValues.map(v => this.textProcessor.processText(v))
      : [this.textProcessor.processText(valueOrValues)];
    if (type.toUpperCase() === 'ALL') {
      this.addFilterAll(this._must, 'match', field, values);
    } else {
      this.addFilterAny(this._must, 'match', field, values);
    }
    return this;
  }

  /**
   * Add a full-text phrase matching condition
   * @param field  The name of the field to search
   * @param phraseOrPhrases  A value or array of possible phrase values
   * @param options  Options for phrase matching (e.g., slop for word proximity)
   * @return {QueryBuilder}
   * @chainable
   */
  matchPhrase(
    field: string,
    phraseOrPhrases: string | string[],
    options: { slop?: number } = {}
  ) {
    const phrases = Array.isArray(phraseOrPhrases)
      ? phraseOrPhrases.map(v => this.textProcessor.processText(v))
      : [this.textProcessor.processText(phraseOrPhrases)];

    const terms = [];
    for (const phrase of phrases) {
      terms.push({
        match_phrase: {
          [field]: {
            query: phrase,
            slop: options.slop || 0,
          },
        },
      });
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
   * @param fieldOrFields  The name of the field to search
   * @param phraseOrPhrases  A value or array of possible phrase values
   * @return {QueryBuilder}
   * @chainable
   */
  matchPhrasePrefix(
    fieldOrFields: string | string[],
    phraseOrPhrases: string | string[]
  ) {
    const phrases = Array.isArray(phraseOrPhrases)
      ? phraseOrPhrases.map(v => this.textProcessor.processText(v))
      : [this.textProcessor.processText(phraseOrPhrases)];
    if (Array.isArray(fieldOrFields)) {
      // we want to do a phrase prefix on more than one fields
      // so we multi_match with a phrase_prefix type
      const clauses = [];
      for (const phrase of phrases) {
        clauses.push({
          multi_match: {
            fields: fieldOrFields,
            type: 'phrase_prefix',
            query: phrase,
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
    for (const phrase of phrases) {
      clauses.push({ match_phrase_prefix: { [fieldOrFields]: phrase } });
    }
    if (clauses.length === 1) {
      this._must.push(clauses[0]);
    } else {
      this._must.push({ bool: { should: clauses } });
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
   * @param term  The search phrase
   * @param boostOptions  Additional options
   * @property boostOptions.expand  If true, also match with "OR" but at a lower relevance (default true)
   * @property boostOptions.boosts  The boosts for "OR", "AND", then "phrase" (default [1,3,5])
   * @return {QueryBuilder}
   * @chainable
   */
  matchBoostedPhrase(
    fieldOrFields: string | string[],
    term: string,
    boostOptions: BoostType = {}
  ) {
    term = this.textProcessor.processText(term);
    const expand = 'expand' in boostOptions ? boostOptions.expand : true;
    const boosts = boostOptions.boosts || [1, 3, 5];
    const subquery = new QueryBuilder({ textProcessor: this.textProcessor });
    if (Array.isArray(fieldOrFields)) {
      const fields = fieldOrFields;
      if (expand) {
        subquery.multiMatchWithPhrase(fields, term, {
          operator: 'or',
          boost: boosts[0],
        });
      }
      subquery.multiMatchWithPhrase(fields, term, {
        operator: 'and',
        boost: boosts[1],
      });
      subquery.multiMatchWithPhrase(fields, term, {
        boost: boosts[2],
      });
      this.should(subquery);
    } else {
      const field = fieldOrFields;
      if (expand) {
        subquery.matchWithPhrase(field, term, {
          operator: 'or',
          boost: boosts[0],
        });
      }
      subquery.matchWithPhrase(field, term, {
        operator: 'and',
        boost: boosts[1],
      });
      subquery.matchWithPhrase(field, term, {
        boost: boosts[2],
      });
      this.should(subquery);
    }
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
      this.addMultiMatchAll(this._must, fields, valueOrValues);
    } else {
      this.addMultiMatchAny(this._must, fields, valueOrValues);
    }
    return this;
  }

  /**
   * Create a basic multi_match clause and add any of the available options.
   * than they would be in a regular multi_match builder
   * See the "Combining OR, AND, and match phrase queries" section of https://www.elastic.co/blog/how-to-improve-elasticsearch-search-relevance-with-boolean-queries.
   * @param fields The fields to search
   * @param value  The value to match on
   * @param options  Additional options, including `type`, `analyzer`, `boost`, `operator`, `minimum_should_match`, `fuzziness`, `lenient`, `prefix_length`, `max_expansions`, `fuzzy_rewrite`, `zero_terms_query`, `cutoff_frequency`, and `fuzzy_transpositions`
   * @chainable
   */
  multiMatchWithPhrase(
    fields: string[],
    value: string,
    options: Prettify<Omit<MultiMatchQueryShape, 'query' | 'fields'>> = {}
  ) {
    value = this.textProcessor.processText(value);
    this._must.push({
      multi_match: {
        fields,
        query: value,
        ...options,
      },
    });
    return this;
  }

  /**
   * Create a basic match clause and add any of the available options.
   * than they would be in a regular multi_match builder
   * See the "Combining OR, AND, and match phrase queries" section of https://www.elastic.co/blog/how-to-improve-elasticsearch-search-relevance-with-boolean-queries.
   * @param field The field to search
   * @param phrase  The value to match on
   * @param options  Additional options, including `type`, `analyzer`, `boost`, `operator`, `minimum_should_match`, `fuzziness`, `lenient`, `prefix_length`, `max_expansions`, `fuzzy_rewrite`, `zero_terms_query`, `cutoff_frequency`, and `fuzzy_transpositions`
   * @chainable
   */
  matchWithPhrase(
    field: string,
    phrase: string,
    options: Prettify<Omit<MultiMatchQueryShape, 'query' | 'fields'>> = {}
  ) {
    phrase = this.textProcessor.processText(phrase);
    this._must.push({
      match: {
        [field]: {
          query: phrase,
          ...options,
        },
      },
    });
    return this;
  }

  rrf({
    semanticField,
    standardField,
    phrase,
    weight,
  }: {
    semanticField: string;
    standardField: string;
    phrase: string;
    weight: number;
  }): this {
    const query = this.textProcessor.processText(phrase);

    this._retrievers.push({
      retriever: {
        rrf: {
          retrievers: [
            // Lexical (standard) retriever on the standardField
            {
              standard: {
                query: {
                  match: {
                    [standardField]: query,
                  },
                },
              },
            },
            // Semantic retriever on the semanticField
            {
              standard: {
                query: {
                  semantic: {
                    field: semanticField,
                    query,
                  },
                },
              },
            },
          ],
          rank_window_size: this._rankWindowSize,
          rank_constant: this._rankConstant,
        },
      },
      weight,
      normalizer: this._normalizer,
    });

    return this; // Enable chaining
  }

  semantic(field: string, phrase: string, weight: number = 1): this {
    const query = this.textProcessor.processText(phrase);

    this._retrievers.push({
      retriever: {
        standard: {
          query: {
            semantic: {
              field,
              query,
            },
          },
        },
      },
      weight,
      normalizer: this._normalizer,
    });

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
      this.addMultiTermAll(this._must, fields, value);
    } else {
      this.addMultiTermAny(this._must, fields, value);
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
    this.addFilterAny(this._mustNot, 'match', field, valueOrValues);
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
    this.addMultiMatchAny(this._mustNot, fields, valueOrValues);
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
    this.addMultiTermAny(this._mustNot, fields, value);
    return this;
  }

  /**
   * Exact term matching with flexible field/fields and value/values.
   * Breaking change: accepts an object parameter.
   */
  term({
    field,
    fields,
    value,
    values,
    matchType = 'every',
  }: {
    field?: string;
    fields?: string[];
    value?: any;
    values?: any[];
    matchType?: 'any' | 'every' | 'notAny' | 'notEvery' | 'not' | string;
  }) {
    const args = this._ensureTermArgs({ field, fields, value, values, matchType });

    if (args.mode === 'single') {
      const clauses = this._buildAndedTermClauses(args.field!, args.values);
      if (args.matchType === 'not') {
        // not(all values)
        this._mustNot.push(clauses.length === 1 ? clauses[0] : ({ bool: { must: clauses } } as any));
        return this;
      }
      // 'every' (default) for single field
      if (clauses.length === 1) {
        this._must.push(clauses[0] as any);
      } else {
        this._must.push({ bool: { must: clauses } } as any);
      }
      return this;
    }

    // Multi-field mode
    const perFieldClauses = args.fields!.map((f) => {
      const list = this._buildAndedTermClauses(f, args.values);
      return list.length === 1 ? list[0] : ({ bool: { must: list } } as any);
    });

    switch (args.matchType) {
      case 'any': {
        this._must.push({ bool: { should: perFieldClauses } } as any);
        return this;
      }
      case 'every': {
        for (const c of perFieldClauses) {
          this._must.push(c as any);
        }
        return this;
      }
      case 'notany': {
        for (const c of perFieldClauses) {
          this._mustNot.push(c as any);
        }
        return this;
      }
      case 'notevery': {
        const negatedPerField = args.fields!.map((f) => ({
          bool: {
            must_not: [
              ((): any => {
                const list = this._buildAndedTermClauses(f, args.values);
                return list.length === 1 ? list[0] : { bool: { must: list } };
              })(),
            ],
          },
        }));
        this._must.push({ bool: { should: negatedPerField, minimum_should_match: 1 } } as any);
        return this;
      }
      default: {
        // should not happen (validated)
        return this;
      }
    }
  }

  /**
   * Require that the given field(s) exist or not exist based on matchType.
   * Breaking change: accepts an object parameter.
   */
  exists({
    field,
    fields,
    matchType = 'every',
  }: {
    field?: string;
    fields?: string[];
    matchType?: 'any' | 'every' | 'notAny' | 'notEvery' | 'not' | string;
  }) {
    // Validate args and normalize
    const normalized = this._ensureExistsArgs({ field, fields, matchType });
    const mt = normalized.matchType; // canonical lowercase: any|every|notany|notevery|not

    if (normalized.mode === 'single') {
      // field present
      const clause = { exists: { field: normalized.field! } } as const;
      if (mt === 'not') {
        this._mustNot.push(clause as any);
      } else {
        // 'every' or default
        this._must.push(clause as any);
      }
      return this;
    }

    // fields present
    const flds = normalized.fields!;
    switch (mt) {
      case 'every': {
        for (const f of flds) this._must.push({ exists: { field: f } });
        return this;
      }
      case 'any': {
        const should = flds.map((f) => ({ exists: { field: f } }));
        this._must.push({ bool: { should, minimum_should_match: 1 } } as any);
        return this;
      }
      case 'notany': {
        for (const f of flds) this._mustNot.push({ exists: { field: f } });
        return this;
      }
      case 'notevery': {
        // At least one field must NOT exist
        const should = flds.map((f) => ({ bool: { must_not: [{ exists: { field: f } }] } }));
        this._must.push({ bool: { should, minimum_should_match: 1 } } as any);
        return this;
      }
      default: {
        // should never happen due to validation
        return this;
      }
    }
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
   * @param field  The name of the field to search
   * @param valueOrValues  A value or array of possible values to reject
   * @return {QueryBuilder}
   * @chainable
   */
  notTerm(field: string, valueOrValues: any | any[]) {
    this.addFilterAny(this._mustNot, 'match', field, valueOrValues);
    return this;
  }

  /**
   * Add a numeric range matching condition
   * @param field  The name of the field to search (can use nested separator for nested fields)
   * @param op  One of the following: > < >= <= gt lt gte lte between
   * @param value  A string or number to search against
   * @return {QueryBuilder}
   * @chainable
   */
  range(field: string, op: OperatorType, value: RangeShape) {
    this.addRange(this._must, field, op, value);
    return this;
  }

  /**
   * Add a numeric range negative matching condition
   * @param field  The name of the field to search (can use nested separator for nested fields)
   * @param op  One of the following: > < >= <= gt lt gte lte between
   * @param value  A value to search against
   * @return {QueryBuilder}
   * @chainable
   */
  notRange(field: string, op: OperatorType, value: RangeShape) {
    this.addRange(this._mustNot, field, op, value);
    return this;
  }

  /**
   * Add a more_like_this condition to find documents similar to the given text or documents
   * @param fieldOrFields  The names of the fields to search (can use nested separator for nested fields)
   * @param like  A string or array of strings, or an object or array of objects describing documents
   * @param options  Additional options for the more_like_this query (e.g., min_term_freq, max_query_terms)
   * @return {QueryBuilder}
   * @chainable
   */
  moreLikeThis(
    fieldOrFields: string | string[],
    like: MoreLikeThisLikeParams,
    options: MoreLikeThisOptions = {}
  ) {
    const likes = Array.isArray(like) ? like : [like];
    const fields = Array.isArray(fieldOrFields)
      ? fieldOrFields
      : [fieldOrFields];
    likes.forEach((item, i) => {
      if (typeof item === 'string') {
        likes[i] = this.textProcessor.processText(item);
      }
    });
    this._must.push({
      more_like_this: {
        fields,
        like: likes,
        ...options,
      },
    });
    return this;
  }

  rawCondition(query: QueryShape) {
    this._must.push(query);
    return this;
  }

  notRawCondition(query: QueryShape) {
    this._mustNot.push(query);
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
   * @param field  The field to group by
   * @param limit  The maximum number of counts to return (default 10)
   * @param exclusions  Values that should be excluded from the counts (default [])
   * @return {QueryBuilder}
   * @chainable
   */
  aggregateTerm(field: string, limit: number = 10, exclusions: any[] = []) {
    this._aggs[field] = {
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
        ? this.offsetIntToString(timezone)
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
   *    360 => -06:00
   *    -300 => +05:00
   *    0 => +00:00
   * @param offset
   */
  offsetIntToString(offset: number) {
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
   * @chainable
   */
  limit(limit: number) {
    this._limit = limit;
    return this;
  }

  /**
   * Set the page of results to return
   * @param page  Where 1 is the first page
   * @chainable
   */
  page(page: number) {
    this._page = page;
    return this;
  }

  /**
   * Add a sort field
   * @param field  The field to sort by
   * @param  maybeDirection  The direction, asc or desc
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/current/sort-search-results.html
   * @chainable
   * @examples:
   *   qb.sort('-created_at');
   *   qb.sort('created_at', 'desc');
   *   qb.sort('_score');
   *   qb.sort({ created_at: 'desc' });
   *   qb.sort([ { name: 'asc' }, { created_at: 'desc' } ]);
   */
  sort(field: SortShape, maybeDirection?: 'asc' | 'desc') {
    // DESC string such as "-created_at"
    if (typeof field === 'string' && field.slice(0, 1) === '-') {
      this._sorts.push({ [field.slice(1)]: { order: 'desc' } });
    } else if (typeof field === 'string') {
      this._sorts.push({ [field]: { order: maybeDirection || 'asc' } });
    } else if (Array.isArray(field)) {
      field.forEach(f => {
        const field = Object.keys(f)[0];
        const direction = f[field];
        this._sorts.push({ [field]: { order: direction } });
      });
    } else {
      // keyword such as "_score"
      // or object such as { "name" : "desc" }
      this._sorts.push(field);
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
    ];
    if (field === null) {
      field = all;
    }
    if (Array.isArray(field)) {
      field.forEach(name => this.clear(name));
    } else if (field === 'sort') {
      this._sorts = [];
      this._shouldSortByRandom = false;
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
    } else if (field === 'excludeFields') {
      this._excludeFields = [];
    } else if (field === 'highlighter') {
      this._highlighter = null;
    } else if (field === 'functionScores') {
      this._functionScores = [];
    }
  }

  /**
   * Enable or disable sorting by random
   * @param trueOrFalse
   * @chainable
   */
  sortByRandom(trueOrFalse: boolean = true) {
    this._shouldSortByRandom = trueOrFalse;
    return this;
  }

  /**
   * Add a decay function score builder
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/query-dsl-function-score-query.html#function-decay
   * @chainable
   */
  decayFunctionScore(functionScore: FunctionScoreShape) {
    this._functionScores.push(functionScore);
    return this;
  }

  /**
   * Get the function score definition
   */
  getFunctionScores() {
    return this._functionScores;
  }

  /**
   * Add a must condition using a callback to build the subquery
   * @param subquery  A function that receives a new QueryBuilder instance for building the subquery
   * @chainable
   */
  must(subquery: QueryBuilder) {
    const must = subquery.getMust();
    if (must.length === 0) {
      return this;
    } else if (must.length === 1) {
      this._must.push(must[0]);
      return this;
    } else if (must.length > 1) {
      this._must.push({
        bool: {
          must,
        },
      });
    }
    return this;
  }

  /**
   * Add a must_not condition using a callback to build the subquery
   * @param subquery  A new QueryBuilder instance
   * @return This instance
   * @chainable
   */
  mustNot(subquery: QueryBuilder) {
    const must = subquery.getMust();
    if (must.length === 0) {
      return this;
    } else if (must.length === 1) {
      this._mustNot.push(must[0]);
      return this;
    } else if (must.length > 1) {
      this._mustNot.push({
        bool: {
          should: must,
        },
      });
    }
    return this;
  }

  /**
   * Get the current array of "must" filters
   * @return The must filters
   */
  getMust(): QueryShape[] {
    return this._must;
  }
  /**
   * Require matching of a subquery
   * @param subquery  The builder object
   * @return This instance
   * @chainable
   */
  should(subquery: QueryBuilder) {
    const must = subquery.getMust();
    if (must.length === 0) {
      return this;
    } else if (must.length === 1) {
      this._must.push(must[0]);
      return this;
    } else if (must.length > 1) {
      this._must.push({
        bool: {
          should: must,
        },
      });
    }
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
    this._must.push({
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
    this._must.push({
      bool: {
        should: {
          bool: {
            must_not: subquery.getMust(),
          } as BoolQueryShape,
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
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/highlighting.html
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/term-vector.html
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
  useHighlighter(value: SearchRequestShape['highlight']) {
    this._highlighter = value;
    return this;
  }

  /**
   * Convenience helper to add FVH highlighting for one or more fields.
   * Ensures tags_schema: 'styled' at the top level and merges with any existing
   * highlighter definition without removing custom options.
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/highlighting.html
   */
  highlightField(fieldOrFields: string | string[], fragmentSize: number, numberOfFragments: number) {
    const fields = Array.isArray(fieldOrFields)
      ? fieldOrFields
      : [fieldOrFields];

    // Initialize the highlighter if needed, preserving prior settings
    const current: NonNullable<SearchRequestShape['highlight']> =
      (this._highlighter as any) ?? ({} as any);

    // Ensure fields container exists
    const currentFields: Record<string, any> = { ...(current.fields as any) };

    // Apply/override per-field FVH configuration
    for (const f of fields) {
      currentFields[f] = {
        type: 'fvh',
        fragment_size: fragmentSize,
        number_of_fragments: numberOfFragments,
      };
    }

    // Assemble the updated highlighter; preserve other options like 'order'
    this._highlighter = {
      ...(current as any),
      tags_schema: 'styled',
      fields: currentFields as any,
    } as SearchRequestShape['highlight'];

    return this;
  }

  /**
   * Return the fields we will fetch
   * @return
   */
  getFields() {
    return this._fields;
  }

  /**
   * Process query object to handle nested fields by converting dot notation to nested queries
   */

  /**
   * Return the builder body
   */
  getBody() {
    const body: Pick<SearchRequestShape, 'retriever' | 'highlight' | 'aggs' | 'rescore'> =
      {};

    // Determine what we're working with
    const hasLinearRetrievers = this._retrievers && this._retrievers.length > 0;
    const hasFilters = this._must.length > 0 || this._mustNot.length > 0;

    // Build the retriever
    if (hasLinearRetrievers) {
      // LINEAR RETRIEVER PATH
      const retrievers = [...this._retrievers];

      // Include a simple retriever for must/must_not criteria if present
      if (hasFilters) {
        let query = this._buildBoolQuery();
        if (this._shouldSortByRandom) {
          query = this._wrapWithRandomScore(query);
        }
        retrievers.push({
          retriever: {
            standard: {
              query,
            },
          },
          weight: 1,
          normalizer: this._normalizer,
        });
      }

      body.retriever = {
        linear: {
          retrievers,
          normalizer: this._normalizer,
        },
      };
    } else if (hasFilters) {
      // STANDARD RETRIEVER PATH (with query)
      let query = this._buildBoolQuery();

      if (this._shouldSortByRandom) {
        query = this._wrapWithRandomScore(query);
      }

      body.retriever = {
        standard: {
          query,
        },
      };
    } else {
      // FALLBACK: No filters, no retrievers
      // If sorting is requested, omit retriever to allow ES to sort normally
      if (this._sorts.length > 0) {
        // no retriever
      } else {
        // match all documents via retriever
        body.retriever = {
          standard: {
            query: this._shouldSortByRandom
              ? this._wrapWithRandomScore({ match_all: {} })
              : { match_all: {} },
          },
        };
      }
    }

    // Add highlighting if specified
    if (this._highlighter) {
      body.highlight = this._highlighter;
    }

    // Add aggregations if specified
    if (!isEmptyObject(this._aggs)) {
      body.aggs = this._aggs;
    }

    // Add rescore if specified
    if (this._rescore && (Array.isArray(this._rescore) ? this._rescore.length > 0 : true)) {
      body.rescore = this._rescore as any;
    }

    return this.nestedFieldsProcessor.process(body);
  }

  /**
   * Build a bool query from must/must_not conditions
   */
  private _buildBoolQuery(): estypes.QueryDslQueryContainer {
    const boolQuery: any = {};

    if (this._must.length > 0) {
      boolQuery.must = this._must;
    }

    if (this._mustNot.length > 0) {
      boolQuery.must_not = this._mustNot;
    }

    // Simplify if only one must clause and no must_not
    if (this._must.length === 1 && this._mustNot.length === 0) {
      return this._must[0];
    }

    return { bool: boolQuery };
  }

  /**
   * Build filter for linear/rrf retrievers
   * Filters don't affect scoring but documents must match
   */
  private _buildFilterForRetriever():
    | estypes.QueryDslQueryContainer
    | estypes.QueryDslQueryContainer[]
    | undefined {
    // If we have both must and must_not, use bool structure
    if (this._must.length > 0 && this._mustNot.length > 0) {
      return {
        bool: {
          must: this._must,
          must_not: this._mustNot,
        },
      };
    }

    // If only must conditions, return as array (cleaner)
    if (this._must.length > 0) {
      return this._must.length === 1 ? [this._must[0]] : this._must;
    }

    // If only must_not conditions, wrap in bool
    if (this._mustNot.length > 0) {
      return {
        bool: {
          must_not: this._mustNot,
        },
      };
    }

    return undefined;
  }

  /**
   * Wrap a query with random score function
   */
  private _wrapWithRandomScore(
    query: estypes.QueryDslQueryContainer
  ): estypes.QueryDslQueryContainer {
    return {
      function_score: {
        query,
        functions: [
          {
            random_score: {},
          },
        ],
        boost_mode: 'replace',
      },
    };
  }

  // Helper: normalize and validate matchType for exists()
  private _normalizeAndValidateMatchType(mt: any): 'any' | 'every' | 'notany' | 'notevery' | 'not' {
    const allowed = new Set(['any', 'every', 'notany', 'notevery', 'not']);
    const value = String(mt ?? 'every').toLowerCase();
    if (!allowed.has(value)) {
      throw new TypeError(
        "QueryBuilder.exists(): invalid 'matchType' — expected one of any|every|notAny|notEvery|not"
      );
    }
    return value as any;
  }

  // Helper: validate args and return normalized shape for exists()
  private _ensureExistsArgs(args: {
    field?: any;
    fields?: any;
    matchType?: any;
  }): { mode: 'single' | 'multi'; field?: string; fields?: string[]; matchType: 'any' | 'every' | 'notany' | 'notevery' | 'not' } {
    const { field, fields } = args;

    if (typeof field === 'undefined' && typeof fields === 'undefined') {
      throw new TypeError("QueryBuilder.exists() requires one of 'field' or 'fields'");
    }

    if (typeof field !== 'undefined' && typeof fields !== 'undefined') {
      throw new TypeError("QueryBuilder.exists(): both 'field' and 'fields' cannot be used together");
    }

    const matchType = this._normalizeAndValidateMatchType(args.matchType);

    // Single field mode
    if (typeof field !== 'undefined') {
      if (typeof field !== 'string' || field.trim().length === 0) {
        throw new TypeError("QueryBuilder.exists(): expected 'field' to be a string");
      }
      // When field is provided, only 'every' or 'not' are allowed
      if (matchType !== 'every' && matchType !== 'not') {
        throw new TypeError(
          "QueryBuilder.exists(): when 'field' is provided, 'matchType' must be every or not"
        );
      }
      return { mode: 'single', field: field.trim(), matchType };
    }

    // Fields array mode
    if (!Array.isArray(fields)) {
      throw new TypeError("QueryBuilder.exists(): expected 'fields' to be an array of strings");
    }
    if (fields.length === 0) {
      throw new TypeError("QueryBuilder.exists(): expected 'fields' to be an array of strings");
    }
    const cleaned: string[] = [];
    for (const f of fields) {
      if (typeof f !== 'string') {
        throw new TypeError("QueryBuilder.exists(): expected 'fields' to be an array of strings");
      }
      const t = f.trim();
      if (t.length === 0) {
        throw new TypeError("QueryBuilder.exists(): expected 'fields' to be an array of strings");
      }
      cleaned.push(t);
    }

    if (matchType === 'not') {
      throw new TypeError(
        "QueryBuilder.exists(): when 'fields' is provided, 'matchType' cannot be not"
      );
    }

    return { mode: 'multi', fields: cleaned, matchType };
  }

  // Helper: normalize and validate matchType for term()
  private _normalizeAndValidateTermMatchType(mt: any): 'any' | 'every' | 'notany' | 'notevery' | 'not' {
    const allowed = new Set(['any', 'every', 'notany', 'notevery', 'not']);
    const value = String(mt ?? 'every').toLowerCase();
    if (!allowed.has(value)) {
      throw new TypeError(
        "QueryBuilder.term(): invalid 'matchType' — expected one of any|every|notAny|notEvery|not"
      );
    }
    return value as any;
  }

  // Helper: ensure and normalize args for term()
  private _ensureTermArgs(args: {
    field?: any;
    fields?: any;
    value?: any;
    values?: any[];
    matchType?: any;
  }): {
    mode: 'single' | 'multi';
    field?: string;
    fields?: string[];
    values: any[];
    matchType: 'any' | 'every' | 'notany' | 'notevery' | 'not';
  } {
    const { field, fields, value, values } = args;

    const hasField = typeof field !== 'undefined';
    const hasFields = typeof fields !== 'undefined';
    if (!hasField && !hasFields) {
      throw new TypeError("QueryBuilder.term() requires one of 'field' or 'fields'");
    }
    if (hasField && hasFields) {
      throw new TypeError("QueryBuilder.term() accepts only one of 'field' or 'fields'");
    }

    const hasValue = typeof value !== 'undefined';
    const hasValues = typeof values !== 'undefined';
    if (!hasValue && !hasValues) {
      throw new TypeError("QueryBuilder.term() requires one of 'value' or 'values'");
    }
    if (hasValue && hasValues) {
      throw new TypeError("QueryBuilder.term() accepts only one of 'value' or 'values'");
    }

    const mt = this._normalizeAndValidateTermMatchType(args.matchType);

    if (hasField) {
      if (typeof field !== 'string' || field.trim().length === 0) {
        throw new TypeError("QueryBuilder.term() expected 'field' to be a string");
      }
      if (mt !== 'every' && mt !== 'not') {
        throw new TypeError(
          "QueryBuilder.term() requires 'matchType' to be one of ['every','not'] when 'field' is used"
        );
      }
      const vals = hasValue ? [value] : (values as any[]);
      return {
        mode: 'single',
        field: field.trim(),
        values: vals,
        matchType: mt,
      };
    }

    if (!Array.isArray(fields)) {
      throw new TypeError("QueryBuilder.term() expected 'fields' to be an array of strings");
    }
    if (fields.length === 0) {
      throw new TypeError("QueryBuilder.term() expected 'fields' to be an array of strings");
    }
    const cleaned: string[] = [];
    for (const f of fields) {
      if (typeof f !== 'string') {
        throw new TypeError("QueryBuilder.term() expected 'fields' to be an array of strings");
      }
      const t = f.trim();
      if (t.length === 0) {
        throw new TypeError("QueryBuilder.term() expected 'fields' to be an array of strings");
      }
      cleaned.push(t);
    }

    if (mt === 'not') {
      throw new TypeError("QueryBuilder.term() cannot use 'matchType'='not' with 'fields'");
    }

    const vals = hasValue ? [value] : (values as any[]);
    return { mode: 'multi', fields: cleaned, values: vals, matchType: mt };
  }

  // Helper: build AND-of-values term clauses for a field
  private _buildAndedTermClauses(field: string, values: any[]): any[] {
    const vals = Array.isArray(values) ? values : [values];
    const clauses: any[] = [];
    for (const v of vals) {
      clauses.push({ term: { [field]: v } });
    }
    return clauses;
  }

  /**
   * Return the "size" and "from" based on "limit" and "page"
   * @return The options to send in the builder
   */
  getOptions() {
    const options: Pick<SearchRequestShape, 'size' | 'from' | 'sort' | 'min_score'> = {};
    if (this._limit !== null) {
      options.size = this._limit;
      if (this._page > 1) {
        options.from = this._limit * (this._page - 1);
      }
    }
    if (this._sorts.length > 0) {
      options.sort = this._sorts;
    }
    if (typeof this._minScore === 'number') {
      options.min_score = this._minScore as any;
    }
    return this.nestedFieldsProcessor.process(options);
  }

  /**
   * Get an object representation of the builder body
   * suitable for the Elasticsearch SDK or Kibana
   * @return {Object}
   */
  getQuery(overrides: Partial<SearchRequestShape> = {}): SearchRequestShape {
    const source: Pick<SearchRequestShape, '_source' | '_source_excludes'> = {};
    if (this._fields.length > 0) {
      source._source = this._fields;
    }
    if (this._excludeFields.length > 0) {
      source._source_excludes = this._excludeFields;
    }
    return {
      ...(this._index ? { index: this._index } : {}),
      ...source,
      ...this.getBody(),
      ...this.getOptions(),
      ...overrides,
    };
  }

  /**
   * For JSON serialization, simply use the value returned from getQuery()
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#tojson_behavior
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
   * Debug to string
   */
  toString() {
    return JSON.stringify(this.getQuery(), null, 2);
  }

  /**
   * Add a KNN retriever (Approximate Nearest Neighbor search)
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/knn-search.html
   */
  knn(field: string, vector: number[], k: number, numCandidates?: number, weight: number = 1) {
    const knnDef: any = {
      field,
      query_vector: vector,
      k,
    };
    if (typeof numCandidates === 'number') {
      knnDef.num_candidates = numCandidates;
    }

    this._retrievers.push({
      retriever: {
        knn: knnDef,
      } as any,
      weight,
      normalizer: this._normalizer,
    });
    return this;
  }

  /**
   * Add a rescore phase for the query. Multiple calls will append additional rescore entries.
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/filter-search-results.html#rescore
   */
  rescore(windowSize: number, rescoreQuery: estypes.QueryDslQueryContainer) {
    const entry: any = {
      window_size: windowSize,
      query: {
        rescore_query: rescoreQuery,
      },
    };
    if (Array.isArray(this._rescore)) {
      this._rescore = [...this._rescore, entry] as any;
    } else if (this._rescore) {
      this._rescore = [this._rescore as any, entry] as any;
    } else {
      this._rescore = [entry] as any;
    }
    return this;
  }

  /**
   * Set a minimum score threshold for hits
   */
  minScore(score: number) {
    this._minScore = score;
    return this;
  }

  /**
   * Add a terms_set query to must filters
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/query-dsl-terms-set-query.html
   */
  termsSet(
    field: string,
    terms: (string | number)[],
    minimumShouldMatchScript?: string
  ) {
    const clause: any = {
      terms_set: {
        [field]: {
          terms,
          ...(minimumShouldMatchScript
            ? { minimum_should_match_script: { source: minimumShouldMatchScript } }
            : {}),
        },
      },
    };
    this._must.push(clause);
    return this;
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
