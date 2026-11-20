import type { estypes } from '@elastic/elasticsearch';

export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type BoostOperator = 'exact' | 'and' | 'or';

export type RangeOperator =
  | '>'
  | 'gt'
  | '<'
  | 'lt'
  | '>='
  | 'gte'
  | '<='
  | 'lte'
  | 'between';

export type SortDirection = 'asc' | 'desc';

export type IntervalType =
  | 'year'
  | 'quarter'
  | 'month'
  | 'week'
  | 'day'
  | 'hour'
  | 'minute'
  | 'second';

export type FieldType =
  | 'fields'
  | 'excludeFields'
  | 'must'
  | 'aggs'
  | 'functionScores'
  | 'highlighter'
  | 'sorts'
  | 'retrievers'
  | 'normalizer'
  | 'rankWindowSize'
  | 'rankConstant'
  | 'rescore'
  | 'minScore'
  | 'searchAfter'
  | 'trackTotalHits'
  | 'shouldSortByRandom'
  | 'page'
  | 'limit';

// Elasticsearch types
export type FieldTypeOrTypes = FieldType | FieldType[] | null;
export type RangeBound<T> = T | null | undefined;
/**
 * The value given to `QueryBuilder.range()`: one bound for a comparison
 * operator, or a `[min, max]` pair for `between` (a `null`/`undefined` side is
 * open). Dates may be `Date` objects (sent as ISO 8601 strings) or strings,
 * including date math such as `'now-1d'`, and the two may be mixed. Numeric
 * bounds may not be mixed with string or date bounds.
 */
export type RangeShape =
  | string
  | number
  | Date
  | [RangeBound<string | Date>, RangeBound<string | Date>]
  | [RangeBound<number>, RangeBound<number>];
export type QueryDslQueryContainer = estypes.QueryDslQueryContainer;
export type QueryDslMatchQuery = estypes.QueryDslMatchQuery;
export type QueryDslMultiMatchQuery = estypes.QueryDslMultiMatchQuery;
export type QueryDslMatchPhrasePrefixQuery =
  estypes.QueryDslMatchPhrasePrefixQuery;
export type SortOrder = estypes.SortOrder;
export type SortCombinations = Prettify<estypes.SortCombinations>;
export type QueryDslDecayFunctionBase = estypes.QueryDslDecayFunctionBase;
export type QueryDslFunctionScoreContainer =
  estypes.QueryDslFunctionScoreContainer;
export type QueryDslFunctionScoreQuery = estypes.QueryDslFunctionScoreQuery;
export type SearchRequest = Prettify<estypes.SearchRequest>;
export type IndexMetadataParams = Prettify<estypes.IndicesGetRequest>;
export type AliasMetadataParams = Prettify<estypes.IndicesGetAliasRequest>;
export type IndexExistParams = Prettify<estypes.IndicesExistsRequest>;
export type AliasExistParams = Prettify<estypes.IndicesExistsAliasRequest>;
export type IndexCreateParams = Prettify<estypes.IndicesCreateRequest>;
export type AliasCreateParams = Prettify<estypes.IndicesPutAliasRequest>;
export type DeleteRequestShape = Prettify<estypes.IndicesDeleteRequest>;
export type AliasDeleteParams = Prettify<estypes.IndicesDeleteAliasRequest>;
export type GetRequestParams = Prettify<estypes.GetRequest>;
export type PutRequestParams = Prettify<estypes.IndexRequest>;
export type BulkRequestParams = estypes.BulkRequest;
export type PatchRequestParams = Prettify<estypes.UpdateRequest>;
export type FlushRequestParams = Prettify<estypes.IndicesFlushRequest>;
export type MoreLikeThisOptions = Omit<
  estypes.QueryDslMoreLikeThisQuery,
  'fields' | 'like'
>;
export type MoreLikeThisLikeParams = estypes.QueryDslMoreLikeThisQuery['like'];
export type RetrieverContainer = estypes.RetrieverContainer;
export type InferenceCohereSimilarityType =
  estypes.InferenceCohereSimilarityType;
export type SearchRescore = estypes.SearchRescore;
export type SortResults = estypes.SortResults;
export type KnnRetriever = estypes.KnnRetriever;
export type QueryDslChildScoreMode = estypes.QueryDslChildScoreMode;
export type SearchInnerHits = estypes.SearchInnerHits;
export type InnerRetriever = estypes.InnerRetriever;
export type ScoreNormalizer = estypes.ScoreNormalizer;
export type AggregationsAggregateOrder = estypes.AggregationsAggregateOrder;
export type AggregationsAggregationContainer =
  estypes.AggregationsAggregationContainer;
export type AggregationsCompositeAggregationSource =
  estypes.AggregationsCompositeAggregationSource;
export type ErrorCause = estypes.ErrorCause;
