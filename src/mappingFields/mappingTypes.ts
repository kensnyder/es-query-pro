/**
 * Type-level counterparts of `getAllFields()` / `getFulltextFields()` in
 * `mappingFields.ts`. They walk the literal type of an
 * `estypes.IndicesCreateRequest` (inline, or declared with
 * `as const satisfies estypes.IndicesCreateRequest`) and produce field-name
 * unions and a document shape. When the mapping is not statically known
 * (e.g. a variable annotated as `estypes.IndicesCreateRequest`), they fall
 * back to `string` / `Record<string, any>`, never to a false error.
 *
 * Types only: nothing here exists at runtime.
 */

/** Mapping types that can be the target of a full-text `match` query (D4) */
type FulltextType =
  | 'text'
  | 'match_only_text'
  | 'search_as_you_type'
  | 'semantic_text';

/** `dynamic` values that let Elasticsearch add fields on its own (D3) */
type LooseDynamic = true | 'true' | 'runtime';

type NumericType =
  | 'long'
  | 'integer'
  | 'short'
  | 'byte'
  | 'double'
  | 'float'
  | 'half_float'
  | 'scaled_float'
  | 'unsigned_long';

type DateType = 'date' | 'date_nanos';

type StringType =
  | 'keyword'
  | 'text'
  | 'wildcard'
  | 'constant_keyword'
  | 'match_only_text'
  | 'search_as_you_type'
  | 'semantic_text'
  | 'ip'
  | 'version';

/** An empty object type usable in intersections and `extends` checks */
type Empty = Record<never, never>;

type IsAny<T> = 0 extends 1 & T ? true : false;

/** True when `T` has key `K` and it is optional */
type HasOptionalKey<T, K extends PropertyKey> = K extends keyof T
  ? Empty extends Pick<T, K>
    ? true
    : false
  : false;

/**
 * True when a property specification is not a literal: `any`, the
 * `estypes.MappingProperty` union or one of its interfaces, where
 * `properties` / `fields` are optional and their contents unknown.
 */
type IsOpenSpec<Spec> =
  IsAny<Spec> extends true
    ? true
    : true extends HasOptionalKey<Spec, 'properties' | 'fields'>
      ? true
      : false;

/** True when the specification explicitly sets a loose `dynamic` value */
type IsLooseSpec<Spec> = [Spec] extends [{ dynamic: infer D }]
  ? [Extract<D, LooseDynamic>] extends [never]
    ? false
    : true
  : false;

/**
 * True when paths below this property cannot all be known statically:
 * open specifications, a loose `dynamic`, or `flattened` (whose keys are
 * queryable as `field.key`).
 */
type HasUnknownChildren<Spec> =
  IsOpenSpec<Spec> extends true
    ? true
    : IsLooseSpec<Spec> extends true
      ? true
      : [Spec] extends [{ type: 'flattened' }]
        ? true
        : false;

/**
 * Strictness for the object a specification describes: its own `dynamic`
 * when set, otherwise the inherited value.
 */
type StrictOf<Spec, Inherited extends boolean> = [Spec] extends [
  { dynamic: infer D },
]
  ? [D] extends ['strict']
    ? true
    : false
  : Inherited;

/**
 * The literal `mappings` object of a creation request, or `never` when the
 * field paths are not statically known: `any`/`never`, a widened request
 * (optional `mappings`), no `mappings`, or `mappings` with neither literal
 * `properties` nor `runtime`.
 */
type KnownMappings<Create> =
  IsAny<Create> extends true
    ? never
    : [Create] extends [never]
      ? never
      : [Create] extends [{ mappings: infer M }]
        ? [M] extends [{ properties: infer P }]
          ? string extends keyof P
            ? never
            : M
          : [M] extends [{ runtime: unknown }]
            ? M
            : never
        : never;

type PropertiesOf<M> = [M] extends [{ properties: infer P }] ? P : Empty;

type RuntimeKeysOf<M> = [M] extends [{ runtime: infer R }]
  ? keyof R & string
  : never;

// ---------------------------------------------------------------------------
// All paths
// ---------------------------------------------------------------------------

/**
 * Every path under a `properties` object: containers, leaves and their
 * sub-fields. Sub-fields do not nest.
 */
type PathsOf<P> = string extends keyof P
  ? string
  : {
      [K in keyof P & string]: K | ChildPaths<K, P[K]>;
    }[keyof P & string];

type ChildPaths<K extends string, Spec> =
  HasUnknownChildren<Spec> extends true
    ? `${K}.${string}`
    : [Spec] extends [{ properties: infer S }]
      ? `${K}.${PathsOf<S>}`
      : [Spec] extends [{ fields: infer F }]
        ? `${K}.${keyof F & string}`
        : never;

// ---------------------------------------------------------------------------
// Full-text paths
// ---------------------------------------------------------------------------

/**
 * True for a full-text leaf or sub-field. An `alias` is full-text when its
 * `path` is one of `Targets` (the non-alias full-text paths).
 */
type IsFulltextSpec<Spec, Targets> = [Spec] extends [
  { type: 'alias'; path: infer Path },
]
  ? string extends Path
    ? true
    : [Path] extends [Targets]
      ? true
      : false
  : [Spec] extends [{ type: FulltextType }]
    ? true
    : false;

