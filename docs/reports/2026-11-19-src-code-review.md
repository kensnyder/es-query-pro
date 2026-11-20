# es-query-pro — `src/` Code Review

**Date:** 2026-11-19  
**Scope:** every file and function under `src/` plus `index.ts`  
**Method:** 7 parallel Opus reviewers, one per slice (below). Reviewers ran throwaway Bun scripts with stubbed ES clients and `tsc` to confirm findings where possible. No live Elasticsearch cluster was contacted, so ES-side behavior marked "from knowledge" in a finding's Confidence line has not been run against a server.

Each finding has a stable ID: **B-nnn** for bugs (ordered Critical → Low) and **S-nnn** for suggestions (ordered High → Low impact). Duplicates reported by more than one reviewer have been merged.

## Slices reviewed

1. **Schema/Naming/Utils** — SchemaManager, IndexNameManager, types, client & utilities
2. **IndexManager (lifecycle)** — IndexManager — envelopes, metadata, index & alias lifecycle (lines 1–760)
3. **IndexManager (CRUD/migration)** — IndexManager — CRUD, status & zero-downtime migration (lines 755–1419)
4. **QueryBuilder (match/semantic)** — QueryBuilder — config, source filtering, highlighting, match family, semantic & RRF (lines 1–850)
5. **QueryBuilder (term/knn/aggs)** — QueryBuilder — term-level queries, knn, rescore & aggregations (lines 850–1605)
6. **QueryBuilder (bool/sort/serialize)** — QueryBuilder — paging, sorting, bool composition, serialization (lines 1600–2194)
7. **QueryRunner/SchemaRegistry** — QueryRunner (execution, count, updateMany) & SchemaRegistry (fleet operations)

## Summary

| Area | Critical | High | Medium | Low | Suggestions |
|---|---:|---:|---:|---:|---:|
| Schema/Naming/Utils | 0 | 1 | 7 | 11 | 7 |
| IndexManager (lifecycle) | 0 | 3 | 4 | 5 | 8 |
| IndexManager (CRUD/migration) | 2 | 3 | 8 | 7 | 7 |
| QueryBuilder (match/semantic) | 0 | 2 | 6 | 7 | 11 |
| QueryBuilder (term/knn/aggs) | 1 | 1 | 9 | 5 | 9 |
| QueryBuilder (bool/sort/serialize) | 0 | 2 | 4 | 4 | 12 |
| QueryRunner/SchemaRegistry | 0 | 5 | 7 | 4 | 9 |
| **Total** | **3** | **17** | **45** | **43** | **63** |

**108 bugs, 63 suggestions.**

## Bug index

