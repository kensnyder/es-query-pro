import type { estypes } from '@elastic/elasticsearch'; // TypeScript needs estypes even if we don't use it
import isEmptyObject from '../isEmptyObject/isEmptyObject';
import { normalizeTimeZone } from '../normalizeTimeZone/normalizeTimeZone';
import type {
  AggregationsAggregationContainer,
  AggregationsCompositeAggregationSource,
  BoostOperator,
  FieldType,
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

/** Options of a `range` query that `QueryBuilder.range()` passes through */
export type RangeOptions = Pick<
  estypes.QueryDslUntypedRangeQuery,
  'format' | 'time_zone' | 'relation' | 'boost'
>;

const RANGE_OPTION_KEYS = ['format', 'time_zone', 'relation', 'boost'] as const;

/** Every accepted (lower-cased) range operator and its DSL name */
const RANGE_OPERATORS: Record<string, string | undefined> = {
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

/**
 * Convert one range bound to its DSL value: `undefined` for a missing bound
 * (`null`, `undefined` or a blank string), an ISO 8601 string for a `Date`.
 * @throws TypeError when `value` is not a number, string or `Date`
 * @throws RangeError when `value` is a non-finite number or an invalid `Date`
 */
function toRangeBound(value: unknown): string | number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value.trim() === '' ? undefined : value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError(`range() expects a finite number, got ${value}`);
    }
    return value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new RangeError('range() got an invalid Date');
    }
    return value.toISOString();
  }
  throw new TypeError(
    `range() expects a number, string or Date, got ${typeof value}`,
  );
}

/**
 * Throw if a `between` pair of two numbers or two `Date`s is reversed. String
 * bounds are not compared: they may be date math or use a custom format.
 * @throws RangeError when `min > max`
 */
function assertRangeOrder(min: unknown, max: unknown) {
  let reversed = false;
  if (typeof min === 'number' && typeof max === 'number') {
    reversed = min > max;
  } else if (min instanceof Date && max instanceof Date) {
    reversed = min.getTime() > max.getTime();
  }
  if (reversed) {
    throw new RangeError(
      `range(): "between" min (${String(min)}) is greater than max (${String(max)})`,
    );
  }
}

/** Built-in date formats that parse `Date#toISOString()` output */
const ISO_DATE_FORMATS = new Set([
  'strict_date_optional_time',
  'date_optional_time',
  'strict_date_optional_time_nanos',
  'strict_date_time',
  'date_time',
]);

/**
 * Throw if a `Date` bound is combined with a `format` that cannot parse its
 * ISO 8601 string. Elasticsearch does not reject that combination; the
 * search silently matches nothing.
 * @throws TypeError when no `||`-separated part of `format` is ISO 8601
 */
function assertDateFormat(values: unknown[], format: unknown) {
  if (typeof format !== 'string' || !values.some((v) => v instanceof Date)) {
    return;
  }
  const accepted = format.split('||').some((f) => {
    return ISO_DATE_FORMATS.has(f.trim());
  });
  if (!accepted) {
    throw new TypeError(
      `range(): a Date is sent as ISO 8601, which format "${format}" ` +
        'cannot parse; pass a string in that format instead',
    );
  }
}

/**
 * Copy the known range options that are set; other keys are ignored.
 * @throws TypeError when `options` is not an object
 */
function pickRangeOptions(options: unknown): RangeOptions {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('range() expects options to be an object');
  }
  const picked: Record<string, unknown> = {};
  for (const key of RANGE_OPTION_KEYS) {
    const value = (options as Record<string, unknown>)[key];
    if (value !== undefined) {
      picked[key] = value;
    }
  }
  return picked as RangeOptions;
}

/** True for `null`, `undefined`, and strings that are empty or whitespace */
function isBlankPhrase(phrase: unknown): boolean {
  if (phrase === null || phrase === undefined) {
    return true;
  }
  return typeof phrase === 'string' && phrase.trim() === '';
}

/** The default `matchBoostedPhrase()` boost of each operator */
const BOOSTED_PHRASE_DEFAULTS: Record<BoostOperator, number> = {
  exact: 5,
  and: 3,
  or: 1,
};

/** A value a `term` query can match: a string, number or boolean */
export type TermValue = Exclude<estypes.FieldValue, null>;

/** Options of `QueryBuilder.term()` */
export type TermOptions = Pick<estypes.QueryDslTermQuery, 'boost'> & {
  /** Match case exactly (default `true`, as in Elasticsearch) */
  caseSensitive?: boolean;
};

/** Options of `QueryBuilder.wildcard()` and `QueryBuilder.containsExact()` */
export type WildcardOptions = Pick<
  estypes.QueryDslWildcardQuery,
  'boost' | 'rewrite'
> & {
  /** Match case exactly (default `false`) */
  caseSensitive?: boolean;
};

/** Options of `QueryBuilder.regexp()` */
export type RegexpOptions = Pick<
  estypes.QueryDslRegexpQuery,
  'boost' | 'rewrite' | 'flags' | 'max_determinized_states'
> & {
  /** Match case exactly (default `false`) */
  caseSensitive?: boolean;
};

/** Options of `QueryBuilder.queryString()` (everything but the query) */
export type QueryStringOptions = Omit<
  estypes.QueryDslQueryStringQuery,
  'query' | 'fields' | 'default_field'
>;

/** Options of `QueryBuilder.simpleQueryString()` */
export type SimpleQueryStringOptions = Omit<
  estypes.QueryDslSimpleQueryStringQuery,
  'query' | 'fields'
>;

/** Arguments of `QueryBuilder.termsSet()` */
export type TermsSetOptions<Field extends string = string> = {
  /** The field to search */
  field: Field;
  /** The terms to look for */
  terms: TermValue[];
  /** How many terms must match, e.g. `2` or `'75%'` */
  minimumShouldMatch?: estypes.MinimumShouldMatch;
  /** A numeric field holding the number of terms each document must match */
  minimumShouldMatchField?: Field;
  /** A script returning the number of terms that must match */
  script?: string | estypes.Script;
  boost?: number;
};

/** Options of `QueryBuilder.rescore()`; unset options use the ES defaults */
export type RescoreOptions = {
  /** How many top hits per shard to rescore, an integer >= 1 (ES default 10) */
  windowSize?: number;
  /** Weight of the original query's score (ES default 1) */
  queryWeight?: number;
  /** Weight of the rescore query's score (ES default 1) */
  rescoreQueryWeight?: number;
  /** How the two weighted scores combine (ES default `'total'`) */
  scoreMode?: estypes.SearchScoreMode;
};

const RESCORE_SCORE_MODES = new Set<string>([
  'avg',
  'max',
  'min',
  'multiply',
  'total',
]);

/**
 * Throw unless a sort can go with `rescore`. Elasticsearch rejects every
 * sort except a lone `_score` in descending order ("Cannot use [sort] option
 * in conjunction with [rescore]"), including `_score` followed by a
 * tie-breaker.
 * @throws TypeError for any other sort
 */
function assertRescoreSort(sort: SortCombinations[]) {
  if (sort.length === 1 && isScoreDescending(sort[0])) {
    return;
  }
  throw new TypeError(
    'rescore() cannot be combined with sort() unless the only sort is ' +
      `_score descending; got ${JSON.stringify(sort)}. ` +
      'Remove the sort or the rescore.',
  );
}

/** True for `'_score'`, `{ _score: 'desc' }` and `{ _score: { order: 'desc' } }` */
function isScoreDescending(sort: SortCombinations): boolean {
  if (sort === '_score') {
    return true;
  }
  if (sort === null || typeof sort !== 'object') {
    return false;
  }
  const keys = Object.keys(sort);
  if (keys.length !== 1 || keys[0] !== '_score') {
    return false;
  }
  const value: unknown = (sort as Record<string, unknown>)._score;
  if (typeof value === 'string') {
    return value === 'desc';
  }
  if (value !== null && typeof value === 'object') {
    const order = (value as { order?: unknown }).order;
    return order === undefined || order === 'desc';
  }
  return false;
}

/** One `aggregateTerm()` ordering criterion */
export type TermsOrderBy<Field extends string = string> = {
  /**
   * `'_count'` (bucket size), `'_key'` or the aggregated field itself (the
   * bucket's term), or another field: buckets are then ordered by that
   * field's smallest value (`asc`) or largest value (`desc`) in the bucket.
   */
  field: Field | '_count' | '_key';
  order: SortOrder;
};

/** Arguments of `QueryBuilder.aggregateTerm()` */
export type AggregateTermOptions<Field extends string = string> = {
  /** The field to bucket by */
  field: Field;
  /** Name of the aggregation in the response [default: the field] */
  name?: string;
  /** Maximum number of buckets, an integer >= 1 (default 25) */
  limit?: number;
  /** Add `doc_count_error_upper_bound` to each bucket (default false) */
  showTermDocCountError?: boolean;
  /** Ordering criteria, applied in turn (default `_count` descending) */
  orderBy?: TermsOrderBy<Field>[];
  /** Bucket documents that lack the field under this key */
  missing?: TermValue;
  /** Exact term values to leave out of the buckets */
  exclude?: string[];
};

/** True for a string, a finite number or a boolean */
function isTermValue(value: unknown): value is TermValue {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return typeof value === 'string' || typeof value === 'boolean';
}

/**
 * Build a `terms` aggregation's `order` and the metric sub-aggregations it
 * needs. `_count`/`_key` are used as is and the aggregated field becomes
 * `_key`; any other field is ordered through a `min` (`asc`) or `max`
 * (`desc`) sub-agg named `__order_<i>`, because an order path cannot hold a
 * dotted field name. One criterion gives an object, several an array (ES
 * reads only the last key of a multi-key object).
 * @throws TypeError when `orderBy` is empty or an `order` is not asc/desc
 */
function buildTermsOrder(field: string, orderBy: unknown) {
  if (!Array.isArray(orderBy) || orderBy.length === 0) {
    throw new TypeError(
      'aggregateTerm() expects orderBy to be a non-empty array',
    );
  }
  const order: Record<string, SortOrder>[] = [];
  const aggs: Record<string, AggregationsAggregationContainer> = {};
  orderBy.forEach((criterion: Partial<TermsOrderBy>, i) => {
    const { field: by, order: direction } = criterion ?? {};
    if (direction !== 'asc' && direction !== 'desc') {
      throw new TypeError(
        `aggregateTerm() expects orderBy[${i}].order to be "asc" or "desc"`,
      );
    }
    if (typeof by !== 'string' || by === '') {
      throw new TypeError(
        `aggregateTerm() expects orderBy[${i}].field to be a field name`,
      );
    }
    if (by === '_count' || by === '_key') {
      order.push({ [by]: direction });
    } else if (by === field) {
      order.push({ _key: direction });
    } else {
      const name = `__order_${i}`;
      const metric = direction === 'asc' ? 'min' : 'max';
      aggs[name] = { [metric]: { field: by } };
      order.push({ [name]: direction });
    }
  });
  return {
    order: order.length === 1 ? order[0] : order,
    aggs: isEmptyObject(aggs) ? undefined : aggs,
  };
}

/**
 * Split the two call forms of the term-level methods, `(field, value,
 * options?)` and `({ field, value, ...options })`, into their parts.
 * @throws TypeError when `field` is neither a string nor an object
 */
function splitTermArgs<O extends object>(
  method: string,
  field: unknown,
  value: unknown,
  options: O | undefined,
): { name: string; value: unknown; options: Partial<O> } {
  if (typeof field === 'string') {
    return { name: field, value, options: options ?? {} };
  }
  if (field === null || typeof field !== 'object') {
    throw new TypeError(
      `${method}() expects a field name or an object with a field`,
    );
  }
  const {
    field: name,
    value: objectValue,
    ...rest
  } = field as Record<string, unknown>;
  if (typeof name !== 'string') {
    throw new TypeError(`${method}() expects field to be a string`);
  }
  return { name, value: objectValue, options: rest as Partial<O> };
}

/**
 * Copy the given keys of `options` that are not `undefined`.
 */
function pickDefined<O extends object>(
  options: O,
  keys: readonly (keyof O)[],
): Partial<O> {
  const picked: Partial<O> = {};
  for (const key of keys) {
    if (options[key] !== undefined) {
      picked[key] = options[key];
    }
  }
  return picked;
}

/**
 * Get `case_insensitive` for a `caseSensitive` option, using `fallback` when
 * the option is `undefined`.
 * @throws TypeError when `caseSensitive` is set but not a boolean
 */
function caseInsensitive(
  method: string,
  caseSensitive: unknown,
  fallback: boolean,
): boolean {
  if (caseSensitive === undefined) {
    return !fallback;
  }
  if (typeof caseSensitive !== 'boolean') {
    throw new TypeError(
      `${method}() expects caseSensitive to be a boolean, got ${typeof caseSensitive}`,
    );
  }
  return !caseSensitive;
}

/**
 * Throw unless `value` is a string.
 * @throws TypeError when `value` is not a string
 */
function assertString(
  method: string,
  name: string,
  value: unknown,
): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(
      `${method}() expects ${name} to be a string, got ${describeType(value)}`,
    );
  }
}

/** `typeof`, but `'null'` for null and `'array'` for arrays */
function describeType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'array' : typeof value;
}

/** A highlight definition whose `fields` is always a keyed object */
export type HighlightDefinition = Omit<
  NonNullable<SearchRequest['highlight']>,
  'fields'
> & { fields: Record<string, estypes.SearchHighlightField> };

/** Options shared by the composite `aggregate*` helpers */
export type CompositeAggregationOptions = {
  /** Name of the aggregation in the response [default: the field] */
  name?: string;
  /** Buckets per page, an integer >= 1 [default=25] */
  limit?: number;
  /**
   * The previous response's `aggregations.<name>.after_key`, to fetch the
   * next page of buckets
   */
  after?: estypes.AggregationsCompositeAggregateKey;
};

/** A composite `histogram` source; it is named after its `field` */
export type CompositeHistogramSource<Field extends string = string> = Omit<
  estypes.AggregationsCompositeHistogramAggregation,
  'field'
> & { field: Field };