/**
 * Full-text paths under a `properties` object. Containers are never
 * full-text; their children are walked.
 */
type FulltextPathsOf<P, Targets> = string extends keyof P
  ? string
  : {
      [K in keyof P & string]: FulltextPropertyPaths<K, P[K], Targets>;
    }[keyof P & string];

type FulltextPropertyPaths<K extends string, Spec, Targets> =
  IsOpenSpec<Spec> extends true
    ? K | `${K}.${string}`
    : [Spec] extends [{ properties: infer S }]
      ? IsLooseSpec<Spec> extends true
        ? `${K}.${string}`
        : `${K}.${FulltextPathsOf<S, Targets>}`
      :
          | (IsFulltextSpec<Spec, Targets> extends true ? K : never)
          | (IsLooseSpec<Spec> extends true ? `${K}.${string}` : never)
          | ([Spec] extends [{ fields: infer F }]
              ? `${K}.${FulltextSubFieldsOf<F, Targets>}`
              : never);

type FulltextSubFieldsOf<F, Targets> = string extends keyof F
  ? string
  : {
      [S in keyof F & string]: IsFulltextSpec<F[S], Targets> extends true
        ? S
        : never;
    }[keyof F & string];

/** Two passes: aliases resolve against the non-alias full-text paths */
type FulltextPaths<P> = FulltextPathsOf<P, FulltextPathsOf<P, never>>;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

type ScalarValue<T> = T extends NumericType
  ? number
  : T extends 'boolean'
    ? boolean
    : T extends DateType
      ? string | number | Date
      : T extends StringType
        ? string
        : unknown;

/** Every field is nullable and also accepts an array of its type */
type FieldValue<V> = V | V[] | null;

type SingleValue<Spec, Strict extends boolean> =
  IsOpenSpec<Spec> extends true
    ? unknown
    : [Spec] extends [{ properties: infer S }]
      ? RecordOf<S, StrictOf<Spec, Strict>>
      : [Spec] extends [{ type: infer T }]
        ? ScalarValue<T>
        : unknown;

/**
 * Keys not in the mapping are allowed (as `any`, so interfaces without an
 * index signature stay assignable) unless the object is strict.
 */
type ExtraKeys<Strict extends boolean> = Strict extends true
  ? unknown
  : Record<string, any>;

/**
 * An object with only optional keys and an `any` index signature would also
 * accept an array, letting `[{ id: 'wrong' }]` slip through as "one object".
 * Documents never have symbol keys, so this rules arrays out.
 */
type NotAnArray = { readonly [Symbol.iterator]?: never };

type RecordOf<P, Strict extends boolean> = string extends keyof P
  ? Record<string, any>
  : {
      -readonly [K in keyof P & string]?: FieldValue<SingleValue<P[K], Strict>>;
    } & ExtraKeys<Strict> &
      NotAnArray;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Union of every field path a query may name for a creation request:
 * leaves, object/nested containers, multi-field sub-fields and runtime
 * fields, as dotted paths (`categories.name`, `title.exact`).
 *
 * Falls back to `string` when the paths are not statically known (widened
 * `estypes.IndicesCreateRequest`, no `mappings`, `mappings` without
 * `properties` or `runtime`) or when `mappings.dynamic` is `true`, `'true'`
 * or `'runtime'`. Below an object whose own `dynamic` is loose, a
 * `flattened` field, or a non-literal property specification, any
 * `parent.${string}` path is accepted.
 */
export type MappingFieldPath<Create> = [KnownMappings<Create>] extends [never]
  ? string
  : IsLooseSpec<KnownMappings<Create>> extends true
    ? string
    :
        | PathsOf<PropertiesOf<KnownMappings<Create>>>
        | RuntimeKeysOf<KnownMappings<Create>>;

/**
 * Union of the full-text field paths of a creation request: leaves and
 * sub-fields of type `text`, `match_only_text`, `search_as_you_type` or
 * `semantic_text`, plus `alias` fields whose `path` is one of those.
 * Same fallbacks as `MappingFieldPath`.
 */
export type MappingFulltextPath<Create> = [KnownMappings<Create>] extends [
  never,
]
  ? string
  : IsLooseSpec<KnownMappings<Create>> extends true
    ? string
    : FulltextPaths<PropertiesOf<KnownMappings<Create>>>;

/**
 * The document shape for a creation request's mapping. Every field is
 * optional, nullable and also accepts an array of its type. Containers map
 * to objects; numeric types to `number`, `boolean` to `boolean`, `date` /
 * `date_nanos` to `string | number | Date`, string-like types to `string`,
 * and anything else to `unknown`. Keys not in the mapping are allowed unless
 * `dynamic` is `'strict'` (per object, inherited when omitted).
 *
 * `Record<string, any>` when the paths are not statically known.
 */
export type MappingRecord<Create> = [KnownMappings<Create>] extends [never]
  ? Record<string, any>
  : RecordOf<
      PropertiesOf<KnownMappings<Create>>,
      StrictOf<KnownMappings<Create>, false>
    >;
