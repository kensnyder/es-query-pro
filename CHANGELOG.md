## Change Log

### v3.0.0-beta.4

Implements the 2026-11-19 code review. Upgrade guide:
[`docs/consumers/upgrading-to-beta-4.md`](./docs/consumers/upgrading-to-beta-4.md).
Indexes that use `englishplus` must be reindexed (see Analyzer below).

Conventions: `QueryBuilder` throws synchronously (`TypeError`/`RangeError`)
on invalid input and nothing is added; `IndexManager`, `QueryRunner` and
`SchemaRegistry` never throw and return `{ ..., error, errorKind, response }`
envelopes. `error` is always an `Error` or `null`.

#### Breaking changes

IndexManager

1. `IndexErrorKind` gains `aborted`, `serialization`, `product` and
   `configuration`; an exhaustive `switch` needs the new cases. A thrown
   non-`Error` value is wrapped in an `Error` with the value as `cause` (a
   thrown `undefined` used to give `error: undefined`).
2. `IndexErrorShape` is the error half of the envelope,
   `{ error, errorKind, response }` (it was a function type).
   `IndexRunShape<T>` is `QueryRunner<IndexInferCreate<T>>` (it was
   `unknown`).
3. `create()`, `createIfNeeded()` and `recreate()` return the same keys on
   every path: `success`, `code` (new type `IndexLifecycleCode`),
   `aliasIndexes`, `indexResponse`, `aliasResponse`, `request`, `took`,
   `error`, `errorKind`, `response`; `recreate()` adds `dropResponse` and
   `flushResponse`. `error`/`errorKind` are `null` on success (were
   `undefined`). `createAliasIfNeeded()` returns `success`, `code`,
   `aliasIndexes`, `aliasResponse` and the envelope; its `'ERROR'` code is
   replaced by `EXISTS_CHECK_ERROR` / `ALIAS_ERROR`.
4. These methods check where the alias points and never add it to a second
   index. When it points at an older version, a newer version or an
   unrelated index, they return `NEEDS_MIGRATION`, `NEWER_VERSION_PRESENT`
   or `ALIAS_CONFLICT` with `success: false` and `error: null`. `create()`
   still creates the index in that case; `createIfNeeded()` and
   `createAliasIfNeeded()` change nothing. `createIfNeeded()` adds a missing
   alias to an existing index (`ALIAS_CREATED`) and treats "already exists"
   from a concurrent caller as success. `recreate()` stops at the first
   failed step (`DROP_ERROR`, `FLUSH_ERROR`, ...).
5. `drop()` sends only `DELETE /<index>` (Elasticsearch removes the aliases).
   `flush()` flushes the versioned index, not the alias.
6. `getAliasMetadata()` returns `success: false` for a missing `more.index`
   or a 404 without a body. `aliasExists()` returns `response: false` on a
   thrown 404. `exists()` options are typed as the index-exists request
   (`flat_settings`, `include_defaults`, ...), not the alias-exists request.
7. `getStatus()` resolves to a wider `StatusReport`: new `aliasIndexes`,
   `aliasAttached`, `siblings`, `error`, `errorKind`. `summary` (type
   `StatusSummary`) gains `unknown` (any failed check; both booleans false),
   `newerVersionPresent`, `aliasConflict` and `needsAlias` (these were
   reported as `needsMigration`, `needsMigration` and `current`).
   `needsMigration()` and `needsCreation()` return `boolean | null`;
   `needsMigration()` is true only for an older (or incomparable) version
   with no newer one, and `needsCreation()` now works (it was always false).
   `getSiblingIndexes()` returns an envelope with `aliasIndexes` and
   `siblings` (`SiblingIndexes`); the old array is `.siblings.all`.
8. `put(id, body, more?)` and `deleteById(id, more?)` take request params;
   ids are `string | number`. The `more` types of `put`, `patch`,
   `findById`, `deleteById`, `deleteMany` and `count` omit the keys the
   method sets (`index`, `id`, `doc`, `document`, `query`); `count()` rejects
   search-only keys such as `size` and `sort`.
9. `patch()` sends `retry_on_conflict: 3` unless `more` sets it or
   `if_seq_no`/`if_primary_term`; `result` is Elasticsearch's (`updated`,
   `noop`, `created`) and `null` on failure (was `'error'`).
