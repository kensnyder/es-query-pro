import { estypes } from '@elastic/elasticsearch';
import { ColumnName } from './IndexNameManager/IndexNameManager';

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

export type ElasticsearchRecord<T> =
  T extends Record<string, any>
    ? { [K in keyof T]: ElasticsearchRecord<T[K]> }
    : T extends ElasticsearchType
      ? T extends 'number'
        ? number
        : T extends 'boolean'
          ? boolean
          : string
      : never;

export type BoostType = {
  expand?: boolean;
  boosts?: [or: number, and: number, phrase: number];
};

export type AnyAllType = 'ANY' | 'ALL' | 'any' | 'all';

export type MatchType = 'match' | 'term';

export type OperatorType =
  | '>'
  | 'gt'
  | '<'
  | 'lt'
  | '>='
  | 'gte'
  | '<='
  | 'lte'
  | 'between';

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
  | 'sort'
  | 'page'
  | 'limit'
  | 'must'
  | 'mustNot'
  | 'aggs'
  | 'fields'
  | 'excludeFields'
  | 'highlighter'
  | 'functionScores';

// Elasticsearch types
export type FieldTypeOrTypes = FieldType | FieldType[] | null;
export type RangeShape = string | [string, string] | number | [number, number];
export type QueryShape = Prettify<estypes.QueryDslQueryContainer>;
export type MultiMatchQueryShape = Prettify<estypes.QueryDslMultiMatchQuery>;
export type SortShape = Prettify<estypes.SortCombinations>;
export type FunctionScoreShape = Prettify<estypes.QueryDslDecayFunctionBase>;
export type BoolQueryShape = Prettify<estypes.QueryDslBoolQuery>;
export type SearchRequestShape = Prettify<estypes.SearchRequest>;
export type IndexSettings = Prettify<estypes.IndicesCreateRequest['settings']>;
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
export type BulkRequestParams = Prettify<estypes.BulkRequest>;
export type PatchRequestParams = Prettify<estypes.UpdateRequest>;
export type FlushRequestParams = Prettify<estypes.IndicesFlushRequest>;
