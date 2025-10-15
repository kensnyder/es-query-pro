import type { estypes } from '@elastic/elasticsearch'; // TypeScript needs estypes even if we don't use it
import isDefined from '../isDefined/isDefined';
import isEmptyObject from '../isEmptyObject/isEmptyObject';
import offsetIntToString from '../offsetIntToString/offsetIntToString';
import type {
  BoostOperator,
  FieldTypeOrTypes,
  InferenceCohereSimilarityType,
  InnerRetriever,
  IntervalType,
  KnnRetriever,
  MoreLikeThisLikeParams,
  MoreLikeThisOptions,
  Prettify,
  QueryBody,
  QueryDslChildScoreMode,
  QueryDslDecayFunctionBase,
  QueryDslMultiMatchQuery,
  QueryDslQueryContainer,
  RangeOperator,
  RangeShape,
  RetrieverContainer,
  ScoreNormalizer,
  SearchInnerHits,
  SearchRequestShape,
  SearchRescore,
  SortCombinations,
  SortDirection,
  SortResults,
} from '../types';

/**
 * Get a default FVH highlighter configuration.
 * @returns A highlight config suitable for use with QueryBuilder.
 */
export const getDefaultHighlighter = () =>
  ({
    type: 'fvh',
    number_of_fragments: 3,
    fragment_size: 150,
    tags_schema: 'styled',
    fields: {},
  }) as SearchRequestShape['highlight'];

/**
 * ElasticSearch query builder (ElasticSearch 9 only)
 */
export default class QueryBuilder {
  /** The index to query from - used by getQuery() */
  public _index: string;

  /** The fields to fetch */
  public _fields: string[] = ['*'];

  /** Fields to exclude from list */
  public _excludeFields: string[] = [];

  /** The must filters */
  public _must: QueryDslQueryContainer[] = [];

  /** The "aggs" to add to the builder */
  public _aggs: SearchRequestShape['aggs'] = {};

  /** The function score builder */
  public _functionScores: QueryDslDecayFunctionBase[] = [];

  /** The highlight definition */
  public _highlighter: SearchRequestShape['highlight'] = getDefaultHighlighter();

  /** The max number of records to return */
  public _limit: number = null;

  /** The page of records to fetch */
  public _page: number = 1;

  /** Fields to sort by */
  public _sorts: SortCombinations[] = [];

  /** Retrievers to use */
  public _retrievers: InnerRetriever[] = [];

  /** type of normalizer for retrievers */
  public _normalizer: ScoreNormalizer = 'minmax';

  /** The number of results to find before ranking */
  public _rankWindowSize = 50;

  /** How much to consider lower ranking content, on a scale of 0-100 */
  public _rankConstant = 20;

  /** Optional rescore phase */
  public _rescore: SearchRescore[] = undefined;

  /** Optional minimum score */
  public _minScore: number = undefined;

  /** Optional search_after sort values for deep pagination */
  public _searchAfter: SortResults = undefined;

  /** Optional track_total_hits control */
  public _trackTotalHits: boolean | number = undefined;

  /** If true, use "random_score" for a function score */
  public _shouldSortByRandom: boolean = false;

  constructor({
    index,
  }: {
    index?: string;
  } = {}) {
    this._index = index;
  }

  //
  // Section 1/6: Set fields, instance options, and highlights
  //

  /**
   * Set the index name (optional)
   * @param name
   * @example
   *   qb.index('my-index');
   */
  index(name: string): this {
    this._index = name;
    return this;
  }

  /**
   * Get the name of the index
   * @example
   *   const qb = new QueryBuilder({ index: 'products' });
   *   const index = qb.getIndex();
   */
  getIndex() {
    return this._index;
  }

  /**
   * Set the fields to fetch
   * @param fields  The fields to select
   * @return This instance
   * @example
   *   qb.fields(['id', 'name']);
   */
  fields(fields: string[]): this {
    this._fields = fields;
    return this;
  }

  /**
   * @alias fields
   * @example
   *   qb.sourceIncludes(['title', 'author']);
   */
  sourceIncludes(fields: string[]): this {
    this._fields = fields;
    return this;
  }

  /**
   * Set the fields to exclude
   * @param fields  The fields to exclude
   * @return This instance
   * @example
   *   qb.excludeFields(['internal.notes']);
   */
  excludeFields(fields: string[]): this {
    this._excludeFields = fields;
    return this;
  }

  /**
   * @alias excludeFields
   * @example
   *   qb.sourceExcludes(['private.*']);
   */
  sourceExcludes(fields: string[]): this {
    this._excludeFields = fields;
    return this;
  }