/**
 * A composite `date_histogram` source; it is named after its `field`.
 * `time_zone` may also be a number of minutes east of UTC.
 */
export type CompositeDateHistogramSource<Field extends string = string> = Omit<
  estypes.AggregationsCompositeDateHistogramAggregation,
  'field' | 'time_zone'
> & { field: Field; time_zone?: string | number };

/** A composite `geotile_grid` source; it is named after its `field` */
export type CompositeGeotileGridSource<Field extends string = string> = Omit<
  estypes.AggregationsCompositeGeoTileGridAggregation,
  'field'
> & { field: Field };

/** Arguments of `QueryBuilder.aggregateHistogram()` */
export type AggregateHistogramOptions<Field extends string = string> =
  CompositeAggregationOptions & {
    /** The numeric field to bucket */
    field: Field;
    /** Bucket key order [default='asc'] */
    order?: SortOrder;
  } & (
      | {
          /** Bucket width, a number > 0 */
          interval: number;
          orderBy?: CompositeHistogramSource<Field>[];
        }
      | {
          interval?: number;
          /** The sources to bucket by, replacing `interval` and `order` */
          orderBy: CompositeHistogramSource<Field>[];
        }
    );

/** Arguments of `QueryBuilder.aggregateDateHistogram()` */
export type AggregateDateHistogramOptions<Field extends string = string> =
  CompositeAggregationOptions & {
    /** The date field to bucket */
    field: Field;
    /** Calendar interval, e.g. `'1d'`, `'1M'`, `'month'` */
    calendarInterval?: string;
    /** Fixed interval, e.g. `'90m'`, `'24h'` */
    fixedInterval?: string;
    /** Zone name or offset, or minutes east of UTC [default: UTC] */
    timeZone?: string | number;
    /** Format of the bucket keys [default: epoch milliseconds] */
    format?: string;
    /** Shift of the bucket boundaries, e.g. `'+6h'` (see `dateHistogram`) */
    offset?: string;
    /** Bucket key order [default='asc'] */
    order?: SortOrder;
    /** The sources to bucket by, replacing the options above */
    orderBy?: CompositeDateHistogramSource<Field>[];
  };

/** Arguments of `QueryBuilder.aggregateGeotileGrid()` */
export type AggregateGeotileGridOptions<Field extends string = string> =
  CompositeAggregationOptions & {
    /** The `geo_point` or `geo_shape` field to bucket */
    field: Field;
    /** Zoom level, an integer 0 to 29 [default: the server's, 7] */
    precision?: number;
    /** Only consider tiles that intersect this box */
    bounds?: estypes.GeoBounds;
    /** Bucket key order [default='asc'] */
    order?: SortOrder;
    /** The sources to bucket by, replacing the options above */
    orderBy?: CompositeGeotileGridSource<Field>[];
  };

/** The intervals `QueryBuilder.dateHistogram()` accepts */
export type DateHistogramInterval =
  | 'year'
  | 'quarter'
  | 'month'
  | 'week'
  | 'day'
  | 'hour'
  | 'minute'
  | 'second';

/** Arguments of `QueryBuilder.dateHistogram()` */
export type DateHistogramOptions<Field extends string = string> = {
  /** The date field to bucket */
  field: Field;
  /** The bucket size; week and longer follow the calendar */
  interval: DateHistogramInterval;
  /** Name of the aggregation in the response [default: the field] */
  name?: string;
  /** Shift of the bucket boundaries, e.g. `'+6h'`, `'-30m'`, `'1d'` */
  offset?: string | null;
  /** Zone name or offset, or minutes east of UTC [default='UTC'] */
  timeZone?: string | number;
  /** @deprecated Use `timeZone` */
  timezone?: string | number;
  /**
   * Return empty buckets from `min` to `max` even outside the data: epoch
   * ms, or strings in the interval's key format (e.g. `'2024-01'`)
   */
  extendedBounds?: estypes.AggregationsExtendedBounds<estypes.AggregationsFieldDateMath>;
};

/** Interval and key format that `dateHistogram()` sends for each interval */
const DATE_HISTOGRAM_INTERVALS: Record<
  DateHistogramInterval,
  {
    interval: Pick<
      estypes.AggregationsDateHistogramAggregation,
      'calendar_interval' | 'fixed_interval'
    >;
    format: string;
  }
> = {
  year: { interval: { calendar_interval: '1y' }, format: 'uuuu' },
  quarter: { interval: { calendar_interval: '1q' }, format: "uuuu-'Q'Q" },
  month: { interval: { calendar_interval: '1M' }, format: 'uuuu-MM' },
  // ISO week-based year and week
  week: { interval: { calendar_interval: '1w' }, format: "YYYY-'W'ww" },
  day: { interval: { calendar_interval: '1d' }, format: 'uuuu-MM-dd' },
  hour: { interval: { fixed_interval: '1h' }, format: "uuuu-MM-dd'T'HH" },
  minute: {
    interval: { fixed_interval: '1m' },
    format: "uuuu-MM-dd'T'HH:mm",
  },
  second: {
    interval: { fixed_interval: '1s' },
    format: "uuuu-MM-dd'T'HH:mm:ss",
  },
};

/**
 * Date histogram offsets Elasticsearch accepts: an optional sign, an integer
 * and a time unit. ES rejects `w`, `M`, `q` and `y`; upper-case units are
 * refused here because `M` (month) and `m` (minute) are easy to confuse.
 */
const DATE_OFFSET_PATTERN = /^[+-]?\d+(nanos|micros|ms|s|m|h|d)$/;

/**
 * Throw unless `offset` is a date histogram offset Elasticsearch accepts.
 * @throws TypeError when `offset` is not a string
 * @throws RangeError when it does not match `DATE_OFFSET_PATTERN`
 */
function assertDateOffset(
  method: string,
  offset: unknown,
): asserts offset is string {
  assertString(method, 'offset', offset);
  if (!DATE_OFFSET_PATTERN.test(offset)) {
    throw new RangeError(
      `${method}() expects offset to be an optional sign, an integer and ` +
        `one of the units nanos, micros, ms, s, m, h, d (e.g. "+6h", ` +
        `"-30m", "1d"); got ${JSON.stringify(offset)}`,
    );
  }
}

/**
 * Get the aggregation name: `name` when given, else `field`.
 * @throws TypeError when `name` is set but not a string
 * @throws RangeError when `name` is empty or contains `[`, `]` or `>`,
 *   which Elasticsearch rejects
 */
function aggregationName(method: string, name: unknown, field: string) {
  if (name === undefined) {
    return field;
  }
  assertString(method, 'name', name);
  if (name === '' || /[[\]>]/.test(name)) {
    throw new RangeError(
      `${method}() expects name to be non-empty without "[", "]" or ">", ` +
        `got ${JSON.stringify(name)}`,
    );
  }
  return name;
}

/**
 * Throw unless `value` is a finite number > 0.
 * @throws TypeError when `value` is not a number
 * @throws RangeError when it is not finite or not > 0
 */
