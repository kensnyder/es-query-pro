export type BoostType = {
	expand?: boolean;
	boosts?: [or: number, and: number, phrase: number];
};

export type AnyAllType = 'ANY' | 'ALL' | 'any' | 'all';

export type MatchType = 'match' | 'term';

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
	| 'functionScores'
	| 'textProcessor';

export type FieldTypeOrTypes = FieldType | FieldType[] | null;

export type FunctionScoreItemType = {
	field: string;
	decayFunction?: 'gauss' | 'exp' | 'linear';
	decayOffset?: number;
	decayScale?: string;
	decayNumber?: number;
	decayOrigin?: string;
	multiValueMode?: 'min' | 'max' | 'avg' | 'sum';
};

export type EsClientType = {
	search: Function;
	close: Function;
};

export type SourceType = {
	_source?: string[];
	_sourceExclude?: string[];
};

export type FilterType = Record<string, any>;

export type AggregatesType = Record<string, any>;

export type RangeableType = string | number | string[] | number[];

export type SortType =
	| '_score'
	| {
			[field: string]: 'asc' | 'desc';
	  }
	| {
			[field: string]: {
				order: 'asc' | 'desc';
				format?: string;
			};
	  };

export type SizeFromSort = {
	size?: number;
	from?: number;
	sort?: SortType[];
};

export type BodyType = {
	query?: Record<string, any>;
	highlight?: HighlightType;
	aggs?: Record<string, any>;
	functions?: Record<string, any>[];
};

export type RunResultType = {
	result: {
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
				_source?: Record<string, any>;
				_type?: string;
				fields?: Record<string, any>;
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
	fields?: Record<string, any>;
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