  /**
   * Pass a highlight definition to use
   * @param options  The global Highlighter options
   * @return {QueryBuilder}
   * @chainable
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/highlighting.html
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/term-vector.html
   * @example
   *   qb.highlighterOptions({ type: 'fvh', number_of_fragments: 1, fragment_size: 100, fields: {} });
   */
  highlighterOptions(options: Omit<SearchRequestShape['highlight'], 'fields'>): this {
    this._highlighter = {
      ...options,
      fields: this._highlighter.fields,
    };
    return this;
  }

  /**
   * Get the current global highlighter configuration.
   * @returns The highlight options that will be applied to the query.
   * @example
   *   qb.highlightField('title');
   *   const hl = qb.getHighlighter();
   */
  getHighlighter() {
    return this._highlighter;
  }

  /**
   * Convenience helper to add FVH highlighting for one or more fields.
   * @param name  The name of the field to highlight
   * @param overrideOptions  Options to override global highlight options
   * @example
   *   qb.highlightField('content', { number_of_fragments: 1 });
   */
  highlightField(
    name: string,
    overrideOptions: Omit<SearchRequestShape['highlight'], 'fields'> = {},
  ): this {
    this._highlighter.fields[name] = overrideOptions;
    return this;
  }

  /**
   * Return the fields we will fetch
   * @example
   *   qb.fields(['id']);
   *   const fields = qb.getFields();
   */
  getFields() {
    return this._fields;
  }

  /**
   * Get the list of fields to exclude from _source in the response.
   * @returns An array of field paths to exclude.
   * @example
   *   qb.excludeFields(['secret']);
   *   const excluded = qb.getExcludeFields();
   */
  getExcludeFields() {
    return this._excludeFields;
  }

  /**
   * @alias getFields
   */
  getSourceIncludes() {
    return this._fields;
  }

  /**
   * @alias getExcludeFields
   */
  getSourceExcludes() {
    return this._excludeFields;
  }

  /**
   * Set rank_window_size
   * @param size
   * @example
   *   qb.rankWindowSize(100);
   */
  rankWindowSize(size: number): this {
    this._rankWindowSize = size;
    return this;
  }

  /**
   * Get the reciprocal rank fusion window size used by the rank feature.
   * @returns The window size if set, otherwise undefined.
   * @example
   *   qb.rankWindowSize(75);
   *   const size = qb.getRankWindowSize();
   */
  getRankWindowSize() {
    return this._rankWindowSize;
  }

  /**
   * Set rank_constant
   * @param constant
   */
  rankConstant(constant: number): this {
    this._rankConstant = constant;
    return this;
  }

  /**
   * Get the rank_constant value used by the rank feature.
   * @returns The rank constant if set, otherwise undefined.
   */
  getRankConstant() {
    return this._rankConstant;
  }

  /**
   * Set a minimum score threshold for hits
   */
  minScore(score: number): this {
    this._minScore = score;
    return this;
  }

  /**
   * Get the minimum _score threshold for hits.
   * @returns The minimum score if set, otherwise undefined.
   */
  getMinScore() {
    return this._minScore;
  }

  /**
   * Use search_after for deep pagination
   */
  searchAfter(values: SortResults): this {
    this._searchAfter = values;
    return this;
  }

  /**
   * Get the search_after cursor used for deep pagination.
   * @returns The sort values to resume from, if set.
   */
  getSearchAfter() {
    return this._searchAfter;
  }

  /**
   * Control track_total_hits (boolean or number)
   */
  trackTotalHits(value: boolean | number): this {
    this._trackTotalHits = value;
    return this;
  }

  /**
   * Get the current track_total_hits setting.
   * @returns A boolean to enable/disable exact hit counts, or a number limit.
   */
  getTrackTotalHits() {
    return this._trackTotalHits;
  }

  //
  // Section 2/6: Criteria builders plus rrf/knn/rescore
  //

