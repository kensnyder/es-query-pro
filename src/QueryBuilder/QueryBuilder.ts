import type { estypes } from '@elastic/elasticsearch'; // TypeScript needs this even if we don't use it
import isDefined from '../isDefined/isDefined';
import isEmptyObject from '../isEmptyObject/isEmptyObject';
import offsetIntToString from '../offsetIntToString/offsetIntToString';
import type {
  FieldTypeOrTypes,
  FunctionScoreShape,
  IntervalType,
  MoreLikeThisLikeParams,
  MoreLikeThisOptions,
  MultiMatchQueryShape,
  OperatorType,
  Prettify,
  QueryShape,
  RangeShape,
  SearchRequestShape,
  SortShape,
} from '../types';

export type QueryBuilderBody = QueryBuilder['getBody'];

export const getDefaultHighlighter = () =>
  ({
    type: 'fvh',
    number_of_fragments: 3,
    fragment_size: 150,
    tags_schema: 'styled',
    fields: {},
  }) as SearchRequestShape['highlight'];

/**
 * Build ElasticSearch builder (ElasticSearch 9 only)
 */
export default class QueryBuilder {
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
  private _highlighter: SearchRequestShape['highlight'] = getDefaultHighlighter();

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
   * Set the fields to exclude
   * @param fields  The fields to exclude
   * @return This instance
   */
  excludeFields(fields: string[]) {
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
   */
  setHighlighterOptions(options: Omit<SearchRequestShape['highlight'], 'fields'>) {
    this._highlighter = {
      ...options,
      fields: this._highlighter.fields,
    };
    return this;
  }

  /**
   * Convenience helper to add FVH highlighting for one or more fields.
   * @param name  The name of the field to highlight
   * @param overrideOptions  Options to override global highlight options
   */
  highlightField(
    name: string,
    overrideOptions: Omit<SearchRequestShape['highlight'], 'fields'> = {},
  ) {
    this._highlighter.fields[name] = overrideOptions;
    return this;
  }

  /**
   * Return the fields we will fetch
   */
  getFields() {
    return this._fields;
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
   * Set a minimum score threshold for hits
   */
  minScore(score: number) {
    this._minScore = score;
    return this;
  }

  //
  // Section 2/6: Criteria builders plus rrf/knn/rescore
  //

  /**
   * Append filters for the given range expression
   * @param field  The name of the field to search
   * @param operator  One of the following: > < >= <= gt lt gte lte between
   * @param range  The limit(s) to search against
   */
  range(field: string, operator: OperatorType, range: RangeShape) {
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

    const normalizedOp = operator.toLowerCase();
    let opName = opMap[normalizedOp] || normalizedOp;
    if (opName === 'between' && Array.isArray(range)) {
      if (!isDefined(range[0]) && !isDefined(range[1])) {
        return this;
      }
      if (!isDefined(range[0])) {
        opName = 'lt';
        range = range[1];
      }
      if (!isDefined(range[1])) {
        opName = 'gt';
        range = range[0];
      }
    }
    if (opName === 'between' && Array.isArray(range)) {
      // Handle 'between' operator with array of [min, max]
      this._must.push({
        range: {
          [field]: {
            gte: range[0],
            lte: range[1],
          },
        },
      });
    } else if (opName in opMap) {
      // Handle standard comparison operators
      this._must.push({
        range: {
          [field]: { [opName]: range },
        },
      });
    } else {
      // Fallback for unknown operators
      throw new Error(`Unsupported range operator: ${operator}`);
    }
    return this;
  }

  /**
   * Add a full-text phrase matching condition
   * @param field  The name of the field to search
   * @param phrase  A phrase string containing multipe words
   * @param options  Options for phrase matching (e.g., slop for word proximity)
   * @return {QueryBuilder}
   * @chainable
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
   */
  match({
    field,
    phrase,
    options = {},
  }: {
    field: string;
    phrase: string;
    options?: Prettify<Omit<MultiMatchQueryShape, 'query' | 'fields'>>;
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
   */
  matchBoostedPhrase({
    field,
    phrase,
    operators = ['exact', 'and'],
    weights = [1, 3, 5],
  }: {
    field: string;
    phrase: string;
    operators?: Array<'exact' | 'and' | 'or'>;
    weights?: number[];
  }): this {
    const should: estypes.QueryDslQueryContainer[] = [];

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

  semantic({ field, value, weight = 1 }: { field: string; value: string; weight: number }): this {
    this._retrievers.push({
      retriever: {
        standard: {
          query: {
            semantic: {
              field,
              query: value,
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
   * Add an exact matching condition
   * @param field  The name of the field to search
   * @param value  A string to match
   * @return {QueryBuilder}
   * @chainable
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
   */
  exists({ field }: { field: string }): this {
    this._must.push({ exists: { field } });
    return this;
  }

  /**
   * Add a Lucene expression condition
   * @param field  The name of the field to search
   * @param queryString  A string containing special operators such as AND, NOT, OR, ~, *
   * @return {QueryBuilder}
   * @chainable
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

  rawCondition(query: QueryShape) {
    this._must.push(query);
    return this;
  }

  /**
   * Add a KNN retriever (Approximate Nearest Neighbor search)
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/knn-search.html
   */
  knn({
    field,
    vector,
    k,
    numCandidates,
    weight = 1,
  }: {
    field: string;
    vector: number[];
    k: number;
    numCandidates?: number;
    weight: number;
  }) {
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
  rescore({
    windowSize,
    withBuilder,
  }: {
    windowSize: number;
    withBuilder: (qb: QueryBuilder) => void;
  }) {
    const qb = new QueryBuilder();
    withBuilder(qb);
    const entry: any = {
      window_size: windowSize,
      query: {
        rescore_query: qb.getQuery(),
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

  //
  // Section 4/6: Aggregation, facets and histograms
  //

  /**
   * Return faceted data using ElasticSearch's "aggregation" feature
   * @param forFields  The names of fields to aggregate into buckets. Can be a list of strings or an object of label-field pairs
   * @param limit  The maximum number of buckets to return for each facet before an "other" option
   * @return {QueryBuilder}
   * @chainable
   */
  includeFacets(forFields: string[] | Record<string, string>, limit: number = 25) {
    let entries: string[][];
    if (Array.isArray(forFields)) {
      entries = forFields.map((field) => [field, field]);
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
   * ES 9 requires using calendar_interval or fixed_interval (interval is deprecated/removed).
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/current/search-aggregations-bucket-datehistogram-aggregation.html
   * @param dateField  The date field
   * @param intervalName  Interval of year, quarter, month, week, day, hour, minute, second
   * @param timezone  The timezone offset (e.g. 360 or "-06:00")
   * @returns This instance
   * @chainable
   */
  dateHistogram(dateField: string, intervalName: IntervalType, timezone: string | number) {
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
   * Clear out one or more builder properties
   * @param field  Valid values: sort, page, limit, must, aggs, fields, highlighter, functionScore
   */
  clear(field: FieldTypeOrTypes = null) {
    const all: FieldTypeOrTypes = [
      'sort',
      'page',
      'limit',
      'must',
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
      field.forEach((name) => {
        this.clear(name);
      });
    } else if (field === 'sort') {
      this._sorts = [];
      this._shouldSortByRandom = false;
    } else if (field === 'page') {
      this._page = 1;
    } else if (field === 'limit') {
      this._limit = null;
    } else if (field === 'must') {
      this._must = [];
    } else if (field === 'aggs') {
      this._aggs = {};
    } else if (field === 'fields') {
      this._fields = [];
    } else if (field === 'excludeFields') {
      this._excludeFields = [];
    } else if (field === 'highlighter') {
      this._highlighter = getDefaultHighlighter();
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
    withBuilders: Array<(qb: QueryBuilder, idx: number) => void>;
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

  mustNot(withBuilder: (qb: QueryBuilder) => void): this {
    const qb = new QueryBuilder();
    withBuilder(qb);
    this._must.push({ bool: { must_not: qb.getMust() } });
    return this;
  }

  nested({
    withBuilder,
    path,
    scoreMode = 'avg',
    innerHits = undefined,
    ignoreUnmapped = false,
  }: {
    withBuilder: (qb: QueryBuilder) => void;
    path: string;
    scoreMode?: estypes.QueryDslChildScoreMode;
    innerHits?: estypes.SearchInnerHits;
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
  getMust(): QueryShape[] {
    return this._must;
  }

  /**
   * Return the builder body
   */
  getBody() {
    const body: Pick<SearchRequestShape, 'retriever' | 'highlight' | 'aggs' | 'rescore'> = {};

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

    // Add rescore if specified
    if (this._rescore && (Array.isArray(this._rescore) ? this._rescore.length > 0 : true)) {
      body.rescore = this._rescore as any;
    }

    return body;
  }

  /**
   * Build a bool query from must/must_not conditions
   */
  private _buildBoolQuery(): estypes.QueryDslQueryContainer {
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
  private _wrapWithRandomScore(
    query: estypes.QueryDslQueryContainer,
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
   * Add a terms_set query to must filters
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/query-dsl-terms-set-query.html
   */
  termsSet(field: string, terms: (string | number)[], minimumShouldMatchScript?: string) {
    const clause: any = {
      terms_set: {
        [field]: {
          terms,
          ...(minimumShouldMatchScript
            ? {
                minimum_should_match_script: {
                  source: minimumShouldMatchScript,
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
   * Get a full Kibana builder string for the given builder
   * @param {String} index  The index to pull the name from
   * @return {String}
   */
  toKibana(index: string): string {
    const json = JSON.stringify(this.getQuery(), null, 4);
    return `GET ${index}/_search\n${json}`;
  }
}