10. `putBulk(records, more?, options?)`: `report` rows are
    `{ id, status, effect, version, error }` with `null` for unknown values,
    one per record in order, including generated ids; only `undefined`/`null`
    ids get a UUID (`0` is kept as `'0'`); records are sent in chunks
    (`chunkSize` 1000, `chunkBytes` 5 MiB) and sending stops at the first
    failed request; rejected rows give `error: AggregateError`,
    `errorKind: 'response'`; `more` is no longer echoed in the result and may
    not set `index`/`operations`; `request` is `POST /<alias>/_bulk`.
11. `findById()` treats a missing record as success: `record: null`,
    `found: false`, `error: null`; it always returns `request` and `found`.
    `deleteById()` returns `result`.
12. `deleteMany(callback?, more?)` passes `more` to `_delete_by_query` and
    returns `{ success, deleted, versionConflicts, failures, request, took,
error, errorKind, response }`; failures or a timeout set `success: false`.
    Without a callback, or with one that adds no conditions, it still deletes
    every document (stated in the JSDoc and README). A builder with no
    `query` (retrievers only) returns an error envelope and sends nothing.
13. `findMany()`, `findFirst()`, `count()` and `deleteMany()` return an error
    envelope when the callback or request building throws (they used to
    reject).

Migration (`IndexManager.migrateIfNeeded()`, now in
`src/IndexManager/migrate.ts`)

14. New zero-downtime flow: the new index is created without the alias and
    filled with `_reindex` (`version_type: 'external'`, `conflicts:
'proceed'`), a catch-up pass runs, the alias moves in one atomic
    `_aliases` update, a final catch-up pass runs, counts are verified, then
    the old index is deleted. Reads, `findById`, `put` and `patch` keep
    working against the old index during the copy (previously the alias
    pointed at both indexes, giving duplicate reads, failing `findById` and
    overwritten writes). No flush runs after migrating.
15. `migrateIfNeeded(params?)` resolves to `MigrationResult`: `success`,
    `code` (`MigrationCode`), `status`, `newName`, `aliasName`, `oldNames`,
    `recordsToMigrate`, `createdIndex`, `createdAlias`, `resumed`,
    `attached`, `taskId`, `request`, `completion`, `took`, `error`,
    `errorKind`, `response`. `completion` is a promise of a
    `MigrationOutcome` and never rejects. `createdIndex` is no longer `true`
    after a failed create.
16. Codes: `CREATED`, `ALIAS_CREATED` (an index without its alias; was
    reported as current), `CURRENT`, `MIGRATION_STARTED`, `MIGRATION_RESUMED`
    (re-running is idempotent and attaches to a running copy);
    `NEWER_VERSION_PRESENT` (downgrades are refused; the old code migrated
    backwards), `INCOMPARABLE_VERSION`, `ALIAS_CONFLICT` (`success: false`,
    `error: null`, nothing changed); `STATUS_ERROR` (a failed status check;
    the old code tried to create the index), `COUNT_ERROR`, `CREATE_ERROR`,
    `ALIAS_ERROR`, `REINDEX_ERROR`. Outcome codes: `MIGRATED`,
    `REINDEX_FAILED` (task errors, failures, timeouts and cancellations are
    now detected), `REINDEX_ERROR`, `POLL_ERROR`, `TIMEOUT`, `SWAP_ERROR`,
    `VERIFY_FAILED`.
17. Callbacks: `onComplete` fires once, only on success, also for an empty
    source and for creation; `onError` fires once; a callback that throws is
    ignored. `MigrationProgressDetails` gains required `phase` and
    `failures`; `percent` is 0 while `total` is 0, 0–99 while running and 100
    only in the final `phase: 'done'` events (one per old index);
    `onComplete`'s `oldIndex` lists old names joined with `,`.
18. New options: `timeout`, `maxPollErrors` (default 5),
    `requestsPerSecond`, `batchSize`. `pollInterval` is the longest wait
    (minimum 10 ms); checks start at 100 ms and back off.