  /**
   * Append filters for the given range expression
   * @param field  The name of the field to search
   * @param operator  One of the following: > < >= <= gt lt gte lte between
   * @param range  The limit(s) to search against
   * @example
   *   qb.range('price', 'between', [10, 20]);
   */
  range(field: string, operator: RangeOperator, range: RangeShape): this {
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

    const normalizedOp = operator.toLowerCase();
    const opName = opMap[normalizedOp] || normalizedOp;

    // Validate operator
    if (!Object.values(opMap).includes(opName)) {
      throw new TypeError(`Unsupported range operator: ${operator}`);
    }

    // Handle "between" specially
    if (opName === 'between') {
      if (!Array.isArray(range) || range.length !== 2) {
        throw new TypeError('range(): "between" expects an array [min, max]');
      }

      const [min, max] = range;

      if (!isDefined(min) && !isDefined(max)) {
        return this;
      }

      if (isDefined(min) && isDefined(max)) {
        this._must.push({
          range: {
            [field]: { gte: min, lte: max },
          },
        });
        return this;
      }

      // Single-sided between
      if (isDefined(min) && !isDefined(max)) {
        this._must.push({
          range: {
            [field]: { gte: min },
          },
        });
        return this;
      }

      if (!isDefined(min) && isDefined(max)) {
        this._must.push({
          range: {
            [field]: { lte: max },
          },
        });
        return this;
      }
    }

    // Standard comparison operators
    this._must.push({
      range: {
        [field]: { [opName]: range },
      },
    });

    return this;
  }

  /**
   * Add a full-text phrase matching condition
   * @param field  The name of the field to search
   * @param phrase  A phrase string containing multipe words
   * @param options  Options for phrase matching (e.g., slop for word proximity)
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.matchPhrase({ field: 'title', phrase: 'elasticsearch guide', options: { slop: 1 } });
   */
  matchPhrase({
    field,
    phrase,
    options = {},
  }: {
    field: string;
    phrase: string;
    options?: { slop?: number };
  }): this {
    this._must.push({
      match_phrase: {
        [field]: {
          query: phrase,
          slop: options.slop || 0,
        },
      },
    });
    return this;
  }

