import type { estypes } from '@elastic/elasticsearch'; // TypeScript needs estypes even if we don't use it
import isDefined from '../isDefined/isDefined';
import isEmptyObject from '../isEmptyObject/isEmptyObject';
import { normalizeTimeZone } from '../normalizeTimeZone/normalizeTimeZone';
import type {
  AggregationsAggregationContainer,
  AggregationsCompositeAggregationSource,
  BoostOperator,
  FieldTypeOrTypes,
  InferenceCohereSimilarityType,
  InnerRetriever,
  KnnRetriever,
  MoreLikeThisLikeParams,
  MoreLikeThisOptions,
  QueryDslChildScoreMode,
  QueryDslFunctionScoreContainer,
  QueryDslFunctionScoreQuery,
  QueryDslMatchQuery,
  QueryDslMultiMatchQuery,
  QueryDslQueryContainer,
  RangeOperator,
  RangeShape,
  RetrieverContainer,
  ScoreNormalizer,
  SearchInnerHits,
  SearchRequest,
  SearchRescore,
  SortCombinations,
  SortDirection,
  SortOrder,
  SortResults,
} from '../types';

/**
 * Get the default highlighter configuration: the `unified` highlighter,
 * which works on any text or keyword field and uses term vectors or
 * offsets when the mapping provides them.
 * @returns A highlight config suitable for use with QueryBuilder.
 */
export const getDefaultHighlighter = (): HighlightDefinition => ({
  type: 'unified',
  number_of_fragments: 3,
  fragment_size: 150,
  tags_schema: 'styled',
  fields: {},
});

/**
 * Throw unless `value` is a finite number, optionally an integer `>= min`.
 * @throws TypeError when `value` is not a number
 * @throws RangeError when `value` is non-finite, fractional or too small
 */