| ID | Severity | Area | Title |
|---|---|---|---|
| [B-001](#b-001) | Critical | IndexManager (CRUD/migration) | `migrateIfNeeded` drops the old index even when the reindex failed |
| [B-002](#b-002) | Critical | IndexManager (CRUD/migration) | Writes made during a migration are overwritten, resurrected or rejected (reindex uses `op_type: 'index'`) |
| [B-003](#b-003) | Critical | QueryBuilder (term/knn/aggs) | `rescore()` builds a `rescore_query` that ES rejects (it's a whole search request, plus a stray `length` key) |
| [B-004](#b-004) | High | Schema/Naming/Utils | `ElasticsearchRecord` types every numeric type except `integer` as `string`, and every field is required |
| [B-005](#b-005) | High | IndexManager (lifecycle) | `getIndexMetadata` fails on every call, even for a healthy index |
| [B-006](#b-006) | High | IndexManager (lifecycle) | `drop()` reports failure whenever the alias existed, even though the index was deleted |
| [B-007](#b-007) | High | IndexManager (lifecycle) | `aliasExists()` throws on any error without `meta`, and so does `drop()` |
| [B-008](#b-008) | High | IndexManager (CRUD/migration) | No version ordering: a rollback or rolling deploy migrates backwards and drops the newer index |
| [B-009](#b-009) | High | IndexManager (CRUD/migration) | The fresh-creation branch of `migrateIfNeeded` always returns `success: false` |
| [B-010](#b-010) | High | IndexManager (CRUD/migration) | Running `migrateIfNeeded` again while a migration is in progress reindexes again and reports false results |
| [B-011](#b-011) | High | QueryBuilder (match/semantic) | `fields()` + `excludeFields()` together drop the includes; `toKibana()` emits an invalid body |
| [B-012](#b-012) | High | QueryBuilder (match/semantic) | `weightedSemantic` runs a wildcard on a `.raw` sub-field that the library never creates |
| [B-013](#b-013) | High | QueryBuilder (term/knn/aggs) | `aggregateTerm()` with a custom `orderBy` adds a `max`/`min` sub-agg on the terms field itself, which fails on keyword fields |
| [B-014](#b-014) | High | QueryBuilder (bool/sort/serialize) | `sort('_score')` sorts by relevance ascending (worst matches first) |
| [B-015](#b-015) | High | QueryBuilder (bool/sort/serialize) | `should()` with exactly one branch keeps only that branch's first condition |
| [B-016](#b-016) | High | QueryRunner/SchemaRegistry | Concurrency is inverted: `chunkify(indexes, concurrency)` makes `concurrency` the group size, then every group runs in parallel |
| [B-017](#b-017) | High | QueryRunner/SchemaRegistry | `QueryRunner.count` sends search-only keys (`size`, `from`, `sort`, `aggs`, `highlight`, `_source_excludes`, `track_total_hits`, `search_after`, `rescore`) to `_count` |
| [B-018](#b-018) | High | QueryRunner/SchemaRegistry | `count` throws a TypeError (rejects, no envelope) whenever the builder uses a retriever other than `standard` |
| [B-019](#b-019) | High | QueryRunner/SchemaRegistry | `findFirstOrThrow` turns every failure (connection, 400, timeout) into a 404 `NotFoundError` |
| [B-020](#b-020) | High | QueryRunner/SchemaRegistry | Painless script injection / breakage through field names in `updateMany` |
| [B-021](#b-021) | Medium | Schema/Naming/Utils | `SchemaManager` never receives an analyzer, so `.fulltext` always uses `english` (affects both `analyzer` and `language`) |
| [B-022](#b-022) | Medium | Schema/Naming/Utils | `ES_VERSION` other than 9 sends mismatched Accept and Content-Type compatibility headers |
| [B-023](#b-023) | Medium | Schema/Naming/Utils | Schema types reject features the runtime supports, and offer types that always fail |
| [B-024](#b-024) | Medium | Schema/Naming/Utils | `IndexNameManager.parseByName` throws when the optional `separator` is omitted |
| [B-025](#b-025) | Medium | Schema/Naming/Utils | `separator`, `prefix`, `language` and `version` are never validated, so invalid or ambiguous ES index names get through |
| [B-026](#b-026) | Medium | Schema/Naming/Utils | `getAllFields` drops the parent path for nested fields, unlike `getFulltextFields` |
| [B-027](#b-027) | Medium | Schema/Naming/Utils | `englishplus` is cast to the wrong type |
| [B-028](#b-028) | Medium | IndexManager (lifecycle) | The `analyzer` constructor option is ignored; `.fulltext` sub-fields always use `english` |
| [B-029](#b-029) | Medium | IndexManager (lifecycle) | `create()`, `createIfNeeded()` and `recreate()` attach the alias to a second index when it already points to an older version |
| [B-030](#b-030) | Medium | IndexManager (lifecycle) | `createIfNeeded()` can leave things half-created and treats a creation race as an error |
| [B-031](#b-031) | Medium | IndexManager (lifecycle) | `create()` returns a different envelope on each path and omits `request`/`error` |
| [B-032](#b-032) | Medium | IndexManager (CRUD/migration) | A transient poll error or process exit abandons the migration, leaving the alias on both indexes permanently |
| [B-033](#b-033) | Medium | IndexManager (CRUD/migration) | `deleteMany(cb, more)` passes `more` as transport options, so it is silently ignored |
| [B-034](#b-034) | Medium | IndexManager (CRUD/migration) | `deleteMany()` with no callback deletes every document |
| [B-035](#b-035) | Medium | IndexManager (CRUD/migration) | `getStatus` reports `needsCreation` when the cluster is unreachable or returns an error |
| [B-036](#b-036) | Medium | IndexManager (CRUD/migration) | The "current" branch of `migrateIfNeeded` never makes sure the alias exists |
| [B-037](#b-037) | Medium | IndexManager (CRUD/migration) | During or after a partial migration, reads return duplicates and `findById` fails |
| [B-038](#b-038) | Medium | IndexManager (CRUD/migration) | `needsCreation()` always returns `false` |
| [B-039](#b-039) | Medium | IndexManager (CRUD/migration) | `putBulk`: id `0` gets a random UUID, the envelope lacks `error`/`errorKind`/`response`, and `more` leaks into the result |
| [B-040](#b-040) | Medium | QueryBuilder (match/semantic) | Default `rankWindowSize` of 50 makes any `limit()` above 50 fail with retrievers |
| [B-041](#b-041) | Medium | QueryBuilder (match/semantic) | `searchAfter()` with `page() > 1` produces a request ES rejects |
| [B-042](#b-042) | Medium | QueryBuilder (match/semantic) | `weightedSemantic` ignores the builder's `rankWindowSize`, `rankConstant` and normalizer |
| [B-043](#b-043) | Medium | QueryBuilder (match/semantic) | `rrf()` and `semantic()` freeze the rank settings and normalizer at call time, so call order matters |
| [B-044](#b-044) | Medium | QueryBuilder (match/semantic) | The default FVH highlighter errors on fields without term vectors |
| [B-045](#b-045) | Medium | QueryBuilder (match/semantic) | `matchBoostedPhrase`'s default weights give the exact phrase the lowest boost |
| [B-046](#b-046) | Medium | QueryBuilder (term/knn/aggs) | `aggregateTerm()`'s multi-key `order` object only applies the last key, and dotted field names break the order path |
| [B-047](#b-047) | Medium | QueryBuilder (term/knn/aggs) | `aggregateTerm()` sends the composite-only `missing_bucket` option to a `terms` agg |
| [B-048](#b-048) | Medium | QueryBuilder (term/knn/aggs) | `knn()` emits a string `similarity` such as `'cosine'`, but the KNN retriever requires a float threshold |
| [B-049](#b-049) | Medium | QueryBuilder (term/knn/aggs) | `termsSet()` without `script` produces an invalid `terms_set` query, and the README example does exactly that |
| [B-050](#b-050) | Medium | QueryBuilder (term/knn/aggs) | `dateHistogram()` offset validation accepts units ES rejects or misreads, and rejects valid unsigned offsets |
| [B-051](#b-051) | Medium | QueryBuilder (term/knn/aggs) | The composite helper types fail to typecheck against `@elastic/elasticsearch` 9.5.1 |
| [B-052](#b-052) | Medium | QueryBuilder (term/knn/aggs) | `rexgep()` defaults to different case sensitivity depending on the call form |
| [B-053](#b-053) | Medium | QueryBuilder (term/knn/aggs) | `includeFacets()` is a public no-op that the README documents as working |
| [B-054](#b-054) | Medium | QueryBuilder (term/knn/aggs) | Composite-based histograms silently truncate at `limit` with no way to page |
| [B-055](#b-055) | Medium | QueryBuilder (bool/sort/serialize) | `sort()` array form produces invalid DSL for anything except `{field: 'asc'\|'desc'}` |
| [B-056](#b-056) | Medium | QueryBuilder (bool/sort/serialize) | `page()` is silently ignored when no `limit()` is set; page values are never validated |
| [B-057](#b-057) | Medium | QueryBuilder (bool/sort/serialize) | `toKibana()` prints `GET undefined/_search` when no index is set |
| [B-058](#b-058) | Medium | QueryBuilder (bool/sort/serialize) | On the retriever path, the request includes top-level keys ES rejects (`rescore`, `min_score`, `search_after`, `sort`) |
| [B-059](#b-059) | Medium | QueryRunner/SchemaRegistry | `updateMany` with an empty/dot-only key replaces the whole `_source`; empty `newValues` sends an empty script |
| [B-060](#b-060) | Medium | QueryRunner/SchemaRegistry | `updateMany` ignores the builder's `limit` and has no `conflicts`/`refresh` defaults |
| [B-061](#b-061) | Medium | QueryRunner/SchemaRegistry | `updateMany` throws and has no error envelope, unlike every other runner method |
| [B-062](#b-062) | Medium | QueryRunner/SchemaRegistry | `getStatus` / `dropAll` report `success: true` on failure; `dropAll`/`recreateAll` ignore error envelopes; `recreateAll` marks failures 'SUCCESS' |
| [B-063](#b-063) | Medium | QueryRunner/SchemaRegistry | One failure in `getStatus`/`dropAll` abandons the result while other lanes keep running and mutating it after return |
| [B-064](#b-064) | Medium | QueryRunner/SchemaRegistry | `chunkify` with `0`/negative/NaN concurrency hangs forever or silently processes nothing |
| [B-065](#b-065) | Medium | QueryRunner/SchemaRegistry | Record shape: no `_id`, and `_score` isn't in the type (TS error at line 36) |
| [B-066](#b-066) | Low | Schema/Naming/Utils | Empty basic-auth credentials are sent when no auth environment variables are set |
| [B-067](#b-067) | Low | Schema/Naming/Utils | `isValidIndexName` and `isValidColumnName` reject single-character names despite their `length >= 1` check |
| [B-068](#b-068) | Low | Schema/Naming/Utils | `getAllFields` and `getFulltextFields` return duplicates when `properties` overrides a schema field |
| [B-069](#b-069) | Low | Schema/Naming/Utils | `getFulltextFields` treats types inconsistently and includes types that can't be queried |
| [B-070](#b-070) | Low | Schema/Naming/Utils | Date formats that contain `.` are truncated |
| [B-071](#b-071) | Low | Schema/Naming/Utils | SchemaManager doesn't type-check under the repo's TypeScript 7 devDependency |
| [B-072](#b-072) | Low | Schema/Naming/Utils | `englishplus` applies `asciifolding` after stop-word removal and stemming |
| [B-073](#b-073) | Low | Schema/Naming/Utils | `normalizeTimeZone` builds invalid offsets from bad numbers and accepts impossible offsets and zone names |
| [B-074](#b-074) | Low | Schema/Naming/Utils | `isEmptyObject` returns `true` for arrays, Dates, non-empty Maps and Sets, and symbol-keyed objects |
| [B-075](#b-075) | Low | Schema/Naming/Utils | The IndexNameManager spec has unused `@ts-expect-error` directives |
| [B-076](#b-076) | Low | Schema/Naming/Utils | The books fixture's schema, mappings and data disagree |
| [B-077](#b-077) | Low | IndexManager (lifecycle) | `IndexErrorShape` is exported as the function type, not the error shape |
| [B-078](#b-078) | Low | IndexManager (lifecycle) | `createAliasIfNeeded()` omits `took` on its success path |
| [B-079](#b-079) | Low | IndexManager (lifecycle) | `exists()` types its `more` parameter as the alias-exists request |
| [B-080](#b-080) | Low | IndexManager (lifecycle) | `recreate()` ignores the results of drop and flush, and its `took` leaves them out |
| [B-081](#b-081) | Low | IndexManager (lifecycle) | `errorKind` classification uses `instanceof`, so it depends on which copy of the client is loaded |
| [B-082](#b-082) | Low | IndexManager (CRUD/migration) | Migrating an empty old index: `onComplete` never fires, `console.log` calls are left in, and there's a small data-loss race |
| [B-083](#b-083) | Low | IndexManager (CRUD/migration) | Writes briefly fail during migration setup (the alias has two indexes and no write index) |
| [B-084](#b-084) | Low | IndexManager (CRUD/migration) | `percent` is `NaN` when a task's `total` is 0 |
| [B-085](#b-085) | Low | IndexManager (CRUD/migration) | `patch` hard-codes `result: 'updated'` |
| [B-086](#b-086) | Low | IndexManager (CRUD/migration) | `findById`'s envelope is missing `request`, `record` is typed `unknown`, and not-found is reported as an error |
| [B-087](#b-087) | Low | IndexManager (CRUD/migration) | `findMany`/`findFirst`/`count`/`deleteMany` reject when the builder callback throws |
| [B-088](#b-088) | Low | IndexManager (CRUD/migration) | Type errors in IndexManager (CRUD and migration) |
| [B-089](#b-089) | Low | QueryBuilder (match/semantic) | `weightedSemantic`'s semantic boost and `weight` have no effect in common cases |
| [B-090](#b-090) | Low | QueryBuilder (match/semantic) | The builder stores caller arrays and objects by reference |
| [B-091](#b-091) | Low | QueryBuilder (match/semantic) | `range()` accepts values that produce invalid or unintended DSL |
| [B-092](#b-092) | Low | QueryBuilder (match/semantic) | The `weight` types in `semantic()` and `rrf()` don't match the defaults or the README |
| [B-093](#b-093) | Low | QueryBuilder (match/semantic) | `QueryBuilder.ts` fails Biome formatting (double quotes) |
| [B-094](#b-094) | Low | QueryBuilder (match/semantic) | The README quick reference shows call signatures that don't exist |
| [B-095](#b-095) | Low | QueryBuilder (match/semantic) | JSDoc inaccuracies in the config and match methods |
| [B-096](#b-096) | Low | QueryBuilder (term/knn/aggs) | `aggregateDateHistogram()` allows both `calendarInterval` and `fixedInterval`, and doesn't normalize `timeZone` |
| [B-097](#b-097) | Low | QueryBuilder (term/knn/aggs) | `aggs()` stores the caller's object by reference, so later `aggregate*` calls mutate it |
| [B-098](#b-098) | Low | QueryBuilder (term/knn/aggs) | The `aggregate*` methods force `limit(0)`, and `reset('aggs')` doesn't undo it |
| [B-099](#b-099) | Low | QueryBuilder (term/knn/aggs) | JSDoc and README examples don't match the real signatures |
| [B-100](#b-100) | Low | QueryBuilder (term/knn/aggs) | `term()` and `wildcard()` emit malformed clauses when `value` is omitted |
| [B-101](#b-101) | Low | QueryBuilder (bool/sort/serialize) | `should()` skips empty branches but keeps the original `minimum_should_match`, so nothing can match |
| [B-102](#b-102) | Low | QueryBuilder (bool/sort/serialize) | `shouldNot()` with one branch ignores `minimumShouldMatch` |
| [B-103](#b-103) | Low | QueryBuilder (bool/sort/serialize) | `reset('shouldSortByRandom')` does nothing |
| [B-104](#b-104) | Low | QueryBuilder (bool/sort/serialize) | `getBody()` returns live references to internal state |
| [B-105](#b-105) | Low | QueryRunner/SchemaRegistry | Result ordering is nondeterministic in `getStatus` / `recreateAll` / `dropAll` |
| [B-106](#b-106) | Low | QueryRunner/SchemaRegistry | Duplicate registration is allowed and runs concurrent destructive operations on the same index |
| [B-107](#b-107) | Low | QueryRunner/SchemaRegistry | Constructor keeps the caller's array, so `register` mutates it |
| [B-108](#b-108) | Low | QueryRunner/SchemaRegistry | Error envelope shape is inconsistent across runner methods and with `IndexManager` |

## Suggestion index

| ID | Impact | Area | Title |
|---|---|---|---|
| [S-001](#s-001) | High | IndexManager (lifecycle) | Make `errorKind` a literal union and give `_formatError` a declared return type |
| [S-002](#s-002) | High | IndexManager (lifecycle) | Add unit tests for the lifecycle methods |
| [S-003](#s-003) | High | IndexManager (CRUD/migration) | Redesign the migration around an atomic swap and a "new copy wins" rule |
| [S-004](#s-004) | High | IndexManager (CRUD/migration) | Return a completion handle and add timeout/retry controls |
| [S-005](#s-005) | High | QueryBuilder (term/knn/aggs) | Rename `rexgep` to `regexp` |
| [S-006](#s-006) | High | QueryRunner/SchemaRegistry | Add a `QueryRunner.spec.ts` |
| [S-007](#s-007) | High | QueryRunner/SchemaRegistry | Fill coverage gaps in `SchemaRegistry.spec.ts` |
| [S-008](#s-008) | Medium | Schema/Naming/Utils | Let objects map as `object` instead of always `nested` |
| [S-009](#s-009) | Medium | Schema/Naming/Utils | Reconsider the `.exact` subfield and the default `term_vector` |
| [S-010](#s-010) | Medium | Schema/Naming/Utils | Review the public API surface in `index.ts` |
| [S-011](#s-011) | Medium | Schema/Naming/Utils | Fill test coverage gaps for the schema, naming, client and utility modules |
| [S-012](#s-012) | Medium | IndexManager (lifecycle) | Share one default client instead of creating one per `IndexManager` |
| [S-013](#s-013) | Medium | IndexManager (lifecycle) | `getCreateRequest`: reuse `this.schema` and merge `more` instead of overwriting |
| [S-014](#s-014) | Medium | IndexManager (CRUD/migration) | Give the write methods a `more` parameter and consistent id types |
| [S-015](#s-015) | Medium | IndexManager (CRUD/migration) | Make `putBulk` production-safe |
| [S-016](#s-016) | Medium | IndexManager (CRUD/migration) | Make `deleteMany` safer and more informative |
| [S-017](#s-017) | Medium | IndexManager (CRUD/migration) | Add unit tests for CRUD and migration using a stub client |
| [S-018](#s-018) | Medium | QueryBuilder (match/semantic) | Add a `normalizer()` setter |
| [S-019](#s-019) | Medium | QueryBuilder (match/semantic) | Run non-scoring conditions in filter context |
| [S-020](#s-020) | Medium | QueryBuilder (match/semantic) | Add missing tests for the config, match and semantic methods |
| [S-021](#s-021) | Medium | QueryBuilder (term/knn/aggs) | Warn or throw when rescore is combined with a non-score sort or with retrievers |
| [S-022](#s-022) | Medium | QueryBuilder (term/knn/aggs) | Make agg names configurable and deduplicate the composite helpers |
| [S-023](#s-023) | Medium | QueryBuilder (term/knn/aggs) | Tighten the `knn()` parameter types and add validation |
| [S-024](#s-024) | Medium | QueryBuilder (term/knn/aggs) | Add common options to `queryString()` and `moreLikeThis()` |
| [S-025](#s-025) | Medium | QueryBuilder (term/knn/aggs) | Add tests for the bugs above |
| [S-026](#s-026) | Medium | QueryBuilder (bool/sort/serialize) | Fix stale README docs for `shouldNot`/`must`, and make the `shouldNot` options optional |
| [S-027](#s-027) | Medium | QueryBuilder (bool/sort/serialize) | Don't silently drop sorts, random sort and function scores on the retriever path |
| [S-028](#s-028) | Medium | QueryBuilder (bool/sort/serialize) | `sortByRandom` cannot be paged reproducibly and is overridden by field sorts |
| [S-029](#s-029) | Medium | QueryBuilder (bool/sort/serialize) | Missing tests for paging, sorting and bool composition |
| [S-030](#s-030) | Medium | QueryRunner/SchemaRegistry | `findFirst` should request `size: 1` |
| [S-031](#s-031) | Medium | QueryRunner/SchemaRegistry | Make the registry's empty-registry behavior and return shapes consistent |
| [S-032](#s-032) | Medium | QueryRunner/SchemaRegistry | `dropAll` safety |
| [S-033](#s-033) | Medium | QueryRunner/SchemaRegistry | Type `updateMany` values against the schema |
| [S-034](#s-034) | Low | Schema/Naming/Utils | `normalizeTimeZone`: accept more of what ES accepts, and fix the formatting |
| [S-035](#s-035) | Low | Schema/Naming/Utils | Make `isDefined` a type guard and add a spec |
| [S-036](#s-036) | Low | Schema/Naming/Utils | `new SchemaManager()` crashes without an argument |
| [S-037](#s-037) | Low | IndexManager (lifecycle) | Tighten the public types |
| [S-038](#s-038) | Low | IndexManager (lifecycle) | `flush()` targets the alias, so it fails when only the index exists |
| [S-039](#s-039) | Low | IndexManager (lifecycle) | `getAliasMetadata` treats every 404 as "no alias" |
| [S-040](#s-040) | Low | IndexManager (lifecycle) | Style cleanups (AGENTS.md / Biome) |
| [S-041](#s-041) | Low | IndexManager (CRUD/migration) | `getStatus`: run checks in parallel and surface errors |
| [S-042](#s-042) | Low | QueryBuilder (match/semantic) | Give `matchPhrase` the same options passthrough as `match`/`matchPhrasePrefix` |
| [S-043](#s-043) | Low | QueryBuilder (match/semantic) | Decide whether `highlighterOptions()` replaces or merges the defaults |
| [S-044](#s-044) | Low | QueryBuilder (match/semantic) | Validate the numeric setters |
| [S-045](#s-045) | Low | QueryBuilder (match/semantic) | Skip clauses for blank phrases |
| [S-046](#s-046) | Low | QueryBuilder (match/semantic) | Make `weightedSemantic` configurable and avoid the leading wildcard |
| [S-047](#s-047) | Low | QueryBuilder (match/semantic) | Make `escapeWildcards` a static, documented utility |
| [S-048](#s-048) | Low | QueryBuilder (match/semantic) | Broaden the `range()` input types |
| [S-049](#s-049) | Low | QueryBuilder (match/semantic) | `fields([])` should probably emit `_source: false` |
| [S-050](#s-050) | Low | QueryBuilder (term/knn/aggs) | Add a `case_insensitive` option to `term()` |
| [S-051](#s-051) | Low | QueryBuilder (term/knn/aggs) | Handle the empty-value edge case in `containsExact()` |
| [S-052](#s-052) | Low | QueryBuilder (term/knn/aggs) | Rename `dateHistogram`'s `timezone` parameter to `timeZone` |
| [S-053](#s-053) | Low | QueryBuilder (bool/sort/serialize) | `decayFunctionScore` is misnamed and offers no `function_score` options |
| [S-054](#s-054) | Low | QueryBuilder (bool/sort/serialize) | Validate `limit()` |
| [S-055](#s-055) | Low | QueryBuilder (bool/sort/serialize) | `mustNot()` and `nested()` emit no-op wrappers and default keys |
| [S-056](#s-056) | Low | QueryBuilder (bool/sort/serialize) | Subquery builders silently discard state other than `must` |
| [S-057](#s-057) | Low | QueryBuilder (bool/sort/serialize) | Put non-scoring clauses in `filter`; `linear.filter` turns scoring clauses into filters |
| [S-058](#s-058) | Low | QueryBuilder (bool/sort/serialize) | `clone()` loses subclass types and can throw on non-cloneable values; getters expose internal arrays |
| [S-059](#s-059) | Low | QueryBuilder (bool/sort/serialize) | `valueOf()` returning an object is unusual |
| [S-060](#s-060) | Low | QueryBuilder (bool/sort/serialize) | Style violations per AGENTS.md |
| [S-061](#s-061) | Low | QueryRunner/SchemaRegistry | Migration completion can hang forever |
| [S-062](#s-062) | Low | QueryRunner/SchemaRegistry | Return a typed lookup from the registry |
| [S-063](#s-063) | Low | QueryRunner/SchemaRegistry | Style / cleanup |

## Bugs

### Critical

<a id="b-001"></a>
#### B-001 — `migrateIfNeeded` drops the old index even when the reindex failed
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:1055-1071` (`migrateIfNeeded` / `_kickoffReindex`)
- **Severity:** Critical
- **Confidence:** High (confirmed with a stubbed client)
- **Description:** When `tasks.get` reports `completed: true`, the code flushes and deletes `oldIndex` without checking `taskStatus.error` (cancelled or aborted tasks) or `taskStatus.response.failures` (bulk failures such as `mapper_parsing_exception`). Schema changes are what trigger a migration, so mapping failures are the most likely error. In the stub, a task that copied 10 of 100 docs with failures still ran `DELETE test~english~books~v1`. It then fired `onProgress(percent:100)` and `onComplete({done:10,total:100})`, and never called `onError`. The source of truth is lost. The code acknowledges this with `// TODO: check if there is a task error`.
- **Example / Fix:**
  ```ts
  if (taskStatus.completed) {
    const failures = taskStatus.response?.failures ?? [];
    if (taskStatus.error || failures.length > 0) {
      onError?.(new Error(`Reindex ${oldIndex} failed`, { cause: taskStatus.error ?? failures }));
      break; // keep old index attached; do NOT delete
    }
    // optionally also verify count(new) >= count(old) before dropping
  ```

<a id="b-002"></a>
#### B-002 — Writes made during a migration are overwritten, resurrected or rejected (reindex uses `op_type: 'index'`)
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:992-1004, 1047` (`migrateIfNeeded`); affects `put`, `patch`, `deleteById`, `deleteMany`
- **Severity:** Critical
- **Confidence:** High (from documented ES reindex and write-alias behavior; request shape confirmed via script)
- **Description:** The new index becomes `is_write_index` before the reindex starts. The reindex then runs with `dest.op_type: 'index'` and internal versioning, so it overwrites any doc with the same `_id`. The comment at line 1064 says the new index is canonical, but the code does the opposite.
  - (a) A `put` made during migration is replaced by the stale copy from the old index.
  - (b) A `deleteById`/`deleteMany` made during migration is undone when the reindex later copies the doc.
  - (c) A `patch` on a doc not yet copied fails with `document_missing_exception`. With `doc_as_upsert` it creates a partial doc, which the reindex then overwrites.

  `conflicts: 'proceed'` does nothing with `op_type: 'index'`.
- **Example / Fix:** Use `dest: { index: status.fullName, op_type: 'create' }` with `conflicts: 'proceed'`, so docs already written to the new index win. Deletes would still be resurrected. To fix those, keep writes on the old index until a final catch-up pass, or record tombstones.

<a id="b-003"></a>
#### B-003 — `rescore()` builds a `rescore_query` that ES rejects (it's a whole search request, plus a stray `length` key)
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1156-1169` (`rescore`)
- **Severity:** Critical
- **Confidence:** High (confirmed via script)
- **Description:** `rescore_query` is set to `qb.getQuery()`. That is a full `SearchRequest`, not a query container: it always includes `_source: ['*']`, plus any `aggs`, `size`, `highlight`, `sort` and `index` from the inner builder. ES parses `rescore_query` as a query, so `_source` alone makes it fail with `unknown query [_source]`. The entry also carries a stray `length: 2` property, which ES rejects with `rescore doesn't support [length]`. Every `rescore()` call therefore produces an invalid request. A `@ts-expect-error` hides the type mismatch, and the spec only checks `window_size`.
- **Example / Fix:** The current output is `{"window_size":10,"query":{"rescore_query":{"_source":["*"],"query":{"match":…},"aggs":{…},"size":0}},"length":2}`. Fix it with:
  ```ts
  const { query } = qb.getBody();
  if (!query) { return this; }
  const entry: SearchRescore = { window_size: windowSize, query: { rescore_query: query } };
  ```
  Also expose `query_weight`, `rescore_query_weight` and `score_mode`.

### High

<a id="b-004"></a>
#### B-004 — `ElasticsearchRecord` types every numeric type except `integer` as `string`, and every field is required
- **Area:** Schema/Naming/Utils
- **Location:** `src/types.ts:42-54` (`ElasticsearchRecord`)
- **Severity:** High
- **Confidence:** Confirmed via script (tsc)
- **Description:**
  - Only `'integer'`, `'boolean'` and `'date'` are special-cased. `long`, `short`, `byte`, `double`, `float`, `half_float`, `scaled_float`, `unsigned_long` and `token_count` all fall through to `string | null | string[]`.
  - `date_nanos` doesn't accept `Date`.
  - With schema `{ id: 'long', price: 'float' }`, `rec.id = 5` fails with TS2322.
  - Every field is required, so a partial document like `{ title: 'x' }` fails with TS2739.
  - The result is that every `IndexInferRecordShape` and `ManagerInferRecordShape` type is wrong.
- **Example / Fix:** Define `type NumericType = 'long'|'integer'|'short'|'byte'|'double'|'float'|'half_float'|'scaled_float'|'unsigned_long'|'token_count'` and map it to `number | null | number[]`. Treat `'date' | 'date_nanos' | \`date.${string}\`` as dates. Make the keys optional, or add a `Partial` variant for writes.

<a id="b-005"></a>
#### B-005 — `getIndexMetadata` fails on every call, even for a healthy index
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:333` (`getIndexMetadata`)
- **Severity:** High
- **Confidence:** Confirmed via script
- **Description:** The v9 JS client returns the parsed body directly. There is no `.body` unless `meta: true` is passed. `Object.keys(response.body)` therefore throws a TypeError. The catch turns it into `{ name: null, errorKind: 'javascript' }`, so a healthy index always reports an error. Nothing calls this method and nothing tests it.
- **Example / Fix:** `const indexName = Object.keys(response)[0] ?? null;`. Add a spec test using the `RecordingConnection` pattern.

<a id="b-006"></a>
#### B-006 — `drop()` reports failure whenever the alias existed, even though the index was deleted
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:567-575` (`drop`)
- **Severity:** High
- **Confidence:** Confirmed via script (stub using ES semantics)
- **Description:** `drop()` deletes the concrete index and then calls `indices.deleteAlias({ index: fullName, name: alias })`. ES deletes an index's aliases along with the index, so the second call returns 404 `index_not_found_exception`. The catch then returns `acknowledged: false, errorKind: 'response'` after a successful drop. The same 404 happens when the alias exists but points to a different version, because `aliasExists()` checks globally. `SchemaRegistry.dropAll()` passes these false failures on. `recreate()` and the integration test hide the problem because they ignore the result of `drop()`.
- **Example / Fix:** Stub trace: `HEAD /_alias/x` → `DELETE /x~v1` (ack) → `DELETE /x~v1/_alias/x` (404) → `{acknowledged:false}`. Remove the `aliasExists()`/`deleteAlias` calls, or pass `{ ignore: [404] }` and run them outside the main try.

<a id="b-007"></a>
#### B-007 — `aliasExists()` throws on any error without `meta`, and so does `drop()`
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:299-301` (`aliasExists`). Also affects `drop` (567), `createAliasIfNeeded` (712), `getStatus`/`migrateIfNeeded` (904).
- **Severity:** High
- **Confidence:** Confirmed via script
- **Description:** The catch reads `error.meta.statusCode` without optional chaining. `ConnectionError`, `TimeoutError`, `NoLivingConnectionsError` and plain JS errors have `meta: undefined`, so the catch block itself throws a TypeError, which breaks the never-throw contract. `drop()` calls `aliasExists()` outside its own try, so it rejects too. The catch also `console.log`s to stdout from library code. The 404 branch is mostly unreachable, because HEAD requests resolve to `false` on 404.
- **Example / Fix:** A stub whose `existsAlias` throws `new errors.ConnectionError('ECONNREFUSED')` makes both `aliasExists()` and `drop()` reject. Fix: `if (e?.meta?.statusCode === 404)`, remove the `console.log`, and return `_formatError(e)` otherwise.

<a id="b-008"></a>
#### B-008 — No version ordering: a rollback or rolling deploy migrates backwards and drops the newer index
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:936-949, 980` (`needsMigration`, `getSiblingIndexes`, `migrateIfNeeded`)
- **Severity:** High
- **Confidence:** High (confirmed with a stubbed client)
- **Description:** "Needs migration" means "the alias contains any index other than mine", and versions are never compared. A `v1` instance whose alias points at `v2` creates `v1`, reindexes `v2`→`v1` with the old mapping, and deletes `v2`. During a rolling deploy, old and new instances migrate back and forth and delete each other's indexes. Any unrelated index attached to the alias is also reindexed and deleted.
- **Example / Fix:** Parse each sibling with `IndexNameManager.parseByName`. Only migrate from siblings with the same prefix and name and a lower numeric version. Otherwise return `code: 'NEWER_VERSION_PRESENT'`.

<a id="b-009"></a>
#### B-009 — The fresh-creation branch of `migrateIfNeeded` always returns `success: false`
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:1119-1129` (`migrateIfNeeded`)
- **Severity:** High
- **Confidence:** High (confirmed with a stubbed client)
- **Description:** On success, `create()` returns no `error` key, so `createResult.error !== null` is `undefined !== null`, which is true. A successful first-time creation returns `{ success: false, error: undefined, errorKind: 'javascript', createdAlias: false }` and never calls `onProgress`/`onComplete`. `SchemaRegistry` only checks `migration.error`, so it hides this, but direct callers see a failure. Commit f3d9d97 touched these lines but left the condition unchanged.
- **Example / Fix:** `if (createResult.error)`, or have `create()` always return `error: null` (see the `create()` envelope bug).

<a id="b-010"></a>
#### B-010 — Running `migrateIfNeeded` again while a migration is in progress reindexes again and reports false results
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:982-991, 1107-1110` (`migrateIfNeeded`)
- **Severity:** High
- **Confidence:** High (confirmed with a stubbed client)
- **Description:** This happens when a second instance boots or the process restarts mid-reindex, so the alias holds `[v1, v2]`:
  - `this.create()` fails with `resource_already_exists_exception`. That error is ignored, and `meta.createdIndex = true` is still reported.
  - `count` includes the new index, so `recordsToMigrate` is inflated.
  - The kickoff loop doesn't skip `status.fullName`. It tries to reindex `v2`→`v2`, and `onError` fires with "reindex cannot write into an index its reading from".
  - A second `v1`→`v2` reindex starts, and it overwrites writes made after the swap.
  - `SchemaRegistry` waits for `oldNames.length` completions, but only one can ever reach 100%.
- **Example / Fix:**
  - Treat "already exists" as resuming the migration.
  - Exclude `status.fullName` from `oldNames`, the count, and the kickoff loop.
  - Look for an active reindex with `tasks.list({ actions: '*reindex', detailed: true })` and attach to it instead of starting a new one.

<a id="b-011"></a>
#### B-011 — `fields()` + `excludeFields()` together drop the includes; `toKibana()` emits an invalid body
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:158-193` (`fields`/`sourceIncludes`/`excludeFields`/`sourceExcludes`), serialized at `:2146-2152` (`getQuery`), `:2189` (`toKibana`)
- **Severity:** High
- **Confidence:** Medium-High (builder output confirmed via script; the server-side behavior comes from reading the client and ES source, not from a live test)
- **Description:** `getQuery()` sets `_source: [...]` and `_source_excludes: [...]` as separate top-level keys. The v9 client (`lib/api/api/search.js`) sends `_source` in the body but `_source_excludes` as a URL query parameter. When any `_source*` URL parameter is present, ES's `RestSearchAction` replaces the body's fetch-source context with one built from the URL parameters, which has no includes. So `fields(['title']).excludeFields(['secret'])` likely returns every field except `secret`, not just `title`. `toKibana()` also writes `_source_excludes` into the JSON body. That is not a valid body key, so pasting the output into Kibana fails with "Unknown key for a START_ARRAY in [_source_excludes]".
- **Example / Fix:** Emit `_source: { includes: this._fields, excludes: this._excludeFields }` in the body and never `_source_excludes`. That form works for both the client and Kibana. Add an integration test for this combination.

<a id="b-012"></a>
#### B-012 — `weightedSemantic` runs a wildcard on a `.raw` sub-field that the library never creates
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:677` (`weightedSemantic`)
- **Severity:** High
- **Confidence:** High
- **Description:** The "exact contains" clause targets `${standardField}.raw`. `SchemaManager` creates only `.exact` and `.fulltext` sub-fields, both of type `text`, and ES dynamic mapping creates `.keyword`. A wildcard on an unmapped field silently matches nothing, so `boosts[0]` (default 6, the highest boost) never applies. Pointing it at a `text` sub-field wouldn't help either: wildcards match individual terms, so `*multi word*` can never match. The clause needs a keyword or `wildcard`-type sub-field.
- **Example / Fix:** Add a configurable `exactField` parameter, or have `SchemaManager` add a keyword sub-field to `text` fields. Document the mapping requirement.

<a id="b-013"></a>
#### B-013 — `aggregateTerm()` with a custom `orderBy` adds a `max`/`min` sub-agg on the terms field itself, which fails on keyword fields
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1261-1267` (`aggregateTerm`)
- **Severity:** High
- **Confidence:** High (shape confirmed via script; the ES error is from knowledge)
- **Description:** Any `orderBy` other than exactly `[{field:'_count'}]` creates a `{max|min: {field: o.field}}` sub-agg for every entry. That includes the entry for the terms field itself, which is already mapped to `_key`. Sorting facets alphabetically is the most common case, and it fails: `orderBy:[{field:'author.keyword',order:'asc'}]` adds `aggs: {'author.keyword': {max: {field: 'author.keyword'}}}`, which ES rejects with `Field [author.keyword] of type [keyword] is not supported for aggregation [max]`. Mixing `_count` with other keys also creates a pointless `_count: {min: {field: '_count'}}` sub-agg.
- **Example / Fix:** Skip the sub-agg when `o.field === field` or `o.field === '_count'`, and give sub-aggs safe generated names.

<a id="b-014"></a>
#### B-014 — `sort('_score')` sorts by relevance ascending (worst matches first)
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1661` (`sort`)
- **Severity:** High
- **Confidence:** Confirmed via script
- **Description:** Every plain string goes to the `typeof field === "string"` branch and gets `order: maybeDirection || "asc"`. So the documented `qb.sort('_score')` produces `[{"_score":{"order":"asc"}}]`, which returns the least relevant documents first. The comment in the `else` branch ("keyword such as `_score`") shows the intent was to pass `_score` through as-is, but no string can reach that branch. ES's default for `_score` is `desc`. The spec at line 544 calls `sort('_score' as any)` and never asserts the output.
- **Example / Fix:** In the string branch, `if (field === '_score' && !maybeDirection) { this._sorts.push('_score'); }`, or default the direction to `desc` for `_score`.

<a id="b-015"></a>
#### B-015 — `should()` with exactly one branch keeps only that branch's first condition
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1864-1872` (`should`)
- **Severity:** High
- **Confidence:** Confirmed via script
- **Description:** The single-branch shortcut runs `this._must.push(musts[0])`. If the callback adds more than one clause, the rest are silently dropped and the query matches more than intended. `qb.should([q => { q.term(a); q.term(b); }])` produces only `[{term:{a:1}}]`. The multi-branch path handles this correctly by wrapping it in `{bool:{must: branch}}`. `minimumShouldMatch` is also ignored on this path (see the `shouldNot` item).
- **Example / Fix:** `this._must.push(...musts)`, or reuse the multi-branch logic.

<a id="b-016"></a>
#### B-016 — Concurrency is inverted: `chunkify(indexes, concurrency)` makes `concurrency` the group size, then every group runs in parallel
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/SchemaRegistry/SchemaRegistry.ts:267`, `:326`, `:360` (`recreateAll`, `getStatus`, `dropAll`)
- **Severity:** High
- **Confidence:** Confirmed via script
- **Description:** `chunkify(this.indexes, concurrency)` splits the indexes into groups of `concurrency` items. Then `Promise.all(groups.map(...))` starts every group at once, and each group works through its items one by one. So the real parallelism is `ceil(N / concurrency)`, not `concurrency`. `concurrency = 1` gives full parallelism, which is the opposite of what a caller asks for. With 10 indexes, the max number of operations in flight was: concurrency=1 → **10**, concurrency=2 → 5, concurrency=5 → 2. This matters most for `recreateAll` and `dropAll`, which hit the cluster with destructive operations all at once.
- **Example / Fix:** Split into `concurrency` lanes instead (round-robin, `lanes[i % concurrency].push(index)`), or use a small worker pool: `const queue=[...this.indexes]; await Promise.all(Array.from({length: Math.min(concurrency, queue.length)}, async () => { while (queue.length) { const idx = queue.shift()!; ... } }))`.

<a id="b-017"></a>
#### B-017 — `QueryRunner.count` sends search-only keys (`size`, `from`, `sort`, `aggs`, `highlight`, `_source_excludes`, `track_total_hits`, `search_after`, `rescore`) to `_count`
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/QueryRunner/QueryRunner.ts:221-226` (`count`)
- **Severity:** High
- **Confidence:** Confirmed via script that these keys reach the HTTP body. ES rejecting them is from the ES source (`RestActions.getQueryContent` throws "request does not support [x]"), not tested against a live server.
- **Description:** This is reached through `IndexManager.count()` too. Only `_source`, `retriever` and `query` are removed; everything else from `getQuery()` is spread into the count request. Client 9.5.1 puts unknown keys into the body, so the `_count` body was `{"_source_excludes":[...],"sort":[...],"aggs":{...},"size":10,"from":10,"query":{...}}`. ES returns 400 for that. Any builder that has `limit`/`page`/`sort`/aggs/highlight/`excludeFields` therefore can't be counted, and `IndexManager.count` is typed to accept `Omit<SearchRequest,...>` as `more`, which invites more such keys.
- **Example / Fix:** Build the count request explicitly: `{ index, query, ...(minScore != null && { min_score }), ...more }` from `this.builder.getBody().query`. Change `IndexManager.count`'s `more` type to `Omit<estypes.CountRequest,'index'|'query'>`.

<a id="b-018"></a>
#### B-018 — `count` throws a TypeError (rejects, no envelope) whenever the builder uses a retriever other than `standard`
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/QueryRunner/QueryRunner.ts:224` (`count`)
- **Severity:** High
- **Confidence:** Confirmed via script
- **Description:** `query || retriever.standard.query` runs outside the `try`. When there are filters plus knn/rrf/semantic/weightedSemantic, `getBody()` returns `retriever.linear`. A single retriever comes back as e.g. `retriever.knn`. In both cases `retriever.standard` is undefined, so `count()` rejects with `undefined is not an object (evaluating 'retriever.standard.query')`. That breaks the "check `.error`, never try/catch" contract. tsc already reports TS18048 on this line.
- **Example / Fix:** Move the request construction inside `try`. For non-standard retrievers, either count with `linear.filter`/match_all and say so in the docs, or return `{ total: null, error: new Error('count() does not support retrievers') }`.

<a id="b-019"></a>
#### B-019 — `findFirstOrThrow` turns every failure (connection, 400, timeout) into a 404 `NotFoundError`
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/QueryRunner/QueryRunner.ts:202-211` (`findFirstOrThrow`)
- **Severity:** High
- **Confidence:** Confirmed via script
- **Description:** `findMany` returns `records: []` with `error` set when the search fails. `findFirstOrThrow` only checks `records.length === 0`, so a `ConnectionError` becomes `NotFoundError` with status 404 "No record found". An outage then looks like a missing record, which is very bad for HTTP handlers that map 404 directly.
- **Example / Fix:** `if (result.error) { throw result.error; }` before the not-found check.

<a id="b-020"></a>
#### B-020 — Painless script injection / breakage through field names in `updateMany`
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/QueryRunner/QueryRunner.ts:95-96, 112-118` (`updateMany`, `toPainlessSourcePath`)
- **Severity:** High
- **Confidence:** Confirmed via script
- **Description:** Values are passed safely through `params`, but field names are pasted into the script as `['${p}']` with no escaping. `{ "it's": 1 }` produces `ctx._source['it's'] = ...`, a compile error. A key with no dots such as `x'] = params['v0']; ctx['op'] = 'delete'; ctx['_source']['y` produces valid Painless that **deletes every matching document**. `newValues` is an untyped `Record<string, unknown>`, so passing something like `req.body` straight through is a realistic mistake.
- **Example / Fix:** Validate each path segment against the schema or `IndexNameManager`'s column-name rules, or at least escape `\` and `'`. Better still, pass the paths as params and walk them in a fixed script, e.g. `for (u in params.updates) { def m = ctx._source; for (int i=0;i<u.path.length-1;i++){ if (m[u.path[i]]==null) m[u.path[i]] = [:]; m = m[u.path[i]]; } m[u.path[u.path.length-1]] = u.value; }`. That also fixes the next item.

### Medium

<a id="b-021"></a>
#### B-021 — `SchemaManager` never receives an analyzer, so `.fulltext` always uses `english` (affects both `analyzer` and `language`)
- **Area:** Schema/Naming/Utils
- **Location:** `src/SchemaManager/SchemaManager.ts:29-37, 41, 69` (`toMappings`, `_schemaToMappings`, `_schemaToNestedMappings`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** `toMappings()` calls `_schemaToMappings(this.schema)` without an analyzer argument, and the constructor accepts only `schema`/`properties`. So there is no public way to set the analyzer. `IndexManager({ language: 'german' })` also still produces `fulltext: { analyzer: 'english' }`. This is the SchemaManager half of the IndexManager bug "The `analyzer` constructor option is ignored".
- **Example / Fix:** Add an `analyzer` option to the SchemaManager constructor, defaulting to `'english'`. Have IndexManager pass it in, and merge `englishplus.analysis` into the index settings when that analyzer is used.

<a id="b-022"></a>
#### B-022 — `ES_VERSION` other than 9 sends mismatched Accept and Content-Type compatibility headers
- **Area:** Schema/Naming/Utils
- **Location:** `src/getEsClient/getEsClient.ts:4, 18-20` (`getEsClient`)
- **Severity:** Medium
- **Confidence:** Confirmed via script (captured headers with a local Bun server)
- **Description:** The 9.x client already sends `compatible-with=9` in both `content-type` and `accept`, but this code overrides only `Accept`. With `ES_VERSION=8`, which the README and `.env.example` document as configurable, requests carry `accept: …compatible-with=8` but `content-type: …compatible-with=9`. ES rejects every request with a body ("compatible versions must match"). With `ES_VERSION=9` the override is redundant and drops the client's `,text/plain` fallback.
- **Example / Fix:** Remove the `Accept` override and `ES_VERSION`, since the client version determines compatibility. Document that 8.x servers need the 8.x client.

<a id="b-023"></a>
#### B-023 — Schema types reject features the runtime supports, and offer types that always fail
- **Area:** Schema/Naming/Utils
- **Location:** `src/types.ts:8-40` (`ColumnType`, `SchemaShape`, `ElasticsearchType`)
- **Severity:** Medium
- **Confidence:** Confirmed via script (tsc), plus ES mapping rules
- **Description:**
  - `'date.epoch_second'` works at runtime and is tested, but `IndexManager({ schema: { created: 'date.epoch_second' } })` fails with TS2322.
  - Objects nested more than one level work at runtime but are rejected by the types.
  - Common ES 9 types are missing: `geo_point`, `geo_shape`, `ip`, `dense_vector`, `sparse_vector`, `flattened`, `object`, `version`, `rank_feature(s)` and the `*_range` types.
  - The union includes `alias`, `scaled_float` and `token_count`, but in string form SchemaManager emits only `{ type }`. ES rejects those types without `path`, `scaling_factor` or `analyzer` respectively.
- **Example / Fix:** `type ColumnType = ElasticsearchType | \`date.${string}\` | { [k: string]: ColumnType }`. Remove the types that need parameters from the string union and add the missing simple types.

<a id="b-024"></a>
#### B-024 — `IndexNameManager.parseByName` throws when the optional `separator` is omitted
- **Area:** Schema/Naming/Utils
- **Location:** `src/IndexNameManager/IndexNameManager.ts:107-116` (`parseByName`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:**
  - `fullName.split(undefined)` returns `[fullName]`, so `name` becomes `undefined` and the constructor throws.
  - A prefix that contains the separator is silently dropped: `'a~b~english~books~v1'` parses with prefix `''`.
  - `version` comes back as the string `'5'`, not a number.
- **Example / Fix:** Use `static parseByName(fullName: string, separator = '~')`. Throw unless there are 3 or 4 parts, and parse numeric versions with `Number()`.

<a id="b-025"></a>
#### B-025 — `separator`, `prefix`, `language` and `version` are never validated, so invalid or ambiguous ES index names get through
- **Area:** Schema/Naming/Utils
- **Location:** `src/IndexNameManager/IndexNameManager.ts:42-59, 61-75` (constructor, `getFullName`, `getAliasName`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** Only `name` is validated. These were all accepted:
  - `prefix: 'Prod'`, which produces uppercase in the index name
  - `prefix: 'a b,c*'`
  - `prefix: '-x'`, which produces a name with a leading `-`
  - `separator: ','`, which ES APIs read as three index names
  - `version: 'X Y'`
  - `language: ''`, which produces `~books~v1`

  `separator: ''` makes every name fail with a misleading length error. The 255-byte limit is checked only on `name`; a full name of 271 chars was accepted. The README uses `prefix: process.env.NODE_ENV`, so uppercase prefixes are realistic.
- **Example / Fix:** Validate the result of `getFullName()` against ES rules in the constructor:
  - lowercase only
  - none of `\ / * ? " < > | , #`, space or `:`
  - must not start with `- _ +`
  - must not be `.` or `..`
  - at most 255 bytes

  Also require a non-empty, ES-legal `separator`.

<a id="b-026"></a>
#### B-026 — `getAllFields` drops the parent path for nested fields, unlike `getFulltextFields`
- **Area:** Schema/Naming/Utils
- **Location:** `src/SchemaManager/SchemaManager.ts:92-102` (`getAllFieldsFromSchema`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** For `{ title, user: { email, bio, addr: { city } } }`, `getAllFields()` returns `["title","email","bio","city"]`, while `getFulltextFields()` returns `["title","user.bio","user.addr.city"]`. Bare leaf names aren't real field paths, and nested fields with the same leaf name collide.
- **Example / Fix:** Pass a `_path` array down through the recursion, the way `getFulltextFieldsFromSchema` does.

<a id="b-027"></a>
#### B-027 — `englishplus` is cast to the wrong type
- **Area:** Schema/Naming/Utils
- **Location:** `src/analyzers/englishplus.ts:3-28`
- **Severity:** Medium
- **Confidence:** Confirmed via script (tsc)
- **Description:** At runtime the value is `{ analysis: {...} }`, but it's cast as `estypes.IndicesIndexSettingsAnalysis`, which is the shape of the inner object. So `englishplus.analysis` fails with TS2339, while `englishplus.analyzer` type-checks but is `undefined`. A user who follows the types writes `settings: { analysis: englishplus }`, which sends `analysis.analysis`, and ES rejects it.
- **Example / Fix:** Use `satisfies estypes.IndicesIndexSettings`, or export only the inner object.

<a id="b-028"></a>
#### B-028 — The `analyzer` constructor option is ignored; `.fulltext` sub-fields always use `english`
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:147,163` (constructor), `:484-490` (`getCreateRequest`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** `this.analyzer` is stored but never read. `getCreateRequest` calls `sm.toMappings()` with the default `'english'`, so the README's main example (`analyzer: "englishplus"`) has no effect. Even if the option were passed through, the `englishplus` analysis settings are never merged into `settings`, so index creation would fail with an unknown analyzer.
- **Example / Fix:** Pass `this.analyzer` into `toMappings(analyzer)`. When it is `englishplus`, deep-merge `englishplus.analysis` into the settings.

<a id="b-029"></a>
#### B-029 — `create()`, `createIfNeeded()` and `recreate()` attach the alias to a second index when it already points to an older version
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:539` (`create`), `:612-624` (`createAlias`), `:698` (`createIfNeeded`), `:604` (`recreate`)
- **Severity:** Medium
- **Confidence:** Medium (ES behavior from docs)
- **Description:** After a version bump (v1 → v2), `createIfNeeded()` sees that v2 doesn't exist and calls `create()`, which runs `putAlias(v2)`. The alias now points to both v1 and v2 with no `is_write_index`. Reads return duplicate or stale documents. Writes through the alias (`put`, `putBulk`, `patch`) fail with "no write index is defined for alias". Apps often call `createIfNeeded()` at boot, so they can reach this state without ever calling `migrateIfNeeded`.
- **Example / Fix:** Use `indices.updateAliases({ actions: [{ remove: { index: '*', alias } }, { add: { index: fullName, alias, is_write_index: true } }] })`, or have `createIfNeeded` detect the old alias and return a `NEEDS_MIGRATION` code.

<a id="b-030"></a>
#### B-030 — `createIfNeeded()` can leave things half-created and treats a creation race as an error
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:676-704` (`createIfNeeded`)
- **Severity:** Medium
- **Confidence:** Confirmed via script (race); High (half-created state)
- **Description:**
  - (a) If `createOnly` succeeds and `createAlias` fails, every later call returns `ALREADY_EXISTS` with `success: true`, and the alias is never created.
  - (b) Checking for existence and then creating is not atomic. When two processes boot at the same time, the loser gets `resource_already_exists_exception` and reports `CREATE_ERROR`.
- **Example / Fix:** Treat `resource_already_exists_exception` as `ALREADY_EXISTS`, and call `createAliasIfNeeded()` on both paths.

<a id="b-031"></a>
#### B-031 — `create()` returns a different envelope on each path and omits `request`/`error`
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:526-552` (`create`)
- **Severity:** Medium
- **Confidence:** Confirmed via script and `tsc`
- **Description:** The success path returns `['took','success','indexResponse','aliasResponse']`. It has no `request`, and `error`/`errorKind` are `undefined` rather than `null`. The failure path names the alias field `alias`, not `aliasResponse`. tsc reports that `IndexCreateResult['request']` does not exist. `create()` also takes no `more` argument, unlike `createOnly`.
- **Example / Fix:** Always return `{ success, took, request, indexResponse, aliasResponse: aliasResponse ?? null, error: x ?? null, errorKind: y ?? null }`.

<a id="b-032"></a>
#### B-032 — A transient poll error or process exit abandons the migration, leaving the alias on both indexes permanently
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:1050-1110` (`migrateIfNeeded`)
- **Severity:** Medium
- **Confidence:** High
- **Description:** In each of these cases the alias is left on two indexes, which leads to duplicate results, `findById` failures, and the re-entry bug on the next run:
  - `_kickoffReindex` is fire-and-forget, and `migrateIfNeeded` returns `success: true` right away with no handle to wait on. If the process exits (CLI or deploy script), polling stops and the old index is never removed.
  - A single failing `tasks.get` (503, timeout, or node restart) exits the poll loop. The reindex keeps running on the server, but the swap never happens.
  - A failing `indices.delete` is swallowed.
  - The poll loop has no timeout.
- **Example / Fix:**
  - Retry `tasks.get` with backoff, up to a maximum number of attempts.
  - Remove the old index atomically with `updateAliases({ actions: [{ remove_index: { index: oldIndex } }] })`.
  - Return a `completion` promise and accept a `timeout`.

<a id="b-033"></a>
#### B-033 — `deleteMany(cb, more)` passes `more` as transport options, so it is silently ignored
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:1331` (`deleteMany`)
- **Severity:** Medium
- **Confidence:** High (confirmed with a recording client)
- **Description:** In client v9, the second argument to `client.deleteByQuery(params, options)` is `TransportRequestOptions`. Calling `deleteMany(cb, { conflicts: 'proceed', refresh: true })` sent an empty querystring, so both settings were lost. `more` is also typed as `Omit<SearchRequest,…>`.
- **Example / Fix:** Type it as `more?: Omit<estypes.DeleteByQueryRequest, 'index' | 'query'>` and merge it into the params object.

<a id="b-034"></a>
#### B-034 — `deleteMany()` with no callback deletes every document
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:1322-1329` (`deleteMany`)
- **Severity:** Medium
- **Confidence:** High (confirmed: the body was `{"query":{"match_all":{}}}`)
- **Description:** The callback is optional, and an empty `QueryBuilder` produces `match_all`, so a missing argument wipes the index. A builder that only calls `sortByRandom()` does the same. For retriever-only builders, `query` is `undefined` and ES rejects the request.
- **Example / Fix:** Require the callback, or reject an empty `getMust()` unless `{ all: true }` is passed. Reject when `query` is undefined.

<a id="b-035"></a>
#### B-035 — `getStatus` reports `needsCreation` when the cluster is unreachable or returns an error
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:899-921, 945-949` (`getStatus`, `getSiblingIndexes`)
- **Severity:** Medium
- **Confidence:** High (confirmed with a stubbed client)
- **Description:** On error, `exists()` returns `null` and `getAliasMetadata()` returns `indexes: []`, so `needsCreation` comes out `true`. A stub that threw ConnectionErrors returned `summary: "needsCreation"`. If only `getAlias` fails (e.g. a 403), `migrateIfNeeded` creates a new empty index and adds it to the alias with no write index. `StatusReport` has no `error` field, so callers can't tell a failed check from a real result. `aliasExists` is typed `boolean` but can be `null` (tsc error at line 912).
- **Example / Fix:** Propagate `error`/`errorKind` from the sub-calls, add `summary: 'unknown'`, and make `migrateIfNeeded` abort when `status.error` is set.

<a id="b-036"></a>
#### B-036 — The "current" branch of `migrateIfNeeded` never makes sure the alias exists
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:1160-1167` (`migrateIfNeeded`)
- **Severity:** Medium
- **Confidence:** High (from the code path)
- **Description:** If the versioned index exists but the alias doesn't (after `createOnly()`, a manually deleted alias, or a failed `createAlias`), the method returns success without an alias. A later `put()` to the alias name then auto-creates a concrete index named `prod~english~books` with dynamic mappings, and from then on `createAlias` can never succeed.
- **Example / Fix:** `if (!status.aliasExists) { await this.createAlias(); meta.createdAlias = true; }`

<a id="b-037"></a>
#### B-037 — During or after a partial migration, reads return duplicates and `findById` fails
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:992-1004` (`migrateIfNeeded`); affects `findById` (1185), `findMany`, `count`
- **Severity:** Medium
- **Confidence:** Medium (from ES single-doc GET semantics)
- **Description:** While the reindex runs, the alias spans both the old and new index, so `findMany`/`count` see each copied doc twice. A single-doc GET through an alias with several indexes fails with "alias […] has more than one index associated with it", so `findById` errors for the whole migration. Because failed deletes are swallowed, this state can become permanent.
- **Example / Fix:** Reindex into an index that isn't in the alias yet, then swap atomically: `[{add:{index:new,alias,is_write_index:true}},{remove_index:{index:old}}]`.

<a id="b-038"></a>
#### B-038 — `needsCreation()` always returns `false`
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:927-930` (`needsCreation`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** `this.exists()` returns an envelope object, which is always truthy, so `!indexExists` is always `false`.
- **Example / Fix:** `const { exists } = await this.exists(); return exists === false;`

<a id="b-039"></a>
#### B-039 — `putBulk`: id `0` gets a random UUID, the envelope lacks `error`/`errorKind`/`response`, and `more` leaks into the result
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:804, 831-838` (`putBulk`)
- **Severity:** Medium
- **Confidence:** High (confirmed with a stubbed client)
- **Description:**
  - `record.id || crypto.randomUUID()` replaces an id of `0` or `''`, so re-putting the record creates a duplicate.
  - Generated ids are never returned, because `report` has no `_id`.
  - On success, `error` is `undefined` rather than `null`, and it stays `undefined` when `errors: true`.
  - `...more` copies request params such as `refresh` into the result.
  - tsc flags `item.index` as possibly undefined.
- **Example / Fix:**
  - Use `record.id ?? crypto.randomUUID()`.
  - Add `id: item.index?._id` to each report row.
  - Replace `...more` with `...this._formatNonError(response)`.
  - Return an aggregated error when some items fail.

<a id="b-040"></a>
#### B-040 — Default `rankWindowSize` of 50 makes any `limit()` above 50 fail with retrievers
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:98` (default), `:280` (`rankWindowSize`); serialized in `getBody`/`getOptions`
- **Severity:** Medium
- **Confidence:** Medium (based on ES `CompoundRetrieverBuilder` validation: "requires [rank_window_size] be greater than or equal to [size]")
- **Description:** `qb.limit(100).rrf({...})` outputs `size: 100` with `rank_window_size: 50`, and ES rejects that for `rrf`/`linear`. Paging past the window (`from + size > rank_window_size`) returns empty pages with no error. Nothing raises the window to cover `size`/`from`. The third QueryBuilder reviewer flagged the same issue.
- **Example / Fix:** In `getBody()`, use `Math.max(this._rankWindowSize, from + size)` unless the user set the window explicitly, or validate it and throw a clear error.

<a id="b-041"></a>
#### B-041 — `searchAfter()` with `page() > 1` produces a request ES rejects
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:332` (`searchAfter`), serialized at `:2119-2130` (`getOptions`)
- **Severity:** Medium
- **Confidence:** High (output confirmed via script; ES requires `from` to be 0 with `search_after`). The third QueryBuilder reviewer flagged the same issue.
- **Description:** `qb.limit(10).page(3).searchAfter([123,'abc'])` → `{"size":10,"from":20,"search_after":[123,"abc"]}`, which ES rejects with "[from] parameter must be set to 0 when [search_after] is used".
- **Example / Fix:** Leave out `from` when `search_after` is set, or throw a clear error.

<a id="b-042"></a>
#### B-042 — `weightedSemantic` ignores the builder's `rankWindowSize`, `rankConstant` and normalizer
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:720-725` (`weightedSemantic`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** It hardcodes `rank_window_size: 100`, `rank_constant: 10` and `normalizer: 'minmax'`, while `rrf()` uses the builder state. `qb.rankWindowSize(500).rankConstant(60).weightedSemantic(...)` still emits 100/10, and a caller can't fix `limit(101)` with a lone `weightedSemantic`.
- **Example / Fix:** Use `this._rankWindowSize`, `this._rankConstant` and `this._normalizer`, or accept per-call overrides.

<a id="b-043"></a>
#### B-043 — `rrf()` and `semantic()` freeze the rank settings and normalizer at call time, so call order matters
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:786-791` (`rrf`), `:828` (`semantic`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** `rank_window_size`, `rank_constant` and `normalizer` are copied into the retriever object when the method is called. With `qb.rrf({...}); qb.rankWindowSize(200).rankConstant(60);`, the inner RRF still gets `50 / 20` while the outer `linear` uses 200. `reset('rankWindowSize')` doesn't update retrievers that were already added either. The spec only passes because it calls `rankWindowSize()` first.
- **Example / Fix:** Store only the intent (`{ type:'rrf', semanticField, ... }`) and build the DSL in `getBody()`.

<a id="b-044"></a>
#### B-044 — The default FVH highlighter errors on fields without term vectors
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:38-44` (`getDefaultHighlighter`), `:231` (`highlightField`)
- **Severity:** Medium
- **Confidence:** Medium-High
- **Description:** `type: 'fvh'` requires `term_vector: with_positions_offsets`. `SchemaManager` sets that only on the parent `text` field, not on the `.exact`/`.fulltext` sub-fields, and keyword fields don't have it either. `qb.highlightField('title.fulltext')` or `qb.highlightField('author')` makes ES fail the entire search.
- **Example / Fix:** Default to `unified`, which uses term vectors when they're present, or allow a per-field `type` override.

<a id="b-045"></a>
#### B-045 — `matchBoostedPhrase`'s default weights give the exact phrase the lowest boost
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:581-582` (`matchBoostedPhrase`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** Weights line up with `operators` by position. The defaults `operators=['exact','and']` and `weights=[1,3,5]` give `match_phrase` boost 1 and `match AND` boost 3. That contradicts the JSDoc ("more weight to the phrase as a whole") and its example (`[5,3,1]`), and the default `5` is never used. The spec (`QueryBuilder.spec.ts:844-862`) locks in the inverted result.
- **Example / Fix:** Default to `weights = [5, 3, 1]` and update the spec.

<a id="b-046"></a>
#### B-046 — `aggregateTerm()`'s multi-key `order` object only applies the last key, and dotted field names break the order path
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1251-1256` (`aggregateTerm`)
- **Severity:** Medium
- **Confidence:** Medium (shape confirmed via script; the ES parsing behavior is from knowledge)
- **Description:**
  1. `Object.fromEntries(...)` builds one object with several keys. ES reads one key per object, so multiple criteria need an array: `[{_key:'asc'},{year:'desc'}]`.
  2. Order keys and sub-agg names use the raw field name. In an order path, `pub.year` means "agg `pub`, metric `year`", so dotted field names fail.
  3. Mapping `desc` → `min` and `asc` → `max` (line 1264) looks inverted. Please confirm the intent.
- **Example / Fix:** `order: orderBy.map(o => ({ [key(o)]: o.order }))`, with sub-agg names like `__order_${i}`.

<a id="b-047"></a>
#### B-047 — `aggregateTerm()` sends the composite-only `missing_bucket` option to a `terms` agg
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1240-1241, 1257-1258` (`aggregateTerm`)
- **Severity:** Medium
- **Confidence:** Medium
- **Description:** `missing_bucket` is a composite-source option. A `terms` agg most likely rejects it as an unknown field; its equivalent is `missing: <value>`. The JSDoc's "otherwise a `composite` agg is built" is also wrong, because the method always builds a `terms` agg.
- **Example / Fix:** Replace it with a `missing?: FieldValue` option and update the JSDoc.

<a id="b-048"></a>
#### B-048 — `knn()` emits a string `similarity` such as `'cosine'`, but the KNN retriever requires a float threshold
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1095, 1117-1119` (`knn`)
- **Severity:** Medium
- **Confidence:** High (confirmed via script; `estypes.KnnRetriever.similarity` is a `float`)
- **Description:** The parameter is typed as `InferenceCohereSimilarityType`, which is a Cohere inference-endpoint setting unrelated to knn search. In knn, `similarity` is a minimum-similarity cutoff, so ES fails to parse a string. The spec at `QueryBuilder.spec.ts:909-920` asserts the invalid output.
- **Example / Fix:** Type it as `similarity?: number`, drop the custom `knnDef` type and the cast, and fix the test.

<a id="b-049"></a>
#### B-049 — `termsSet()` without `script` produces an invalid `terms_set` query, and the README example does exactly that
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1047-1072` (`termsSet`); `README.md` termsSet row
- **Severity:** Medium
- **Confidence:** Medium-High
- **Description:** `script` is optional, and there's no other way to set a minimum, so the output is `{terms_set:{tags:{terms:['a']}}}`. ES rejects it with "No minimum should match has been specified".
- **Example / Fix:** Accept `minimumShouldMatch` (ES 8.10+), `minimumShouldMatchField` or `script`, and require exactly one, or default to `minimum_should_match: 1`.

<a id="b-050"></a>
#### B-050 — `dateHistogram()` offset validation accepts units ES rejects or misreads, and rejects valid unsigned offsets
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1573-1580` (`dateHistogram`)
- **Severity:** Medium
- **Confidence:** Medium-High
- **Description:** ES parses `offset` with `TimeValue.parseTimeValue` after lowercasing it, and accepts only `nanos|micros|ms|s|m|h|d`. As a result, `+1w`, `+1q` and `+1y` fail on the server, and `+1M` is silently read as **+1 minute** instead of one month. Meanwhile the regex rejects an unsigned `6h`, which ES accepts.
- **Example / Fix:** `/^[+-]?\d+(nanos|micros|ms|s|m|h|d)$/`

<a id="b-051"></a>
#### B-051 — The composite helper types fail to typecheck against `@elastic/elasticsearch` 9.5.1
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:53-55, 1307, 1309, 1380, 1388, 1453` (`CompositeSourceWithField`, `aggregateHistogram`, `aggregateDateHistogram`, `aggregateGeotileGrid`)
- **Severity:** Medium
- **Confidence:** High (confirmed via `bunx tsc --noEmit`: TS2344/TS2339)
- **Description:** `AggregationsCompositeAggregationSource` is now `ExactlyOne<...>`, so `keyof` collapses to `never`. The build only passes because of `dts-bundle-generator --no-check`, which makes the published `.d.ts` for `orderBy` unreliable.
- **Example / Fix:** Use the concrete exported types, e.g. `estypes.AggregationsCompositeHistogramAggregation & { field: string }`.

<a id="b-052"></a>
#### B-052 — `rexgep()` defaults to different case sensitivity depending on the call form
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:946-947` (`rexgep`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** `rexgep('f','abc')` emits `case_insensitive: false`, but `rexgep({field:'f', value:'abc'})` emits `case_insensitive: true` because `!undefined` is true. `wildcard` and `containsExact` default to case-insensitive in both forms.
- **Example / Fix:** Use one default for both forms and document it.

<a id="b-053"></a>
#### B-053 — `includeFacets()` is a public no-op that the README documents as working
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1483` (`includeFacets`); `README.md`
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** It returns `undefined` (which breaks chaining) and adds nothing to the query. The spec block named `includeFacets()` actually tests `aggregateTerm`.
- **Example / Fix:** Implement it as `fields.forEach(f => this.aggregateTerm({ field: f, limit }))` and return `this`, or remove it.

<a id="b-054"></a>
#### B-054 — Composite-based histograms silently truncate at `limit` with no way to page
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1316-1321, 1405-1410, 1473-1478, 1582` (`aggregateHistogram`, `aggregateDateHistogram`, `aggregateGeotileGrid`, `dateHistogram`)
- **Severity:** Medium
- **Confidence:** High
- **Description:** These methods use `composite` with `size: limit` (default 25, or 100 for `dateHistogram`) but have no `after` parameter. `dateHistogram({interval:'day'})` over a year returns only the first 100 days. Composite also skips empty buckets, which leaves gaps in time-series charts.
- **Example / Fix:** Add an `after` option, or for `dateHistogram` use a plain `date_histogram` with `min_doc_count: 0` and `extended_bounds`.

<a id="b-055"></a>
#### B-055 — `sort()` array form produces invalid DSL for anything except `{field: 'asc'|'desc'}`
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1663-1668` (`sort`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** Each array entry is assumed to be `{field: 'asc'}` and is rewrapped as `{[k]: {order: v}}`.
  - Object values get double-wrapped: `[{price:{order:'desc',missing:'_last'}}]` becomes `{price:{order:{order:'desc',missing:'_last'}}}`, which ES rejects.
  - String entries break completely: `['_score','-created_at']` becomes `[{"0":{"order":"_"}},{"0":{"order":"-"}}]`.
  - The array form is not part of the `SortCombinations` parameter type, even though the JSDoc example uses it. tsc rejects `qb.sort([{ name: 'asc' }])`, and the spec has to cast it `as any`.
- **Example / Fix:** Widen the parameter to `SortCombinations | SortCombinations[]` and call `this.sort(f)` recursively for each item.

<a id="b-056"></a>
#### B-056 — `page()` is silently ignored when no `limit()` is set; page values are never validated
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:2119-2124` (`getOptions`), `:1628` (`page`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:**
  - `new QueryBuilder().page(3).getOptions()` returns `{}`, so the caller gets page 1 again. ES's implicit page size is 10.
  - `page(0)` and `page(-2)` silently become page 1.
  - `page(1.5)` gives `from: 5`, and with `limit(3)` it gives `from: 4.5`, which ES rejects.
- **Example / Fix:** `const size = this._limit ?? 10;` and compute `from` from that. Throw in `page()`/`limit()` on non-integer or out-of-range values.

<a id="b-057"></a>
#### B-057 — `toKibana()` prints `GET undefined/_search` when no index is set
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:2189-2193` (`toKibana`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** With no index and no override, the output is `GET undefined/_search`. (The `_source_excludes` problem in the `toKibana` body is covered in the `fields()`/`excludeFields()` bug in the first QueryBuilder section.)
- **Example / Fix:** ``const idx = indexOverride ?? this._index; `GET ${idx ? `${idx}/` : ''}_search` ``

<a id="b-058"></a>
#### B-058 — On the retriever path, the request includes top-level keys ES rejects (`rescore`, `min_score`, `search_after`, `sort`)
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:2053-2067` (`getBody`), `:2114-2138` (`getOptions`)
- **Severity:** Medium
- **Confidence:** Medium (ES validation from knowledge; DSL output confirmed via script)
- **Description:** When retrievers are used, `getBody()` still sends top-level `rescore` if any inner linear retriever is `standard`, and `getOptions()` always sends `min_score` and `search_after`. ES's `SearchSourceBuilder` rejects `retriever` together with `rescore`, `min_score`, `search_after` or `sort` ("cannot specify [retriever] and [X]"). (The `size` vs `rank_window_size` limit is covered separately in the first QueryBuilder section.)
- **Example / Fix:** Send these options only on the query path, or throw early. For rescore on the retriever path, use ES's `rescorer` retriever.

<a id="b-059"></a>
#### B-059 — `updateMany` with an empty/dot-only key replaces the whole `_source`; empty `newValues` sends an empty script
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/QueryRunner/QueryRunner.ts:113-116` (`toPainlessSourcePath`), `:93` (`updateMany`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** `updateMany({ '': {...} })` (or `'.'`) generates `ctx._source = params['v0'];`, which overwrites every matching document. `updateMany({})` sends `source: ""`, which ES rejects, or at best it's a no-op that still rewrites every document's version. Nested paths `a.b` also NPE in Painless when `ctx._source['a']` is null or missing.
- **Example / Fix:** Throw or return an error envelope for an empty `newValues` and for empty segments (the commented-out version at lines 133-135 already had that check). Create intermediate maps as shown above.

<a id="b-060"></a>
#### B-060 — `updateMany` ignores the builder's `limit` and has no `conflicts`/`refresh` defaults
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/QueryRunner/QueryRunner.ts:99-108` (`updateMany`)
- **Severity:** Medium
- **Confidence:** Confirmed via script (`max_docs` undefined after `limit(5)`)
- **Description:** Only `body.query` is used. A user who sets `qb.limit(5)` expecting to update 5 docs updates *all* matches. Without `conflicts: 'proceed'`, a single version conflict aborts the update midway with a 409, leaving it partly applied. The commented-out reference implementation defaulted `conflicts: 'proceed', refresh: true`.
- **Example / Fix:** Map `getLimit()` to `max_docs` when set, default `conflicts: 'proceed'`, and let `more` override.

<a id="b-061"></a>
#### B-061 — `updateMany` throws and has no error envelope, unlike every other runner method
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/QueryRunner/QueryRunner.ts:84-109` (`updateMany`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** It throws synchronously for retriever builders and lets `client.updateByQuery` rejections propagate. It returns the raw ES response, with no `{ request, took, error, errorKind }`. The TODO at line 89 acknowledges this.
- **Example / Fix:** Wrap the call in try/catch and return `{ updated, total, failures, request, took, ...index._formatNonError(res) }` or `...index._formatError(e)`.

<a id="b-062"></a>
#### B-062 — `getStatus` / `dropAll` report `success: true` on failure; `dropAll`/`recreateAll` ignore error envelopes; `recreateAll` marks failures 'SUCCESS'
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/SchemaRegistry/SchemaRegistry.ts:347` and `:376` (`success: true` in catch); `:273-275` (`recreateAll`); `:364` (`dropAll`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** (a) Both `catch` branches return `success: true`. (b) `IndexManager.drop()`/`recreate()` return envelopes and rarely throw. A failed drop gave `{ success: true, error: null }`. A failed recreate gave `summary: { 'a~v1': 'SUCCESS' }`, `success: true`. (c) In `recreateAll`, an index that does throw is left out of `report` entirely.
- **Example / Fix:** Check `result.error` per index, record it, and compute `success = every(no error)`. Use `success: false` in the catch branches.

<a id="b-063"></a>
#### B-063 — One failure in `getStatus`/`dropAll` abandons the result while other lanes keep running and mutating it after return
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/SchemaRegistry/SchemaRegistry.ts:327-353` (`getStatus`), `:361-381` (`dropAll`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** With `Promise.all`, the first throw rejects immediately. The remaining items in the failing group are skipped, and the other groups keep running in the background, pushing into `report`/`results` after the method has returned (report length went 0 → 2 within 200 ms of return). For `dropAll`, that means indexes keep being dropped after the caller has been told the operation errored.
- **Example / Fix:** Catch per index inside the loop, record the failure, and continue (or use `Promise.allSettled` with per-item results). Return only after every lane has settled.

<a id="b-064"></a>
#### B-064 — `chunkify` with `0`/negative/NaN concurrency hangs forever or silently processes nothing
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/SchemaRegistry/SchemaRegistry.ts:82-88` (`chunkify`)
- **Severity:** Medium
- **Confidence:** Confirmed via script
- **Description:** `size = 0` → `i += 0` loops forever, pushing empty arrays until the process is killed (timed out with SIGTERM). Negative sizes loop forever as well. `size = NaN` (e.g. `Number(process.env.X)`) returns `[[]]`, so `getStatus`/`dropAll`/`recreateAll` process **no indexes** and report `success: true`.
- **Example / Fix:** `const n = Math.max(1, Math.floor(size) || 1);`, or throw a `RangeError` for non-positive or non-finite values.

<a id="b-065"></a>
#### B-065 — Record shape: no `_id`, and `_score` isn't in the type (TS error at line 36)
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/QueryRunner/QueryRunner.ts:36-41` (`formatResponse`)
- **Severity:** Medium
- **Confidence:** High (confirmed by `tsc`: TS2322 at line 36; `records[0]._score` and `._id` give TS2339)
- **Description:** Records are `{ ..._source, _score }` with no `_id`. `IndexManager.putBulk` assigns `_id: record.id || crypto.randomUUID()`, so documents stored without an `id` field come back with no way to identify them for `patch`/`deleteById`. `_score` is added at runtime, but the declared type `ElasticsearchRecord<ThisSchema>` doesn't include it, which doesn't compile under the project tsconfig. Highlights, `fields`, and `sort` values (needed for `searchAfter` paging) are also dropped from records.
- **Example / Fix:** Type the records as `ElasticsearchRecord<ThisSchema> & { _id: string; _score: number | null; _highlight?: ...; _sort?: SortResults }` and map `hit._id`, `hit.highlight`, `hit.sort`.

### Low

<a id="b-066"></a>
#### B-066 — Empty basic-auth credentials are sent when no auth environment variables are set
- **Area:** Schema/Naming/Utils
- **Location:** `src/getEsClient/getEsClient.ts:5-12`
- **Severity:** Low
- **Confidence:** Confirmed via script (`authorization: Basic Og==`)
- **Description:** With neither `ES_API_KEY` nor `ES_USERNAME` set, the client sends `Authorization: Basic Og==`. Clusters with anonymous access, or behind an auth proxy, then fail authentication.
- **Example / Fix:** `auth: apiKey ? { apiKey } : username ? { username, password } : undefined` (or the equivalent `if` blocks, per the style rules).

<a id="b-067"></a>
#### B-067 — `isValidIndexName` and `isValidColumnName` reject single-character names despite their `length >= 1` check
- **Area:** Schema/Naming/Utils
- **Location:** `src/IndexNameManager/IndexNameManager.ts:88, 103`
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:**
  - `/^[a-z][a-z0-9_]+$/` requires at least 2 characters, so `name: 'a'` throws.
  - The pattern also rejects names ES allows, such as `wild-animals` and `2024_books`.
  - `isValidColumnName` is never called. It also rejects dotted paths and a leading `_`.
- **Example / Fix:** Change `+` to `*`. Allow `-` and a leading digit. Either delete `isValidColumnName` or wire it into SchemaManager.

<a id="b-068"></a>
#### B-068 — `getAllFields` and `getFulltextFields` return duplicates when `properties` overrides a schema field
- **Area:** Schema/Naming/Utils
- **Location:** `src/SchemaManager/SchemaManager.ts:104-108, 124-140`
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** With `{title:'text'}` plus `properties {title:{...}}`, which is the README's own example, both methods return `['title','title']`.
- **Example / Fix:** `return [...new Set(fields)]`

<a id="b-069"></a>
#### B-069 — `getFulltextFields` treats types inconsistently and includes types that can't be queried
- **Area:** Schema/Naming/Utils
- **Location:** `src/SchemaManager/SchemaManager.ts:113, 126-133`
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:**
  - For schema fields, only `=== 'text'` counts, so `semantic_text` and `match_only_text` are excluded there. The same types are included when they come from `properties`.
  - `token_count` (numeric) and `completion` are included, but neither works with `match`.
  - Text fields inside `properties` entries of type `nested`/`object` are never traversed.
- **Example / Fix:** Use one shared `FULLTEXT_TYPES` set for both branches and recurse into `properties[x].properties`.

<a id="b-070"></a>
#### B-070 — Date formats that contain `.` are truncated
- **Area:** Schema/Naming/Utils
- **Location:** `src/SchemaManager/SchemaManager.ts:144-146` (`getPropertyType`)
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** `'date.yyyy.MM.dd'` becomes `{ type:'date', format:'yyyy' }`.
- **Example / Fix:** `const format = type.slice('date.'.length);`

<a id="b-071"></a>
#### B-071 — SchemaManager doesn't type-check under the repo's TypeScript 7 devDependency
- **Area:** Schema/Naming/Utils
- **Location:** `src/SchemaManager/SchemaManager.ts:14, 45, 73, 94, 98, 112, 117, 135`
- **Severity:** Low
- **Confidence:** Confirmed via script (`tsc` 7.0.2 `--noEmit`)
- **Description:** `Schema` is unconstrained, so the file fails with TS2769 and TS2345. The build runs with `--no-check`, which hides these errors.
- **Example / Fix:** `class SchemaManager<Schema extends SchemaShape = SchemaShape>`, and guard `mapping.type` before using it.

<a id="b-072"></a>
#### B-072 — `englishplus` applies `asciifolding` after stop-word removal and stemming
- **Area:** Schema/Naming/Utils
- **Location:** `src/analyzers/englishplus.ts:19-24`
- **Severity:** Low
- **Confidence:** Medium (reasoned from Porter stemmer rules)
- **Description:** Because folding runs last, `résumés` → `resume` but `resumes` → `resum`, so the two no longer match. Accented stopwords are also missed. The analyzer also drops the `english_possessive_stemmer` that the built-in `english` analyzer includes.
- **Example / Fix:** `filter: ['english_possessive_stemmer', 'lowercase', 'asciifolding', 'english_stop', 'english_stemmer']`

<a id="b-073"></a>
#### B-073 — `normalizeTimeZone` builds invalid offsets from bad numbers and accepts impossible offsets and zone names
- **Area:** Schema/Naming/Utils
- **Location:** `src/normalizeTimeZone/normalizeTimeZone.ts:15-21, 32-33`
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** Bad input is converted or passed through instead of being rejected:
  - `330.5` → `+05:30.5`
  - `NaN` → `+NaN:NaN`
  - `100000` → `+1666:40`
  - `'+99:99'` and `'Foo/Bar'` are accepted as-is

  ES later returns a 400 for each of these.
- **Example / Fix:**
  - Numbers: require `Number.isInteger(tz)` and `|tz| <= 18*60`.
  - Offsets: check `hh <= 18` and `mm < 60`.
  - Zone names: validate with `new Intl.DateTimeFormat('en', { timeZone })`.

<a id="b-074"></a>
#### B-074 — `isEmptyObject` returns `true` for arrays, Dates, non-empty Maps and Sets, and symbol-keyed objects
- **Area:** Schema/Naming/Utils
- **Location:** `src/isEmptyObject/isEmptyObject.ts:1-13`
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** `isEmptyObject([])`, `isEmptyObject(new Date())`, `isEmptyObject(new Map([[1,2]]))` and `isEmptyObject({[Symbol()]:1})` all return `true`. Internal callers only pass plain objects today, but the function is publicly exported.
- **Example / Fix:** Return `false` unless the object is a plain object, then check `Reflect.ownKeys(obj).length === 0`.

<a id="b-075"></a>
#### B-075 — The IndexNameManager spec has unused `@ts-expect-error` directives
- **Area:** Schema/Naming/Utils
- **Location:** `src/IndexNameManager/IndexNameManager.spec.ts:54, 66, 78`
- **Severity:** Low
- **Confidence:** Confirmed via script (tsc TS2578)
- **Description:** `IndexName` is a plain `string`, so these lines have no type error to suppress, and the unused directives are themselves tsc errors.

<a id="b-076"></a>
#### B-076 — The books fixture's schema, mappings and data disagree
- **Area:** Schema/Naming/Utils
- **Location:** `src/testFixtures/books.ts:8 vs 66, 59 vs 83, 116/143/170`
- **Severity:** Low
- **Confidence:** High
- **Description:**
  - `id` is `keyword` in the mappings, `'integer'` in the schema, and a string in the data.
  - `price` is `integer`, but the data has `24.99`, so ES indexes it as `24`.
  - `published_at` is missing from `getBooksSchema()`.
  - `insertBooksData` uses `body:` instead of the 9.x `operations:`.
- **Example / Fix:** Make `price` a float, align the type of `id`, add `published_at: 'date'` to the schema, and use `operations`.

<a id="b-077"></a>
#### B-077 — `IndexErrorShape` is exported as the function type, not the error shape
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:29`
- **Severity:** Low
- **Confidence:** Confirmed via `tsc`
- **Description:** `IndexManager['_formatError']` is a function type, and it is re-exported publicly from `index.ts`.
- **Example / Fix:** `export type IndexErrorShape = ReturnType<IndexManager['_formatError']>;`

<a id="b-078"></a>
#### B-078 — `createAliasIfNeeded()` omits `took` on its success path
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:742-749` (`createAliasIfNeeded`)
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** The `CREATED` branch returns no `took`, while every other branch includes it.
- **Example / Fix:** Add `took: Date.now() - start`.

<a id="b-079"></a>
#### B-079 — `exists()` types its `more` parameter as the alias-exists request
- **Area:** IndexManager (lifecycle)
- **Location:** `src/types.ts:126` (`IndexExistParams`), used at `IndexManager.ts:233` (`exists`)
- **Severity:** Low
- **Confidence:** Confirmed via `tsc` (`m.exists({ name: 'x' })` type-checks)
- **Description:** `IndexExistParams = Prettify<estypes.IndicesExistsAliasRequest>` should be `IndicesExistsRequest`. As written, valid options such as `include_defaults` and `flat_settings` are missing.

<a id="b-080"></a>
#### B-080 — `recreate()` ignores the results of drop and flush, and its `took` leaves them out
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:599-607` (`recreate`)
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:**
  - If `drop()` fails (e.g. 403), `create()` still runs. It then fails with `resource_already_exists_exception`, and the drop error is lost.
  - If `exists()` errors, the drop is skipped silently.
  - `flush()` runs even after `create()` fails, and its result is discarded.
  - `took` covers only `create()`.
- **Example / Fix:** Return early on a drop or exists error, skip the flush on error, and time the whole operation.

<a id="b-081"></a>
#### B-081 — `errorKind` classification uses `instanceof`, so it depends on which copy of the client is loaded
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:180-208` (`_formatError`), `:1369` (`isApiNotAvailable`)
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** When a different copy of `@elastic/elasticsearch` (e.g. a dual ESM/CJS install) produced the error, a real 404 `ResponseError` was classified as `errorKind: 'javascript'`. Serverless `api_not_available_exception` detection also fails in that case. The package declares the client as a peer dependency and ships both ESM and CJS, so consumers can hit this.
- **Example / Fix:** Fall back to duck-typing: `e?.name === 'ResponseError'` or `typeof e?.meta?.statusCode === 'number'`.

<a id="b-082"></a>
#### B-082 — Migrating an empty old index: `onComplete` never fires, `console.log` calls are left in, and there's a small data-loss race
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:1005-1035` (`migrateIfNeeded`)
- **Severity:** Low
- **Confidence:** Confirmed via script (the only event was `["progress",100]`)
- **Description:**
  - When `count === 0`, `onComplete` is never called.
  - Two `console.log` calls write to the library user's stdout.
  - Writes that reach the old index between the `count` (985) and `updateAliases` (992) are lost when that index is dropped.
- **Example / Fix:** Call `onComplete`, remove the logs, and re-count after the alias swap.

<a id="b-083"></a>
#### B-083 — Writes briefly fail during migration setup (the alias has two indexes and no write index)
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:990-1004` (`migrateIfNeeded`)
- **Severity:** Low
- **Confidence:** Medium
- **Description:** `this.create()` calls `putAlias` without `is_write_index`, so between `putAlias` and `updateAliases`, `put`/`patch`/`deleteById` fail with "no write index is defined for alias".
- **Example / Fix:** Use `createOnly()` followed by a single `updateAliases` that sets `is_write_index: true` on the new index.

<a id="b-084"></a>
#### B-084 — `percent` is `NaN` when a task's `total` is 0
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:1060` (`migrateIfNeeded`)
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** If one of several old indexes is empty, or the task hasn't computed `total` yet, the progress calculation is `0/0`.
- **Example / Fix:** `const percent = total > 0 ? Math.floor(Math.min(99, (done / total) * 100)) : 0;`

<a id="b-085"></a>
#### B-085 — `patch` hard-codes `result: 'updated'`
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:878` (`patch`)
- **Severity:** Low
- **Confidence:** Confirmed with a stubbed client
- **Description:** ES can return `noop` (via `detect_noop`) or `created` (via upsert), but the method always reports `updated`.
- **Example / Fix:** `result: response.result`

<a id="b-086"></a>
#### B-086 — `findById`'s envelope is missing `request`, `record` is typed `unknown`, and not-found is reported as an error
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:1185-1211` (`findById`)
- **Severity:** Low
- **Confidence:** High
- **Description:**
  - Neither branch returns `request`.
  - `client.get` is called without a type argument, so `record` is `unknown`.
  - A 404 comes back as `errorKind: 'response'` with `error` set.
  - `...more` can override `index`/`id`.
- **Example / Fix:** Use `this.client.get<ElasticsearchRecord<ThisSchema>>(...)`. On a 404, return `{ record: null, found: false, error: null }`.

<a id="b-087"></a>
#### B-087 — `findMany`/`findFirst`/`count`/`deleteMany` reject when the builder callback throws
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:1232-1236, 1250-1254, 1268-1272, 1323-1329`
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** The callback and `builder.getBody()` run outside any try/catch, which breaks the never-throw contract.
- **Example / Fix:** Wrap them and return the error envelope.

<a id="b-088"></a>
#### B-088 — Type errors in IndexManager (CRUD and migration)
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:821-828, 912` (under `--strict`, also 983, 1053, 1077/1086/1097, 1104, 1170)
- **Severity:** Low
- **Confidence:** Confirmed via `bunx tsc --noEmit -p .`
- **Description:**
  - `item.index` is possibly undefined.
  - `boolean | null` is assigned to `boolean`.
  - Under `--strict`: `oldNames` is inferred as `never[]`, `taskInfo.task` is possibly undefined, and `unknown` is passed to `onError`.

<a id="b-089"></a>
#### B-089 — `weightedSemantic`'s semantic boost and `weight` have no effect in common cases
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:714`, `:724` (`weightedSemantic`)
- **Severity:** Low
- **Confidence:** High
- **Description:** RRF uses only each child's rank order. `boosts[3]` scales the only query inside its own `standard` retriever, so it can't change the fused result. `weight` only matters inside `linear`, and when `weightedSemantic` is the only retriever with no filters, `getBody()` drops it.
- **Example / Fix:** Remove `boosts[3]` or use RRF component weights, and document when `weight` applies.

<a id="b-090"></a>
#### B-090 — The builder stores caller arrays and objects by reference
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:159, 169, 181, 191, 235, 333`; `getHighlighter` `:220`; `getBody` `:2045`
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:**
  - `fields(arr); arr.push('b')` changes `_source`.
  - Mutating the options passed to `highlightField` changes the query.
  - `qb.getBody().highlight.fields.injected = {}` adds a field to the builder's highlighter.
  - `searchAfter` has the same aliasing.
- **Example / Fix:** Copy on input (`[...fields]`, `{ ...opts }`) and clone on output.

<a id="b-091"></a>
#### B-091 — `range()` accepts values that produce invalid or unintended DSL
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:373-443` (`range`)
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:**
  - An array with an operator other than `between` emits `{ gt: [1,2] }`, which ES rejects.
  - `undefined`/`null` emits `{ range: { w: {} } }`.
  - `''` counts as defined, so `['', '2020-01-01']` emits `gte: ''`, which fails date parsing.
  - `between` with `min > max` silently matches nothing.
- **Example / Fix:** Throw on arrays used with non-`between` operators, skip null values, and treat `''` as empty. Overloads would help.

<a id="b-092"></a>
#### B-092 — The `weight` types in `semantic()` and `rrf()` don't match the defaults or the README
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:814` (`semantic`), `:758` (`rrf`)
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** `semantic` defaults to `weight = 1` but types `weight` as required. `rrf` requires `weight` with no default, so the README example that leaves it out fails type-checking.
- **Example / Fix:** Use `weight?: number = 1` in both.

<a id="b-093"></a>
#### B-093 — `QueryBuilder.ts` fails Biome formatting (double quotes)
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts` (whole file)
- **Severity:** Low
- **Confidence:** Confirmed via `bunx biome format`
- **Description:** `biome.json` and AGENTS.md require single quotes, but this file uses double quotes throughout, so `bun run format:check` fails.
- **Example / Fix:** `bun run format:write`.

<a id="b-094"></a>
#### B-094 — The README quick reference shows call signatures that don't exist
- **Area:** QueryBuilder (match/semantic)
- **Location:** `README.md:177-186` (`match`, `matchBoostedPhrase`, `matchPhrase`, `matchPhrasePrefix`, `rrf`)
- **Severity:** Low
- **Confidence:** High
- **Description:**
  - The README uses positional calls such as `match('title', 'Market research')` and `matchBoostedPhrase(['title'], ...)`. The real methods take a single object, and `matchBoostedPhrase` takes one `field`, not an array.
  - It lists `matchPhrase({ field, phrase, options })`, but `matchPhrase` only accepts `slop`.
  - `weightedSemantic` is undocumented.

<a id="b-095"></a>
#### B-095 — JSDoc inaccuracies in the config and match methods
- **Area:** QueryBuilder (match/semantic)
- **Location:** `:297` (`rankConstant`), `:287`/`:307` (getters), `:505-511` (`match`), `:543` (`multiMatch`), `:448`/`:478`
- **Severity:** Low
- **Confidence:** High
- **Description:**
  - The `rankConstant` JSDoc says "0-100", but ES requires a value ≥ 1, has no upper limit and defaults to 60.
  - The getters say "otherwise undefined", but they always return a number.
  - The `match` JSDoc lists `cutoff_frequency`, which ES 8+ rejects, and contains a stray sentence fragment.
  - The `multiMatch` example has a syntax error (`'summary]`).
  - "multipe" is misspelled twice.

<a id="b-096"></a>
#### B-096 — `aggregateDateHistogram()` allows both `calendarInterval` and `fixedInterval`, and doesn't normalize `timeZone`
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1388-1401` (`aggregateDateHistogram`)
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** ES rejects a source that sets both intervals. `timeZone` bypasses `normalizeTimeZone`, so a value like `'utc'` is passed through unchanged. Interval validation is skipped when `orderBy` is supplied.
- **Example / Fix:** Throw when both intervals are set, and run `timeZone` through `normalizeTimeZone`.

<a id="b-097"></a>
#### B-097 — `aggs()` stores the caller's object by reference, so later `aggregate*` calls mutate it
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1489-1492` (`aggs`); also `getAggs` (1498), `getRetrievers` (1135), `getRescore` (1178), and the knn `filter` (1112)
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** `const mine = {}; qb.aggs(mine); qb.aggregateTerm({field:'tag'})` leaves `mine.tag` populated. Mutating the array from `getRetrievers()` or the knn `filter` array changes the builder's internal state.
- **Example / Fix:** Copy on input and output (e.g. `this._aggs = { ...aggs }`).

<a id="b-098"></a>
#### B-098 — The `aggregate*` methods force `limit(0)`, and `reset('aggs')` doesn't undo it
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1270, 1322, 1411, 1479`
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** `qb.limit(10).aggregateTerm(...).reset('aggs')` still returns `{size:0}`. This side effect is undocumented, and a user-set limit gets overwritten.
- **Example / Fix:** Only set `limit(0)` when `_limit === null`, or make it opt-in, and document it.

<a id="b-099"></a>
#### B-099 — JSDoc and README examples don't match the real signatures
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `QueryBuilder.ts:1009` (`moreLikeThis`), `901-902` (`containsExact`), `932-933` (`rexgep`), `1199-1210` (`aggregateTerm`); README rows for knn, moreLikeThis, aggregateTerm and dateHistogram
- **Severity:** Low
- **Confidence:** High
- **Description:**
  - The `moreLikeThis` example passes `options: {...}`, but the method spreads rest props, so the request fails with a 400. There's also a typo: "MorkLikeThisOptions".
  - The `containsExact` examples call `containExact`.
  - In the `rexgep` example, `'\d+'` needs to be written as `'\\d+'`.
  - The `aggregateTerm` example has a syntax error.
  - The `exclude` parameter is described as "field names", but it takes term values.
  - The README uses `order`, but the parameter is `orderBy`.
  - The README shows `dateHistogram` with positional arguments.
  - The README knn example omits the required `weight`.
  - `wildcard`, `containsExact`, `rexgep` and the `aggregate*` histogram methods are missing from the README table.

<a id="b-100"></a>
#### B-100 — `term()` and `wildcard()` emit malformed clauses when `value` is omitted
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:853-861` (`term`), `875-890` (`wildcard`)
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** The output is `{"term":{}}` and `{"wildcard":{"f":{"case_insensitive":true}}}`, which ES rejects as malformed. `term` also accepts `any`, so passing an array gives a confusing ES error.
- **Example / Fix:** Make `value` required via overloads, type it as `estypes.FieldValue`, and throw on `undefined`.

<a id="b-101"></a>
#### B-101 — `should()` skips empty branches but keeps the original `minimum_should_match`, so nothing can match
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1880-1882` (`should`)
- **Severity:** Low
- **Confidence:** Confirmed via script (DSL); ES behavior: High
- **Description:** With two branches, one of them empty, and `minimumShouldMatch: 2`, the output is `{should:[A], minimum_should_match:2}`, which can never match. An empty branch arguably means "true" (`A OR true`), but skipping it narrows the result to `A`. With zero branches the output is `{bool:{should:[], minimum_should_match:1}}`.
- **Example / Fix:** When the number of non-empty clauses drops below a numeric `msm`, lower `msm` or throw. Decide on and document what an empty branch means, and push nothing when there are no clauses.

<a id="b-102"></a>
#### B-102 — `shouldNot()` with one branch ignores `minimumShouldMatch`
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1930-1939` (`shouldNot`)
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** `shouldNot([A], {minimumShouldMatch: 2})` produces `must_not:[A]` because of the `should()` single-branch shortcut. In real ES, `msm` 2 with one clause would exclude nothing.
- **Example / Fix:** The `should()` single-branch fix resolves this. Alternatively, validate that `msm` ≤ the branch count.

<a id="b-103"></a>
#### B-103 — `reset('shouldSortByRandom')` does nothing
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1695-1755` (`reset`)
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** `FieldType` (`src/types.ts:97`) includes `'shouldSortByRandom'`, but `reset()` has no branch for it. Random sort is cleared only as a side effect of `reset('sorts')`.
- **Example / Fix:** Add `else if (field === 'shouldSortByRandom') { this._shouldSortByRandom = false; }` and add it to `all`.

<a id="b-104"></a>
#### B-104 — `getBody()` returns live references to internal state
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:2033, 2045, 2050, 2079, 2081` (`getBody`, `_buildBoolQuery`)
- **Severity:** Low
- **Confidence:** Confirmed via script
- **Description:** `body.sort`, `body.highlight`, `body.aggs`, `body.rescore` and the bool `must` array are the builder's own objects. `body.query.term.a = 999` changed `qb.getMust()`. If a runner or caller adjusts the body, later queries from the same builder are affected.
- **Example / Fix:** Return `structuredClone(body)`, or document that the result is read-only.

<a id="b-105"></a>
#### B-105 — Result ordering is nondeterministic in `getStatus` / `recreateAll` / `dropAll`
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/SchemaRegistry/SchemaRegistry.ts:274, 332, 364`
- **Severity:** Low
- **Confidence:** Confirmed via script (registered `[a,b,c]`, report came back `[c,a,b]`)
- **Description:** Results are pushed in completion order. `migrateIfNeeded` promises "registration order", and these methods are inconsistent with that.
- **Example / Fix:** Write to `report[i]` by original index position.

<a id="b-106"></a>
#### B-106 — Duplicate registration is allowed and runs concurrent destructive operations on the same index
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/SchemaRegistry/SchemaRegistry.ts:72-80` (`register`, `registerAll`), `:310-316` (`getIndexLookup`)
- **Severity:** Low
- **Confidence:** Confirmed via script (same index registered twice ran 2 concurrent ops)
- **Description:** Registering the same `IndexManager` twice, or two managers with the same alias but different versions, is accepted. `recreateAll`/`dropAll` can then drop or create the same index concurrently (`resource_already_exists` and similar races). `summary` (keyed by fullName) and `getIndexLookup` (keyed by alias) silently collapse the entries.
- **Example / Fix:** Dedupe on `getFullName()` in `register`/`registerAll`, and throw on an alias collision with a different full name.

<a id="b-107"></a>
#### B-107 — Constructor keeps the caller's array, so `register` mutates it
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/SchemaRegistry/SchemaRegistry.ts:68-70` (`constructor`)
- **Severity:** Low
- **Confidence:** Confirmed via script (caller's array length went 1 → 2)
- **Example / Fix:** `this.indexes = [...indexes];`

<a id="b-108"></a>
#### B-108 — Error envelope shape is inconsistent across runner methods and with `IndexManager`
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/QueryRunner/QueryRunner.ts:54-61, 175-185, 192-193, 236-243` (`formatResponse`, `findMany`, `findFirst`, `count`)
- **Severity:** Low
- **Confidence:** Confirmed via script (`'errorKind' in findMany()` → false)
- **Description:** None of the runner methods return `errorKind`, unlike `IndexManager._formatError`. The `findMany` catch sets `response: null` (dropping `e.meta`) while `count` keeps `e.meta`. `aggregations` is `{}` in one error branch and `null` in the other. `total` is `0` in one and `null` in the other. `findFirst` returns `record: undefined` where IndexManager methods use `record: null`. `count.took` is wall-clock time while `findMany.took` is ES-reported time. tsc also flags `e.meta` (TS18046, line 241).
- **Example / Fix:** Route all catches through `this.index._formatError(e)` and successes through `_formatNonError`; use `record: records[0] ?? null`.

## Suggestions

### High

<a id="s-001"></a>
#### S-001 — Make `errorKind` a literal union and give `_formatError` a declared return type
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:179-228` (`_formatError`, `_formatNonError`)
- **Impact:** High
- **Description:** `errorKind` widens to `string`, so callers can't narrow on it. Declare `type ErrorKind = 'response' | 'connection' | 'timeout' | 'disconnected' | 'aborted' | 'serialization' | 'javascript'`. Also map `RequestAbortedError`, `SerializationError`/`DeserializationError`, `ProductNotSupportedError` and `ConfigurationError`, which all fall through to `'javascript'` today. Use `e: unknown`.

<a id="s-002"></a>
#### S-002 — Add unit tests for the lifecycle methods
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.spec.ts`
- **Impact:** High
- **Description:** The spec covers only `put`, `patch` and `flush`. `exists`, `aliasExists`, `getIndexMetadata`, `getAliasMetadata`, `create`, `drop`, `recreate`, `createIfNeeded` and `createAliasIfNeeded` are untested, which is how the bugs above slipped through. The integration test calls `createAlias()` after `create()`, which already creates the alias, and never checks the result of `drop()`.

<a id="s-003"></a>
#### S-003 — Redesign the migration around an atomic swap and a "new copy wins" rule
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:961-1178` (`migrateIfNeeded`)
- **Impact:** High
- **Description:**
  1. Validate the version order so migrations only go upward.
  2. `createOnly()` the new index.
  3. Make the new index the write index.
  4. Reindex with `op_type: 'create'` and `conflicts: 'proceed'`.
  5. On completion, check `error` and `failures`, and compare doc counts.
  6. Remove the old index with an atomic `updateAliases` `remove_index`.
  7. Delete the `.tasks` result doc.

  Add a guard against concurrent migrations, such as checking `tasks.list` or using a lock document.

<a id="s-004"></a>
#### S-004 — Return a completion handle and add timeout/retry controls
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:1107-1116` (`migrateIfNeeded`)
- **Impact:** High
- **Description:**
  - Return `completion: Promise<MigrationOutcome>`. Today `SchemaRegistry` reconstructs this from `percent === 100` callbacks.
  - Add `timeout`, `maxPollErrors`, `slices` and `requests_per_second` options.
  - Include `failures` in the progress details.
  - Call `onComplete` only on success.

<a id="s-005"></a>
#### S-005 — Rename `rexgep` to `regexp`
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:935` (`rexgep`)
- **Impact:** High
- **Description:** The name is a typo, so users won't find the method. Add `regexp()` and keep `rexgep` as a `@deprecated` alias. Also expose `flags` and `max_determinized_states`.

<a id="s-006"></a>
#### S-006 — Add a `QueryRunner.spec.ts`
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/QueryRunner/`
- **Impact:** High
- **Description:** There are no unit tests at all. A stubbed client (or a real `Client` with a custom `Connection`) makes it easy to cover: the count body containing only `query`, count with retrievers, `findFirstOrThrow` rethrowing the real error, the `updateMany` script/params for nested paths, quote rejection and empty input, `formatResponse` with numeric vs object `hits.total` and missing `hits`, and the error envelope shape.

<a id="s-007"></a>
#### S-007 — Fill coverage gaps in `SchemaRegistry.spec.ts`
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/SchemaRegistry/SchemaRegistry.spec.ts`
- **Impact:** High
- **Description:** Only `chunkify` (happy path) and `migrateIfNeeded` are tested. Add tests for `recreateAll`, `getStatus` and `dropAll`: actual max in-flight count, partial failure, error envelopes making `success` false, result order, and empty registry. Also test `chunkify` with 0/NaN/negative, duplicate `register`, `registerAll`, `listIndexes`, and `getIndexLookup`. The existing `fakeIndex` helper extends easily with `drop`/`recreate`.

### Medium

<a id="s-008"></a>
#### S-008 — Let objects map as `object` instead of always `nested`
- **Area:** Schema/Naming/Utils
- **Location:** `src/SchemaManager/SchemaManager.ts:52-61, 80-85`
- **Impact:** Medium
- **Description:** Every sub-object becomes `type: 'nested'`. That costs hidden Lucene documents and requires `nested` queries, so a plain `match` on `publishing.author` silently returns nothing. Support `{ type: 'object' | 'nested', properties }`, and merge the near-identical `_schemaToMappings`/`_schemaToNestedMappings`.

<a id="s-009"></a>
#### S-009 — Reconsider the `.exact` subfield and the default `term_vector`
- **Area:** Schema/Naming/Utils
- **Location:** `src/SchemaManager/SchemaManager.ts:151-163`
- **Impact:** Medium
- **Description:** `.exact` uses the `standard` analyzer, which is already the parent field's default. That duplicates the parent's index, and the name suggests keyword semantics it doesn't have. `term_vector: 'with_positions_offsets'` on every text field roughly doubles the text index size. Consider making `.exact` a `keyword` with `ignore_above`, and making term vectors opt-in.

<a id="s-010"></a>
#### S-010 — Review the public API surface in `index.ts`
- **Area:** Schema/Naming/Utils
- **Location:** `index.ts`
- **Impact:** Medium
- **Description:**
  - **Missing exports:** `IndexNameAttributes`, `IndexName`, `ColumnName`, `IndexRecreateResult`, `MigrationParams`, `QueryBuilderProvider`, `HighlightDefinition`.
  - **Internal names exposed:** `isEmptyObject` is exported while `isDefined` and `normalizeTimeZone` aren't. `export * from './src/types'` also leaks QueryBuilder internals (`FieldType`, `FieldTypeOrTypes`, `Prettify`).
  - **No CommonJS build:** AGENTS.md describes a dual ESM/CJS package, but `package.json` exports only `import` and the build has no CJS step.

<a id="s-011"></a>
#### S-011 — Fill test coverage gaps for the schema, naming, client and utility modules
- **Area:** Schema/Naming/Utils
- **Location:** `SchemaManager.spec.ts`, `IndexNameManager.spec.ts`, `isEmptyObject.spec.ts`, plus new specs
- **Impact:** Medium
- **Description:**
  - **SchemaManager:** text fields inside nested objects; nesting deeper than one level; `getAllFields` on nested fields; custom analyzer; duplicate `properties`; dotted date formats.
  - **IndexNameManager:** construction without a prefix; `parseByName` without a separator; validating prefix and separator.
  - **No spec at all:** `getEsClient` (a local `Bun.serve` that captures headers works well for this), `englishplus`, `isDefined`.
  - **Type-level tests:** none for `ElasticsearchRecord` or `IndexInferRecordShape`.
  - **isEmptyObject:** arrays, Dates and Maps.

<a id="s-012"></a>
#### S-012 — Share one default client instead of creating one per `IndexManager`
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:149` (constructor)
- **Impact:** Medium
- **Description:** `getEsClient()` builds a new `Client`, with its own connection pool, for every `IndexManager` that isn't given one. A `SchemaRegistry` of N indexes opens N pools, and serverless detection isn't shared between them. Memoize the default client.

<a id="s-013"></a>
#### S-013 — `getCreateRequest`: reuse `this.schema` and merge `more` instead of overwriting
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:483-495` (`getCreateRequest`)
- **Impact:** Medium
- **Description:**
  - `new SchemaManager(this.schema)` passes a `SchemaManager` instance as the options bag. It only works because the field names happen to match, so call `this.schema.toMappings()` directly.
  - `...(more || {})` replaces `mappings`/`settings` wholesale, so deep-merge them instead.
  - Consider stripping settings that serverless rejects when `isServerless()` is true.

<a id="s-014"></a>
#### S-014 — Give the write methods a `more` parameter and consistent id types
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:759, 857, 1185, 1280` (`put`, `patch`, `findById`, `deleteById`)
- **Impact:** Medium
- **Description:**
  - `put` and `deleteById` accept no `more`, so callers can't pass `refresh`, `routing`, `if_seq_no`/`if_primary_term` or `op_type`.
  - `put` takes `number | string` ids, but the others take only `string`. Use the same type everywhere.
  - Default `retry_on_conflict` on `patch`.

<a id="s-015"></a>
#### S-015 — Make `putBulk` production-safe
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:795-849` (`putBulk`)
- **Impact:** Medium
- **Description:**
  - Return early for an empty `records` array, because ES rejects an empty bulk request.
  - Split large inputs into chunks (around 1000 ops or 5MB each).
  - Include `_id` in each report row.
  - Type `bulkBody` properly instead of `any[]`.

<a id="s-016"></a>
#### S-016 — Make `deleteMany` safer and more informative
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:1315-1346` (`deleteMany`)
- **Impact:** Medium
- **Description:**
  - Reuse the `QueryBuilderProvider` type.
  - Inspect `failures`/`version_conflicts` and set `success` from them.
  - Offer `conflicts: 'proceed'` as an opt-in.
  - Use the same `{ method, endpoint, body }` request shape as the other methods.

<a id="s-017"></a>
#### S-017 — Add unit tests for CRUD and migration using a stub client
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.spec.ts`
- **Impact:** Medium
- **Description:** These have no unit tests:
  - `migrateIfNeeded` (every branch)
  - `putBulk`
  - `deleteMany`
  - `findById` (404 case)
  - `getStatus` (error paths)
  - `needsCreation`

  The integration test covers only the migration-with-data path, with no concurrent writes or failures.

<a id="s-018"></a>
#### S-018 — Add a `normalizer()` setter
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:95`, `:837` (`getNormalizer`)
- **Impact:** Medium
- **Description:** `_normalizer` has a getter and a `reset` branch but no setter. Add `normalizer(n: ScoreNormalizer): this` and apply it when `getBody()` runs.

<a id="s-019"></a>
#### S-019 — Run non-scoring conditions in filter context
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:373` (`range`) and the `_must` design overall
- **Impact:** Medium
- **Description:** `range` and term-like clauses go into `bool.must`, where they add a constant to `_score` and skip the filter cache. Add a `_filter` bucket (`bool.filter`) or a `{ filter: true }` option. This matters most combined with `minScore()` and rescore.

<a id="s-020"></a>
#### S-020 — Add missing tests for the config, match and semantic methods
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.spec.ts`
- **Impact:** Medium
- **Description:** No tests cover:
  - `weightedSemantic`, `escapeWildcards` and `multiMatch`
  - The options passthrough in `matchPhrasePrefix`
  - `fields` + `excludeFields` serialized together
  - The default highlighter output
  - `rrf` when `rankWindowSize()` is called after it
  - `searchAfter` + `page()`
  - The scalar getters

<a id="s-021"></a>
#### S-021 — Warn or throw when rescore is combined with a non-score sort or with retrievers
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1148` (`rescore`), `getBody` 2032-2066
- **Impact:** Medium
- **Description:** ES rejects a `sort` other than `_score` together with `rescore`, but the builder emits both. An inner builder with no conditions produces a `match_all` rescore, and a knn-only inner builder is silently dropped.

<a id="s-022"></a>
#### S-022 — Make agg names configurable and deduplicate the composite helpers
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1213-1481` (`aggregate*`)
- **Impact:** Medium
- **Description:** Every helper keys its agg as `this._aggs[field]`, so `aggregateTerm({field:'price'})` followed by `aggregateHistogram({field:'price'})` silently overwrites the first agg. Add an optional `name` and extract a shared `_addComposite()` helper. `aggregateHistogram` requires `interval` even when `orderBy` supplies the sources.

<a id="s-023"></a>
#### S-023 — Tighten the `knn()` parameter types and add validation
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1080-1129` (`knn`)
- **Impact:** Medium
- **Description:**
  - Make `weight` optional, since it defaults to 1.
  - Validate that `numCandidates >= k`, `k > 0`, and the vector is non-empty.
  - Consider supporting `query_vector_builder` and `rescore_vector`.
  - An empty `filter` array is emitted as `filter: []`.

<a id="s-024"></a>
#### S-024 — Add common options to `queryString()` and `moreLikeThis()`
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:980` (`queryString`), `1011` (`moreLikeThis`)
- **Impact:** Medium
- **Description:** `queryString` has no `default_operator`, `analyze_wildcard`, `lenient` or `fuzziness` options. User-supplied syntax errors return a 400, so consider a `simpleQueryString()`. `moreLikeThis` accepts only a single field; it should accept `string | string[]`.

<a id="s-025"></a>
#### S-025 — Add tests for the bugs above
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.spec.ts`
- **Impact:** Medium
- **Description:** Add tests for:
  - The full rescore shape
  - `aggregateTerm` with an `orderBy` other than `_count`
  - Both `rexgep` call forms
  - The string forms of `wildcard`, `containsExact` and `term`
  - The histogram aggregations
  - `dateHistogram` offset validation
  - `termsSet` without a script
  - `includeFacets`

  The knn similarity test currently asserts an invalid value.

<a id="s-026"></a>
#### S-026 — Fix stale README docs for `shouldNot`/`must`, and make the `shouldNot` options optional
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1930-1935` (`shouldNot`), `:1910` (`must`); README lines 281-294 and 363-365
- **Impact:** Medium
- **Description:**
  - The README calls `shouldNot(withBuilders)` with one argument, but `shouldOptions` is required (tsc: "Expected 2 arguments").
  - The README says `shouldNot` cannot take a custom `minimumShouldMatch`, but the code passes it through.
  - The README says there is no explicit `must()`, but there is one.
- **Example / Fix:** `shouldOptions: { minimumShouldMatch?: number | string } = {}`. Give `must()` an explicit `: this` return type and update the README.

<a id="s-027"></a>
#### S-027 — Don't silently drop sorts, random sort and function scores on the retriever path
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:2011-2028` (`getBody`)
- **Impact:** Medium
- **Description:** With retrievers present, `_sorts`, `_shouldSortByRandom` and `_functionScores` are discarded without any signal. Only function scores are documented as ignored. For a single `standard` retriever, sort and function_score could go inside `retriever.standard`.

<a id="s-028"></a>
#### S-028 — `sortByRandom` cannot be paged reproducibly and is overridden by field sorts
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1792, 2096-2106` (`sortByRandom`, `_applyScoreFunctions`)
- **Impact:** Medium
- **Description:** `random_score: {}` has no seed, so page 2 can repeat or skip results from page 1. Any field `sort()` takes precedence over `_score`, so random sort then has no effect. With other functions present, `boost_mode: 'replace'` multiplies the random score by the decay functions.
- **Example / Fix:** `sortByRandom(true, { seed, field = '_seq_no' })` producing `random_score: { seed, field }`.

<a id="s-029"></a>
#### S-029 — Missing tests for paging, sorting and bool composition
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.spec.ts`
- **Impact:** Medium
- **Description:** No tests cover:
  - `sort('_score')` output, and array sorts with option objects
  - Single-branch `should` with multiple clauses, empty branches, and `shouldNot`
  - `page` without `limit`, and `page` ≤ 0
  - `reset()` with no arguments, and `reset('shouldSortByRandom')`
  - `toKibana()` without an index
  - Behavior on the retriever path

<a id="s-030"></a>
#### S-030 — `findFirst` should request `size: 1`
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/QueryRunner/QueryRunner.ts:191-194` (`findFirst`, `findFirstOrThrow`)
- **Impact:** Medium
- **Description:** The request carries no `size`, so ES returns 10 hits (or the builder's limit) to use one. Pass `{ size: 1, ...more }` (or `from` from the page) into `findMany`. This does not mutate the shared builder. Neither `findFirst` nor `count` mutate `this.builder` today (verified), so keep it that way and avoid `builder.limit(1)`.

<a id="s-031"></a>
#### S-031 — Make the registry's empty-registry behavior and return shapes consistent
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/SchemaRegistry/SchemaRegistry.ts:106, 259, 318, 356`
- **Impact:** Medium
- **Description:** On an empty registry, `migrateIfNeeded` returns an error envelope, `recreateAll` throws, and `getStatus`/`dropAll` return `success: true`. Field naming also differs: `report` vs `results`, and `error` is an `Error` in migrate but a `string` (`.message`) elsewhere. Pick one envelope: `{ success, took, report, summary, error: Error | null }`.

<a id="s-032"></a>
#### S-032 — `dropAll` safety
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/SchemaRegistry/SchemaRegistry.ts:356` (`dropAll`)
- **Impact:** Medium
- **Description:** It deletes the data for every registered index with no guard. Consider requiring an explicit confirmation option (e.g. `dropAll({ confirm: true })`) or refusing when `NODE_ENV==='production'`. Note it drops only `getFullName()`, so older versioned siblings still behind the alias are left in place. Document that, or optionally drop them too.

<a id="s-033"></a>
#### S-033 — Type `updateMany` values against the schema
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/QueryRunner/QueryRunner.ts:80` (`updateMany`)
- **Impact:** Medium
- **Description:** `newValues: Record<string, unknown>` gives no autocomplete or checking. Use `Partial<ElasticsearchRecord<ThisSchema>>`, or dotted-path keys derived from the schema, and validate keys against `index.allFields` at runtime. That also closes most of the injection surface.

### Low

<a id="s-034"></a>
#### S-034 — `normalizeTimeZone`: accept more of what ES accepts, and fix the formatting
- **Area:** Schema/Naming/Utils
- **Location:** `src/normalizeTimeZone/normalizeTimeZone.ts`
- **Impact:** Low
- **Description:**
  - The file uses double quotes, so `biome check` fails.
  - ES (Java `ZoneId`) accepts `GMT`, `CET`, `EST5EDT`, `+0530` and `+05`, which this function rejects.
  - "Positive = east of UTC" is the opposite of `Date#getTimezoneOffset()`. Document this prominently.
  - Fixed offsets don't follow DST, so recommend IANA zone names.

<a id="s-035"></a>
#### S-035 — Make `isDefined` a type guard and add a spec
- **Area:** Schema/Naming/Utils
- **Location:** `src/isDefined/isDefined.ts:5`
- **Impact:** Low
- **Description:** Use `function isDefined<T>(v: T): v is NonNullable<T>` instead of an `any` parameter.

<a id="s-036"></a>
#### S-036 — `new SchemaManager()` crashes without an argument
- **Area:** Schema/Naming/Utils
- **Location:** `src/SchemaManager/SchemaManager.ts:18-24`
- **Impact:** Low
- **Description:** It throws "Cannot destructure property 'schema'". Add a `= {}` default.

<a id="s-037"></a>
#### S-037 — Tighten the public types
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:84` (`StatusReport.indexExists: any`), `:116` (`settings: any`)
- **Impact:** Low
- **Description:** Use `boolean | null` for `indexExists` and `IndexSettings` for `settings`. `IndexRunShape` could use `Awaited<...>`.

<a id="s-038"></a>
#### S-038 — `flush()` targets the alias, so it fails when only the index exists
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:432-434` (`flush`)
- **Impact:** Low
- **Description:** After `createOnly()`, or after a failed alias step, `flush()` returns 404 even though the concrete index exists. Flush `getFullName()`, or document the dependency on the alias.

<a id="s-039"></a>
#### S-039 — `getAliasMetadata` treats every 404 as "no alias"
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:383` (`getAliasMetadata`)
- **Impact:** Low
- **Description:** A 404 caused by a nonexistent `more.index` (`index_not_found_exception`) is also reported as `success: true, indexes: []`. Check the error type before treating the 404 as "no alias".

<a id="s-040"></a>
#### S-040 — Style cleanups (AGENTS.md / Biome)
- **Area:** IndexManager (lifecycle)
- **Location:** `src/IndexManager/IndexManager.ts:688-703, 722-751, 300`
- **Impact:** Low
- **Description:**
  - Remove `else if`/`else` after `return`, and fix the inner `const res` shadowing the outer one.
  - Remove the `console.log`.
  - `request.endpoint` is built from `getFullName()`/`getAliasName()` even when `more.index`/`more.name` overrides it.
  - Consider `performance.now()` for `took`.

<a id="s-041"></a>
#### S-041 — `getStatus`: run checks in parallel and surface errors
- **Area:** IndexManager (CRUD/migration)
- **Location:** `src/IndexManager/IndexManager.ts:899-921` (`getStatus`)
- **Impact:** Low
- **Description:**
  - Run the three round-trips with `Promise.all`.
  - Stop fetching alias metadata twice when migrating.
  - Add `error`/`errorKind` to `StatusReport`.
  - Replace the nested ternary at lines 915-919 (AGENTS.md style rule).

<a id="s-042"></a>
#### S-042 — Give `matchPhrase` the same options passthrough as `match`/`matchPhrasePrefix`
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:455` (`matchPhrase`)
- **Impact:** Low
- **Description:** Type it as `Omit<estypes.QueryDslMatchPhraseQuery,'query'> & { field; phrase }` so callers can pass `boost`, `analyzer` and `zero_terms_query`.

<a id="s-043"></a>
#### S-043 — Decide whether `highlighterOptions()` replaces or merges the defaults
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:205` (`highlighterOptions`)
- **Impact:** Low
- **Description:** `highlighterOptions({ number_of_fragments: 1 })` silently drops `type`, `fragment_size` and `tags_schema`. Either merge with the current options or state in the JSDoc that it replaces them.

<a id="s-044"></a>
#### S-044 — Validate the numeric setters
- **Area:** QueryBuilder (match/semantic)
- **Location:** `rankWindowSize` `:280`, `rankConstant` `:300`, `minScore` `:316`, `trackTotalHits` `:348`
- **Impact:** Low
- **Description:** `minScore(NaN)` serializes as `"min_score":null`. Throw for non-finite values, a `rankWindowSize` below 1, a `rankConstant` below 1, and a negative `trackTotalHits`.

<a id="s-045"></a>
#### S-045 — Skip clauses for blank phrases
- **Area:** QueryBuilder (match/semantic)
- **Location:** `match` `:516`, `matchPhrase` `:455`, `matchBoostedPhrase` `:578`, `weightedSemantic` `:652`
- **Impact:** Low
- **Description:** `phrase: ''` emits clauses that match nothing, so an empty search box returns zero hits. Treat blank phrases as a no-op, the way `range` already treats `[null, null]`.

<a id="s-046"></a>
#### S-046 — Make `weightedSemantic` configurable and avoid the leading wildcard
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:652-729`
- **Impact:** Low
- **Description:** `*phrase*` is an expensive leading-wildcard query, and ES rejects it when `search.allow_expensive_queries=false`. Allow disabling the contains clause, and document each `boosts` slot in JSDoc and the README.

<a id="s-047"></a>
#### S-047 — Make `escapeWildcards` a static, documented utility
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:731` (`escapeWildcards`)
- **Impact:** Low
- **Description:** The escaping is correct, but it's an undocumented public instance method that doesn't use any state. Make it `static` or a standalone helper.

<a id="s-048"></a>
#### S-048 — Broaden the `range()` input types
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:373`, `src/types.ts:104` (`RangeShape`)
- **Impact:** Low
- **Description:** Accept `Date`, and add optional `{ format, time_zone, relation, boost }`.

<a id="s-049"></a>
#### S-049 — `fields([])` should probably emit `_source: false`
- **Area:** QueryBuilder (match/semantic)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:158`, `:2147`
- **Impact:** Low
- **Description:** An empty include list currently omits `_source`, so ES returns the full source.

<a id="s-050"></a>
#### S-050 — Add a `case_insensitive` option to `term()`
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:853` (`term`)
- **Impact:** Low
- **Description:** Use the same `caseSensitive` option shape as `wildcard`/`rexgep`, and also support `boost`.

<a id="s-051"></a>
#### S-051 — Handle the empty-value edge case in `containsExact()`
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:904` (`containsExact`)
- **Impact:** Low
- **Description:** `containsExact('f', '')` becomes `**` and matches every document that has the field. The examples use `.keyword` sub-fields, but `SchemaManager` generates `.exact`/`.fulltext`.

<a id="s-052"></a>
#### S-052 — Rename `dateHistogram`'s `timezone` parameter to `timeZone`
- **Area:** QueryBuilder (term/knn/aggs)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1524` (`dateHistogram`) vs `1366` (`aggregateDateHistogram`)
- **Impact:** Low
- **Description:** The two methods spell the parameter differently and use different default limits (100 vs 25). Standardize on `timeZone` and keep `timezone` as an alias. Also validate that geotile `precision` is between 0 and 29.

<a id="s-053"></a>
#### S-053 — `decayFunctionScore` is misnamed and offers no `function_score` options
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1820` (`decayFunctionScore`)
- **Impact:** Low
- **Description:** It accepts any score function (`field_value_factor`, `script_score`, `weight`), not just decay functions. There is no way to set `score_mode`, `boost_mode`, `max_boost` or `min_score`, and it stores the caller's object by reference. Add a `scoreFunction()` alias and a `functionScoreOptions()` setter.

<a id="s-054"></a>
#### S-054 — Validate `limit()`
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1605` (`limit`)
- **Impact:** Low
- **Description:** Negative, `NaN` or fractional values go straight to ES as `size`. Throw a `RangeError` for them.

<a id="s-055"></a>
#### S-055 — `mustNot()` and `nested()` emit no-op wrappers and default keys
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1902, 1969-1977` (`mustNot`, `nested`)
- **Impact:** Low
- **Description:**
  - An empty `mustNot` callback pushes `{bool:{must_not:[]}}`, which acts as match_all.
  - `nested()` always wraps the query in `bool.must`, even for one clause, and always sends `ignore_unmapped: false` and `inner_hits: undefined`.
  - The `nested` JSDoc example (`qb.term('name','health')` with `path:'tags'`) is misleading, because ES requires the full path `tags.name`.

<a id="s-056"></a>
#### S-056 — Subquery builders silently discard state other than `must`
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1866-1878, 1900, 1967` (`should`, `mustNot`, `nested`)
- **Impact:** Low
- **Description:** Calling `sort`, `limit`, `sortByRandom`, `decayFunctionScore`, `aggregate*` or `knn`/`semantic` inside a sub-builder callback is ignored without warning. Throw in that case, or pass a narrower "condition builder" type to callbacks.

<a id="s-057"></a>
#### S-057 — Put non-scoring clauses in `filter`; `linear.filter` turns scoring clauses into filters
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:2075-2083, 2022-2024` (`_buildBoolQuery`, `getBody`)
- **Impact:** Low
- **Description:**
  - Every clause, including `term` and `range`, goes in scoring `bool.must`, so it is not cached and adds to the score.
  - On the retriever path, the whole must-bool, including full-text `match` clauses, becomes `linear.filter`, so those clauses stop affecting ranking.
  - A lone retriever with filters is wrapped in `linear` with minmax normalization just to apply the filter.

<a id="s-058"></a>
#### S-058 — `clone()` loses subclass types and can throw on non-cloneable values; getters expose internal arrays
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1764` (`clone`), `:1684, 1988, 1996` (`getSort`, `getFunctionScores`, `getMust`)
- **Impact:** Low
- **Description:**
  - `clone()` correctly deep-copies all 19 state fields (verified).
  - It returns `QueryBuilder` rather than `this`.
  - `structuredClone` throws if a clause contains a function or class instance.
  - The getters return internal arrays that callers can mutate.

<a id="s-059"></a>
#### S-059 — `valueOf()` returning an object is unusual
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:2173` (`valueOf`)
- **Impact:** Low
- **Description:** A non-primitive `valueOf` makes coercion fall through to `toString()` and rebuilds the whole query each time. Remove it or document it.

<a id="s-060"></a>
#### S-060 — Style violations per AGENTS.md
- **Area:** QueryBuilder (bool/sort/serialize)
- **Location:** `src/QueryBuilder/QueryBuilder.ts:1715-1716, 1857, 1874, 1899, 1931, 1665, 1718`
- **Impact:** Low
- **Description:**
  - `reset` uses a nested ternary.
  - `const bool: any` appears, and callbacks are typed `=> any`.
  - The inner `const field` shadows the parameter in both `sort` and `reset`.

<a id="s-061"></a>
#### S-061 — Migration completion can hang forever
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/SchemaRegistry/SchemaRegistry.ts:236` (`_migrateOne`)
- **Impact:** Low
- **Description:** `await settled` waits only for `percent === 100` progress events. `IndexManager`'s reindex poll loop doesn't detect task failures (its own `// TODO: check if there is a task error`), so a stuck or failed task leaves `completion` pending indefinitely. Consider an optional `timeout` in `SchemaMigrationParams`. Also, when one of several reindex tasks errors, `settleIfDone` settles right away and `after` status is read while the other tasks are still running.

<a id="s-062"></a>
#### S-062 — Return a typed lookup from the registry
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/SchemaRegistry/SchemaRegistry.ts:66, 310`
- **Impact:** Low
- **Description:** `indexes: IndexManager[]` erases schema generics, so `getIndexLookup()['books']` is untyped. A generic `SchemaRegistry<T extends Record<string, IndexManager<any>>>` built from a named map would keep the types.

<a id="s-063"></a>
#### S-063 — Style / cleanup
- **Area:** QueryRunner/SchemaRegistry
- **Location:** `src/SchemaRegistry/SchemaRegistry.ts:1, 9, 328-335`; `src/QueryRunner/QueryRunner.ts:58, 64-77, 119-161`
- **Impact:** Low
- **Description:** Several small cleanups:
  - In SchemaRegistry, `import { estypes }` (a value import) and `MigrationProgressDetails` are unused.
  - `getStatus` wraps an `async` arrow around an IIFE that is itself async, which is redundant.
  - The `chunkify` lane logic is duplicated three times; extract one `runLimited(items, concurrency, fn)` helper.
  - QueryRunner has about 45 lines of commented-out `mget`/`msearch`/`updateMany` code to delete.
  - `aggregations: {} as any` should be replaced with a real type, per the AGENTS.md preference.
  - tsc reports 4 errors in QueryRunner (lines 36, 224×2, 241).