  /**
   * Add a full-text phrase matching condition
   * @param field  The name of the field to search
   * @param phrase  A phrase string containing multipe words
   * @param options  Options for phrase matching (e.g., slop for word proximity)
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.matchPhrasePrefix({ field: 'title', phrase: 'elastic sea', options: { slop: 1 } });
   */
  matchPhrasePrefix({
    field,
    phrase,
    options = {},
  }: {
    field: string;
    phrase: string;
    options?: { slop?: number };
  }): this {
    this._must.push({
      match_phrase_prefix: {
        [field]: {
          query: phrase,
          slop: options.slop || 0,
        },
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
   * @example
   *   qb.match({ field: 'title', phrase: 'elastic', options: { operator: 'and' } });
   */
  match({
    field,
    phrase,
    options = {},
  }: {
    field: string;
    phrase: string;
    options?: Prettify<Omit<QueryDslMultiMatchQuery, 'query' | 'fields'>>;
  }): this {
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

  /**
   * Match a term with boosted relevancy for exact phrases and "AND" matches.
   * This approach is described in the "Combining OR, AND, and match phrase queries" section of
   * https://www.elastic.co/blog/how-to-improve-elasticsearch-search-relevance-with-boolean-queries
   * It gives more weight to the phrase as a whole so results with the whole phrase will be higher
   * in the results.
   * @param field  The name of the field to search
   * @param term  The search phrase
   * @param weights  Weights for each operator (in order)
   * @param operators  Operators to include (an array of "or", "and", "exact")
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.matchBoostedPhrase({ field: 'title', phrase: 'elastic search', operators: ['exact','and','or'], weights: [5,3,1] });
   */
  matchBoostedPhrase({
    field,
    phrase,
    operators = ['exact', 'and'],
    weights = [1, 3, 5],
  }: {
    field: string;
    phrase: string;
    operators?: BoostOperator[];
    weights?: number[];
  }): this {
    const should: QueryDslQueryContainer[] = [];

    for (let i = 0; i < operators.length; i++) {
      const op = operators[i];
      const boost = typeof weights[i] === 'number' ? weights[i] : 1;

      if (op === 'exact') {
        should.push({
          match_phrase: {
            [field]: {
              query: phrase,
              boost: boost,
            },
          },
        });
      } else if (op === 'and') {
        should.push({
          match: {
            [field]: {
              query: phrase,
              operator: 'and',
              boost: boost,
            },
          },
        });
      } else if (op === 'or') {
        should.push({
          match: {
            [field]: {
              query: phrase,
              operator: 'or',
              boost: boost,
            },
          },
        });
      }
    }

    if (should.length > 0) {
      this._must.push({ bool: { should, minimum_should_match: 1 } });
    }

    return this;
  }

  /**
   * Search with Reciprocal rank fusion
   * @see https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion
   *
   * @param semanticField  The name of the semantic_text field
   * @param standardField  The name of the text field containing equivalent content
   * @param phrase  The phrase to search
   * @param weight  The weight of this retriever block
   * @example
   *   qb.rrf({ semanticField: 'content_semantic', standardField: 'content', phrase: 'neural search', weight: 2 });
   */
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
    this._retrievers.push({
      retriever: {
        rrf: {
          retrievers: [
            // Lexical (standard) retriever on the standardField
            {
              standard: {
                query: {
                  match: {
                    [standardField]: phrase,
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
                    query: phrase,
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

  /**
   * Search on a semantic_text field
   * @see https://www.elastic.co/docs/solutions/search/semantic-search/semantic-search-semantic-text
   *
   * @param field  The field to search on
   * @param phrase  The phrase to search on
   * @param weight  The weight of this retriever block
   * @example
   *   qb.semantic({ field: 'content_semantic', phrase: 'vector search', weight: 1 });
   */
  semantic({ field, phrase, weight = 1 }: { field: string; phrase: string; weight: number }): this {
    this._retrievers.push({
      retriever: {
        standard: {
          query: {
            semantic: {
              field,
              query: phrase,
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
   * Get the current normalizer setting
   */
  getNormalizer() {
    return this._normalizer;
  }

  /**
   * Add an exact matching condition
   * @see https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-term-query
   *
   * @param field  The name of the field to search
   * @param value  A string to match
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.term({ field: 'status', value: 'active' });
   */
  term({ field, value }: { field: string; value: string }): this {
    this._must.push({
      term: {
        [field]: value,
      },
    });
    return this;
  }

  /**
   * Require that the given field or fields contain values (i.e. non-missing, non-null)
   * @param field  The name of the field
   * @returns {QueryBuilder}
   * @example
   *   qb.exists({ field: 'author' });
   */
  exists({ field }: { field: string }): this {
    this._must.push({ exists: { field } });
    return this;
  }

  /**
   * Add a Lucene expression condition
   * @see https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-query-string-query
   *
   * @param field  The name of the field to search
   * @param queryString  A string containing special operators such as AND, NOT, OR, ~, *
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.queryString({ field: 'title', queryString: 'quick AND fox' });
   */
  queryString({ field, queryString }: { field: string; queryString: string }): this {
    this._must.push({
      query_string: {
        fields: [field],
        query: queryString,
      },
    });
    return this;
  }

  /**
   *
   * @see https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-mlt-query
   *
   * @param field  The field name
   * @param like  The like string or { _doc: '123' }
   * @param options  Additional MorkLikeThisOptions
   * @example
   *   qb.moreLikeThis({ field: 'description', like: 'wireless headphones', options: { min_term_freq: 1, max_query_terms: 12 } });
   */
  moreLikeThis({
    field,
    like,
    options = {},
  }: {
    field: string;
    like: MoreLikeThisLikeParams;
    options: MoreLikeThisOptions;
  }): this {
    this._must.push({
      more_like_this: {
        fields: [field],
        like,
        ...(options ?? {}),
      },
    });

    return this;
  }

  /**
   * Add an arbitrary condition
   * @param query
   * @example
   *   qb.rawCondition({ range: { price: { gte: 10, lte: 50 } } });
   */
  rawCondition(query: QueryDslQueryContainer): this {
    this._must.push(query);
    return this;
  }

  /**
   * Add a terms_set query to must filters
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/query-dsl-terms-set-query.html
   * @example
   *   qb.termsSet({ field: 'tags', terms: ['red','blue'], script: "Math.min(params.num_terms, 2)" });
   */
  termsSet({
    field,
    terms,
    script,
  }: {
    field: string;
    terms: Array<string | number>;
    script?: string;
  }): this {
    const clause: QueryDslQueryContainer = {
      terms_set: {
        [field]: {
          terms,
          ...(script
            ? {
                minimum_should_match_script: {
                  source: script,
                },
              }
            : {}),
        },
      },
    };
    this._must.push(clause);
    return this;
  }

  /**
   * Add a KNN retriever (Approximate Nearest Neighbor search)
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/knn-search.html
   * @example
   *   qb.knn({ field: 'embedding', vector: [0.1, 0.2, 0.3], k: 10, numCandidates: 100, weight: 2 });
   */
  knn({
    field,
    vector,
    k,
    numCandidates,
    weight = 1,
    filter,
    similarity,
  }: {
    field: string;
    vector: number[];
    k: number;
    numCandidates?: number;
    weight: number;
    filter?: QueryDslQueryContainer | QueryDslQueryContainer[];
    similarity?: number | InferenceCohereSimilarityType;
  }): this {
    const knnDef: Partial<
      Omit<KnnRetriever, 'similarity'> & {
        similarity?: number | InferenceCohereSimilarityType;
      }
    > = {
      field,
      query_vector: vector,
      k,
    };

    if (typeof numCandidates === 'number') {
      knnDef.num_candidates = numCandidates;
    }

    if (Array.isArray(filter) && filter.length > 0) {
      knnDef.filter = { bool: { filter } };
    } else if (filter) {
      knnDef.filter = filter;
    }

    if (typeof similarity === 'number' || typeof similarity === 'string') {
      knnDef.similarity = similarity;
    }

    this._retrievers.push({
      retriever: {
        knn: knnDef,
      } as RetrieverContainer,
      weight,
      normalizer: this._normalizer,
    });
    return this;
  }

  /**
   * Get all configured retrievers (e.g., KNN) to be applied during retrieval.
   * @returns An array of retriever containers with weights and normalizer.
   */
  getRetrievers() {
    return this._retrievers;
  }

  /**
   * Add a rescore phase for the query. Multiple calls will append additional rescore entries.
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/filter-search-results.html#rescore
   * @example

   *   qb.rescore({ windowSize: 50, withBuilder: (q) => { q.match({ field: 'title', phrase: 'elasticsearch' }); } });
   */
  rescore({
    windowSize,
    withBuilder,
  }: {
    windowSize: number;
    withBuilder: (qb: QueryBuilder) => void;
  }): this {
    const qb = new QueryBuilder();
    withBuilder(qb);
    const entry = {
      window_size: windowSize,
      query: {
        rescore_query: qb.getQuery(),
      },
    } as SearchRescore;
    if (Array.isArray(this._rescore)) {
      this._rescore = [...this._rescore, entry];
    } else if (this._rescore) {
      this._rescore = [this._rescore, entry];
    } else {
      this._rescore = [entry];
    }
    return this;
  }

  /**
   * Get the configured rescore phases for this query, if any.
   * @returns A rescore definition or array of definitions, or undefined.
   */
  getRescore() {
    return this._rescore;
  }

  //
  // Section 4/6: Aggregation, facets and histograms
  //

  /**
   * Return faceted data using ElasticSearch's "aggregation" feature
   * @param fields  The names of fields to aggregate into buckets. Can be a list of strings or an object of label-field pairs
   * @param limit  The maximum number of buckets to return for each facet before an "other" option
   * @return {QueryBuilder}
   * @chainable
   * @example

   *   qb.includeFacets({ fields: ['category', 'brand'], limit: 10 });
   */
  includeFacets({
    fields,
    limit = 25,
  }: {
    fields: string[] | Record<string, string>;
    limit: number;
  }): this {
    let entries: string[][];
    if (Array.isArray(fields)) {
      entries = fields.map((field) => [field, field]);
    } else {
      entries = Object.entries(fields);
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
   * @example

   *   qb.aggregateTerm({ field: 'category', limit: 5, exclude: ['misc'] });
   */
  aggregateTerm({
    field,
    limit = 10,
    exclude = [],
    order = { _count: 'desc' },
    showTermDocCountError = true,
  }: {
    field: string;
    limit?: number;
    showTermDocCountError?: boolean;
    exclude?: any[];
    order?: any;
  }): this {
    this._aggs[field] = {
      terms: {
        field: field,
        size: limit,
        show_term_doc_count_error: showTermDocCountError,
        order,
        exclude,
      },
    };
    // use limit to return no records, just counts
    this.limit(0);
    return this;
  }

  /**
   * Manually set the aggs array
   * @param aggs
   */
  aggs(aggs: SearchRequestShape['aggs']): this {
    this._aggs = aggs;
    return this;
  }

  /**
   * Get the current aggregation definitions to be included in the request.
   * @returns A map of aggregation names to their definitions.
   */
  getAggs() {
    return this._aggs;
  }

  /**
   * Add an "aggs" entry for date histogram aggregation. Similar to COUNT(*) over a timer period with GROUP BY
   * ES 9 requires using calendar_interval or fixed_interval (interval is deprecated/removed).
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/current/search-aggregations-bucket-datehistogram-aggregation.html
   * @param dateField  The date field
   * @param intervalName  Interval of year, quarter, month, week, day, hour, minute, second
   * @param timezone  The timezone offset (e.g. 360 or "-06:00")
   * @returns This instance
   * @chainable
   * @example
   *   qb.dateHistogram('created_at', 'month', '+00:00');
   */
  dateHistogram(dateField: string, intervalName: IntervalType, timezone: string | number): this {
    // see https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping-date-format.html
    // Map human-friendly interval names to ES9 calendar/fixed intervals and output formats
    const intervals: Record<
      IntervalType,
      { code: string; format: string; kind: 'calendar' | 'fixed' }
    > = {
      year: { code: '1y', format: 'yyyy', kind: 'calendar' },
      quarter: { code: '1q', format: 'yyyy-Q', kind: 'calendar' },
      month: { code: '1M', format: 'yyyy-MM', kind: 'calendar' },
      week: { code: '1w', format: 'xxxx-ww', kind: 'calendar' },
      day: { code: '1d', format: 'yyyy-MM-dd', kind: 'calendar' },
      hour: { code: '1h', format: "yyyy-MM-dd'T'HH", kind: 'fixed' },
      minute: { code: '1m', format: "yyyy-MM-dd'T'HH:mm", kind: 'fixed' },
      second: { code: '1s', format: "yyyy-MM-dd'T'HH:mm:ss", kind: 'fixed' },
    } as const;

    const interval = intervals[intervalName];
    if (!interval) {
      const supported = Object.keys(intervals).join(', ');
      throw new Error(
        `QueryBuilder.dateHistogram(): intervalName not supported. Supported intervals are ${supported}.`,
      );
    }

    const timezoneString = typeof timezone === 'number' ? offsetIntToString(timezone) : timezone;

    if (!/^[+-]\d\d:\d\d$/.test(timezoneString)) {
      throw new Error(
        `QueryBuilder.dateHistogram(): timezone must be a numeric offset in minutes OR a string in the form "+02:00".  Received ${JSON.stringify(timezone)}`,
      );
    }

    const dateHistogram: any = {
      field: dateField,
      time_zone: timezoneString,
      format: interval.format,
      min_doc_count: 1,
    };

    if (interval.kind === 'calendar') {
      dateHistogram.calendar_interval = interval.code;
    } else {
      dateHistogram.fixed_interval = interval.code;
    }

    this._aggs[dateField] = { date_histogram: dateHistogram };

    // don't return any records; just the histogram
    this.limit(0);
    return this;
  }

  //
  // Section 5/6: Sort and paginate methods
  //

  /**
   * Set the max number of results to return
   * @param limit  The max
   * @chainable
   * @example
   *   qb.limit(25);
   */
  limit(limit: number): this {
    this._limit = limit;
    return this;
  }

  /**
   * Get the maximum number of results to return (size).
   * @returns The size/limit, or null to use Elasticsearch defaults.
   * @example
   *   qb.limit(10);
   *   const size = qb.getLimit();
   */
  getLimit() {
    return this._limit;
  }

  /**
   * Set the page of results to return
   * @param page  Where 1 is the first page
   * @chainable
   * @example
   *   qb.page(3);
   */
  page(page: number): this {
    this._page = page;
    return this;
  }

  /**
   * Get the page number to return (1-based).
   * @returns The page number, default is 1.
   * @example
   *   qb.page(2);
   *   const page = qb.getPage();
   */
  getPage() {
    return this._page;
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
  sort(field: SortCombinations, maybeDirection?: SortDirection): this {
    // DESC string such as "-created_at"
    if (typeof field === 'string' && field.slice(0, 1) === '-') {
      this._sorts.push({ [field.slice(1)]: { order: 'desc' } });
    } else if (typeof field === 'string') {
      this._sorts.push({ [field]: { order: maybeDirection || 'asc' } });
    } else if (Array.isArray(field)) {
      field.forEach((f) => {
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
   * Get the sort clauses to apply to the search.
   * @returns An array of sort specifications in Elasticsearch format.
   * @example
   *   qb.sort('_score');
   *   const sorts = qb.getSort();
   */
  getSort() {
    return this._sorts;
  }

  /**
   * Reset one or more properties of this instance to its initial value
   * @param field
   * @example
   *   qb.fields(['a']).limit(5);
   *   qb.reset('fields');
   */
  reset(field: FieldTypeOrTypes = null): this {
    const all: FieldTypeOrTypes = [
      'fields',
      'excludeFields',
      'must',
      'aggs',
      'functionScores',
      'highlighter',
      'sorts',
      'retrievers',
      'normalizer',
      'rankWindowSize',
      'rankConstant',
      'rescore',
      'minScore',
      'searchAfter',
      'trackTotalHits',
      'page',
      'limit',
    ];
    const fields = field === null ? all : Array.isArray(field) ? field : [field];
    const empty = new QueryBuilder();
    for (const field of fields) {
      if (field === 'fields') {
        this._fields = empty.getFields();
      } else if (field === 'excludeFields') {
        this._excludeFields = empty.getExcludeFields();
      } else if (field === 'must') {
        this._must = empty.getMust();
      } else if (field === 'aggs') {
        this._aggs = empty.getAggs();
      } else if (field === 'functionScores') {
        this._functionScores = empty.getFunctionScores();
      } else if (field === 'highlighter') {
        this._highlighter = empty.getHighlighter();
      } else if (field === 'sorts') {
        this._sorts = empty.getSort();
        this._shouldSortByRandom = empty.getSortByRandom();
      } else if (field === 'retrievers') {
        this._retrievers = empty.getRetrievers();
      } else if (field === 'normalizer') {
        this._normalizer = empty.getNormalizer();
      } else if (field === 'rankWindowSize') {
        this._rankWindowSize = empty.getRankWindowSize();
      } else if (field === 'rankConstant') {
        this._rankConstant = empty.getRankConstant();
      } else if (field === 'rescore') {
        this._rescore = empty.getRescore();
      } else if (field === 'minScore') {
        this._minScore = empty.getMinScore();
      } else if (field === 'searchAfter') {
        this._searchAfter = empty.getSearchAfter();
      } else if (field === 'trackTotalHits') {
        this._trackTotalHits = empty.getTrackTotalHits();
      } else if (field === 'page') {
        this._page = empty.getPage();
      } else if (field === 'limit') {
        this._limit = empty.getLimit();
      }
    }
    return this;
  }

  /**
   * Create a copy of this instance
   */
  clone(): QueryBuilder {
    const copy = new QueryBuilder({ index: this._index });
    copy._fields = this._fields;
    copy._excludeFields = this._excludeFields;
    copy._must = this._must;
    copy._aggs = this._aggs;
    copy._functionScores = this._functionScores;
    copy._highlighter = this._highlighter;
    copy._sorts = this._sorts;
    copy._retrievers = this._retrievers;
    copy._normalizer = this._normalizer;
    copy._rankWindowSize = this._rankWindowSize;
    copy._rankConstant = this._rankConstant;
    copy._rescore = this._rescore;
    copy._minScore = this._minScore;
    copy._searchAfter = this._searchAfter;
    copy._trackTotalHits = this._trackTotalHits;
    return copy;
  }

  /**
   * Enable or disable sorting by random
   * @param trueOrFalse
   * @chainable
   */
  sortByRandom(trueOrFalse: boolean = true): this {
    this._shouldSortByRandom = trueOrFalse;
    return this;
  }

  /**
   * Get the current sort by random state
   */
  getSortByRandom() {
    return this._shouldSortByRandom;
  }

  /**
   * Add a decay function score builder
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/query-dsl-function-score-query.html#function-decay
   * @chainable
   * @example

   *   qb.decayFunctionScore({
   *     gauss: {
   *       "created_at": { origin: "now", scale: "7d", decay: 0.5 }
   *     }
   *   });
   */
  decayFunctionScore(functionScore: QueryDslDecayFunctionBase): this {
    this._functionScores.push(functionScore);
    return this;
  }

  //
  // Section 3/6: Logic including should, mustNot, nested
  //

  /**
   * Build a boolean SHOULD clause from multiple subquery builders.
   *
   * This helper lets you define several alternative branches (disjuncts) of a
   * query. Each branch is a callback that receives a fresh QueryBuilder. Inside
   * the callback you add the desired must/term/range/etc. clauses for that
   * branch. All branches are combined under a bool.should with an optional
   * minimum_should_match.
   *
   * @param {Object} params                     The configuration object
   * @param {Array<Function>} params.branches   Callbacks, invoked with (qb, idx), used to build each branch
   * @param {number} [params.minimumShouldMatch=1]  Minimum number of branches that must match
   * @returns {this} This QueryBuilder instance for chaining
   * @chainable
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/query-dsl-bool-query.html#query-dsl-bool-query-should
   * @example
   * // Match documents that satisfy at least one branch
   * qb.should({
   *   branches: [
   *     (q) => { q.term("status", "published"); },
   *     (q) => { q.range("created_at", { gte: "now-7d" }); },
   *   ],
   *   minimumShouldMatch: 1, // or "50%"
   * });
   */
  should({
    withBuilders,
    minimumShouldMatch = 1,
  }: {
    withBuilders: Array<(qb: QueryBuilder, idx: number) => any>;
    minimumShouldMatch?: number | string;
  }): this {
    const bool: any = { should: [], minimum_should_match: minimumShouldMatch };
    for (let i = 0; i < withBuilders.length; i++) {
      const qb = new QueryBuilder();
      withBuilders[i](qb, i);
      const branch = qb.getMust();
      if (branch.length === 0) {
        continue;
      }
      if (branch.length === 1) {
        bool.should.push(branch[0]);
      } else {
        bool.should.push({ bool: { must: branch } });
      }
    }
    this._must.push({ bool });
    return this;
  }

  /**
   * Get a Query Builder to add a negative condition
   * @param withBuilder  A function that takes a QueryBuilder to allow adding conditions
   */
  mustNot(withBuilder: (qb: QueryBuilder) => any): this {
    const qb = new QueryBuilder();
    withBuilder(qb);
    this._must.push({ bool: { must_not: qb.getMust() } });
    return this;
  }

  /**
   * Add a nested condition
   * @param withBuilder  A function that takes a QueryBuilder to allow adding conditions
   * @param path  The path to this nesting layer
   * @param scoreMode  score_mode=avg
   * @param innerHits  inner_hits=undefined
   * @param ignoreUnmapped  ignoreUnmapped=false
   */
  nested({
    withBuilder,
    path,
    scoreMode = 'avg',
    innerHits = undefined,
    ignoreUnmapped = false,
  }: {
    withBuilder: (qb: QueryBuilder) => void;
    path: string;
    scoreMode?: QueryDslChildScoreMode;
    innerHits?: SearchInnerHits;
    ignoreUnmapped?: boolean;
  }): this {
    const qb = new QueryBuilder();
    withBuilder(qb);
    this._must.push({
      nested: {
        path,
        query: { bool: { must: qb.getMust() } },
        score_mode: scoreMode,
        inner_hits: innerHits,
        ignore_unmapped: ignoreUnmapped,
      },
    });
    return this;
  }

  //
  // Section 6/6: Builders including getMust/getBody/toJSON/valueOf/toString
  //

  /**
   * Get the function score definition
   */
  getFunctionScores() {
    return this._functionScores;
  }

  /**
   * Get the current array of "must" filters
   * @return The must filters
   */
  getMust(): QueryDslQueryContainer[] {
    return this._must;
  }

  /**
   * Return the builder body
   */
  getBody() {
    const body: QueryBody = {};

    // Determine what we're working with
    const hasLinearRetrievers = this._retrievers.length > 0;
    const hasFilters = this._must.length > 0;

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
    if (!isEmptyObject(this._highlighter.fields)) {
      body.highlight = this._highlighter;
    }

    // Add aggregations if specified
    if (!isEmptyObject(this._aggs)) {
      body.aggs = this._aggs;
    }

    // Add rescore if specified and supported (requires a standard query retriever)
    if (this._rescore && (Array.isArray(this._rescore) ? this._rescore.length > 0 : true)) {
      let canRescore = false;
      if (body.retriever?.standard) {
        canRescore = true;
      } else if (body.retriever?.linear) {
        const retrs = (body.retriever.linear.retrievers || []) as InnerRetriever[];
        canRescore = Array.isArray(retrs) && retrs.some((r) => r?.retriever?.standard);
      }
      if (canRescore) {
        body.rescore = this._rescore;
      }
    }

    return body;
  }

  /**
   * Build a bool query from must/must_not conditions
   */
  private _buildBoolQuery(): QueryDslQueryContainer {
    if (this._must.length === 0) {
      return { match_all: {} };
    } else if (this._must.length === 1) {
      return this._must[0];
    } else {
      return { bool: { must: this._must } };
    }
  }

  /**
   * Wrap a query with random score function
   */
  private _wrapWithRandomScore(query: QueryDslQueryContainer): QueryDslQueryContainer {
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

  /**
   * Return the "size" and "from" based on "limit" and "page"
   * @return The options to send in the builder
   */
  getOptions() {
    const options: Pick<
      SearchRequestShape,
      'size' | 'from' | 'sort' | 'min_score' | 'search_after' | 'track_total_hits'
    > = {};
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
      options.min_score = this._minScore;
    }
    if (Array.isArray(this._searchAfter) && this._searchAfter.length > 0) {
      options.search_after = this._searchAfter;
    }
    if (typeof this._trackTotalHits === 'boolean' || typeof this._trackTotalHits === 'number') {
      options.track_total_hits = this._trackTotalHits;
    }
    return options;
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
   * Get a full Kibana builder string for the given builder
   * @param {String} index  The index to pull the name from
   * @return {String}
   */
  toKibana(index?: string): string {
    const json = JSON.stringify(this.getQuery(), null, 4);
    return `GET ${index || this._index}/_search\n${json}`;
  }
}