function assertNumber(
  method: string,
  value: unknown,
  { min, integer = false }: { min?: number; integer?: boolean } = {},
): asserts value is number {
  if (typeof value !== 'number') {
    throw new TypeError(`${method}() expects a number, got ${typeof value}`);
  }
  if (!Number.isFinite(value)) {
    throw new RangeError(`${method}() expects a finite number, got ${value}`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new RangeError(`${method}() expects an integer, got ${value}`);
  }
  if (min !== undefined && value < min) {
    throw new RangeError(`${method}() expects a value >= ${min}, got ${value}`);
  }
}

/**
 * Copy a list of field names, throwing unless it is an array of strings.
 * @throws TypeError when `fields` is not an array of strings
 */
function copyFieldList(method: string, fields: unknown): string[] {
  if (!Array.isArray(fields)) {
    throw new TypeError(`${method}() expects an array of field names`);
  }
  for (const field of fields) {
    if (typeof field !== 'string') {
      throw new TypeError(
        `${method}() expects field names to be strings, got ${typeof field}`,
      );
    }
  }
  return [...fields];
}

/** A highlight definition whose `fields` is always a keyed object */
export type HighlightDefinition = Omit<
  NonNullable<SearchRequest['highlight']>,
  'fields'
> & { fields: Record<string, estypes.SearchHighlightField> };

/** A composite aggregation source that names the field it buckets on */
type CompositeSourceWithField<
  K extends keyof AggregationsCompositeAggregationSource,
> = NonNullable<AggregationsCompositeAggregationSource[K]> & { field: string };

/**
 * ElasticSearch query builder (ElasticSearch 9 only)
 */
export default class QueryBuilder<Field extends string = string> {
  /** The index to query from - used by getQuery() */
  public _index: string | undefined;

  /** The fields to fetch */
  public _fields: string[] = ['*'];

  /** Fields to exclude from the fetch list */
  public _excludeFields: string[] = [];

  /** The "must" filters */
  public _must: QueryDslQueryContainer[] = [];

  /** The "aggs" to add to the builder */
  public _aggs: Record<string, AggregationsAggregationContainer> = {};

  /** The function score builder */
  public _functionScores: QueryDslFunctionScoreContainer[] = [];

  /** The highlight definition */
  public _highlighter: HighlightDefinition = getDefaultHighlighter();

  /** The max number of records to return */
  public _limit: number | null = null;

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

  /** The rrf rank_constant (an integer >= 1; higher values flatten ranks) */
  public _rankConstant = 20;

  /** Optional rescore phase */
  public _rescore: SearchRescore[] | undefined = undefined;

  /** Optional minimum score */
  public _minScore: number | undefined = undefined;

  /** Optional search_after sort values for deep pagination */
  public _searchAfter: SortResults | undefined = undefined;

  /** Optional track_total_hits control */
  public _trackTotalHits: boolean | number | undefined = undefined;

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
   * Set the fields to fetch in `_source`. Patterns such as `'publishing.*'`
   * are allowed. An empty list fetches no `_source` at all (`_source: false`).
   * The list is copied; later changes to the array do not affect the builder.
   * @param fields  The fields to select (default `['*']`)
   * @return This instance
   * @throws TypeError when `fields` is not an array of strings
   * @example
   *   qb.fields(['id', 'name']);
   */
  fields(fields: string[]): this {
    this._fields = copyFieldList('fields', fields);
    return this;
  }

  /**
   * @alias fields
   * @example
   *   qb.sourceIncludes(['title', 'author']);
   */
  sourceIncludes(fields: string[]): this {
    this._fields = copyFieldList('sourceIncludes', fields);
    return this;
  }

  /**
   * Set the fields to leave out of `_source`. Patterns are allowed. Combined
   * with `fields()`, the result is the included fields minus the excluded.
   * The list is copied; later changes to the array do not affect the builder.
   * @param fields  The fields to exclude
   * @return This instance
   * @throws TypeError when `fields` is not an array of strings
   * @example
   *   qb.excludeFields(['internal.notes']);
   */
  excludeFields(fields: string[]): this {
    this._excludeFields = copyFieldList('excludeFields', fields);
    return this;
  }

  /**
   * @alias excludeFields
   * @example
   *   qb.sourceExcludes(['private.*']);
   */
  sourceExcludes(fields: string[]): this {
    this._excludeFields = copyFieldList('sourceExcludes', fields);
    return this;
  }

  /**
   * Set global highlight options. They are **merged** into the current
   * options (initially `getDefaultHighlighter()`); pass a key as `undefined`
   * to remove it. Fields are added with `highlightField()`, not here.
   * @param options  The global highlighter options
   * @return {QueryBuilder}
   * @chainable
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/highlighting.html
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/term-vector.html
   * @example
   *   qb.highlighterOptions({ number_of_fragments: 1, fragment_size: 100 });
   */
  highlighterOptions(options: Omit<HighlightDefinition, 'fields'>): this {
    const merged: Record<string, unknown> = { ...this._highlighter };
    for (const [key, value] of Object.entries(structuredClone(options))) {
      if (key === 'fields') {
        continue;
      }
      if (value === undefined) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    this._highlighter = merged as HighlightDefinition;
    return this;
  }

  /**
   * Get a copy of the current highlighter configuration.
   * @returns The highlight options that will be applied to the query.
   * @example
   *   qb.highlightField('title');
   *   const hl = qb.getHighlighter();
   */
  getHighlighter(): HighlightDefinition {
    return structuredClone(this._highlighter);
  }

  /**
   * Highlight a field. The default `unified` highlighter works on any text
   * or keyword field; use `{ type: 'fvh' }` only on fields mapped with
   * `term_vector: 'with_positions_offsets'`. The options are copied.
   * @param name  The name of the field to highlight
   * @param overrideOptions  Options to override global highlight options
   * @example
   *   qb.highlightField('content', { number_of_fragments: 1 });
   */
  highlightField(
    name: Field,
    overrideOptions: estypes.SearchHighlightField = {},
  ): this {
    this._highlighter.fields[name] = structuredClone(overrideOptions);
    return this;
  }

  /**
   * Return a copy of the fields we will fetch
   * @example
   *   qb.fields(['id']);
   *   const fields = qb.getFields();
   */
  getFields(): string[] {
    return [...this._fields];
  }

  /**
   * Get a copy of the list of fields to exclude from _source.
   * @returns An array of field paths to exclude.
   * @example
   *   qb.excludeFields(['secret']);
   *   const excluded = qb.getExcludeFields();
   */
  getExcludeFields(): string[] {
    return [...this._excludeFields];
  }

  /**
   * @alias getFields
   */
  getSourceIncludes(): string[] {
    return this.getFields();
  }

  /**
   * @alias getExcludeFields
   */
  getSourceExcludes(): string[] {
    return this.getExcludeFields();
  }

  /**
   * Set rank_window_size: the number of results each retriever finds
   * before they are combined (rrf and linear retrievers)
   * @param size  An integer >= 1 (default 50)
   * @throws TypeError when `size` is not a number
   * @throws RangeError when `size` is not an integer >= 1
   * @example
   *   qb.rankWindowSize(100);
   */
  rankWindowSize(size: number): this {
    assertNumber('rankWindowSize', size, { min: 1, integer: true });
    this._rankWindowSize = size;
    return this;
  }

  /**
   * Get the rank_window_size used by rrf and linear retrievers.
   * @returns The window size (default 50).
   * @example
   *   qb.rankWindowSize(75);
   *   const size = qb.getRankWindowSize();
   */
  getRankWindowSize(): number {
    return this._rankWindowSize;
  }

  /**
   * Set the rrf rank_constant: how much documents in lower ranks of each
   * result set count. Elasticsearch requires an integer >= 1 and has no upper
   * limit; its own default is 60, this builder's default is 20.
   * @param constant  An integer >= 1
   * @throws TypeError when `constant` is not a number
   * @throws RangeError when `constant` is not an integer >= 1
   * @example
   *   qb.rankConstant(60);
   */
  rankConstant(constant: number): this {
    assertNumber('rankConstant', constant, { min: 1, integer: true });
    this._rankConstant = constant;
    return this;
  }

  /**
   * Get the rrf rank_constant.
   * @returns The rank constant (default 20).
   */
  getRankConstant(): number {
    return this._rankConstant;
  }

  /**
   * Set a minimum score threshold for hits
   * @param score  Any finite number
   * @throws TypeError when `score` is not a number
   * @throws RangeError when `score` is NaN or infinite
   * @example
   *   qb.minScore(0.5);
   */
  minScore(score: number): this {
    assertNumber('minScore', score);
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
   * Use search_after for deep pagination. The values are copied.
   * @param values  The `sort` values of the last hit of the previous page
   * @throws TypeError when `values` is not an array
   * @example
   *   qb.sort('published_at').searchAfter(lastHit.sort);
   */
  searchAfter(values: SortResults): this {
    if (!Array.isArray(values)) {
      throw new TypeError('searchAfter() expects an array of sort values');
    }
    this._searchAfter = structuredClone(values);
    return this;
  }

  /**
   * Get a copy of the search_after cursor used for deep pagination.
   * @returns The sort values to resume from, if set.
   */
  getSearchAfter() {
    return structuredClone(this._searchAfter);
  }

  /**
   * Control track_total_hits
   * @param value  true for an exact count, false to skip counting, or an
   *   integer >= 0 to count accurately up to that many hits
   * @throws TypeError when `value` is not a boolean or number
   * @throws RangeError when `value` is a number but not an integer >= 0
   * @example
   *   qb.trackTotalHits(true);
   */
  trackTotalHits(value: boolean | number): this {
    if (typeof value !== 'boolean') {
      assertNumber('trackTotalHits', value, { min: 0, integer: true });
    }
    this._trackTotalHits = value;
    return this;
  }

  /**
   * Get the current track_total_hits setting.
   * @returns A boolean to enable/disable exact hit counts, a number limit, or
   *   undefined if not set.
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
  range(field: Field, operator: RangeOperator, range: RangeShape): this {
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
   * @param slop  Word proximity allowed between phrase terms (default 0)
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.matchPhrase({ field: 'title', phrase: 'elasticsearch guide', slop: 1 });
   */
  matchPhrase({
    field,
    phrase,
    slop = 0,
  }: {
    field: Field;
    phrase: string;
    slop?: number;
  }): this {
    this._must.push({
      match_phrase: {
        [field]: {
          query: phrase,
          slop,
        },
      },
    });
    return this;
  }

  /**
   * Add a full-text phrase matching condition
   * @param field  The name of the field to search
   * @param phrase  A phrase string containing multipe words
   * @param options  Any other match_phrase_prefix options (e.g., slop, max_expansions)
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.matchPhrasePrefix({ field: 'title', phrase: 'elastic sea', slop: 1 });
   */
  matchPhrasePrefix({
    field,
    phrase,
    ...options
  }: Omit<estypes.QueryDslMatchPhrasePrefixQuery, 'query'> & {
    field: Field;
    phrase: string;
  }): this {
    this._must.push({
      match_phrase_prefix: {
        [field]: {
          ...options,
          slop: options.slop ?? 0,
          query: phrase,
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
   * @param options  Any other match options, including `analyzer`, `boost`, `operator`, `minimum_should_match`, `fuzziness`, `lenient`, `prefix_length`, `max_expansions`, `fuzzy_rewrite`, `zero_terms_query`, `cutoff_frequency`, and `fuzzy_transpositions`
   * @chainable
   * @example
   *   qb.match({ field: 'title', phrase: 'elastic', operator: 'and' });
   */
  match({
    field,
    phrase,
    ...options
  }: Omit<QueryDslMatchQuery, 'query'> & {
    phrase: string;
    field: Field;
  }): this {
    this._must.push({
      match: {
        [field]: {
          ...options,
          query: phrase,
        },
      },
    });
    return this;
  }

  /**
   * Create a basic multi_match clause and add any of the available options
   * @param fields The field to search
   * @param phrase  The value to match on
   * @param options  Additional options, including `analyzer`, `auto_generate_synonyms_phrase_query`, `cutoff_frequency`, `fuzziness`, `fuzzy_rewrite`, `fuzzy_transpositions`, `lenient`, `max_expansions`, `minimum_should_match`, `operator`, `prefix_length`, `slop`, `tie_breaker`, `type`, `zero_terms_query`
   * @chainable
   * @example
   *   qb.multiMatch({
   *     fields: ['title^2','summary],
   *     phrase: 'elastic',
   *     operator: 'and'
   *   });
   */
  multiMatch({
    fields,
    phrase,
    ...options
  }: Omit<QueryDslMultiMatchQuery, 'query'> & { phrase: string }): this {
    this._must.push({
      multi_match: {
        fields,
        ...options,
        query: phrase,
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
    field: Field;
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
   * Search with Reciprocal rank fusion especially for semantic_text fields
   * @see https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion
   *
   * @param semanticField  The name of the semantic_text field
   * @param standardField  The name of the text field containing equivalent content
   * @param phrase  The phrase to search
   * @param boosts  An array of four integers representing boost of exact match, phrase match, match, semantic match
   * @param weight  The weight of this retriever block
   * @example
   *   qb.weightedSemantic({
   *     semanticField: 'content_semantic',
   *     standardField: 'content',
   *     phrase: 'neural network',
   *     boosts: [5, 3, 1, 4],
   *     weight: 2
   *   });
   */
  weightedSemantic({
    semanticField,
    standardField,
    boosts = [6, 4, 1, 2],
    phrase,
    weight = 1,
  }: {
    semanticField: Field;
    standardField: Field;
    boosts?: [number, number, number, number];
    phrase: string;
    weight?: number;
  }): this {
    this._retrievers.push({
      retriever: {
        rrf: {
          retrievers: [
            {
              standard: {
                query: {
                  bool: {
                    should: [
                      {
                        wildcard: {
                          // exact text contained in standard field
                          [`${standardField}.raw`]: {
                            value: `*${this.escapeWildcards(phrase)}*`,
                            case_insensitive: true,
                            boost: boosts[0],
                          },
                        },
                      },
                      {
                        match_phrase: {
                          // unpunctuated, stemmed text contained in standard field
                          [standardField]: {
                            query: phrase,
                            boost: boosts[1],
                          },
                        },
                      },
                      {
                        match: {
                          // flexible word matching on text contained in standard field
                          [standardField]: {
                            query: phrase,
                            boost: boosts[2],
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            {
              standard: {
                query: {
                  semantic: {
                    // semantic meaning on semantic field
                    field: semanticField,
                    query: phrase,
                    boost: boosts[3],
                  },
                },
              },
            },
          ],
          rank_window_size: 100,
          rank_constant: 10,
        },
      },
      weight,
      normalizer: 'minmax',
    });

    return this; // Enable chaining
  }

  escapeWildcards(text: string) {
    return text
      .replace(/\\/g, '\\\\') // Escape backslashes first
      .replace(/\*/g, '\\*') // Escape asterisks
      .replace(/\?/g, '\\?'); // Escape question marks
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
    semanticField: Field;
    standardField: Field;
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
  semantic({
    field,
    phrase,
    weight = 1,
  }: {
    field: Field;
    phrase: string;
    weight: number;
  }): this {
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
   * @param field  The name of the field to search OR an object {field:name, value:value}
   * @param value  A string to match
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.term({ field: 'status', value: 'active' });
   *   qb.term('tag', 'music');
   */
  term(field: Field | { field: Field; value: any }, value?: any): this {
    const effectiveName = typeof field === 'string' ? field : field.field;
    const effectiveValue = typeof field === 'string' ? value : field.value;
    this._must.push({
      term: {
        [effectiveName]: effectiveValue,
      },
    });
    return this;
  }

  /**
   * Add a wildcard matching condition
   *
   * @param field  The name of the field to search OR an object {field:name, value:value, caseSensitive:bool}
   * @param value  A string to match
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.wildcard({ field: 'description.keyword', value: '*United Airlines*', caseSensitive: false });
   *   qb.wildcard('description.keyword', '*United Airlines*');
   */
  wildcard(
    field: Field | { field: Field; value: string; caseSensitive?: boolean },
    value?: string,
  ): this {
    const effectiveName = typeof field === 'string' ? field : field.field;
    const effectiveValue = typeof field === 'string' ? value : field.value;
    this._must.push({
      wildcard: {
        [effectiveName]: {
          value: effectiveValue,
          case_insensitive:
            typeof field === 'string' ? true : !field.caseSensitive,
        },
      },
    });
    return this;
  }

  /**
   * Require field to contain the exact phrase
   *
   * @param field  The name of the field to search OR an object {field:name, value:value, caseSensitive:bool}
   * @param value  A string to match
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.containExact({ field: 'description.keyword', value: 'United Airlines' });
   *   qb.containExact('description.keyword', 'United Airlines');
   */
  containsExact(
    field: Field | { field: Field; value: string; caseSensitive?: boolean },
    value?: string,
  ): this {
    const effectiveName = typeof field === 'string' ? field : field.field;
    const effectiveValue =
      typeof field === 'string' ? (value ?? '') : field.value;
    const escaped = this.escapeWildcards(effectiveValue);
    this._must.push({
      wildcard: {
        [effectiveName]: {
          value: `*${escaped}*`,
          case_insensitive:
            typeof field === 'string' ? true : !field.caseSensitive,
        },
      },
    });
    return this;
  }

  /**
   * Add a regular expression matching condition
   *
   * @param field  The name of the field to search OR an object {field:name, value:value, caseSensitive:bool}
   * @param value  A string to match
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.rexgep({ field: 'description.keyword', value: 'iP(od|ad|hone) \d+', caseSensitive: true });
   *   qb.rexgep('description.keyword', 'iP(od|ad|hone) \d+');
   */
  rexgep(
    field: Field | { field: Field; value: string; caseSensitive?: boolean },
    value?: string,
  ): this {
    const effectiveName = typeof field === 'string' ? field : field.field;
    const effectiveValue =
      typeof field === 'string' ? (value ?? '') : field.value;
    this._must.push({
      regexp: {
        [effectiveName]: {
          value: effectiveValue,
          case_insensitive:
            typeof field === 'string' ? false : !field.caseSensitive,
        },
      },
    });
    return this;
  }

  /**
   * Require that the given field or fields contain values (i.e. non-missing, non-null)
   * @param field  The name of the field or an object with { field: name }
   * @returns {QueryBuilder}
   * @example
   *   qb.exists({ field: 'author' });
   *   qb.exists('publisher');
   */
  exists(field: Field | { field: Field }): this {
    const effectiveField = typeof field === 'string' ? field : field.field;
    this._must.push({ exists: { field: effectiveField } });
    return this;
  }

  /**
   * Add a Lucene expression condition
   * @see https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-query-string-query
   *
   * @param field  The name of the field to search OR an object with {field:name,queryString:value}
   * @param queryString  A string containing special operators such as AND, NOT, OR, ~, *
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.queryString({ field: 'title', queryString: 'quick AND fox' });
   *   qb.queryString('introduction', 'quick AND fox');
   */
  queryString(
    field:
      | Field
      | {
          field: Field;
          queryString: string;
        },
    queryString?: string,
  ): this {
    const effectiveName = typeof field === 'string' ? field : field.field;
    const effectiveValue =
      typeof field === 'string' ? (queryString ?? '') : field.queryString;
    this._must.push({
      query_string: {
        fields: [effectiveName],
        query: effectiveValue,
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
    ...options
  }: MoreLikeThisOptions & {
    field: Field;
    like: MoreLikeThisLikeParams;
  }): this {
    this._must.push({
      more_like_this: {
        fields: [field],
        like,
        ...options,
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
    field: Field;
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
    field: Field;
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
   *   qb.rescore(
   *     (q) => { q.match({ field: 'title', phrase: 'elasticsearch' }); },
   *     { windowSize: 50 }
   *   );
   */
  rescore(
    withBuilder: (qb: QueryBuilder<Field>) => void,
    {
      windowSize,
    }: {
      windowSize: number;
    },
  ): this {
    const qb = new QueryBuilder<Field>();
    withBuilder(qb);
    const query = qb.getQuery();
    if (!query.query) {
      return this;
    }
    const entry: SearchRescore = {
      window_size: windowSize,
      query: {
        // @ts-expect-error We already filtered out retriever queries
        rescore_query: query,
      },
      length: 2,
    };
    this._rescore = [...(this._rescore ?? []), entry];
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
   * Return faceted data using ElasticSearch's "aggregation" feature against a keyword field
   * @param field  The name of a field to aggregate into buckets (e.g. 'osisID.keyword')
   * @param limit  The maximum number of buckets to return for the facet [default=25]
   * @param showTermDocCountError  When true, Elasticsearch adds per-bucket accuracy metadata
   *   (e.g., `doc_count_error_upper_bound`) to indicate the maximum error caused by
   *   distributed counting across shards. Useful for diagnosing/monitoring count accuracy,
   *   with a small overhead. [default=false]
   * @param orderBy Array of ordering instructions. If the only item is `{ field: '_count' }`,
   *   the aggregation uses a `terms` agg ordered by bucket frequency. Otherwise, a
   *   `composite` agg is built with one `terms`-based source per entry, ordered by those keys.
   * @property field  The field to order by (use '_count' to order by bucket count)
   * @property order  Either 'asc' or 'desc'
   * @param missing_bucket  If true, include a bucket for documents missing the value
   * @param missing_order  'first' to put the missing bucket first, 'last' to put it last
   * @param exclude An array of field names to exclude from facet results
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.aggregateTerm({ field: 'chapterNumber' });
   *   qb.aggregateTerm({
   *     field: 'chapterNumber',
   *     limit: 1000,
   *     showTermDocCountError: true,
   *     orderBy: [{ field: 'chapterNumber': order: 'asc' }],
   *   });
   */
  aggregateTerm({
    field,
    limit = 25,
    showTermDocCountError = false,
    orderBy = [{ field: '_count', order: 'desc' }],
    exclude = [],
    missing_bucket,
    missing_order,
  }: {
    field: Field;
    limit?: number;
    showTermDocCountError?: boolean;
    orderBy?: Array<{
      field: Field | '_count';
      order: SortOrder;
    }>;
    missing_bucket?: boolean;
    missing_order?: estypes.AggregationsMissingOrder;
    exclude?: string[];
  }): this {
    if (orderBy.length === 1 && orderBy[0].field === '_count') {
      this._aggs[field] = {
        terms: {
          field,
          size: limit,
          show_term_doc_count_error: showTermDocCountError,
          order: { _count: orderBy[0].order ?? 'desc' },
          ...(missing_bucket === undefined ? {} : { missing_bucket }),
          ...(missing_order === undefined ? {} : { missing_order }),
          ...(exclude.length === 0 ? {} : { exclude }),
        },
      };
    } else {
      this._aggs[field] = {
        terms: {
          field,
          size: limit,
          show_term_doc_count_error: showTermDocCountError,
          order: Object.fromEntries(
            orderBy.map((o) => [
              o.field === field ? '_key' : o.field, // Map field name to _key when it matches the aggregation field
              o.order,
            ]),
          ),
          ...(missing_bucket === undefined ? {} : { missing_bucket }),
          ...(missing_order === undefined ? {} : { missing_order }),
          ...(exclude.length === 0 ? {} : { exclude }),
        },
        aggs: Object.fromEntries(
          orderBy.map((o) => {
            const field = o.field;
            const dir = o.order === 'desc' ? 'min' : 'max';
            return [field, { [dir]: { field } }];
          }),
        ) as Record<string, AggregationsAggregationContainer>,
      };
    }
    this.limit(0);
    return this;
  }

  /**
   * Return faceted data binned by a numeric interval using a composite "histogram" source.
   *
   * Unlike `aggregateTerm`, histograms cannot be ordered by `_count` inside `composite`;
   * buckets are emitted in key order (you control direction via each source's `order`).
   *
   * @param field  The numeric field to bucket (e.g., 'price', 'durationMs')
   * @param interval  The width of each histogram bucket (e.g., 10, 1000)
   * @param limit  The maximum number of composite buckets to return per page [default=25]
   * @param orderBy  Array of composite histogram sources to control ordering (and add secondary sort keys).
   *   If omitted, a single source is synthesized from `{ field, interval, order: 'asc' }`.
   * @property field  Numeric field name for the histogram source
   * @property interval  Bucket width for the histogram source
   * @property order  'asc' or 'desc' for bucket-key order (default 'asc')
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.aggregateHistogram({ field: 'price', interval: 50 });
   *   qb.aggregateHistogram({
   *     field: 'latencyMs',
   *     interval: 25,
   *     orderBy: [{ field: 'latencyMs', interval: 25, order: 'desc' }],
   *   });
   */
  aggregateHistogram({
    field,
    interval,
    limit = 25,
    orderBy,
  }: {
    field: Field;
    interval: number;
    limit?: number;
    orderBy?: Array<CompositeSourceWithField<'histogram'>>;
  }): this {
    const sources: Array<
      Record<string, AggregationsCompositeAggregationSource>
    > =
      orderBy && orderBy.length > 0
        ? orderBy.map((o) => ({ [o.field]: { histogram: o } }))
        : [{ [field]: { histogram: { field, interval, order: 'asc' } } }];

    this._aggs[field] = {
      composite: {
        size: limit,
        sources,
      },
    };
    this.limit(0);
    return this;
  }

  /**
   * Return faceted data binned by time using a composite "date_histogram" source.
   *
   * You must specify either `calendarInterval` (e.g., '1d', '1w', '1M') or `fixedInterval`
   * (e.g., '24h', '15m'). Ordering by `_count` is not supported in `composite`; buckets are
   * sorted by key(s) you define.
   *
   * @param field  The date/datetime field to bucket (e.g., '@timestamp')
   * @param limit  The maximum number of composite buckets to return per page [default=25]
   * @param calendarInterval  Calendar-based interval (one of year|quarter|month|week|day|hour|minute|second)
   * @param fixedInterval  Fixed time interval string (e.g., '24h', '90m'); use instead of `calendarInterval`
   * @param timeZone  IANA time zone or offset to apply when bucketing (e.g., 'America/Denver', '+00:00')
   * @param format  Output format for the bucket key as a date string
   * @param offset  Shift the bucket boundaries (e.g., '+6h', '-1d')
   * @param order  'asc' or 'desc' for the primary source (default 'asc')
   * @param orderBy  Array of composite date-histogram sources. If omitted, a single source is built
   *   from the parameters above.
   * @property field  Date field name
   * @property calendar_interval  Calendar interval (snake_case form for the composite source)
   * @property fixed_interval  Fixed interval string (snake_case form)
   * @property time_zone  Time zone for bucketing (snake_case form)
   * @property format  Output format for bucket keys
   * @property offset  Boundary shift for buckets
   * @property order  'asc' | 'desc' for source key ordering
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.aggregateDateHistogram({ field: '@timestamp', calendarInterval: 'day' });
   *   qb.aggregateDateHistogram({
   *     field: '@timestamp',
   *     fixedInterval: '1h',
   *     timeZone: 'America/Denver',
   *     order: 'desc',
   *   });
   */
  aggregateDateHistogram({
    field,
    limit = 25,
    calendarInterval,
    fixedInterval,
    timeZone,
    format,
    offset,
    order = 'asc',
    orderBy,
  }: {
    field: Field;
    limit?: number;
    calendarInterval?: string;
    fixedInterval?: string;
    timeZone?: string;
    format?: string;
    offset?: string;
    order?: 'asc' | 'desc';
    orderBy?: Array<CompositeSourceWithField<'date_histogram'>>;
  }): this {
    let sources: Array<Record<string, AggregationsCompositeAggregationSource>>;

    if (orderBy && orderBy.length > 0) {
      sources = orderBy.map((o) => ({ [o.field]: { date_histogram: o } }));
    } else {
      // Build a single date_histogram source from the provided params
      const src: AggregationsCompositeAggregationSource['date_histogram'] = {
        field,
        order,
        ...(calendarInterval ? { calendar_interval: calendarInterval } : {}),
        ...(fixedInterval ? { fixed_interval: fixedInterval } : {}),
        ...(timeZone ? { time_zone: timeZone } : {}),
        ...(format ? { format } : {}),
        ...(offset ? { offset } : {}),
      };
      if (!src.calendar_interval && !src.fixed_interval) {
        throw new Error(
          'aggregateDateHistogram: require either calendarInterval or fixedInterval.',
        );
      }
      sources = [{ [field]: { date_histogram: src } }];
    }

    this._aggs[field] = {
      composite: {
        size: limit,
        sources,
      },
    };
    this.limit(0);
    return this;
  }

  /**
   * Return faceted data binned by map tiles using a composite "geotile_grid" source.
   *
   * @param field  The `geo_point` field to bucket (e.g., 'location')
   * @param precision  Tile precision (zoom level) from 0–29 (higher = finer grid)
   * @param limit  The maximum number of composite buckets to return per page [default=25]
   * @param bounds  Optional bounding box to limit tiles considered
   *   (e.g., { top_left: "41,-109", bottom_right: "37,-102" })
   * @param order  'asc' or 'desc' for the tile key order (default 'asc')
   * @param orderBy  Array of composite geotile grid sources. If omitted, a single source is built
   *   from the parameters above.
   * @property field  geo_point field name for the grid source
   * @property precision  Tile precision level
   * @property bounds  Bounding box for the grid source
   * @property order  'asc' | 'desc' for key ordering
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.aggregateGeotileGrid({ field: 'location', precision: 7 });
   *   qb.aggregateGeotileGrid({
   *     field: 'location',
   *     precision: 8,
   *     bounds: { top_left: '40.8,-74.3', bottom_right: '40.4,-73.6' },
   *   });
   */
  aggregateGeotileGrid({
    field,
    precision,
    limit = 25,
    bounds,
    order = 'asc',
    orderBy,
  }: {
    field: Field;
    precision: number;
    limit?: number;
    bounds?: { top_left: string; bottom_right: string };
    order?: 'asc' | 'desc';
    orderBy?: Array<CompositeSourceWithField<'geotile_grid'>>;
  }): this {
    const sources: Array<
      Record<string, AggregationsCompositeAggregationSource>
    > =
      orderBy && orderBy.length > 0
        ? orderBy.map((o) => ({ [o.field]: { geotile_grid: o } }))
        : [
            {
              [field]: {
                geotile_grid: {
                  field,
                  precision,
                  ...(bounds ? { bounds } : {}),
                  order,
                },
              },
            },
          ];

    this._aggs[field] = {
      composite: {
        size: limit,
        sources,
      },
    };
    this.limit(0);
    return this;
  }

  includeFacets() {}

  /**
   * Manually set the aggs array
   * @param aggs
   */
  aggs(aggs: Record<string, AggregationsAggregationContainer> = {}): this {
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
   * Add a date histogram aggregation (COUNT(*) grouped by time buckets).
   * ES 9 requires using `calendar_interval` or `fixed_interval` (the old `interval` is removed).
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/current/search-aggregations-bucket-datehistogram-aggregation.html
   *
   * @param field     The date/datetime field to bucket (e.g. '@timestamp')
   * @param interval  One of: 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second'
   *                  - calendar intervals (year, quarter, month, week, day) align to calendar boundaries
   *                  - fixed intervals (hour, minute, second here) use exact durations (uniform size)
   * @param limit     Max number of buckets returned per page (via composite size) [default=100]
   * @param offset    Shift bucket boundaries (e.g. '+6h', '-1d'); must include a unit compatible with your interval
   * @param timezone  IANA TZ (e.g. 'America/Denver'), 'UTC'/'Z', a string offset '±HH:MM', or a numeric minute offset
   * @returns         This instance (chainable)
   *
   * @example
   *   qb.dateHistogram({ field: 'created_at', interval: 'month', timezone: 'UTC' });
   *   qb.dateHistogram({ field: '@timestamp', interval: 'hour', offset: '+30m', timezone: 'America/Denver' });
   */
  dateHistogram({
    field,
    interval,
    limit = 100,
    offset = null,
    timezone = 'UTC',
  }: {
    field: Field;
    interval:
      | 'year'
      | 'quarter'
      | 'month'
      | 'week'
      | 'day'
      | 'hour'
      | 'minute'
      | 'second';
    limit?: number;
    offset?: string | null;
    timezone?: string | number;
  }): this {
    // Map human-friendly interval names to ES9 calendar/fixed intervals and output formats (Java time)
    const intervals: Record<
      | 'year'
      | 'quarter'
      | 'month'
      | 'week'
      | 'day'
      | 'hour'
      | 'minute'
      | 'second',
      { code: string; format: string; kind: 'calendar' | 'fixed' }
    > = {
      year: { code: '1y', format: 'uuuu', kind: 'calendar' },
      quarter: { code: '1q', format: "uuuu-'Q'Q", kind: 'calendar' },
      month: { code: '1M', format: 'uuuu-MM', kind: 'calendar' },
      week: { code: '1w', format: "YYYY-'W'ww", kind: 'calendar' }, // ISO week-based year/week
      day: { code: '1d', format: 'uuuu-MM-dd', kind: 'calendar' },
      hour: { code: '1h', format: "uuuu-MM-dd'T'HH", kind: 'fixed' },
      minute: { code: '1m', format: "uuuu-MM-dd'T'HH:mm", kind: 'fixed' },
      second: { code: '1s', format: "uuuu-MM-dd'T'HH:mm:ss", kind: 'fixed' },
    } as const;

    const intv = intervals[interval];
    if (!intv) {
      const supported = Object.keys(intervals).join(', ');
      throw new Error(
        `QueryBuilder.dateHistogram(): interval not supported. Supported intervals are ${supported}.`,
      );
    }

    const timeZone = normalizeTimeZone(timezone);

    // Validate offset if provided (ES expects things like "+6h", "-1d", "+30m")
    if (offset != null) {
      const okOffset = /^[+-]\d+(ms|s|m|h|d|w|M|q|y)$/.test(offset);
      if (!okOffset) {
        throw new Error(
          `QueryBuilder.dateHistogram(): offset must look like "+30m", "-6h", "+1d", etc. Received ${JSON.stringify(offset)}`,
        );
      }
    }

    return this.aggregateDateHistogram({
      field,
      limit,
      fixedInterval: intv.kind === 'fixed' ? intv.code : undefined,
      calendarInterval: intv.kind === 'calendar' ? intv.code : undefined,
      format: intv.format,
      timeZone, // pass through; ES uses "time_zone"
      offset: offset ?? undefined,
      order: 'asc',
    });
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
    const fields =
      field === null ? all : Array.isArray(field) ? field : [field];
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
   * Create a deep copy of this instance. All accumulated state is cloned
   * with structuredClone so that mutating the copy (or the original) does
   * not affect the other.
   */
  clone(): QueryBuilder<Field> {
    const copy = new QueryBuilder<Field>({ index: this._index });
    copy._fields = structuredClone(this._fields);
    copy._excludeFields = structuredClone(this._excludeFields);
    copy._must = structuredClone(this._must);
    copy._aggs = structuredClone(this._aggs);
    copy._functionScores = structuredClone(this._functionScores);
    copy._highlighter = structuredClone(this._highlighter);
    copy._limit = this._limit;
    copy._page = this._page;
    copy._sorts = structuredClone(this._sorts);
    copy._retrievers = structuredClone(this._retrievers);
    copy._normalizer = this._normalizer;
    copy._rankWindowSize = this._rankWindowSize;
    copy._rankConstant = this._rankConstant;
    copy._rescore = structuredClone(this._rescore);
    copy._minScore = this._minScore;
    copy._searchAfter = structuredClone(this._searchAfter);
    copy._trackTotalHits = this._trackTotalHits;
    copy._shouldSortByRandom = this._shouldSortByRandom;
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
   * Add a function score definition (e.g. gauss/exp/linear decay,
   * field_value_factor, script_score). All added functions are applied to
   * the final query inside a single `function_score` wrapper when
   * getBody()/getQuery() is called. Function scores only apply when the
   * query is built on the standard query path; when retrievers (kNN, RRF,
   * semantic) are in use the functions are ignored.
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/query-dsl-function-score-query.html#function-decay
   * @chainable
   * @example
   *   qb.decayFunctionScore({
   *     gauss: {
   *       created_at: { origin: "now", scale: "7d", decay: 0.5 }
   *     }
   *   });
   */
  decayFunctionScore(functionScore: QueryDslFunctionScoreContainer): this {
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
   * @param {Array<Function>} withBuilders   Callbacks, invoked with (qb, idx), used to build each branch
   * @param {Object} params                     The configuration object
   * @property {number} [params.minimumShouldMatch=1]  Minimum number of branches that must match
   * @returns {this} This QueryBuilder instance for chaining
   * @chainable
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/query-dsl-bool-query.html#query-dsl-bool-query-should
   * @example
   * // Match documents that satisfy at least one branch
   * query.should(
   *   [
   *     (qb) => { qb.term("status", "published"); },
   *     (qb) => { qb.range("created_at", { gte: "now-7d" }); },
   *   ],
   *   {
   *     minimumShouldMatch: 1, // or "50%"
   *   }
   * );
   */
  should(
    withBuilders: Array<(qb: QueryBuilder<Field>, idx: number) => any>,
    {
      minimumShouldMatch = 1,
    }: {
      minimumShouldMatch?: number | string;
    } = {},
  ): this {
    if (withBuilders.length === 1) {
      // just a single condition - treat like must
      const qb = new QueryBuilder<Field>();
      withBuilders[0](qb, 0);
      const musts = qb.getMust();
      if (musts.length > 0) {
        this._must.push(musts[0]);
      }
      return this;
    }
    const bool: any = { should: [], minimum_should_match: minimumShouldMatch };
    for (let i = 0; i < withBuilders.length; i++) {
      // should match at least minimumShouldMatch conditions
      const qb = new QueryBuilder<Field>();
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
   * @example
   * query.mustNot(qb => qb.term('visibility', 'hidden'))
   */
  mustNot(withBuilder: (qb: QueryBuilder<Field>) => any): this {
    const qb = new QueryBuilder<Field>();
    withBuilder(qb);
    this._must.push({ bool: { must_not: qb.getMust() } });
    return this;
  }

  /**
   * Add a custom match condition, perhaps not supported by the QueryBuilder
   * @param customMust
   */
  must(customMust: QueryDslQueryContainer) {
    this._must.push(customMust);
    return this;
  }

  /**
   * Get a Query Builder to add a negative condition such as
   * "exclude documents that match at least k of these clauses"
   * @param withBuilders  An array of functions that each take a QueryBuilder to allow adding conditions
   * @param shouldOptions
   * @property minimumShouldMatch  Number of negative conditions that must match
   * @example
   * query.shouldNot([
   *   qb => qb.term('visibility', 'hidden'),
   *   qb => qb.term('color', 'red'),
   *   qb => qb.term('disabled', true),
   * ], {
   *   minimumShouldMatch: 2
   * })
   */
  shouldNot(
    withBuilders: Array<(qb: QueryBuilder<Field>) => any>,
    shouldOptions: {
      minimumShouldMatch: number | string;
    },
  ): this {
    return this.mustNot((qb) => {
      qb.should(withBuilders, shouldOptions);
    });
  }

  /**
   * Add a nested condition
   * @param query  A function that takes a QueryBuilder to allow adding conditions
   * @param path  The path to this nesting layer
   * @param scoreMode  score_mode=avg
   * @param innerHits  inner_hits=undefined
   * @param ignoreUnmapped  ignoreUnmapped=false
   * @example
   * query.nested({
   *   path: 'tags',
   *   query: qb => qb.term('name', 'health'),
   * })
   */
  nested({
    query,
    path,
    scoreMode = 'avg',
    innerHits = undefined,
    ignoreUnmapped = false,
  }: {
    query: (qb: QueryBuilder<Field>) => void;
    path: Field;
    scoreMode?: QueryDslChildScoreMode;
    innerHits?: SearchInnerHits;
    ignoreUnmapped?: boolean;
  }): this {
    const qb = new QueryBuilder<Field>();
    query(qb);
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
    const body: SearchRequest = {};

    // Determine what we're working with
    const hasLinearRetrievers = this._retrievers.length > 0;
    const hasFilters = this._must.length > 0;

    // Build the retriever
    if (hasLinearRetrievers) {
      // LINEAR RETRIEVER PATH
      const retrievers = [...this._retrievers];

      // Only use linear if we have multiple retrievers
      if (retrievers.length > 1 || hasFilters) {
        const linear: NonNullable<RetrieverContainer['linear']> = {
          retrievers,
          normalizer: this._normalizer,
          rank_window_size: this._rankWindowSize,
        };
        if (hasFilters) {
          linear.filter = [this._buildBoolQuery()];
        }
        body.retriever = { linear };
      } else {
        body.retriever = retrievers[0].retriever;
      }
    } else if (hasFilters) {
      // STANDARD RETRIEVER PATH (with query)
      body.query = this._applyScoreFunctions(this._buildBoolQuery());
      if (this._sorts.length > 0) {
        body.sort = this._sorts;
      }
    } else {
      // match all documents
      body.query = this._applyScoreFunctions({ match_all: {} });
      if (this._sorts.length > 0) {
        body.sort = this._sorts;
      }
    }

    // Add highlighting if specified
    if (!isEmptyObject(this._highlighter.fields)) {
      body.highlight = structuredClone(this._highlighter);
    }

    // Add aggregations if specified
    if (!isEmptyObject(this._aggs)) {
      body.aggs = this._aggs;
    }

    // Add rescore if specified and supported (requires a standard query retriever)
    if (this._rescore && this._rescore.length > 0) {
      let canRescore = false;
      if (body.query) {
        canRescore = true;
      } else if (body.retriever?.linear) {
        const retrs = (body.retriever.linear.retrievers ||
          []) as InnerRetriever[];
        canRescore =
          Array.isArray(retrs) && retrs.some((r) => r?.retriever?.standard);
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
   * Wrap a query in a function_score containing any functions added via
   * decayFunctionScore() plus a random_score function if sortByRandom()
   * is enabled. Returns the query untouched when there is nothing to apply.
   */
  private _applyScoreFunctions(
    query: QueryDslQueryContainer,
  ): QueryDslQueryContainer {
    const functions: QueryDslFunctionScoreContainer[] = [
      ...this._functionScores,
    ];
    if (this._shouldSortByRandom) {
      functions.push({ random_score: {} });
    }
    if (functions.length === 0) {
      return query;
    }
    const functionScore: QueryDslFunctionScoreQuery = { query, functions };
    if (this._shouldSortByRandom) {
      // random_score should fully replace the relevance score
      functionScore.boost_mode = 'replace';
    }
    return { function_score: functionScore };
  }

  /**
   * Return the "size" and "from" based on "limit" and "page"
   * @return The options to send in the builder
   */
  getOptions() {
    const options: Pick<
      SearchRequest,
      'size' | 'from' | 'min_score' | 'search_after' | 'track_total_hits'
    > = {};
    if (this._limit !== null) {
      options.size = this._limit;
      if (this._page > 1) {
        options.from = this._limit * (this._page - 1);
      }
    }
    if (typeof this._minScore === 'number') {
      options.min_score = this._minScore;
    }
    if (Array.isArray(this._searchAfter) && this._searchAfter.length > 0) {
      options.search_after = structuredClone(this._searchAfter);
    }
    if (
      typeof this._trackTotalHits === 'boolean' ||
      typeof this._trackTotalHits === 'number'
    ) {
      options.track_total_hits = this._trackTotalHits;
    }
    return options;
  }

  /**
   * Get an object representation of the builder body
   * suitable for the Elasticsearch SDK or Kibana
   * @return {Object}
   */
  getQuery(overrides: Partial<SearchRequest> = {}): SearchRequest {
    return {
      ...(this._index ? { index: this._index } : {}),
      _source: this._getSource(),
      ...this.getBody(),
      ...this.getOptions(),
      ...overrides,
    };
  }

  /**
   * Build the body's `_source`: `false` when `fields([])` was set, the
   * includes array when nothing is excluded, otherwise one object with both
   * lists. Excludes always go in the body: the client would send a separate
   * `_source_excludes` key as a URL parameter, which makes Elasticsearch
   * ignore the body's includes, and Kibana rejects it as a body key.
   */
  private _getSource(): NonNullable<SearchRequest['_source']> {
    if (this._fields.length === 0) {
      return false;
    }
    if (this._excludeFields.length === 0) {
      return [...this._fields];
    }
    return { includes: [...this._fields], excludes: [...this._excludeFields] };
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
   * @param {String} indexOverride  The index to pull the name from
   * @return {String}
   */
  toKibana(indexOverride?: string): string {
    const { index, ...query } = this.getQuery();
    const json = JSON.stringify(query, null, 4);
    return `GET ${indexOverride || this._index}/_search\n${json}`;
  }
}