19. While a migration runs, the new index's mapping `_meta` holds
    `"es-query-pro-migration"` (the copy's task id) so a later run can
    resume; it is removed at the end.
20. Known limitation: a document deleted through the alias during the copy
    can reappear in the new index (no tombstones). Old versioned indexes
    that are no longer on the alias are never cleaned up, and indexes on the
    alias that are not versions of this one are never copied or removed.

QueryBuilder

21. `valueOf()` is removed.
22. Highlighting: the default highlighter is `unified` (was `fvh`, which
    fails or returns no hits on fields without term vectors).
    `highlighterOptions()` merges into the current options (a key set to
    `undefined` is removed) instead of replacing them.
23. Source filtering: `fields([])` sends `_source: false`; `fields()` with
    `excludeFields()` sends `_source: { includes, excludes }` in the body and
    `_source_excludes` is no longer emitted.
24. Validation: setters throw on invalid input (`rankWindowSize`,
    `rankConstant`, `minScore`, `trackTotalHits` (`-1` rejected; use
    `false`), `fields`, `excludeFields`, `searchAfter`, `limit` (integer
    > = 0), `page` (integer >= 1), `sort`, `sortByRandom`, `reset` (unknown
    > names), `term` (missing, `null`, array or object values), the pattern
    > methods, `range`, retriever methods, aggregation options). Getters return
    > copies, and `getBody()`/`getQuery()` output shares nothing with the
    > builder; `aggs()` copies its input.
25. Match family: `matchBoostedPhrase()` default boosts are exact 5, and 3,
    or 1 (the exact phrase now ranks highest); a missing weight defaults by
    operator. A blank phrase (empty, whitespace, `null`, `undefined`) adds
    nothing in `match`, `matchPhrase`, `matchPhrasePrefix`, `multiMatch`,
    `matchBoostedPhrase`, `containsExact`, `simpleQueryString`, `semantic`,
    `rrf` and `weightedSemantic`: an empty search box returns everything
    instead of nothing. `containsExact(f, '')` used to match every document
    with the field.
26. `range()` throws for invalid operators and values, for `between` with a
    numeric or `Date` min above max, and for a `Date` combined with a
    non-ISO `format` (which silently matched nothing). Blank-string bounds
    are open.
27. `rexgep(field, value)` (positional form) is now case-insensitive, like
    the object form; `rexgep` is deprecated in favor of `regexp`.
    `termsSet()` without a minimum sends `minimum_should_match: 1` (was a
    400).
28. `sort('_score')` sorts descending (best match first). Sort objects are
    stored as `{ field: { order } }` (`{ _score: 'desc' }` becomes
    `{ _score: { order: 'desc' } }`). `page()` without `limit()` pages by 10
    hits, and `from` is omitted when 0. `searchAfter()` with `page() > 1`
    throws at `getQuery()`. `sortByRandom()` puts `_score` first, so field
    sorts only break ties.
29. Bool composition: `should()` with one non-empty branch adds all of its
    clauses directly; empty branches are skipped and a positive
    `minimumShouldMatch` above their number is lowered; a numeric
    `minimumShouldMatch` must be an integer with an absolute value at most
    the number of branches. `shouldNot()` sends one `must_not` holding the
    `should` query, so a branch with two conditions excludes only documents
    matching both. Empty `mustNot()`/`should()` add nothing. Sub-builder
    callbacks throw when they set anything other than conditions (sort,
    limit, aggregations, retrievers, ...). `must()` copies and validates its
    clause. `nested()` sends a lone clause without a `bool.must` wrapper and
    sends `score_mode`, `inner_hits` and `ignore_unmapped` only when given.
30. Aggregations: `aggregateTerm()` drops `missing_bucket`/`missing_order`
    (passing them throws; use `missing`), orders by another field through a
    `min` (asc) or `max` (desc) sub-aggregation named `__order_<i>` (the old
    mapping was inverted and rejected for keyword fields), and requires
    `limit` >= 1. `aggregate*` helpers no longer override a limit you set.
    `dateHistogram()` emits a plain `date_histogram` with
    `min_doc_count: 0`: the response is
    `buckets: [{ key: <epoch ms>, key_as_string, doc_count }]`, includes
    empty buckets and is not truncated; its `limit` option is removed (it
    throws). Offsets and intervals throw `RangeError` (was `Error`); `+1w`,
    `+1M`, `+1q`, `+1y` are rejected, unsigned offsets and `nanos`/`micros`
    are accepted. `aggregateDateHistogram()` throws `TypeError` unless
    exactly one of `calendarInterval`/`fixedInterval` is set. Geotile
    `precision` must be an integer 0–29; `bounds` is `estypes.GeoBounds`.
    `orderBy[].field` is typed `Field`.
31. Rescore: the rescore query is the inner builder's query (the old shape
    was rejected by Elasticsearch); an inner builder with no condition adds
    no phase; a retriever inside it throws. `getBody()` throws for rescore
    with any sort other than a lone `_score` descending.
