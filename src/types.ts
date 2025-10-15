import type { estypes } from '@elastic/elasticsearch';
import type { ColumnName } from './IndexNameManager/IndexNameManager';

export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type ColumnType =
  | ElasticsearchType
  | Record<ColumnName, ElasticsearchType>;

export type SchemaShape = Record<ColumnName, ColumnType>;

export type ElasticsearchType =
  // Common types
  | 'binary'
  | 'boolean'
  | 'keyword'
  | 'constant_keyword'
  | 'wildcard'
  | 'long'
  | 'integer'
  | 'short'
  | 'byte'
  | 'double'
  | 'float'
  | 'half_float'
  | 'scaled_float'
  | 'unsigned_long'
  | 'date'
  | 'date_nanos'
  | 'alias'
  | 'text'

  // Text search types
  | 'match_only_text'
  | 'completion'
  | 'search_as_you_type'
  | 'semantic_text'
  | 'token_count';

export type ElasticsearchRecord<T> = T extends Record<string, any>
  ? {
      [K in keyof T]: ElasticsearchRecord<T[K]> | ElasticsearchRecord<T[K]>[];
    }
  : T extends ElasticsearchType
    ? T extends 'integer'
      ? number | null | number[]
      : T extends 'boolean'
        ? boolean | null | boolean[]
        : T extends 'date'
          ? Date | string | null | Date[] | string[]
          : string | null | string[]
    : any;

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
export type RangeShape = string | [string, string] | number | [number, number];
export type QueryDslQueryContainer = estypes.QueryDslQueryContainer;
export type QueryDslMultiMatchQuery = estypes.QueryDslMultiMatchQuery;
export type SortCombinations = Prettify<estypes.SortCombinations>;
export type QueryDslDecayFunctionBase = estypes.QueryDslDecayFunctionBase;
export type SearchRequestShape = Prettify<estypes.SearchRequest>;
export type IndexSettings = Prettify<estypes.IndicesCreateRequest['settings']>;
export type MappingProperty = Prettify<estypes.MappingProperty>;
export type MappingProperties = Record<string, MappingProperty>;
export type IndexMetadataParams = Prettify<estypes.IndicesGetRequest>;
export type AliasMetadataParams = Prettify<estypes.IndicesGetAliasRequest>;
export type IndexExistParams = Prettify<estypes.IndicesExistsAliasRequest>;
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
export type QueryBody = Pick<
  SearchRequestShape,
  'retriever' | 'highlight' | 'aggs' | 'rescore'
>;