function assertPositive(method: string, name: string, value: unknown) {
  if (typeof value !== 'number') {
    throw new TypeError(
      `${method}() expects ${name} to be a number, got ${describeType(value)}`,
    );
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${method}() expects ${name} to be a finite number > 0, got ${value}`,
    );
  }
}

/**
 * Throw unless `precision` is a geotile zoom level, an integer 0 to 29.
 * @throws TypeError when it is not a number
 * @throws RangeError when it is not an integer from 0 to 29
 */
function assertGeotilePrecision(method: string, precision: unknown) {
  if (typeof precision !== 'number') {
    throw new TypeError(
      `${method}() expects precision to be a number, got ${describeType(precision)}`,
    );
  }
  if (!Number.isInteger(precision) || precision < 0 || precision > 29) {
    throw new RangeError(
      `${method}() expects precision to be an integer from 0 to 29, got ${precision}`,
    );
  }
}

/**
 * Copy a plain object option (a composite `after` key, extended bounds).
 * @throws TypeError when `value` is not a non-array object
 */
function copyObjectOption<T>(method: string, name: string, value: T): T {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      `${method}() expects ${name} to be an object, got ${describeType(value)}`,
    );
  }
  return structuredClone(value);
}

/**
 * Validate and copy `orderBy` sources, keying each by its field and
 * wrapping it with `toSource`. Returns null when there are none.
 * @throws TypeError when `orderBy` is not an array or a source has no field
 */
function compositeSources<S extends { field: string }>(
  method: string,
  orderBy: readonly S[] | undefined,
  toSource: (source: S) => AggregationsCompositeAggregationSource,
): Record<string, AggregationsCompositeAggregationSource>[] | null {
  if (orderBy === undefined) {
    return null;
  }
  if (!Array.isArray(orderBy)) {
    throw new TypeError(`${method}() expects orderBy to be an array`);
  }
  if (orderBy.length === 0) {
    return null;
  }
  return orderBy.map((source: S, i) => {
    if (
      source === null ||
      typeof source !== 'object' ||
      typeof source.field !== 'string' ||
      source.field === ''
    ) {
      throw new TypeError(
        `${method}() expects orderBy[${i}].field to be a field name`,
      );
    }
    return { [source.field]: toSource(structuredClone(source)) };
  });
}

/**
 * Wrap a composite `histogram` source.
 * @throws RangeError/TypeError when `interval` is not a number > 0
 */
function histogramSource(
  method: string,
  source: CompositeHistogramSource,
): AggregationsCompositeAggregationSource {
  assertPositive(method, 'interval', source.interval);
  return { histogram: source };
}

/**
 * Wrap a composite `date_histogram` source, normalizing its `time_zone`.
 * @throws TypeError unless exactly one of the two intervals is a string
 * @throws RangeError for an offset or time zone Elasticsearch rejects
 */
function dateHistogramSource(
  method: string,
  source: CompositeDateHistogramSource,
): AggregationsCompositeAggregationSource {
  const { calendar_interval, fixed_interval, offset, time_zone } = source;
  const intervals = [calendar_interval, fixed_interval].filter(
    (interval) => interval !== undefined,
  );
  if (intervals.length !== 1 || typeof intervals[0] !== 'string') {
    throw new TypeError(
      `${method}() expects exactly one of calendarInterval or fixedInterval ` +
        '(calendar_interval or fixed_interval in orderBy) as a string',
    );
  }
  if (offset !== undefined) {
    assertDateOffset(method, offset);
  }
  const { time_zone: _, ...rest } = source;
  if (time_zone === undefined) {
    return { date_histogram: rest };
  }
  return {
    date_histogram: { ...rest, time_zone: normalizeTimeZone(time_zone) },
  };
}

/**
 * Wrap a composite `geotile_grid` source.
 * @throws RangeError/TypeError when `precision` is set but not 0 to 29
 */
function geotileGridSource(
  method: string,
  source: CompositeGeotileGridSource,
): AggregationsCompositeAggregationSource {
  if (source.precision !== undefined) {
    assertGeotilePrecision(method, source.precision);
  }
  return { geotile_grid: source };
}

/**
 * One clause for `sort()`: a field name (`'-name'` sorts descending), an
 * object mapping field names to `'asc'`/`'desc'`, or an Elasticsearch sort
 * object such as `{ price: { order: 'desc', missing: '_last' } }`.
 */
export type SortClause = SortCombinations | { [field: string]: SortOrder };

/** Options for `sortByRandom()` */
export type RandomSortOptions<Field extends string = string> = {
  /**
   * Seed (an integer or a non-empty string). With a seed, the same seed
   * gives the same order on every request, so pages do not overlap. Without
   * one, every request is shuffled anew.
   */
  seed?: number | string;
  /**
   * Field with doc values hashed with the seed (requires `seed`). Default
   * `_seq_no`, which is not unique across shards and changes when a document
   * is updated; add a tie-breaker `sort()` or use a unique numeric field.
   */
  field?: Field | '_seq_no';
};

/** Options for the `function_score` wrapper, see `functionScoreOptions()` */
export type FunctionScoreOptions = {
  /** How the functions' scores are combined (`score_mode`, ES default `multiply`) */
  scoreMode?: estypes.QueryDslFunctionScoreMode;
  /** How the combined score is combined with the query score (`boost_mode`) */
  boostMode?: estypes.QueryDslFunctionBoostMode;
  /** Upper limit for the functions' combined score (`max_boost`) */
  maxBoost?: number;
  /** Drop documents whose final score is lower (`min_score`) */
  minScore?: number;
};

/**
 * A part of the builder `reset()` can clear: a `FieldType`, or `'filter'`
 * for the clauses added with `filter()`.
 */
export type ResetName = FieldType | 'filter';

/** Options for `should()` and `shouldNot()` */
export type ShouldOptions = {
  /**
   * How many of the branches must match (default `1`): an integer, where a
   * negative value means "all but that many", or a string such as `'75%'`.
   * A number may not exceed the number of branches passed; when branches
   * turn out empty, a positive number is lowered to the non-empty ones.
   */
  minimumShouldMatch?: number | string;
};

/** Options for `nested()` */
export type NestedOptions<Field extends string = string> = {
  /** The `nested` field to search; conditions inside use full paths */
  path: Field;
  /** Adds the conditions each nested object is matched against */
  query: (qb: QueryBuilder<Field>) => unknown;
  /** How matching nested objects' scores are combined (server default `avg`) */
  scoreMode?: QueryDslChildScoreMode;
  /** Return the matching nested objects; `true` for the default settings */
  innerHits?: SearchInnerHits | boolean;
  /** Match nothing instead of failing when `path` is not mapped */
  ignoreUnmapped?: boolean;
};

const NESTED_SCORE_MODES = new Set<unknown>([
  'avg',
  'max',
  'min',
  'none',
  'sum',
]);

/**
 * Builder properties that hold conditions, so a sub-builder may set them.
 * `_limitFromAggregations` only accompanies `_limit`, which is reported.
 */
const CONDITION_STATE = new Set(['_must', '_filter', '_limitFromAggregations']);

/** @throws TypeError unless `value` is a function */
function assertCallback(method: string, name: string, value: unknown) {
  if (typeof value !== 'function') {
    throw new TypeError(
      `${method}() expects ${name} to be a function, got ${describeType(value)}`,
    );
  }
}

/**
 * Validate `minimumShouldMatch` for `branchCount` branches.
 * @throws TypeError when it is not a number or string
 * @throws RangeError for an empty string, a non-integer, or a number whose
 *   magnitude exceeds `branchCount` (when there is at least one branch)
 */
function assertMinimumShouldMatch(
  method: string,
  value: unknown,
  branchCount: number,
) {
  if (typeof value === 'string') {
    if (value.trim() === '') {
      throw new RangeError(
        `${method}() expects minimumShouldMatch to be a non-empty string`,
      );
    }
    return;
  }
  if (typeof value !== 'number') {
    throw new TypeError(
      `${method}() expects minimumShouldMatch to be a number or string, ` +
        `got ${describeType(value)}`,
    );
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(
      `${method}() expects minimumShouldMatch to be an integer, got ${value}`,
    );
  }
  if (branchCount > 0 && Math.abs(value) > branchCount) {
    throw new RangeError(
      `${method}() got minimumShouldMatch ${value} for ${branchCount} ` +
        'branch(es); no document could match',
    );
  }
}

/** Every name `reset()` accepts; `reset()` with no argument resets all */
const RESETTABLE_FIELDS: ResetName[] = [
  'fields',
  'excludeFields',
  'must',
  'filter',
  'aggs',
  'functionScores',
  'highlighter',
  'sorts',
  'shouldSortByRandom',
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

/** The size Elasticsearch uses when a search sends none */
const DEFAULT_PAGE_SIZE = 10;

const SORT_ORDERS = new Set<unknown>(['asc', 'desc']);

const FUNCTION_SCORE_MODES = new Set<unknown>([
  'multiply',
  'sum',
  'avg',
  'first',
  'max',
  'min',
]);

const FUNCTION_BOOST_MODES = new Set<unknown>([
  'multiply',
  'replace',
  'sum',
  'avg',
  'max',
  'min',
]);

const FUNCTION_SCORE_OPTION_KEYS = new Set<string>([
  'scoreMode',
  'boostMode',
  'maxBoost',
  'minScore',
]);

/**
 * Throw unless `value` is `'asc'` or `'desc'`.
 * @throws TypeError when `value` is not a string
 * @throws RangeError for any other string
 */
function assertSortOrder(
  what: string,
  value: unknown,
): asserts value is SortOrder {
  if (typeof value !== 'string') {
    throw new TypeError(
      `sort() expects ${what} to be 'asc' or 'desc', got ${describeType(value)}`,
    );
  }
  if (!SORT_ORDERS.has(value)) {
    throw new RangeError(
      `sort() expects ${what} to be 'asc' or 'desc', got '${value}'`,
    );
  }
}

/**
 * Convert one `sort()` argument into Elasticsearch sort clauses, one per
 * field, each with an explicit order (`_score` defaults to descending).
 * @throws TypeError/RangeError for anything that is not a valid clause
 */
function toSortClauses(
  clause: unknown,
  direction: SortDirection | undefined,
): SortCombinations[] {
  if (typeof clause === 'string') {
    return [fieldNameSort(clause, direction)];
  }
  if (direction !== undefined) {
    throw new TypeError(
      "sort() takes a direction only with a field name, e.g. sort('price', 'desc')",
    );
  }
  if (clause === null || typeof clause !== 'object' || Array.isArray(clause)) {
    throw new TypeError(
      `sort() expects a field name or a sort object, got ${describeType(clause)}`,
    );
  }
  const entries = Object.entries(clause);
  if (entries.length === 0) {
    throw new TypeError('sort() expects a sort object with at least one key');
  }
  return entries.map(([name, value]) => objectSort(name, value));
}

/** Sort clause for `'name'`, `'-name'` or `('name', direction)` */
function fieldNameSort(
  name: string,
  direction: SortDirection | undefined,
): SortCombinations {
  const descending = name.startsWith('-');
  const field = descending ? name.slice(1) : name;
  if (field === '') {
    throw new RangeError(`sort() expects a field name, got '${name}'`);
  }
  if (direction !== undefined) {
    assertSortOrder('the direction', direction);
    if (descending) {
      throw new TypeError(
        `sort() got both a '-' prefix and a direction for '${name}'`,
      );
    }
    return { [field]: { order: direction } };
  }
  if (descending || field === '_score') {
    return { [field]: { order: 'desc' } };
  }
  return { [field]: { order: 'asc' } };
}

/** Sort clause for one key of a sort object (a copy of its options) */
function objectSort(name: string, value: unknown): SortCombinations {
  if (name === '') {
    throw new RangeError('sort() expects a non-empty field name');
  }
  if (typeof value === 'string') {
    assertSortOrder(`the order of '${name}'`, value);
    return { [name]: { order: value } };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      `sort() expects '${name}' to be 'asc', 'desc' or an options object, ` +
        `got ${describeType(value)}`,
    );
  }
  const order = (value as { order?: unknown }).order;
  if (order !== undefined) {
    assertSortOrder(`the order of '${name}'`, order);
  }
  return { [name]: structuredClone(value) } as SortCombinations;
}

/** True when a sort clause sorts by `_score` (in either direction) */
function isScoreSort(sort: SortCombinations): boolean {
  if (typeof sort === 'string') {
    return sort === '_score';
  }
  return Object.keys(sort)[0] === '_score';
}

/**
 * Validate `sortByRandom()` options and build the `random_score` body.
 * @throws TypeError/RangeError for invalid options
 */
function randomScore(options: unknown): estypes.QueryDslRandomScoreFunction {
  if (options === null || typeof options !== 'object') {
    throw new TypeError(
      `sortByRandom() expects options to be an object, got ${describeType(options)}`,
    );
  }
  const { seed, field } = options as RandomSortOptions;
  if (seed === undefined) {
    if (field !== undefined) {
      throw new TypeError('sortByRandom() needs a seed to use a field');
    }
    return {};
  }
  if (typeof seed === 'string') {
    if (seed === '') {
      throw new RangeError('sortByRandom() expects a non-empty seed');
    }
  } else {
    assertNumber('sortByRandom', seed, { integer: true });
  }
  if (field === undefined) {
    return { seed, field: '_seq_no' };
  }
  assertString('sortByRandom', 'field', field);
  if (field === '') {
    throw new RangeError('sortByRandom() expects a non-empty field');
  }
  return { seed, field };
}

/**
 * Validate `functionScoreOptions()` input.
 * @throws TypeError/RangeError for unknown keys or invalid values
 */
function assertFunctionScoreOptions(options: unknown) {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    throw new TypeError(
      `functionScoreOptions() expects an object, got ${describeType(options)}`,
    );
  }
  for (const [key, value] of Object.entries(options)) {
    if (!FUNCTION_SCORE_OPTION_KEYS.has(key)) {
      throw new TypeError(`functionScoreOptions() got an unknown key '${key}'`);
    }
    if (value === undefined) {
      continue;
    }
    if (key === 'scoreMode' && !FUNCTION_SCORE_MODES.has(value)) {
      throw new TypeError(
        `functionScoreOptions() got an unknown scoreMode ${JSON.stringify(value)}`,
      );
    }
    if (key === 'boostMode' && !FUNCTION_BOOST_MODES.has(value)) {
      throw new TypeError(
        `functionScoreOptions() got an unknown boostMode ${JSON.stringify(value)}`,
      );
    }
    if (key === 'maxBoost' || key === 'minScore') {
      assertNumber('functionScoreOptions', value);
    }
  }
}

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

  /** Clauses run in filter context (`bool.filter`), added with `filter()` */
  private _filter: QueryDslQueryContainer[] = [];

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

  /**
   * True while `_limit` is the `0` that an `aggregate*` method set because
   * no limit was set; `reset('aggs')` then clears it, `limit()` ends it.
   */
  private _limitFromAggregations = false;

  /** Optional minimum score */
  public _minScore: number | undefined = undefined;

  /** Optional search_after sort values for deep pagination */
  public _searchAfter: SortResults | undefined = undefined;

  /** Optional track_total_hits control */
  public _trackTotalHits: boolean | number | undefined = undefined;

  /** If true, use "random_score" for a function score */
  public _shouldSortByRandom: boolean = false;

  /** The `random_score` body (seed and field) used when sorting by random */
  private _randomScore: estypes.QueryDslRandomScoreFunction = {};

  /** Options for the `function_score` wrapper */
  private _functionScoreOptions: FunctionScoreOptions = {};

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
   * Append a `range` condition. A missing bound (`null`, `undefined` or a
   * blank string) is open: a comparison with no value, or `between` with
   * neither bound, adds nothing.
   * @param field  The name of the field to search
   * @param operator  One of the following: > < >= <= gt lt gte lte between
   * @param range  One bound (a number, a string such as `'2020-01-01'` or
   *   `'now-1d'`, or a `Date`) for a comparison operator, or a `[min, max]`
   *   pair (both inclusive) for `between`. `Date` values are sent as ISO 8601
   *   UTC strings, so a `Date` with a custom `format` throws unless the
   *   format includes an ISO one (e.g. `'dd/MM/yyyy||strict_date_time'`);
   *   pass strings in the custom format instead.
   * @param options  Optional `format`, `time_zone` (applied to string dates
   *   without an offset, not to `Date` values or `now`), `relation` (for
   *   range fields) and `boost`
   * @throws TypeError on an unknown operator, an array used with a comparison
   *   operator, a non-pair for `between`, a value that is not a number,
   *   string or `Date`, or a `Date` with a non-ISO `format`
   * @throws RangeError on a non-finite number, an invalid `Date`, or a
   *   `between` pair whose numeric or `Date` min is greater than its max
   * @example
   *   qb.range('price', 'between', [10, 20]);
   *   qb.range('published_at', '>=', new Date('2020-01-01'));
   *   qb.range('published_at', 'between', ['01/01/2020', null], {
   *     format: 'dd/MM/yyyy',
   *     time_zone: 'Europe/Paris',
   *   });
   */
  range(
    field: Field,
    operator: RangeOperator,
    range: RangeShape | null | undefined,
    options: RangeOptions = {},
  ): this {
    if (typeof operator !== 'string') {
      throw new TypeError(
        `range() expects a string operator, got ${typeof operator}`,
      );
    }
    const opName = RANGE_OPERATORS[operator.toLowerCase()];
    if (!opName) {
      throw new TypeError(`Unsupported range operator: ${operator}`);
    }
    const bounds: Record<string, string | number> = {};
    if (opName === 'between') {
      if (!Array.isArray(range) || range.length !== 2) {
        throw new TypeError('range(): "between" expects an array [min, max]');
      }
      const min = toRangeBound(range[0]);
      const max = toRangeBound(range[1]);
      assertRangeOrder(range[0], range[1]);
      if (min !== undefined) {
        bounds.gte = min;
      }
      if (max !== undefined) {
        bounds.lte = max;
      }
    } else {
      if (Array.isArray(range)) {
        throw new TypeError(
          `range(): an array is only allowed with "between", not "${operator}"`,
        );
      }
      const value = toRangeBound(range);
      if (value !== undefined) {
        bounds[opName] = value;
      }
    }
    if (isEmptyObject(bounds)) {
      return this;
    }
    const picked = pickRangeOptions(options);
    assertDateFormat(Array.isArray(range) ? range : [range], picked.format);
    this._must.push({ range: { [field]: { ...bounds, ...picked } } });
    return this;
  }

  /**
   * Add a full-text phrase condition (`match_phrase`). A blank phrase
   * (empty or whitespace only) adds nothing.
   * @param field  The name of the field to search
   * @param phrase  A phrase string containing multiple words
   * @param slop  Word proximity allowed between phrase terms (default 0)
   * @param options  Any other match_phrase options (`analyzer`, `boost`,
   *   `zero_terms_query`, ...)
   * @return {QueryBuilder}
   * @chainable
   * @example
   *   qb.matchPhrase({ field: 'title', phrase: 'elasticsearch guide', slop: 1 });
   */
  matchPhrase({
    field,
    phrase,
    ...options
  }: Omit<estypes.QueryDslMatchPhraseQuery, 'query'> & {
    field: Field;
    phrase: string;
  }): this {
    if (isBlankPhrase(phrase)) {
      return this;
    }
    this._must.push({
      match_phrase: {
        [field]: {
          ...options,
          query: phrase,
          slop: options.slop ?? 0,
        },
      },
    });
    return this;
  }

  /**
   * Add a phrase condition whose last word is a prefix
   * (`match_phrase_prefix`), e.g. for search-as-you-type. A blank phrase
   * adds nothing.
   * @param field  The name of the field to search
   * @param phrase  A phrase string containing multiple words
   * @param options  Any other match_phrase_prefix options (`slop` (default
   *   0), `max_expansions`, `analyzer`, `boost`, `zero_terms_query`)
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
    if (isBlankPhrase(phrase)) {
      return this;
    }
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
   * Add a `match` condition with any of the available options. A blank
   * phrase (empty or whitespace only) adds nothing.
   * @param field The field to search
   * @param phrase  The value to match on
   * @param options  Any other match options: `analyzer`,
   *   `auto_generate_synonyms_phrase_query`, `boost`, `fuzziness`,
   *   `fuzzy_rewrite`, `fuzzy_transpositions`, `lenient`, `max_expansions`,
   *   `minimum_should_match`, `operator`, `prefix_length` and
   *   `zero_terms_query`
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
    if (isBlankPhrase(phrase)) {
      return this;
    }
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
   * Add a `multi_match` condition with any of the available options. Field
   * names may carry a boost (`'title^2'`) or a wildcard. A blank phrase adds
   * nothing.
   * @param fields  The field or fields to search (default: the index's
   *   `index.query.default_field` setting)
   * @param phrase  The value to match on
   * @param options  Additional options: `analyzer`,
   *   `auto_generate_synonyms_phrase_query`, `boost`, `fuzziness`,
   *   `fuzzy_rewrite`, `fuzzy_transpositions`, `lenient`, `max_expansions`,
   *   `minimum_should_match`, `operator`, `prefix_length`, `slop`,
   *   `tie_breaker`, `type` and `zero_terms_query`
   * @chainable
   * @example
   *   qb.multiMatch({
   *     fields: ['title^2', 'summary'],
   *     phrase: 'elastic',
   *     operator: 'and',
   *   });
   */
  multiMatch({
    fields,
    phrase,
    ...options
  }: Omit<QueryDslMultiMatchQuery, 'query'> & { phrase: string }): this {
    if (isBlankPhrase(phrase)) {
      return this;
    }
    const clause: QueryDslMultiMatchQuery = { ...options, query: phrase };
    if (fields !== undefined) {
      clause.fields = Array.isArray(fields) ? [...fields] : fields;
    }
    this._must.push({ multi_match: clause });
    return this;
  }

  /**
   * Match a phrase with boosted relevancy for exact phrases and "AND"
   * matches. This approach is described in the "Combining OR, AND, and match
   * phrase queries" section of
   * https://www.elastic.co/blog/how-to-improve-elasticsearch-search-relevance-with-boolean-queries
   * It gives more weight to the phrase as a whole, so results with the whole
   * phrase rank higher than results with all of its words, which rank higher
   * than results with some of its words. A document must match at least one
   * operator. A blank phrase adds nothing.
   * @param field  The name of the field to search
   * @param phrase  The search phrase
   * @param operators  Operators to include, any of "exact" (`match_phrase`),
   *   "and" (all words) and "or" (any word). Default `['exact', 'and']`.
   * @param weights  Boost of each operator, by position in `operators`. A
   *   missing weight defaults by operator: exact 5, and 3, or 1.
   * @return {QueryBuilder}
   * @throws TypeError on an unknown operator
   * @throws RangeError on a weight that is negative or not a finite number
   * @chainable
   * @example
   *   qb.matchBoostedPhrase({
   *     field: 'title',
   *     phrase: 'elastic search',
   *     operators: ['exact', 'and', 'or'],
   *     weights: [5, 3, 1],
   *   });
   */
  matchBoostedPhrase({
    field,
    phrase,
    operators = ['exact', 'and'],
    weights = [],
  }: {
    field: Field;
    phrase: string;
    operators?: BoostOperator[];
    weights?: number[];
  }): this {
    const should: QueryDslQueryContainer[] = [];
    for (let i = 0; i < operators.length; i++) {
      const op = operators[i];
      if (!Object.hasOwn(BOOSTED_PHRASE_DEFAULTS, op)) {
        throw new TypeError(
          `matchBoostedPhrase() got unknown operator "${String(op)}"; ` +
            'expected "exact", "and" or "or"',
        );
      }
      const boost = weights[i] ?? BOOSTED_PHRASE_DEFAULTS[op];
      assertNumber('matchBoostedPhrase', boost, { min: 0 });
      if (op === 'exact') {
        should.push({ match_phrase: { [field]: { query: phrase, boost } } });
      } else {
        should.push({
          match: { [field]: { query: phrase, operator: op, boost } },
        });
      }
    }
    if (should.length > 0 && !isBlankPhrase(phrase)) {
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

  /**
   * Escape the characters that are special in a `wildcard` query value
   * (`\`, `*` and `?`) so that `text` matches literally.
   * @param text  The literal text
   * @returns The escaped text, e.g. `'50%*off?'` → `'50%\\*off\\?'`
   * @throws TypeError when `text` is not a string
   * @example
   *   qb.wildcard('sku', `${QueryBuilder.escapeWildcards(userInput)}*`);
   */
  static escapeWildcards(text: string): string {
    if (typeof text !== 'string') {
      throw new TypeError(
        `escapeWildcards() expects a string, got ${typeof text}`,
      );
    }
    return text
      .replace(/\\/g, '\\\\') // Escape backslashes first
      .replace(/\*/g, '\\*') // Escape asterisks
      .replace(/\?/g, '\\?'); // Escape question marks
  }

  /**
   * Instance alias of the static `QueryBuilder.escapeWildcards()`.
   * @param text  The literal text
   * @returns The text with `\`, `*` and `?` escaped
   */
  escapeWildcards(text: string): string {
    return QueryBuilder.escapeWildcards(text);
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
   * Add an exact-value condition (`term` query). Without options the clause
   * is the shorthand `{ term: { field: value } }`. Use it on `keyword`,
   * numeric, boolean or date fields; a `text` field holds analyzed tokens, so
   * an exact value rarely matches there.
   * @see https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-term-query
   *
   * @param field  The name of the field to search, or an object
   *   `{ field, value, ...options }`
   * @param value  The string, number or boolean to match
   * @param options  `caseSensitive` (default `true`; `false` sends
   *   `case_insensitive: true`, for `keyword` fields) and `boost`
   * @return {QueryBuilder}
   * @throws TypeError when `value` is missing, `null`, an array or an
   *   object (use `rawCondition({ terms })` for several values), or when
   *   `caseSensitive` is not a boolean
   * @throws RangeError when `value` is a non-finite number
   * @chainable
   * @example
   *   qb.term('tag', 'music');
   *   qb.term({ field: 'status', value: 'Active', caseSensitive: false });
   *   qb.term('author', 'tolkien', { boost: 2 });
   */
  term(field: Field, value: TermValue, options?: TermOptions): this;
  /**
   * Add an exact-value condition (`term` query); see the positional form.
   * @example
   *   qb.term({ field: 'status', value: 'active', boost: 2 });
   */
  term(field: { field: Field; value: TermValue } & TermOptions): this;
  term(
    field: Field | ({ field: Field; value: TermValue } & TermOptions),
    value?: TermValue,
    options?: TermOptions,
  ): this {
    const args = splitTermArgs('term', field, value, options);
    const termValue = args.value;
    if (
      typeof termValue !== 'string' &&
      typeof termValue !== 'number' &&
      typeof termValue !== 'boolean'
    ) {
      throw new TypeError(
        `term() expects a string, number or boolean value, got ${describeType(termValue)}`,
      );
    }
    if (typeof termValue === 'number') {
      assertNumber('term', termValue);
    }
    const { caseSensitive, ...rest } = args.options;
    const extra = pickDefined(rest, ['boost']);
    if (caseSensitive === undefined && isEmptyObject(extra)) {
      this._must.push({ term: { [args.name]: termValue } });
      return this;
    }
    const clause: estypes.QueryDslTermQuery = { value: termValue };
    if (caseSensitive !== undefined) {
      clause.case_insensitive = caseInsensitive('term', caseSensitive, true);
    }
    this._must.push({ term: { [args.name]: { ...clause, ...extra } } });
    return this;
  }

  /**
   * Add a wildcard pattern condition (`wildcard` query): `*` matches any
   * characters and `?` one character. Case-insensitive by default. Use it on
   * `keyword` fields; to match literal text, see `containsExact()` or
   * `QueryBuilder.escapeWildcards()`.
   * @see https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-wildcard-query
   *
   * @param field  The name of the field to search, or an object
   *   `{ field, value, ...options }`
   * @param value  The pattern to match
   * @param options  `caseSensitive` (default `false`), `boost` and `rewrite`
   * @return {QueryBuilder}
   * @throws TypeError when `value` is not a string or `caseSensitive` is not
   *   a boolean
   * @chainable
   * @example
   *   qb.wildcard('sku', 'WM-2025-*');
   *   qb.wildcard({ field: 'sku', value: 'wm-*', caseSensitive: true });
   */
  wildcard(field: Field, value: string, options?: WildcardOptions): this;
  /**
   * Add a wildcard pattern condition; see the positional form.
   * @example
   *   qb.wildcard({ field: 'sku', value: 'WM-*', caseSensitive: true });
   */
  wildcard(field: { field: Field; value: string } & WildcardOptions): this;
  wildcard(
    field: Field | ({ field: Field; value: string } & WildcardOptions),
    value?: string,
    options?: WildcardOptions,
  ): this {
    const args = splitTermArgs('wildcard', field, value, options);
    assertString('wildcard', 'value', args.value);
    this._pushPattern('wildcard', args.name, args.value, args.options);
    return this;
  }

  /**
   * Require a field to contain the given text anywhere in its value, as
   * written: a `wildcard` query `*text*` with `*`, `?` and `\` escaped.
   * Case-insensitive by default. Meant for `keyword` fields (or a keyword
   * sub-field of a text field); on a `text` field it matches single tokens
   * only. A blank value (empty, whitespace only, `null` or `undefined`) adds
   * nothing, so an empty search box does not filter.
   *
   * @param field  The name of the field to search, or an object
   *   `{ field, value, ...options }`
   * @param value  The text to look for
   * @param options  `caseSensitive` (default `false`), `boost` and `rewrite`
   * @return {QueryBuilder}
   * @throws TypeError when `value` is set but not a string, or
   *   `caseSensitive` is not a boolean
   * @chainable
   * @example
   *   qb.containsExact('title.raw', 'United Airlines');
   *   qb.containsExact({ field: 'sku', value: '50%*', caseSensitive: true });
   */
  containsExact(field: Field, value: string, options?: WildcardOptions): this;
  /**
   * Require a field to contain the given text; see the positional form.
   * @example
   *   qb.containsExact({ field: 'title.raw', value: 'United Airlines' });
   */
  containsExact(field: { field: Field; value: string } & WildcardOptions): this;
  containsExact(
    field: Field | ({ field: Field; value: string } & WildcardOptions),
    value?: string,
    options?: WildcardOptions,
  ): this {
    const args = splitTermArgs('containsExact', field, value, options);
    if (isBlankPhrase(args.value)) {
      return this;
    }
    assertString('containsExact', 'value', args.value);
    const escaped = QueryBuilder.escapeWildcards(args.value);
    this._pushPattern('containsExact', args.name, `*${escaped}*`, args.options);
    return this;
  }

  /**
   * Add a regular expression condition (`regexp` query). The pattern must
   * match the whole value (it is anchored) and uses Lucene syntax.
   * Case-insensitive by default in both call forms. Use it on `keyword`
   * fields.
   * @see https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-regexp-query
   *
   * @param field  The name of the field to search, or an object
   *   `{ field, value, ...options }`
   * @param value  The regular expression
   * @param options  `caseSensitive` (default `false`), `flags` (e.g.
   *   `'COMPLEMENT|INTERVAL'`, `'ALL'`, `'NONE'`),
   *   `max_determinized_states` (integer >= 1), `rewrite` and `boost`
   * @return {QueryBuilder}
   * @throws TypeError when `value` is not a string or `caseSensitive` is not
   *   a boolean
   * @throws RangeError when `max_determinized_states` is not an integer >= 1
   * @chainable
   * @example
   *   qb.regexp('model', 'iP(od|ad|hone) \\d+');
   *   qb.regexp({ field: 'model', value: 'ip.*', caseSensitive: true });
   *   qb.regexp('code', '<1-100>', { flags: 'INTERVAL' });
   */
  regexp(field: Field, value: string, options?: RegexpOptions): this;
  /**
   * Add a regular expression condition; see the positional form.
   * @example
   *   qb.regexp({ field: 'model', value: 'ip.*', caseSensitive: true });
   */
  regexp(field: { field: Field; value: string } & RegexpOptions): this;
  regexp(
    field: Field | ({ field: Field; value: string } & RegexpOptions),
    value?: string,
    options?: RegexpOptions,
  ): this {
    const args = splitTermArgs('regexp', field, value, options);
    assertString('regexp', 'value', args.value);
    const states = args.options.max_determinized_states;
    if (states !== undefined) {
      assertNumber('regexp', states, { min: 1, integer: true });
    }
    this._pushPattern('regexp', args.name, args.value, args.options);
    return this;
  }

  /**
   * @deprecated Misspelled; use `regexp()`, which takes the same arguments.
   */
  rexgep(field: Field, value: string, options?: RegexpOptions): this;
  /**
   * @deprecated Misspelled; use `regexp()`, which takes the same arguments.
   */
  rexgep(field: { field: Field; value: string } & RegexpOptions): this;
  rexgep(
    field: Field | ({ field: Field; value: string } & RegexpOptions),
    value?: string,
    options?: RegexpOptions,
  ): this {
    if (typeof field === 'string') {
      return this.regexp(field, value as string, options);
    }
    return this.regexp(field);
  }

  /**
   * Push a `wildcard` or `regexp` clause with `case_insensitive` (default
   * true) and the pattern options that are set.
   */
  private _pushPattern(
    method: 'wildcard' | 'containsExact' | 'regexp',
    name: string,
    value: string,
    options: Partial<RegexpOptions>,
  ) {
    const { caseSensitive, ...rest } = options;
    const clause = {
      value,
      case_insensitive: caseInsensitive(method, caseSensitive, false),
      ...pickDefined(rest, ['boost', 'rewrite']),
    };
    if (method === 'regexp') {
      const extra = pickDefined(rest, ['flags', 'max_determinized_states']);
      this._must.push({ regexp: { [name]: { ...clause, ...extra } } });
      return;
    }
    this._must.push({ wildcard: { [name]: clause } });
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
   * Add a Lucene query syntax condition (`query_string` query) on one field.
   * Invalid syntax makes the search fail with a 400 error, so for text typed
   * by end users prefer `simpleQueryString()` (or pass `lenient: true`,
   * which only covers type mismatches, not syntax).
   * @see https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-query-string-query
   *
   * @param field  The name of the field to search, or an object
   *   `{ field, queryString, ...options }`
   * @param queryString  A query using operators such as AND, OR, NOT, ~, *
   * @param options  Any other query_string option: `default_operator`,
   *   `analyze_wildcard`, `lenient`, `fuzziness`, `analyzer`, `boost`,
   *   `minimum_should_match`, `phrase_slop`, ...
   * @return {QueryBuilder}
   * @throws TypeError when the query is not a string
   * @chainable
   * @example
   *   qb.queryString('introduction', 'quick AND fox');
   *   qb.queryString('title', 'quick fox', { default_operator: 'and' });
   *   qb.queryString({ field: 'title', queryString: 'qick~', fuzziness: 1 });
   */
  queryString(
    field: Field,
    queryString: string,
    options?: QueryStringOptions,
  ): this;
  /**
   * Add a Lucene query syntax condition; see the positional form.
   * @example
   *   qb.queryString({ field: 'title', queryString: 'quick AND fox' });
   */
  queryString(
    field: { field: Field; queryString: string } & QueryStringOptions,
  ): this;
  queryString(
    field: Field | ({ field: Field; queryString: string } & QueryStringOptions),
    queryString?: string,
    options?: QueryStringOptions,
  ): this {
    let name: unknown = field;
    let query: unknown = queryString;
    let rest: object = options ?? {};
    if (typeof field !== 'string') {
      if (field === null || typeof field !== 'object') {
        throw new TypeError(
          'queryString() expects a field name or an object with a field',
        );
      }
      ({ field: name, queryString: query, ...rest } = field);
    }
    assertString('queryString', 'field', name);
    assertString('queryString', 'the query', query);
    this._must.push({
      query_string: { ...rest, fields: [name], query },
    });
    return this;
  }

  /**
   * Add a `simple_query_string` condition: a forgiving query syntax for
   * search boxes (`+` and, `|` or, `-` not, `"phrase"`, `prefix*`, `~N`) that
   * never fails on invalid syntax. A blank query (empty, whitespace only,
   * `null` or `undefined`) adds nothing.
   * @see https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-simple-query-string-query
   *
   * @param fields  The fields to search; names may carry a boost
   *   (`'title^2'`) or a wildcard. Default: the index's
   *   `index.query.default_field` setting
   * @param query  The user's query text
   * @param options  Any other simple_query_string option:
   *   `default_operator`, `flags`, `analyze_wildcard`, `lenient`,
   *   `minimum_should_match`, `boost`, ...
   * @return {QueryBuilder}
   * @throws TypeError when the query is set but not a string
   * @chainable
   * @example
   *   qb.simpleQueryString({
   *     fields: ['title^2', 'body'],
   *     query: '"fried eggs" +(eggplant | potato) -frittata',
   *     default_operator: 'and',
   *   });
   */
  simpleQueryString({
    fields,
    query,
    ...options
  }: SimpleQueryStringOptions & { fields?: string[]; query: string }): this {
    if (isBlankPhrase(query)) {
      return this;
    }
    assertString('simpleQueryString', 'the query', query);
    const clause: estypes.QueryDslSimpleQueryStringQuery = {
      ...options,
      query,
    };
    if (fields !== undefined) {
      clause.fields = copyFieldList('simpleQueryString', fields);
    }
    this._must.push({ simple_query_string: clause });
    return this;
  }

  /**
   * Find documents similar to the given text or documents
   * (`more_like_this` query).
   * @see https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-mlt-query
   *
   * @param field  The field or fields to compare
   * @param like  Text, a document reference such as
   *   `{ _index: 'books', _id: '123' }`, or an array of these
   * @param options  Any other more_like_this option, passed at the top
   *   level: `min_term_freq`, `min_doc_freq`, `max_query_terms`,
   *   `minimum_should_match`, `unlike`, `boost`, ...
   * @return {QueryBuilder}
   * @throws TypeError when no field is given or `like` is missing
   * @chainable
   * @example
   *   qb.moreLikeThis({
   *     field: ['title', 'description'],
   *     like: 'wireless headphones',
   *     min_term_freq: 1,
   *     max_query_terms: 12,
   *   });
   */
  moreLikeThis({
    field,
    like,
    ...options
  }: MoreLikeThisOptions & {
    field: Field | Field[];
    like: MoreLikeThisLikeParams;
  }): this {
    const fields = copyFieldList(
      'moreLikeThis',
      Array.isArray(field) ? field : [field],
    );
    if (fields.length === 0) {
      throw new TypeError('moreLikeThis() expects at least one field');
    }
    if (like === undefined || like === null) {
      throw new TypeError('moreLikeThis() expects a like value');
    }
    this._must.push({
      more_like_this: {
        fields,
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
   * Require a minimum number of the given terms to match (`terms_set`
   * query). Give at most one of `minimumShouldMatch`,
   * `minimumShouldMatchField` and `script`; with none, one term must match
   * (`minimum_should_match: 1`), since Elasticsearch rejects a `terms_set`
   * without a minimum.
   * @see https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-terms-set-query
   *
   * @param field  The field to search
   * @param terms  The terms to look for
   * @param minimumShouldMatch  How many terms must match: an integer or a
   *   string such as `'75%'`
   * @param minimumShouldMatchField  A numeric field holding, per document,
   *   how many terms must match
   * @param script  A script returning how many terms must match; it can
   *   read `params.num_terms`. A string is used as the script source
   * @param boost  Relevance boost of this clause
   * @return {QueryBuilder}
   * @throws TypeError when `terms` is not an array, or more than one
   *   minimum is given
   * @throws RangeError when `minimumShouldMatch` is a non-integer number
   * @chainable
   * @example
   *   qb.termsSet({ field: 'tags', terms: ['red', 'blue'] });
   *   qb.termsSet({ field: 'tags', terms: ['a', 'b', 'c'], minimumShouldMatch: 2 });
   *   qb.termsSet({ field: 'tags', terms: ['a', 'b'], minimumShouldMatchField: 'required' });
   *   qb.termsSet({ field: 'tags', terms: ['a', 'b'], script: 'Math.min(params.num_terms, 2)' });
   */
  termsSet({
    field,
    terms,
    minimumShouldMatch,
    minimumShouldMatchField,
    script,
    boost,
  }: TermsSetOptions<Field>): this {
    if (!Array.isArray(terms)) {
      throw new TypeError(
        `termsSet() expects terms to be an array, got ${describeType(terms)}`,
      );
    }
    const minimums = [minimumShouldMatch, minimumShouldMatchField, script];
    if (minimums.filter((m) => m !== undefined).length > 1) {
      throw new TypeError(
        'termsSet() accepts only one of minimumShouldMatch, ' +
          'minimumShouldMatchField and script',
      );
    }
    if (typeof minimumShouldMatch === 'number') {
      assertNumber('termsSet', minimumShouldMatch, { integer: true });
    }
    const clause: estypes.QueryDslTermsSetQuery = { terms: [...terms] };
    if (minimumShouldMatchField !== undefined) {
      clause.minimum_should_match_field = minimumShouldMatchField;
    } else if (typeof script === 'string') {
      clause.minimum_should_match_script = { source: script };
    } else if (script !== undefined) {
      clause.minimum_should_match_script = script;
    } else {
      clause.minimum_should_match = minimumShouldMatch ?? 1;
    }
    if (boost !== undefined) {
      clause.boost = boost;
    }
    this._must.push({ terms_set: { [field]: clause } });
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
   * Add a rescore phase: re-score the top `windowSize` hits of each shard
   * with a second query built in the callback. Each call appends a phase;
   * phases run in order.
   *
   * Only the callback builder's conditions and score functions
   * (`decayFunctionScore`, `sortByRandom`) form the rescore query; its
   * paging, sorting, fields, aggregations and highlighting are ignored.
   * A callback that adds no condition adds no phase.
   *
   * Elasticsearch rejects rescore combined with any sort other than a lone
   * `_score` descending, so `getBody()` throws for that combination.
   * @see https://www.elastic.co/docs/reference/elasticsearch/rest-apis/filter-search-results#rescore
   * @param withBuilder  Receives a fresh builder to add the rescore query to
   * @param options  `windowSize` (integer >= 1, ES default 10),
   *   `queryWeight` and `rescoreQueryWeight` (ES default 1 each) and
   *   `scoreMode` (`'total'` by default, or `'multiply'`, `'avg'`, `'max'`,
   *   `'min'`); unset options are left to Elasticsearch
   * @throws TypeError when the callback adds a retriever (`knn`,
   *   `semantic`, ...), which cannot be a rescore query, or an option has
   *   the wrong type
   * @throws RangeError when `windowSize` is not an integer >= 1 or a weight
   *   is not finite
   * @chainable
   * @example
   *   qb.match({ field: 'title', phrase: 'harry potter' });
   *   qb.rescore(
   *     (q) => q.matchPhrase({ field: 'title', phrase: 'harry potter' }),
   *     { windowSize: 50, rescoreQueryWeight: 2 },
   *   );
   */
  rescore(
    withBuilder: (qb: QueryBuilder<Field>) => void,
    options: RescoreOptions = {},
  ): this {
    if (typeof withBuilder !== 'function') {
      throw new TypeError('rescore() expects a callback function');
    }
    const entry = this._buildRescoreOptions(options);
    const qb = new QueryBuilder<Field>();
    withBuilder(qb);
    if (qb.getRetrievers().length > 0) {
      throw new TypeError(
        'rescore() supports query conditions only; knn, semantic and other ' +
          'retrievers cannot be used as a rescore query',
      );
    }
    const { query } = qb.getBody();
    if (!query || 'match_all' in query) {
      return this;
    }
    const rescore: SearchRescore = {
      ...entry,
      query: { ...entry.query, rescore_query: query },
    };
    this._rescore = [...(this._rescore ?? []), rescore];
    return this;
  }

  /**
   * Validate `rescore()` options and convert them to a rescore entry with
   * an empty `query` (no `rescore_query` yet).
   */
  private _buildRescoreOptions(options: RescoreOptions) {
    if (options === null || typeof options !== 'object') {
      throw new TypeError('rescore() expects options to be an object');
    }
    const { windowSize, queryWeight, rescoreQueryWeight, scoreMode } = options;
    const query: Omit<estypes.SearchRescoreQuery, 'rescore_query'> = {};
    if (queryWeight !== undefined) {
      assertNumber('rescore', queryWeight);
      query.query_weight = queryWeight;
    }
    if (rescoreQueryWeight !== undefined) {
      assertNumber('rescore', rescoreQueryWeight);
      query.rescore_query_weight = rescoreQueryWeight;
    }
    if (scoreMode !== undefined) {
      if (!RESCORE_SCORE_MODES.has(scoreMode)) {
        const modes = [...RESCORE_SCORE_MODES].join(', ');
        throw new TypeError(
          `rescore() expects scoreMode to be one of ${modes}, got ${JSON.stringify(scoreMode)}`,
        );
      }
      query.score_mode = scoreMode;
    }
    const entry: { window_size?: number; query: typeof query } = { query };
    if (windowSize !== undefined) {
      assertNumber('rescore', windowSize, { min: 1, integer: true });
      entry.window_size = windowSize;
    }
    return entry;
  }

  /**
   * Get a copy of the rescore phases added with `rescore()`.
   * @returns The rescore entries in order, or `undefined` when there are none
   */
  getRescore(): SearchRescore[] | undefined {
    return this._rescore ? structuredClone(this._rescore) : undefined;
  }

  //
  // Section 4/6: Aggregation, facets and histograms
  //

  /**
   * Count documents per distinct value of a field (a `terms` aggregation,
   * like SQL's `GROUP BY`). The aggregation is named `name`, or after
   * `field`; a second aggregation with the same name replaces the first.
   *
   * Unless a limit was set with `limit()`, this also sets the limit to 0 so
   * the search returns buckets but no hits; `reset('aggs')` undoes that.
   * @see https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-terms-aggregation
   * @param options.field  The field to bucket by, usually a `keyword` field
   * @param options.name  Name of the aggregation in the response, to keep
   *   two aggregations on one field apart [default: `field`]
   * @param options.limit  Maximum number of buckets, an integer >= 1
   *   [default=25]
   * @param options.showTermDocCountError  Add `doc_count_error_upper_bound`
   *   to each bucket: the most a bucket's count can be off because each
   *   shard counts separately [default=false]
   * @param options.orderBy  Ordering criteria, applied in turn (later ones
   *   break ties) [default=`[{ field: '_count', order: 'desc' }]`]. Each
   *   `field` is `'_count'` (bucket size), `'_key'` or the aggregated field
   *   (the bucket's value), or another numeric or date field: buckets are
   *   then ordered by that field's smallest value in the bucket (`asc`) or
   *   largest (`desc`), computed by a `min`/`max` sub-aggregation named
   *   `__order_<i>` (its value appears in each bucket).
   * @param options.missing  Put documents that lack the field in a bucket
   *   with this key
   * @param options.exclude  Exact values to leave out of the buckets
   * @throws TypeError when `orderBy` is empty, an `order` is not `'asc'` or
   *   `'desc'`, `exclude` is not an array of strings, `missing` is not a
   *   string, number or boolean, or the removed `missing_bucket` or
   *   `missing_order` option is given (use `missing`), or `name` is not a
   *   string
   * @throws RangeError when `limit` is not an integer >= 1, or `name` is
   *   empty or contains `[`, `]` or `>`
   * @chainable
   * @example
   *   qb.aggregateTerm({ field: 'author' });
   *   qb.aggregateTerm({
   *     field: 'author',
   *     limit: 100,
   *     missing: '(unknown)',
   *     exclude: ['Anonymous'],
   *     orderBy: [
   *       { field: '_count', order: 'desc' },
   *       { field: 'author', order: 'asc' },
   *     ],
   *   });
   *   // buckets with the best-rated book first
   *   qb.aggregateTerm({
   *     field: 'author',
   *     orderBy: [{ field: 'stats.rating', order: 'desc' }],
   *   });
   */
  aggregateTerm(options: AggregateTermOptions<Field>): this {
    const {
      field,
      limit = 25,
      showTermDocCountError = false,
      orderBy = [{ field: '_count', order: 'desc' }],
      exclude = [],
      missing,
    } = options;
    const name = aggregationName('aggregateTerm', options.name, field);
    for (const removed of ['missing_bucket', 'missing_order']) {
      if (removed in options) {
        throw new TypeError(
          `aggregateTerm() no longer accepts ${removed}, which only ` +
            'composite aggregations support; use missing: <bucket key>',
        );
      }
    }
    assertNumber('aggregateTerm', limit, { min: 1, integer: true });
    if (!Array.isArray(exclude) || exclude.some((v) => typeof v !== 'string')) {
      throw new TypeError('aggregateTerm() expects exclude to be string[]');
    }
    const excluded = [...exclude];
    if (missing !== undefined && !isTermValue(missing)) {
      throw new TypeError(
        'aggregateTerm() expects missing to be a string, number or boolean',
      );
    }
    const { order, aggs } = buildTermsOrder(field, orderBy);
    const terms: estypes.AggregationsTermsAggregation = {
      field,
      size: limit,
      show_term_doc_count_error: showTermDocCountError,
      order,
    };
    if (missing !== undefined) {
      terms.missing = missing;
    }
    if (excluded.length > 0) {
      terms.exclude = excluded;
    }
    this._aggs[name] = aggs ? { terms, aggs } : { terms };
    this._defaultToNoHits();
    return this;
  }

  /**
   * Set the limit to 0 (aggregations only, no hits) unless a limit was set.
   * Called by the `aggregate*` methods; `reset('aggs')` undoes it.
   */
  private _defaultToNoHits() {
    if (this._limit === null) {
      this._limit = 0;
      this._limitFromAggregations = true;
    }
  }

  /**
   * Add a composite aggregation named `name` (or after `field`) with the
   * given sources, and default the limit to 0 like the other `aggregate*`.
   * @throws TypeError/RangeError for an invalid name, limit or after key
   */
  private _addComposite(
    method: string,
    options: CompositeAggregationOptions & { field: string },
    sources: Record<string, AggregationsCompositeAggregationSource>[],
  ): this {
    const { field, limit = 25, after } = options;
    const name = aggregationName(method, options.name, field);
    assertNumber(method, limit, { min: 1, integer: true });
    const composite: estypes.AggregationsCompositeAggregation = {
      size: limit,
      sources,
    };
    if (after !== undefined) {
      composite.after = copyObjectOption(method, 'after', after);
    }
    this._aggs[name] = { composite };
    this._defaultToNoHits();
    return this;
  }

  /**
   * Count documents per numeric range of equal width (a `composite`
   * aggregation with one `histogram` source). Buckets come in key order
   * (they cannot be ordered by count) and only non-empty buckets are
   * returned. Pages hold `limit` buckets: pass the response's
   * `aggregations.<name>.after_key` as `after` to get the next page, until a
   * page comes back with no buckets.
   *
   * The aggregation is named `name`, or after `field`. Each bucket's `key` is
   * an object keyed by source (the field): `{ price: 50 }` is the bucket
   * from 50 up to `50 + interval`. Unless a limit was set with `limit()`,
   * this also sets the limit to 0 (aggregations only, no hits).
   * @see https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-composite-aggregation
   * @param options.field  The numeric field to bucket
   * @param options.interval  Bucket width, a number > 0; not needed when
   *   `orderBy` is given
   * @param options.name  Name of the aggregation in the response
   *   [default: `field`]
   * @param options.limit  Buckets per page, an integer >= 1 [default=25]
   * @param options.after  The previous page's `after_key`
   * @param options.order  Bucket key order, `'asc'` or `'desc'`
   *   [default='asc']
   * @param options.orderBy  Composite `histogram` sources (`{ field,
   *   interval, order? }`) to bucket by instead of `field`, `interval` and
   *   `order`; several sources give one bucket per combination
   * @throws TypeError when `interval` is missing without `orderBy`, a value
   *   has the wrong type, or `after` is not an object
   * @throws RangeError when an `interval` is not > 0, `limit` is not an
   *   integer >= 1, or `name` is invalid
   * @chainable
   * @example
   *   qb.aggregateHistogram({ field: 'price', interval: 50 });
   *   // next page: pass the previous response's after_key
   *   qb.aggregateHistogram({
   *     field: 'price',
   *     interval: 50,
   *     limit: 10,
   *     after: response.aggregations.price.after_key,
   *   });
   *   // two aggregations on one field
   *   qb.aggregateTerm({ field: 'price', name: 'price_terms' });
   *   qb.aggregateHistogram({ field: 'price', interval: 50, name: 'bands' });
   */
  aggregateHistogram(options: AggregateHistogramOptions<Field>): this {
    const method = 'aggregateHistogram';
    const { field, interval, order = 'asc', orderBy } = options;
    let sources = compositeSources(method, orderBy, (source) =>
      histogramSource(method, source),
    );
    if (!sources) {
      if (interval === undefined) {
        throw new TypeError(`${method}() expects interval unless orderBy`);
      }
      const source = histogramSource(method, { field, interval, order });
      sources = [{ [field]: source }];
    }
    return this._addComposite(method, options, sources);
  }

  /**
   * Count documents per time interval (a `composite` aggregation with one
   * `date_histogram` source). Buckets come in key order and only non-empty
   * buckets are returned; pass the response's
   * `aggregations.<name>.after_key` as `after` to get the next page. For a
   * chart that needs every interval, including empty ones, use
   * `dateHistogram()`.
   *
   * Set exactly one of `calendarInterval` (`minute`/`1m`, `hour`/`1h`,
   * `day`/`1d`, `week`/`1w`, `month`/`1M`, `quarter`/`1q`, `year`/`1y`) or
   * `fixedInterval` (any whole number of `ms`, `s`, `m`, `h` or `d`). The
   * aggregation is named `name`, or after `field`; each bucket's `key` is
   * `{ <field>: <epoch ms or formatted date> }`. Unless a limit was set with
   * `limit()`, this also sets the limit to 0 (aggregations only, no hits).
   * @see https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-composite-aggregation
   * @param options.field  The date field to bucket
   * @param options.calendarInterval  Calendar-aware interval
   * @param options.fixedInterval  Fixed-length interval
   * @param options.timeZone  Zone name (`'America/Denver'`), offset
   *   (`'+05:30'`) or minutes east of UTC (`330`), checked and normalized
   *   by `normalizeTimeZone()` [default: UTC]
   * @param options.format  Date format of the bucket keys, e.g.
   *   `'uuuu-MM-dd'` [default: epoch milliseconds]
   * @param options.offset  Shift of the bucket boundaries; same rules as
   *   `dateHistogram()`
   * @param options.order  Bucket key order [default='asc']
   * @param options.name  Name of the aggregation [default: `field`]
   * @param options.limit  Buckets per page, an integer >= 1 [default=25]
   * @param options.after  The previous page's `after_key`
   * @param options.orderBy  Composite `date_histogram` sources (snake_case
   *   keys: `{ field, calendar_interval | fixed_interval, time_zone?,
   *   format?, offset?, order? }`) to bucket by instead of the options above;
   *   each is checked the same way
   * @throws TypeError unless exactly one interval is set (per source), or
   *   when a value has the wrong type
   * @throws RangeError for an invalid offset, time zone, limit or name
   * @chainable
   * @example
   *   qb.aggregateDateHistogram({ field: 'created_at', calendarInterval: 'day' });
   *   qb.aggregateDateHistogram({
   *     field: 'created_at',
   *     fixedInterval: '1h',
   *     timeZone: 'America/Denver',
   *     format: "uuuu-MM-dd'T'HH",
   *     order: 'desc',
   *   });
   */
  aggregateDateHistogram(options: AggregateDateHistogramOptions<Field>): this {
    const method = 'aggregateDateHistogram';
    const {
      field,
      calendarInterval,
      fixedInterval,
      timeZone,
      format,
      offset,
      order = 'asc',
      orderBy,
    } = options;
    let sources = compositeSources(method, orderBy, (source) =>
      dateHistogramSource(method, source),
    );
    if (!sources) {
      const source: CompositeDateHistogramSource = { field, order };
      if (calendarInterval !== undefined) {
        source.calendar_interval = calendarInterval;
      }
      if (fixedInterval !== undefined) {
        source.fixed_interval = fixedInterval;
      }
      if (timeZone !== undefined) {
        source.time_zone = timeZone;
      }
      if (format !== undefined) {
        source.format = format;
      }
      if (offset !== undefined) {
        source.offset = offset;
      }
      sources = [{ [field]: dateHistogramSource(method, source) }];
    }
    return this._addComposite(method, options, sources);
  }

  /**
   * Count documents per map tile (a `composite` aggregation with one
   * `geotile_grid` source). Only non-empty tiles are returned, in key order;
   * pass the response's `aggregations.<name>.after_key` as `after` to get
   * the next page.
   *
   * The aggregation is named `name`, or after `field`; each bucket's `key` is
   * `{ <field>: '<zoom>/<x>/<y>' }`. Unless a limit was set with `limit()`,
   * this also sets the limit to 0 (aggregations only, no hits).
   * @see https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-composite-aggregation
   * @param options.field  The `geo_point` or `geo_shape` field to bucket
   * @param options.precision  Zoom level, an integer from 0 (whole world)
   *   to 29 (finest) [default: the server's, 7]
   * @param options.bounds  Only consider tiles that intersect this box,
   *   e.g. `{ top_left: '41,-109', bottom_right: '37,-102' }`
   * @param options.order  Tile key order [default='asc']
   * @param options.name  Name of the aggregation [default: `field`]
   * @param options.limit  Buckets per page, an integer >= 1 [default=25]
   * @param options.after  The previous page's `after_key`
   * @param options.orderBy  Composite `geotile_grid` sources (`{ field,
   *   precision?, bounds?, order? }`) to bucket by instead of the options
   *   above
   * @throws TypeError when a value has the wrong type
   * @throws RangeError when `precision` is not an integer from 0 to 29, or
   *   for an invalid limit or name
   * @chainable
   * @example
   *   qb.aggregateGeotileGrid({ field: 'location', precision: 7 });
   *   qb.aggregateGeotileGrid({
   *     field: 'location',
   *     precision: 8,
   *     bounds: { top_left: '40.8,-74.3', bottom_right: '40.4,-73.6' },
   *   });
   */
  aggregateGeotileGrid(options: AggregateGeotileGridOptions<Field>): this {
    const method = 'aggregateGeotileGrid';
    const { field, precision, bounds, order = 'asc', orderBy } = options;
    let sources = compositeSources(method, orderBy, (source) =>
      geotileGridSource(method, source),
    );
    if (!sources) {
      const source: CompositeGeotileGridSource = { field, order };
      if (precision !== undefined) {
        source.precision = precision;
      }
      if (bounds !== undefined) {
        source.bounds = copyObjectOption(method, 'bounds', bounds);
      }
      sources = [{ [field]: geotileGridSource(method, source) }];
    }
    return this._addComposite(method, options, sources);
  }

  /**
   * Count documents per value of each field: one `aggregateTerm()` per
   * field, each named after its field and ordered by count, descending.
   * Like `aggregateTerm()`, sets the limit to 0 unless one was set.
   * @param options.fields  The fields to facet on, usually `keyword` fields
   * @param options.limit  Maximum number of buckets per field, an integer
   *   >= 1 [default=25]
   * @throws TypeError when `fields` is not an array of strings
   * @throws RangeError when `limit` is not an integer >= 1
   * @chainable
   * @example
   *   qb.includeFacets({ fields: ['author', 'country'], limit: 10 });
   *   // response: aggregations.author.buckets, aggregations.country.buckets
   */
  includeFacets({
    fields,
    limit = 25,
  }: {
    fields: Field[];
    limit?: number;
  }): this {
    const names = copyFieldList('includeFacets', fields) as Field[];
    assertNumber('includeFacets', limit, { min: 1, integer: true });
    for (const field of names) {
      this.aggregateTerm({ field, limit });
    }
    return this;
  }

  /**
   * Replace all aggregations with raw Elasticsearch DSL, keyed by
   * aggregation name. The object is copied, so later `aggregate*` calls do
   * not change it. Unlike the `aggregate*` methods, this leaves the limit
   * alone.
   * @param aggs  Aggregation definitions by name [default=`{}`, none]
   * @throws TypeError when `aggs` is not a plain object
   * @chainable
   * @example
   *   qb.aggs({ avg_price: { avg: { field: 'price' } } });
   */
  aggs(aggs: Record<string, AggregationsAggregationContainer> = {}): this {
    if (aggs === null || typeof aggs !== 'object' || Array.isArray(aggs)) {
      throw new TypeError(
        'aggs() expects an object of aggregations keyed by name',
      );
    }
    this._aggs = structuredClone(aggs);
    return this;
  }

  /**
   * Get a copy of the aggregations to send, keyed by name.
   * @returns The aggregation definitions; `{}` when there are none
   */
  getAggs(): Record<string, AggregationsAggregationContainer> {
    return structuredClone(this._aggs);
  }

  /**
   * Count documents per time interval for a chart: a plain `date_histogram`
   * aggregation that returns **every** interval from the first document to
   * the last (or across `extendedBounds`), including empty ones
   * (`min_doc_count: 0`). It is not paged or truncated; Elasticsearch's
   * `search.max_buckets` setting caps the total.
   *
   * The aggregation is named `name`, or after `field`. The response has
   * `aggregations.<name>.buckets`, each `{ key, key_as_string, doc_count }`,
   * where `key` is the bucket start in epoch milliseconds and
   * `key_as_string` is formatted for the interval (`'2024'`, `'2024-Q1'`,
   * `'2024-05'`, `'2024-W18'`, `'2024-05-02'`, `'2024-05-02T10'`,
   * `'2024-05-02T10:30'`, `'2024-05-02T10:30:15'`). Unless a limit was set
   * with `limit()`, this also sets the limit to 0 (aggregations only, no
   * hits).
   * @see https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-datehistogram-aggregation
   * @param options.field  The date field to bucket
   * @param options.interval  `'year'`, `'quarter'`, `'month'`, `'week'` and
   *   `'day'` follow the calendar in `timeZone` (a day can be 23 or 25
   *   hours); `'hour'`, `'minute'` and `'second'` are fixed lengths
   * @param options.name  Name of the aggregation [default: `field`]
   * @param options.timeZone  Zone name (`'America/Denver'`, `'UTC'`),
   *   offset (`'+05:30'`, `'-0800'`) or minutes **east** of UTC (`330`),
   *   checked and normalized by `normalizeTimeZone()`. Prefer zone names:
   *   fixed offsets ignore daylight saving time [default='UTC']
   * @param options.timezone  Deprecated alias of `timeZone`
   * @param options.offset  Shift of the bucket boundaries: an optional sign,
   *   a whole number and one of `nanos`, `micros`, `ms`, `s`, `m`, `h`, `d`
   *   (e.g. `'+6h'` starts days at 06:00, `'-30m'`, `'1d'`). Elasticsearch
   *   has no week, month, quarter or year offsets (`'+1M'` is rejected).
   * @param options.extendedBounds  `{ min, max }` to return empty buckets
   *   for, even before the first or after the last document: epoch
   *   milliseconds, or strings in the interval's key format (Elasticsearch
   *   parses them with it: `'2024-01'` for `'month'`, `'2024-Q1'` for
   *   `'quarter'`)
   * @throws TypeError when `timeZone` and `timezone` are both set, the
   *   removed `limit` option is given, or a value has the wrong type
   * @throws RangeError for an unknown `interval`, or an invalid `offset`,
   *   time zone or `name`
   * @chainable
   * @example
   *   qb.dateHistogram({ field: 'created_at', interval: 'month' });
   *   // response.aggregations.created_at.buckets:
   *   //   [{ key: 1704067200000, key_as_string: '2024-01', doc_count: 3 }, ...]
   *   qb.dateHistogram({
   *     field: 'created_at',
   *     interval: 'day',
   *     name: 'per_day',
   *     timeZone: 'America/Denver',
   *     offset: '+6h',
   *     extendedBounds: { min: '2024-01-01', max: '2024-12-31' },
   *   });
   */
  dateHistogram(options: DateHistogramOptions<Field>): this {
    const method = 'dateHistogram';
    const {
      field,
      interval,
      offset = null,
      timeZone,
      timezone,
      extendedBounds,
    } = options;
    if ((options as { limit?: unknown }).limit !== undefined) {
      throw new TypeError(
        `${method}() no longer accepts limit: it returns every bucket`,
      );
    }
    const name = aggregationName(method, options.name, field);
    if (
      typeof interval !== 'string' ||
      !Object.hasOwn(DATE_HISTOGRAM_INTERVALS, interval)
    ) {
      const supported = Object.keys(DATE_HISTOGRAM_INTERVALS).join(', ');
      throw new RangeError(
        `${method}() expects interval to be one of ${supported}, ` +
          `got ${JSON.stringify(interval)}`,
      );
    }
    if (timeZone !== undefined && timezone !== undefined) {
      throw new TypeError(
        `${method}() takes timeZone or its deprecated alias timezone, not both`,
      );
    }
    const spec = DATE_HISTOGRAM_INTERVALS[interval];
    const histogram: estypes.AggregationsDateHistogramAggregation = {
      field,
      ...spec.interval,
      format: spec.format,
      time_zone: normalizeTimeZone(timeZone ?? timezone ?? 'UTC'),
      min_doc_count: 0,
    };
    if (offset !== null && offset !== undefined) {
      assertDateOffset(method, offset);
      histogram.offset = offset;
    }
    if (extendedBounds !== undefined) {
      histogram.extended_bounds = copyObjectOption(
        method,
        'extendedBounds',
        extendedBounds,
      );
    }
    this._aggs[name] = { date_histogram: histogram };
    this._defaultToNoHits();
    return this;
  }

  //
  // Section 5/6: Sort and paginate methods
  //

  /**
   * Set the max number of results to return (`size`). Without a limit,
   * Elasticsearch returns 10 hits and `page()` pages by 10.
   * @param limit  An integer >= 0 (0 returns no hits, e.g. aggregations only)
   * @throws TypeError when `limit` is not a number
   * @throws RangeError when `limit` is negative, fractional or not finite
   * @chainable
   * @example
   *   qb.limit(25);
   */
  limit(limit: number): this {
    assertNumber('limit', limit, { min: 0, integer: true });
    this._limit = limit;
    this._limitFromAggregations = false;
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
   * Set the page of results to return. Pages are `limit()` hits long, or 10
   * (the Elasticsearch default size) when no limit is set. A page > 1 cannot
   * be combined with `searchAfter()`: `getOptions()`/`getQuery()` throw.
   * @param page  An integer >= 1, where 1 is the first page
   * @throws TypeError when `page` is not a number
   * @throws RangeError when `page` is < 1, fractional or not finite
   * @chainable
   * @example
   *   qb.limit(20).page(3); // hits 41-60
   */
  page(page: number): this {
    assertNumber('page', page, { min: 1, integer: true });
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
   * Add one or more sort clauses; each call appends to the earlier ones.
   * Every clause is stored as `{ <field>: { order, ...options } }`.
   *
   * - `'name'` sorts ascending, `'-name'` descending; `'_score'` (relevance)
   *   sorts descending, best match first, unless a direction is given.
   * - `{ name: 'asc' | 'desc' }`; an object with several keys becomes one
   *   clause per key, in key order.
   * - Elasticsearch sort objects such as
   *   `{ price: { order: 'desc', missing: '_last' } }` or `_geo_distance`
   *   are copied as they are.
   * - An array of any of the above.
   *
   * Field names are not checked against the mapping, so metadata fields
   * (`_score`, `_doc`, `_shard_doc`) and `'-'`-prefixed names work.
   * @param field  A field name, a sort object or an array of either
   * @param direction  With a field name only: `'asc'` or `'desc'`
   * @throws TypeError/RangeError for an invalid clause or direction (nothing
   *   is added)
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/current/sort-search-results.html
   * @chainable
   * @example
   *   qb.sort('-created_at');
   *   qb.sort('created_at', 'desc');
   *   qb.sort('_score');
   *   qb.sort({ created_at: 'desc' });
   *   qb.sort([{ name: 'asc' }, '-created_at']);
   *   qb.sort({ price: { order: 'desc', missing: '_last' } });
   */
  sort(field: string, direction?: SortDirection): this;
  sort(clause: SortClause | SortClause[]): this;
  sort(clause: SortClause | SortClause[], direction?: SortDirection): this {
    if (Array.isArray(clause) && direction !== undefined) {
      throw new TypeError(
        "sort() takes a direction only with a field name, e.g. sort('price', 'desc')",
      );
    }
    const clauses = Array.isArray(clause) ? clause : [clause];
    const sorts = clauses.flatMap((item) => toSortClauses(item, direction));
    this._sorts.push(...sorts);
    return this;
  }

  /**
   * Get a copy of the sort clauses added with `sort()`. The body may add a
   * leading `_score` clause for `sortByRandom()`.
   * @returns An array of sort clauses in Elasticsearch format.
   * @example
   *   qb.sort('_score');
   *   qb.getSort(); // [{ _score: { order: 'desc' } }]
   */
  getSort(): SortCombinations[] {
    return structuredClone(this._sorts);
  }

  /**
   * Reset one or more parts of this builder to their initial value.
   * - `'sorts'` clears `sort()` clauses and `sortByRandom()`;
   *   `'shouldSortByRandom'` clears only `sortByRandom()`.
   * - `'functionScores'` clears score functions and `functionScoreOptions()`.
   * - `'aggs'` also removes the `limit(0)` an `aggregate*` method set.
   * - `'must'` clears conditions; `'filter'` clears `filter()` clauses.
   * @param target  One name, a list of names, or `null`/nothing for all
   * @throws TypeError for an unknown name (nothing is reset)
   * @chainable
   * @example
   *   qb.fields(['a']).limit(5);
   *   qb.reset('fields');
   *   qb.reset(['limit', 'page']);
   *   qb.reset(); // everything
   */
  reset(target: ResetName | ResetName[] | null = null): this {
    let names: ResetName[] = RESETTABLE_FIELDS;
    if (Array.isArray(target)) {
      names = target;
    } else if (target !== null) {
      names = [target];
    }
    for (const name of names) {
      if (!RESETTABLE_FIELDS.includes(name)) {
        throw new TypeError(
          `reset() got an unknown name ${JSON.stringify(name)}; expected one of ${RESETTABLE_FIELDS.join(', ')}`,
        );
      }
    }
    const empty = new QueryBuilder();
    for (const field of names) {
      if (field === 'fields') {
        this._fields = empty.getFields();
      } else if (field === 'excludeFields') {
        this._excludeFields = empty.getExcludeFields();
      } else if (field === 'must') {
        this._must = empty.getMust();
      } else if (field === 'filter') {
        this._filter = empty.getFilter();
      } else if (field === 'aggs') {
        this._aggs = empty.getAggs();
        if (this._limitFromAggregations) {
          this._limit = empty.getLimit();
          this._limitFromAggregations = false;
        }
      } else if (field === 'functionScores') {
        this._functionScores = empty.getFunctionScores();
        this._functionScoreOptions = empty.getFunctionScoreOptions();
      } else if (field === 'highlighter') {
        this._highlighter = empty.getHighlighter();
      } else if (field === 'sorts') {
        this._sorts = empty.getSort();
        this.sortByRandom(false);
      } else if (field === 'shouldSortByRandom') {
        this.sortByRandom(false);
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
        this._limitFromAggregations = false;
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
    copy._filter = structuredClone(this._filter);
    copy._aggs = structuredClone(this._aggs);
    copy._functionScores = structuredClone(this._functionScores);
    copy._highlighter = structuredClone(this._highlighter);
    copy._limit = this._limit;
    copy._limitFromAggregations = this._limitFromAggregations;
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
    copy._randomScore = structuredClone(this._randomScore);
    copy._functionScoreOptions = { ...this._functionScoreOptions };
    return copy;
  }

  /**
   * Enable or disable sorting by random. Adds a `random_score` function to
   * the `function_score` wrapper (with `boost_mode: 'replace'` unless
   * `functionScoreOptions()` sets a `boostMode`). With other score functions,
   * the default `score_mode` (`multiply`) gives a weighted random order.
   *
   * Random order goes first: when `sort()` clauses exist and the first one
   * is not `_score`, the body sorts by `_score` descending first, and the
   * `sort()` clauses only break ties (useful with a seed and `searchAfter()`).
   * Only applies on the standard query path (not with retrievers).
   * @param enabled  `false` turns random order off and forgets the seed
   * @param options  `seed` for a reproducible order (stable pages), and the
   *   `field` hashed with it (default `_seq_no`)
   * @throws TypeError/RangeError for invalid arguments
   * @chainable
   * @example
   *   qb.sortByRandom(); // a new order on every request
   *   qb.sortByRandom(true, { seed: userSessionId }).limit(20).page(2);
   */
  sortByRandom(
    enabled: boolean = true,
    options: RandomSortOptions<Field> = {},
  ): this {
    if (typeof enabled !== 'boolean') {
      throw new TypeError(
        `sortByRandom() expects a boolean, got ${describeType(enabled)}`,
      );
    }
    const random = randomScore(options);
    this._shouldSortByRandom = enabled;
    this._randomScore = enabled ? random : {};
    return this;
  }

  /**
   * Get the current sort by random state
   */
  getSortByRandom() {
    return this._shouldSortByRandom;
  }

  /**
   * Get a copy of the `random_score` settings: `{ seed, field }` when
   * `sortByRandom()` was given a seed, otherwise `{}`.
   */
  getSortByRandomOptions(): RandomSortOptions {
    return { ...this._randomScore } as RandomSortOptions;
  }

  /**
   * Add a score function (e.g. a gauss/exp/linear decay, `field_value_factor`,
   * `script_score`, `weight`, `random_score`). All added functions are
   * applied to the final query inside a single `function_score` wrapper when
   * getBody()/getQuery() is called; see `functionScoreOptions()` for how
   * they are combined. Function scores only apply when the query is built on
   * the standard query path; when retrievers (kNN, RRF, semantic) are in use
   * the functions are ignored. The function is copied.
   * @param functionScore  One Elasticsearch `function_score` function
   * @throws TypeError when `functionScore` is not an object
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/query-dsl-function-score-query.html
   * @chainable
   * @example
   *   qb.scoreFunction({
   *     field_value_factor: { field: 'popularity', modifier: 'log1p' },
   *   });
   */
  scoreFunction(functionScore: QueryDslFunctionScoreContainer): this {
    if (
      functionScore === null ||
      typeof functionScore !== 'object' ||
      Array.isArray(functionScore)
    ) {
      throw new TypeError(
        `scoreFunction() expects a function object, got ${describeType(functionScore)}`,
      );
    }
    this._functionScores.push(structuredClone(functionScore));
    return this;
  }

  /**
   * Add a score function; the same as `scoreFunction()`, which also takes
   * functions other than decays.
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
    return this.scoreFunction(functionScore);
  }

  /**
   * Set how score functions are combined: `scoreMode` (`score_mode`),
   * `boostMode` (`boost_mode`), `maxBoost` (`max_boost`) and `minScore`
   * (`min_score`, applied to the final score). Merges into the current
   * options; a key passed as `undefined` is removed. The options are sent
   * only when there is at least one score function or `sortByRandom()`.
   * @throws TypeError for unknown keys or modes
   * @throws RangeError for non-finite numbers
   * @chainable
   * @example
   *   qb.scoreFunction({ weight: 2 })
   *     .functionScoreOptions({ scoreMode: 'sum', boostMode: 'multiply' });
   */
  functionScoreOptions(options: FunctionScoreOptions): this {
    assertFunctionScoreOptions(options);
    const merged: FunctionScoreOptions = {};
    const entries = Object.entries({
      ...this._functionScoreOptions,
      ...options,
    });
    for (const [key, value] of entries) {
      if (value !== undefined) {
        Object.assign(merged, { [key]: value });
      }
    }
    this._functionScoreOptions = merged;
    return this;
  }

  /**
   * Get a copy of the options set with `functionScoreOptions()`.
   */
  getFunctionScoreOptions(): FunctionScoreOptions {
    return { ...this._functionScoreOptions };
  }

  //
  // Section 3/6: Logic including should, mustNot, nested
  //

  /**
   * Require at least `minimumShouldMatch` of several alternative branches
   * (a `bool.should`). Each branch is a callback that receives a fresh
   * QueryBuilder and its index; the conditions it adds must all match for the
   * branch to match (AND within a branch, OR across branches).
   *
   * - A branch that adds no condition is skipped, as if it were not passed.
   *   When that leaves fewer non-empty branches than a positive numeric
   *   `minimumShouldMatch`, it is lowered to their number. When every branch
   *   is empty, nothing is added.
   * - With one non-empty branch, its conditions are added directly.
   * - Sub-builders may only add conditions (including `filter()`, `should()`,
   *   `mustNot()`, `nested()`); setting anything else on them (sort, limit,
   *   aggregations, retrievers, ...) throws.
   *
   * @param withBuilders  Callbacks, invoked with (qb, idx), one per branch
   * @param options  `minimumShouldMatch`: how many branches must match
   *   (default 1); an integer (negative means "all but that many") or a
   *   string such as `'50%'`
   * @throws TypeError when `withBuilders` is not an array of functions, or a
   *   callback sets state other than conditions on its builder
   * @throws RangeError when a numeric `minimumShouldMatch` is not an integer
   *   or exceeds the number of branches
   * @chainable
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/query-dsl-bool-query.html#query-dsl-bool-query-should
   * @example
   * // Match documents that satisfy at least one branch
   * query.should(
   *   [
   *     (qb) => qb.term('status', 'published'),
   *     (qb) => qb.range('created_at', 'gte', 'now-7d'),
   *   ],
   *   { minimumShouldMatch: 1 }, // or "50%"
   * );
   */
  should(
    withBuilders: Array<(qb: QueryBuilder<Field>, idx: number) => unknown>,
    options: ShouldOptions = {},
  ): this {
    return this._addShould('should', withBuilders, options);
  }

  /**
   * Exclude documents that match any condition the callback adds: each
   * condition goes under `bool.must_not` (NOT A AND NOT B). Clauses the
   * callback adds with `filter()` are excluded the same way. An empty
   * callback adds nothing. To exclude only documents matching several
   * conditions together, use `shouldNot()` with one branch.
   * @param withBuilder  A function that receives a QueryBuilder to add
   *   conditions to
   * @throws TypeError when `withBuilder` is not a function, or it sets state
   *   other than conditions on its builder
   * @chainable
   * @example
   * query.mustNot(qb => qb.term('visibility', 'hidden'))
   */
  mustNot(withBuilder: (qb: QueryBuilder<Field>) => unknown): this {
    assertCallback('mustNot', 'withBuilder', withBuilder);
    const qb = this._runSubBuilder('mustNot', withBuilder);
    const clauses = [...qb._must, ...qb._filter];
    if (clauses.length > 0) {
      this._must.push({ bool: { must_not: clauses } });
    }
    return this;
  }

  /**
   * Add a raw query clause as a scoring condition (`bool.must`); for DSL the
   * builder has no method for. The clause is copied. To add one in filter
   * context, call `filter(qb => qb.must(clause))`.
   * @param customMust  An Elasticsearch query clause
   * @throws TypeError when `customMust` is not an object
   * @chainable
   * @example
   * query.must({ match_phrase: { title: 'quick brown fox' } });
   */
  must(customMust: QueryDslQueryContainer): this {
    this._must.push(copyObjectOption('must', 'customMust', customMust));
    return this;
  }

  /**
   * Add conditions in filter context (`bool.filter`): they must match, but
   * do not change `_score`, and Elasticsearch can cache them. Use it for
   * yes/no conditions such as `term`, `range` and `exists`; conditions added
   * any other way stay scoring `bool.must` clauses. Every condition the
   * callback adds (including its own `filter()` clauses) becomes a filter;
   * an empty callback adds nothing.
   *
   * With retrievers (`knn`, `semantic`, `rrf`, ...), every condition, scoring
   * or not, is applied as the retriever's filter: it restricts which
   * documents are returned but does not affect their rank.
   * @param withBuilder  A function that receives a QueryBuilder to add
   *   conditions to
   * @throws TypeError when `withBuilder` is not a function, or it sets state
   *   other than conditions on its builder
   * @chainable
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/9.x/query-filter-context.html
   * @example
   * query
   *   .match({ field: 'title', phrase: 'apple pie' })
   *   .filter((qb) => qb.term('status', 'published').range('price', '<', 20));
   */
  filter(withBuilder: (qb: QueryBuilder<Field>) => unknown): this {
    assertCallback('filter', 'withBuilder', withBuilder);
    const qb = this._runSubBuilder('filter', withBuilder);
    this._filter.push(...qb._must, ...qb._filter);
    return this;
  }

  /**
   * Get a copy of the clauses added with `filter()`
   */
  getFilter(): QueryDslQueryContainer[] {
    return structuredClone(this._filter);
  }

  /**
   * Exclude documents that match at least `minimumShouldMatch` of the
   * branches: a `bool.must_not` holding `should(withBuilders, options)`.
   * A branch matches when all of its conditions match, so one branch with
   * two conditions excludes only documents matching both. Empty branches are
   * skipped as in `should()`; when all are empty, nothing is added.
   * @param withBuilders  Callbacks, invoked with (qb, idx), one per branch
   * @param options  `minimumShouldMatch`: how many branches must match for a
   *   document to be excluded (default 1)
   * @throws TypeError/RangeError as `should()` does
   * @chainable
   * @example
   * // exclude documents matching at least 2 of these
   * query.shouldNot([
   *   qb => qb.term('visibility', 'hidden'),
   *   qb => qb.term('color', 'red'),
   *   qb => qb.term('disabled', true),
   * ], {
   *   minimumShouldMatch: 2
   * })
   */
  shouldNot(
    withBuilders: Array<(qb: QueryBuilder<Field>, idx: number) => unknown>,
    options: ShouldOptions = {},
  ): this {
    const qb = new QueryBuilder<Field>();
    qb._addShould('shouldNot', withBuilders, options);
    if (qb._must.length > 0 || qb._filter.length > 0) {
      this._must.push({ bool: { must_not: [qb._buildBoolQuery()] } });
    }
    return this;
  }

  /**
   * Add a condition on a `nested` field: documents match when at least one
   * nested object matches every condition the callback adds. Conditions use
   * full field paths (`reviews.stars`, not `stars`). An empty callback
   * matches documents that have at least one nested object.
   * @param path  The nested field
   * @param query  A function that receives a QueryBuilder to add conditions to
   * @param scoreMode  `score_mode` (server default `avg`)
   * @param innerHits  `inner_hits` settings, or `true` for the defaults, to
   *   return the matching nested objects with each hit
   * @param ignoreUnmapped  `ignore_unmapped` (server default `false`)
   * @throws TypeError for invalid options, or when `query` sets state other
   *   than conditions on its builder
   * @chainable
   * @example
   * query.nested({
   *   path: 'reviews',
   *   query: (qb) => qb.term('reviews.author', 'ana').range('reviews.stars', 'gte', 4),
   *   innerHits: true,
   * })
   */
  nested({
    query,
    path,
    scoreMode,
    innerHits,
    ignoreUnmapped,
  }: NestedOptions<Field>): this {
    if (typeof path !== 'string' || path === '') {
      throw new TypeError(
        `nested() expects path to be a non-empty string, got ${describeType(path)}`,
      );
    }
    assertCallback('nested', 'query', query);
    if (scoreMode !== undefined && !NESTED_SCORE_MODES.has(scoreMode)) {
      throw new TypeError(
        `nested() got an unknown scoreMode ${JSON.stringify(scoreMode)}`,
      );
    }
    if (ignoreUnmapped !== undefined && typeof ignoreUnmapped !== 'boolean') {
      throw new TypeError(
        `nested() expects ignoreUnmapped to be a boolean, got ${describeType(ignoreUnmapped)}`,
      );
    }
    let innerHitsBody: SearchInnerHits | undefined;
    if (innerHits === true) {
      innerHitsBody = {};
    } else if (innerHits !== undefined && innerHits !== false) {
      innerHitsBody = copyObjectOption('nested', 'innerHits', innerHits);
    }
    const qb = this._runSubBuilder('nested', query);
    const nested: estypes.QueryDslNestedQuery = {
      path,
      query: qb._buildBoolQuery(),
    };
    if (scoreMode !== undefined) {
      nested.score_mode = scoreMode;
    }
    if (innerHitsBody !== undefined) {
      nested.inner_hits = innerHitsBody;
    }
    if (ignoreUnmapped !== undefined) {
      nested.ignore_unmapped = ignoreUnmapped;
    }
    this._must.push({ nested });
    return this;
  }

  /**
   * Shared body of `should()` and `shouldNot()`: validate, run each branch
   * and add the result to this builder.
   */
  private _addShould(
    method: string,
    withBuilders: Array<(qb: QueryBuilder<Field>, idx: number) => unknown>,
    options: ShouldOptions,
  ): this {
    if (!Array.isArray(withBuilders)) {
      throw new TypeError(
        `${method}() expects an array of functions, got ${describeType(withBuilders)}`,
      );
    }
    withBuilders.forEach((build, idx) => {
      assertCallback(method, `withBuilders[${idx}]`, build);
    });
    const { minimumShouldMatch = 1 } = copyObjectOption(
      method,
      'options',
      options,
    );
    assertMinimumShouldMatch(method, minimumShouldMatch, withBuilders.length);
    const branches: QueryBuilder<Field>[] = [];
    withBuilders.forEach((build, idx) => {
      const qb = this._runSubBuilder(method, (sub) => build(sub, idx));
      if (qb._must.length > 0 || qb._filter.length > 0) {
        branches.push(qb);
      }
    });
    if (branches.length === 0) {
      return this;
    }
    if (branches.length === 1) {
      // the one branch must match, so its conditions apply directly
      this._must.push(...branches[0]._must);
      this._filter.push(...branches[0]._filter);
      return this;
    }
    let required = minimumShouldMatch;
    if (typeof required === 'number' && required > branches.length) {
      required = branches.length;
    }
    this._must.push({
      bool: {
        should: branches.map((qb) => qb._buildBoolQuery()),
        minimum_should_match: required,
      },
    });
    return this;
  }

  /**
   * Run a sub-builder callback on a fresh builder and return the builder.
   * @throws TypeError when the callback set anything but conditions on it,
   *   which would otherwise be silently ignored
   */
  private _runSubBuilder(
    method: string,
    build: (qb: QueryBuilder<Field>) => unknown,
  ): QueryBuilder<Field> {
    const qb = new QueryBuilder<Field>();
    build(qb);
    const fresh = new QueryBuilder() as unknown as Record<string, unknown>;
    const state = qb as unknown as Record<string, unknown>;
    const ignored = Object.keys(state).filter(
      (key) =>
        !CONDITION_STATE.has(key) &&
        JSON.stringify(state[key]) !== JSON.stringify(fresh[key]),
    );
    if (ignored.length > 0) {
      const names = ignored.map((key) => key.replace(/^_/, '')).join(', ');
      throw new TypeError(
        `${method}() callback set ${names} on its sub-builder; only ` +
          'conditions are used there. Set them on the outer builder.',
      );
    }
    return qb;
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
    const hasFilters = this._must.length > 0 || this._filter.length > 0;

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
      const sorts = this._getSortClauses();
      if (sorts.length > 0) {
        body.sort = sorts;
      }
    } else {
      // match all documents
      body.query = this._applyScoreFunctions({ match_all: {} });
      const sorts = this._getSortClauses();
      if (sorts.length > 0) {
        body.sort = sorts;
      }
    }

    // Add highlighting if specified
    if (!isEmptyObject(this._highlighter.fields)) {
      body.highlight = structuredClone(this._highlighter);
    }

    // Add aggregations if specified
    if (!isEmptyObject(this._aggs)) {
      body.aggs = this.getAggs();
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
        body.rescore = this.getRescore();
        if (body.sort) {
          assertRescoreSort([body.sort].flat());
        }
      }
    }

    return body;
  }

  /**
   * Build one query from the conditions: `match_all` when there are none, a
   * lone `must` clause as is, otherwise a `bool` with `must` and/or `filter`.
   */
  private _buildBoolQuery(): QueryDslQueryContainer {
    if (this._filter.length === 0) {
      if (this._must.length === 0) {
        return { match_all: {} };
      }
      if (this._must.length === 1) {
        return this._must[0];
      }
      return { bool: { must: this._must } };
    }
    const bool: estypes.QueryDslBoolQuery = {};
    if (this._must.length > 0) {
      bool.must = this._must;
    }
    bool.filter = this._filter;
    return { bool };
  }

  /**
   * Copies of the `sort()` clauses, led by `_score` descending when
   * `sortByRandom()` is on and the first clause does not sort by `_score`
   * (otherwise a field sort would make the random score irrelevant).
   */
  private _getSortClauses(): SortCombinations[] {
    const sorts = structuredClone(this._sorts);
    if (
      this._shouldSortByRandom &&
      sorts.length > 0 &&
      !isScoreSort(sorts[0])
    ) {
      sorts.unshift({ _score: { order: 'desc' } });
    }
    return sorts;
  }

  /**
   * Wrap a query in a function_score containing any functions added via
   * scoreFunction() plus a random_score function if sortByRandom() is
   * enabled, with the functionScoreOptions(). Returns the query untouched
   * when there is no function to apply.
   */
  private _applyScoreFunctions(
    query: QueryDslQueryContainer,
  ): QueryDslQueryContainer {
    const functions = structuredClone(this._functionScores);
    if (this._shouldSortByRandom) {
      functions.push({ random_score: { ...this._randomScore } });
    }
    if (functions.length === 0) {
      return query;
    }
    const functionScore: QueryDslFunctionScoreQuery = { query, functions };
    const { scoreMode, boostMode, maxBoost, minScore } =
      this._functionScoreOptions;
    if (scoreMode !== undefined) {
      functionScore.score_mode = scoreMode;
    }
    if (boostMode !== undefined) {
      functionScore.boost_mode = boostMode;
    } else if (this._shouldSortByRandom) {
      // random_score should fully replace the relevance score
      functionScore.boost_mode = 'replace';
    }
    if (maxBoost !== undefined) {
      functionScore.max_boost = maxBoost;
    }
    if (minScore !== undefined) {
      functionScore.min_score = minScore;
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
    }
    const from = (this._limit ?? DEFAULT_PAGE_SIZE) * (this._page - 1);
    if (from > 0) {
      options.from = from;
    }
    if (typeof this._minScore === 'number') {
      options.min_score = this._minScore;
    }
    if (Array.isArray(this._searchAfter) && this._searchAfter.length > 0) {
      if (options.from !== undefined) {
        throw new TypeError(
          `searchAfter() cannot be combined with page(${this._page}): ` +
            'Elasticsearch requires from to be 0 with search_after. ' +
            "Use page 1 (reset('page')) and page with the hits' sort values.",
        );
      }
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