32. Retrievers: `weightedSemantic()` `boosts` is `[contains, phrase, match]`
    (default `[6, 4, 1]`; four values throw) and uses the builder's rank
    settings and normalizer (defaults 50 and 20, was a hardcoded 100/10).
    `knn()` `similarity` is a number only and `num_candidates` is always
    sent (default `min(ceil(1.5 * k), 10000)`). A `linear` body has no
    top-level `normalizer`. A lone retriever with conditions takes them as
    its own `filter` instead of being wrapped in `linear` (scores are no
    longer min-max normalized). Retrievers with `sort()`, `searchAfter()`,
    `sortByRandom()` or score functions throw; an explicit
    `rankWindowSize()` below `limit()` throws `RangeError`; without one the
    window is raised to cover `from + size`. Rescore with retrievers is sent
    as a `rescorer` retriever (it used to be dropped or rejected).
    `_retrievers` is private.
33. `clone()` returns `this` (subclasses survive); `toKibana()` prints
    `GET _search` when there is no index.

QueryRunner

34. `updateMany()` returns an envelope (`success`, `updated`, `total`,
    `versionConflicts`, `noops`, `failures`, ...) instead of the raw
    response and never throws. It uses one fixed Painless script with field
    paths as parameters (field names were injected into the script), checks
    keys against the mapping at run time (unknown keys, sub-fields, empty
    values are rejected without a request), defaults `conflicts: 'proceed'`,
    sends `limit()` as `max_docs` (`limit(0)` is an error), and its `more`
    may not set `script`. `toPainlessSourcePath()` is removed.
35. `count()` sends only the query, `min_score` and `more` (it used to send
    `sort`, `size`, ... and get a 400). With retrievers it returns
    `{ total: null, error }` without a request (it used to reject).
36. Every result has `error`, `errorKind` and `response`. On error `records`
    is `[]`, `total`/`aggregations` are `null`, `response` is the error
    metadata (was `null`) and `request` is `null` when nothing was sent.
    `aggregations` is `null` when absent. `findFirst()` `record` is `null`
    when nothing matched (was `undefined`) and no longer changes the builder.
    `took` is wall-clock milliseconds (Elasticsearch's is in
    `response.took`).
37. `findFirstOrThrow()` rethrows the request's error, and throws a
    `QueryNotFoundError` (`name: 'NotFoundError'`, `status: 404`, `result`)
    when nothing matched. `QueryRecord` adds `_id`, `_highlight` and `_sort`.

SchemaRegistry

38. Every operation resolves to `SchemaFleetResult`: `{ success, took,
report, summary, error, errorKind }`. An empty registry is
    `success: false` with `errorKind: 'configuration'` everywhere
    (`recreateAll()` used to throw). An invalid `concurrency` is a
    configuration error; fractions are rounded down.
39. `migrateIfNeeded()` returns `{ acknowledged, error, errorKind,
completion }` and awaits each index's `completion` (it used to count
    `percent === 100` events). `SchemaMigrationReport` gains `code`,
    `migration` and `errorKind`; `before` is the migration's own status;
    `after` is read once the index's migration settled, and a failing `after`
    read no longer fails the index. `NEWER_VERSION_PRESENT`,
    `INCOMPARABLE_VERSION` and `ALIAS_CONFLICT` are `failed` with
    `error: null`. New `timeout` for the whole run (invalid values give
    `acknowledged: false`); all `MigrationParams` are passed to each index.
    Throwing callbacks are ignored (no `console.error`).
40. `recreateAll()`: `report` is `SchemaRecreateReport[]`; `summary` holds
    each `recreate()` code or `'ERROR'` (was always `'SUCCESS'`).
    `getStatus()`: `report` is `StatusReport[]`, `summary` is
    `Record<string, StatusSummary>`, and `success` is false when any status
    has an error. `dropAll()`: `results` is renamed `report`
    (`SchemaDropReport[]`) and `summary` is `DROPPED`, `MISSING` (counts as
    success) or `ERROR`.
41. Registration dedupes on the full name and throws when two versions of
    the same alias are registered; `registerAll()` is all or none; the
    constructor copies its array. `indexes` is `readonly`. `_migrateOne()`
    changed signature.

IndexNameManager

