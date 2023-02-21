import QueryBuilder from './QueryBuilder/QueryBuilder';
import isEmptyObject from './isEmptyObject/isEmptyObject';

export type BoostType = {
	expand?: boolean;
	boosts?: [number, number, number];
};

export type AnyAll = 'ANY' | 'ALL' | 'any' | 'all';

export type MultiMatchType = {
	type?:
		| 'best_fields'
		| 'most_fields'
		| 'cross_fields'
		| 'phrase'
		| 'phrase_prefix'
		| 'bool_prefix';
	analyzer?: string;
	boost?: number;
	operator?: 'and' | 'or' | 'AND' | 'OR';
	minimum_should_match?: number;
	fuzziness?: number;
	lenient?: boolean;
	prefix_length?: number;
	max_expansions?: number;
	fuzzy_rewrite?: boolean;
	zero_terms_query?: 'none' | 'all';
	cutoff_frequency?: number;
	fuzzy_transpositions?: boolean;
};

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
	| 'functionScore'
	| 'textProcessor';

export type FieldTypeOrTypes = FieldType | FieldType[] | null;

export type FunctionScoreType = {
	field: string;
	query: QueryBuilder;
	decayFunction?: 'gauss' | 'exp' | 'linear';
	decayOffset?: number;
	decayScale?: string;
	decayNumber?: number;
	decayOrigin?: string;
	multiValueMode?: 'min' | 'max' | 'avg' | 'sum';
};

export type SizeAndFrom = {
	size: number;
	from: number;
};

export type BodyType = {
	query?: object;
	highlight: HighlightType;
	aggs: object;
};

export type RunResultType = {
	result:
		| object
		| {
				took: number;
				_shards: {
					total: number;
					successful: number;
					failed: number;
					failures?: Array<{
						shard: number;
						index: string;
						node: string;
						reason: {
							type: string;
							reason: string;
						};
					}>;
					skipped: number;
					shared: number;
				};
				hits: {
					total:
						| number
						| {
								value: number;
								relation: 'gt' | 'lt' | 'gte' | 'lte';
						  };
					hits: Array<{
						_index: string;
						_id: string;
						_score: number;
						_source?: object;
						_type?: string;
						fields?: object;
					}>;
				};
		  };
	error?: string;
};

export type HighlightType = {
	boundary_chars?: string;
	boundary_max_scan?: number;
	boundary_scanner?: 'chars' | 'sentence' | 'word';
	boundary_scanner_locale?: string;
	encoder?: 'default' | 'html';
	fields?: object;
	force_source?: boolean;
	fragmenter?: 'simple' | 'span';
	fragment_size?: number;
	highlight_query?: boolean;
	matched_fields?: boolean;
	no_match_size?: number;
	number_of_fragments?: number;
	phrase_limit?: number;
	pre_tags?: string[];
	post_tags?: string[];
	require_field_match?: boolean;
	max_analyzed_offset?: number;
	tags_schema?: 'styled' | boolean;
	type?: 'unified' | 'plain' | 'fvh';
};