42. The constructor (and so `IndexManager`'s) throws `RangeError` for names
    Elasticsearch would reject (uppercase, forbidden characters, leading
    `- _ + .`, over 255 bytes), an empty language, a negative or fractional
    numeric version, an empty string version and parts containing the
    separator. Single-character names, leading digits and `-` in
    `create.index` are now accepted.
43. `parseByName()` throws `RangeError` unless the name has 3 or 4 valid
    parts ending in `v<version>`, and returns integer versions as numbers.
    `isValidColumnName()` and the `ColumnName` type are removed.

Analyzer and utilities

44. `englishplus` adds an English possessive filter and moves `asciifolding`
    before the stop and stem filters, so it produces different tokens
    (`résumés` and `resumes` now both stem to `resume`; `John's` becomes
    `john`). **Indexes that use it must be reindexed**: raise `version` and
    run `migrateIfNeeded()`.
45. Time zones (`dateHistogram`, `aggregateDateHistogram`) throw `RangeError`
    (was `Error`) and reject `EST`, `MST`, `HST`, `ROC`, wrong-case names and
    out-of-range offsets that used to reach Elasticsearch and fail there.
46. `isEmptyObject()` returns false for arrays, Dates, Maps, Sets, class
    instances and objects with only symbol or non-enumerable keys.

#### Added

- `QueryBuilder`: `filter(callback)` (filter context, `getFilter()`,
  `reset('filter')`), `regexp()`, `simpleQueryString()`, `normalizer()`,
  `scoreFunction()`, `functionScoreOptions()`/`getFunctionScoreOptions()`,
  `getSortByRandomOptions()`, static `QueryBuilder.escapeWildcards()`,
  `range()` `options` (`format`, `time_zone`, `relation`, `boost`) and
  `Date` values, `matchPhrase()` options, options on `term`, `wildcard`,
  `containsExact`, `regexp`, `queryString`, `sort(clause | clause[])`,
  `sortByRandom(enabled, { seed, field })`, `rescore` options `queryWeight`,
  `rescoreQueryWeight`, `scoreMode` (`windowSize` optional), working
  `includeFacets()`, `name` on every aggregation helper, `after` on the
  composite helpers, `order` on `aggregateHistogram`, `dateHistogram`
  `timeZone` (`timezone` deprecated) and `extendedBounds`,
  `weightedSemantic` `exactField`, `nested({ innerHits: true })`.
- `IndexManager`: `putBulk` `options` (`chunkSize`, `chunkBytes`); request
  params on `put`, `deleteById`, `deleteMany`, `count`; `createIfNeeded(more)`
  and `recreate(more)`.
- `IndexNameManager.tryParseByName()`, `.compare()`, `.isValidEsIndexName()`.
- `SchemaRegistry`: named map form `new SchemaRegistry({ books, authors })`
  with typed `get(name)` and `getNamedIndexes()`.
- Time zones accept `+0530`, `+05`, `GMT`, `CET`, `EST5EDT` and other
  single-segment names.
- Type exports: `IndexLifecycleCode`, `IndexCreateOnlyResult`,
  `IndexCreateRequestShape`, `IndexRecreateResult`, `IndexRecordId`,
  `IndexPutParams`, `IndexPutBulkParams`, `IndexPutBulkOptions`,
  `IndexPutBulkReportRow`, `IndexPatchParams`, `IndexFindByIdParams`,
  `IndexFindByIdResult`, `IndexDeleteByIdParams`, `IndexDeleteManyParams`,
  `IndexDeleteManyResult`, `IndexCountParams`, `IndexSiblingIndexesResult`,
  `SiblingIndexes`, `StatusSummary`, `IndexMigrateResult`, `MigrationCode`,
  `MigrationOutcome`, `MigrationOutcomeCode`, `MigrationParams`,
  `MigrationPassPhase`, `MigrationPassReport`, `MigrationPhase`,
  `MigrationRequest`, `MigrationResult`; `IndexName`, `IndexNameAttributes`,
  `IndexNameRelation`; `AggregateDateHistogramOptions`,
  `AggregateGeotileGridOptions`, `AggregateHistogramOptions`,
  `AggregateTermOptions`, `CompositeAggregationOptions`,
  `CompositeDateHistogramSource`, `CompositeGeotileGridSource`,
  `CompositeHistogramSource`, `DateHistogramInterval`,
  `DateHistogramOptions`, `FunctionScoreOptions`, `HighlightDefinition`,
  `KnnOptions`, `NestedOptions`, `QueryStringOptions`, `RandomSortOptions`,
  `RangeOptions`, `RegexpOptions`, `RescoreOptions`, `ResetName`,
  `RrfOptions`, `SemanticOptions`, `ShouldOptions`,
  `SimpleQueryStringOptions`, `SortClause`, `TermOptions`, `TermsOrderBy`,
  `TermsSetOptions`, `TermValue`, `WeightedSemanticOptions`,
  `WildcardOptions`; `QueryCountParams`, `QueryFindParams`,
  `QueryNotFoundError`, `QueryUpdateManyParams`, `QueryUpdateManyResult`,
  `QueryUpdateValues`; `AnyIndexManager`, `SchemaDropCode`,
  `SchemaDropReport`, `SchemaFleetResult`, `SchemaNamedIndexes`,
  `SchemaRecreateCode`, `SchemaRecreateReport`,
  `SchemaRecreateResultShape`.

#### Fixed

- `IndexManager` no longer logs with `console.log`; `aliasExists()` and
  `drop()` resolve when a check fails.
- `getStatus()` sends its two requests in parallel; `migrateIfNeeded()`
  fetches the alias once.
- `range()` stores `Date` values as ISO strings; `multiMatch()` omits
  `fields` when not given.
- `count()` through `IndexManager` sends `more` to `_count`.
- The bundled `dist/index.d.ts` type-checks with `skipLibCheck: false`.
- The package is ESM only, as `package.json` declares; the documentation no
  longer mentions a CommonJS build.

### v3.0.0-beta.3 on 2026-11-20

Breaking changes:

1. `new IndexManager({ index, schema, … })` → `new IndexManager(options, create)`:
   `options` is `ManageOptions` (`client`, `separator`, `version`, `prefix`,
   `language`, `serverless`) and `create` is an Elasticsearch
   `estypes.IndicesCreateRequest` whose `index` is the logical name. Everything
   else in `create` (`settings`, `mappings`, `aliases`, …) is sent unchanged.
   The constructor options `index` (object), `schema`, `properties`,
   `settings` and `analyzer` are gone.
2. `client` is required; `getEsClient()` is removed and `ES_ENDPOINT` /
   `ES_API_KEY` / `ES_USERNAME` / `ES_PASSWORD` / `ES_VERSION` are no longer
   read by the library (`ES_SERVERLESS` still is). The library imports
   `@elastic/elasticsearch` for types only.
3. String schemas (`SchemaShape`) are gone, along with `SchemaManager`,
   `ManagerInferSchema`, `ManagerInferRecordShape`, `IndexInferSchema`,
   `ElasticsearchRecord`, `ElasticsearchType`, `ColumnType` (and the unused
   `IndexSettings`, `MappingProperty`, `MappingProperties` aliases). Use
   `MappingRecord`, `IndexInferRecordShape` and `estypes` instead.
4. `text` fields no longer get `.exact` / `.fulltext` sub-fields or
   `term_vector` automatically; sub-objects are no longer mapped as `nested`
   automatically; the `analyzer` option is gone. Declare all of these in the
   mapping (the README shows the hand-written equivalent).
5. `IndexManager.schema`, `.settings`, `.analyzer` are removed; `.createSpec`
   (the creation request as passed) is added.
6. `allFields` now contains full dotted paths (`categories.name`, not `name`);
   `fulltextFields` no longer includes `completion` or `token_count` fields.
7. Field names passed to query callbacks from an `IndexManager` (`findMany`,
   `findFirst`, `count`, `deleteMany`, `run`) are type-checked against the
   mapping (compile-time only), as are records passed to `put`, `putBulk` and
   `patch`. Requires TypeScript 5.0+. Opt out per manager with
   `new IndexManager<estypes.IndicesCreateRequest>(…)`.
8. Error `errorKind` is decided by the error's `name`, not `instanceof`.

Added:

- `getAllFields(create, { subFields, containers })` and
  `getFulltextFields(create, { subFields })`.
- Types `ManageOptions`, `IndexInferCreate`, `IndexInferFields`,
  `MappingFieldPath`, `MappingFulltextPath`, `MappingRecord`,
  `QueryBuilderProvider`, `IndexErrorKind`, `QueryRecord`.
- `QueryBuilder<Field extends string = string>`; `new QueryBuilder()` behaves
  as before.

Fixed:

- `getIndexMetadata()` no longer always returns an error with client v9.
- `StatusReport.indexExists` / `aliasExists` are typed `boolean | null`.
- Errors from a second copy of the client package are classified correctly.
- `SchemaRegistry.listIndexes()` returns each index's version.
- `englishplus` is typed `{ analysis: IndicesIndexSettingsAnalysis }`, so
  `settings: { analysis: englishplus.analysis }` type-checks.

### v2.0.0-beta.1 on 2025-08-14

- Initial release with IndexManager and nested field support

### v1.0.0-beta.1 on 2022

- Test release of Query Builder
