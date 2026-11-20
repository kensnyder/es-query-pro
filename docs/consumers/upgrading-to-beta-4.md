# Upgrading a consumer codebase from `es-query-pro` 3.0.0-beta.3 to 3.0.0-beta.4

These are instructions for an AI agent (or a person) changing an application
that uses `es-query-pro`. Follow the steps in order. Most of the upgrade is
code-only. **One index change may be needed:** every index whose settings use
the `englishplus` analyzer must be reindexed (step 1).

If the application is still on 3.0.0-beta.2, first follow
[`upgrading-to-beta-3.md`](./upgrading-to-beta-3.md).

## What changed, in one paragraph

beta.4 implements a code review of the whole library. `IndexManager`,
`QueryRunner` and `SchemaRegistry` now return the same envelope from every
method (`error`, `errorKind`, `response`) and never throw; several result
shapes changed. `migrateIfNeeded()` was rewritten for zero downtime: it
returns a `code` and a `completion` promise instead of relying on progress
events. `QueryBuilder` validates its input and throws `TypeError` or
`RangeError` synchronously, and several methods now send different (correct)
DSL: the default highlighter, `sort('_score')`, `dateHistogram()`,
`aggregateTerm()` ordering, `should()`/`shouldNot()`, retrievers. The
`englishplus` analyzer produces different tokens.

## Requirements

- Same as beta.3: TypeScript 5.0 or later, `@elastic/elasticsearch` 9.x.
- On Bun, give the client `Connection: HttpConnection`. With the default
  undici connection a refused connection is reported as
  `errorKind: 'javascript'` (a `TypeError`) instead of `'connection'`.

## Step 0 — Find the affected code

Run these searches in the consumer repository and keep the list of files.
Every hit needs one of the steps below.

```bash
grep -rnE "englishplus" src
grep -rnE "migrateIfNeeded|percent ?=== ?100|onComplete|onProgress" src
grep -rnE "createIfNeeded|createAliasIfNeeded|recreate\(|\.create\(|getStatus|needsMigration|needsCreation|getSiblingIndexes" src
grep -rnE "\.summary|needsCreation|aliasExists|'ERROR'|\"ERROR\"" src
grep -rnE "putBulk|\.patch\(|findById|deleteById|deleteMany|updateMany|findFirst|\.count\(|\.run\(" src
grep -rnE "recreateAll|dropAll|\.results\b|SchemaRegistry" src
grep -rnE "valueOf\(|rexgep|toPainlessSourcePath|isValidColumnName|ColumnName" src
grep -rnE "dateHistogram|aggregateTerm|missing_bucket|missing_order|aggregateHistogram|aggregateDateHistogram|aggregateGeotileGrid" src
grep -rnE "highlighterOptions|highlightField|sort\(['\"]_score|matchBoostedPhrase|weightedSemantic|knn\(|similarity" src
grep -rnE "should\(|shouldNot\(|mustNot\(|nested\(|rescore\(|sortByRandom|searchAfter|rankWindowSize" src
grep -rnE "errorKind|isEmptyObject|parseByName|timezone" src
```

Then install the new version: `bun add es-query-pro@3.0.0-beta.4` (or the
equivalent for the project's package manager) and run the type check. The
compile errors cover part of this guide; the behavior changes in step 7 do
not show up as errors.

## Step 1 — Reindex indexes that use `englishplus`

The analyzer's filter chain is now `english_possessive_stemmer, lowercase,
asciifolding, english_stop, english_stemmer`. Before, folding ran after
stemming, so `résumés` and `resumes` were indexed as different tokens, and
`John's` kept its apostrophe. Searches run with the new analyzer against an
index built with the old one miss documents.

For every `IndexManager` whose creation request has
`settings: { analysis: englishplus.analysis }` (or copies its filters),
raise `version` by one. Change nothing else in that manager.

Before:

```ts
export const booksIndex = new IndexManager(
  { client: esClient, version: 2, prefix: 'prod' },
  { index: 'books', settings: { analysis: englishplus.analysis }, mappings },
);
```

After:

```ts
export const booksIndex = new IndexManager(
  { client: esClient, version: 3, prefix: 'prod' },
  { index: 'books', settings: { analysis: englishplus.analysis }, mappings },
);
```

The next `migrateIfNeeded()` (step 2) copies the data into
`prod~english~books~v3`, re-analyzing every document, and moves the alias.
Reads and writes keep working during the copy. Do not delete documents while
it runs: a document deleted during the copy can reappear in the new index
(known limitation; repeat such deletes afterwards).

## Step 2 — Migration and boot code

### 2.1 `IndexManager.migrateIfNeeded()`

The result has a `code` and a `completion` promise that never rejects. Code
that waited for a progress event with `percent === 100`, or for
`onComplete`, must await `completion` instead: `onComplete` now fires only on
success, and `percent` reaches 100 only in the final `phase: 'done'` events.

Before:

```ts
await booksIndex.migrateIfNeeded({
  onProgress: ({ percent }) => {
    if (percent === 100) {
      startServer();
    }
  },
  onError: (error) => logger.error(error),
});
```

After:

```ts
const migration = await booksIndex.migrateIfNeeded({
  timeout: 30 * 60_000, // optional; default: no limit
  onProgress: ({ phase, percent }) => logger.info({ phase, percent }),
});
if (!migration.success) {
  // NEWER_VERSION_PRESENT, INCOMPARABLE_VERSION, ALIAS_CONFLICT: error is null
  logger.error({ code: migration.code, error: migration.error });
}
const outcome = await migration.completion;
if (outcome.success) {
  startServer();
} else {
  logger.error({ code: outcome.code, phase: outcome.phase }, outcome.error);
}
```

Codes returned at once: `CREATED`, `ALIAS_CREATED`, `CURRENT`,
`MIGRATION_STARTED`, `MIGRATION_RESUMED` (success);
`NEWER_VERSION_PRESENT`, `INCOMPARABLE_VERSION`, `ALIAS_CONFLICT`
(`success: false`, `error: null`, nothing changed); `STATUS_ERROR`,
`COUNT_ERROR`, `CREATE_ERROR`, `ALIAS_ERROR`, `REINDEX_ERROR`. Codes of
`completion`: `MIGRATED`, `REINDEX_FAILED`, `REINDEX_ERROR`, `POLL_ERROR`,
`TIMEOUT`, `SWAP_ERROR`, `VERIFY_FAILED`, or the immediate code when no
migration started.

Decide with the maintainer how the application treats
`NEWER_VERSION_PRESENT`: it means a newer deployment already migrated the
index (rolling deploy or rollback). beta.3 migrated backwards in that case;
beta.4 refuses and changes nothing.

Remove any `flush()` or alias fix-up the application did after migrating;
neither is needed.

### 2.2 `create()`, `createIfNeeded()`, `createAliasIfNeeded()`, `recreate()`

These return `{ success, code, aliasIndexes, indexResponse, aliasResponse,
request, took, error, errorKind, response }` on every path (`recreate()` adds
`dropResponse` and `flushResponse`). `error` is `null` on success, not
`undefined`: replace `result.error === undefined` and similar checks with
`result.error === null` or `result.success`.

After a version bump, `createIfNeeded()` returns `code: 'NEEDS_MIGRATION'`
with `success: false` and `error: null`, and creates nothing. If the
application calls `createIfNeeded()` at boot, call `migrateIfNeeded()`
instead (it also creates a missing index). `createAliasIfNeeded()`'s
`'ERROR'` code is now `EXISTS_CHECK_ERROR` or `ALIAS_ERROR`.

### 2.3 `getStatus()` and friends

- `summary` has new values: `unknown` (a check failed; read `error`),
  `newerVersionPresent`, `aliasConflict` and `needsAlias`. A `switch` on
  `summary` needs these cases. `needsCreation` is no longer true when a check
  fails.
- `needsMigration()` and `needsCreation()` return `boolean | null` (`null`
  when the check failed). Treat `null` as "unknown", not as `false`.
- `getSiblingIndexes()` returns an envelope. The old array is
  `result.siblings.all`.

## Step 3 — `IndexManager` and `QueryRunner` results

| Call | beta.3 | beta.4 |
| --- | --- | --- |
| `patch()` `result` on failure | `'error'` | `null`; `patch()` also sends `retry_on_conflict: 3` unless `more` sets it or `if_seq_no` |
| `putBulk()` `report` rows | varied keys, `undefined` values | `{ id, status, effect, version, error }`, `null` when unknown, one per record in order |
| `putBulk()` row errors | `success: false` | also `error` (`AggregateError`), `errorKind: 'response'`, `response: { statusCode: 200, body }` |
| `putBulk()` ids | falsy ids got a UUID | only `undefined`/`null` get a UUID; `0` is kept as `'0'`; `''` is sent and rejected by Elasticsearch |
| `findById()` missing record | an error (404) | `record: null`, `found: false`, `error: null` |
| `deleteMany()` result | raw fields | `{ success, deleted, versionConflicts, failures, request, took, error, errorKind, response }` |
| `findFirst()` nothing matched | `record: undefined` | `record: null` |
| `findMany()`/`findFirst()` error | `response: null` | `response` is the error metadata; `records: []`, `total`/`aggregations: null`, `request: null` when nothing was sent |
| `findMany()` `aggregations` absent | `undefined` | `null` |
| `findMany()` `took` | Elasticsearch's `took` | wall-clock ms; Elasticsearch's is `response.took` |
| `count()` with retrievers | rejected promise | `{ total: null, error }`, nothing sent |
| `updateMany()` | raw response, could throw | envelope `{ success, updated, total, versionConflicts, noops, failures, ... }`, never throws |
| `findFirstOrThrow()` request error | thrown as a `NotFoundError` | the request's own error is thrown (`ResponseError`, `ConnectionError`, builder errors); not found is still `name: 'NotFoundError'`, `status: 404` (type `QueryNotFoundError`) |

`updateMany(values, more?)` changes:

- Keys are checked against the mapping at run time. An unknown key, a
  sub-field (`title.raw`), a key inside another key (`publishing` with
  `publishing.year`) or empty values return an error envelope and send
  nothing. Fix the call; do not catch it.
- `conflicts` defaults to `'proceed'` (conflicting documents are counted in
  `versionConflicts`). Pass `conflicts: 'abort'` to keep the old behavior.
- `limit()` on the builder becomes `max_docs`. A builder that called an
  `aggregate*` method has `limit(0)` and is refused; build a separate
  builder for the update.
- `QueryRunner.toPainlessSourcePath()` is removed; there is no replacement
  (field names are no longer part of the script).

Type changes: the `more` parameters of `put`, `patch`, `findById`,
`deleteById`, `deleteMany` and `count` no longer accept the keys the method
sets (`index`, `id`, `doc`, `document`, `query`); `count()` rejects
search-only keys such as `size` and `sort`. `IndexErrorShape` is now the
object `{ error, errorKind, response }`. `IndexErrorKind` has four more
members (`aborted`, `serialization`, `product`, `configuration`): add them to
any exhaustive `switch`.

## Step 4 — `QueryBuilder`

### 4.1 Compile errors and renamed calls

| beta.3 | beta.4 |
| --- | --- |
| `qb.valueOf()` | removed; use `qb.getQuery()` |
| `qb.rexgep(...)` | `qb.regexp(...)` (same arguments; `rexgep` still works but is deprecated). The positional form is now case-insensitive by default; pass `{ caseSensitive: true }` to keep exact case |
| `qb.dateHistogram(field, interval, timezone)` or `{ ..., limit }` | `qb.dateHistogram({ field, interval, timeZone?, offset?, name?, extendedBounds? })`; `limit` throws |
| `aggregateTerm({ ..., missing_bucket, missing_order })` | `aggregateTerm({ ..., missing: '(none)' })` |
| `knn({ ..., similarity: 'cosine' })` | `similarity` is a number (minimum similarity, e.g. `0.8`) |
| `weightedSemantic({ ..., boosts: [a, b, c, d] })` | three boosts `[contains, phrase, match]` (default `[6, 4, 1]`) |
| `sort({ _score: 'desc' })` read back from `getSort()` | stored as `{ _score: { order: 'desc' } }` |

### 4.2 Response shapes

`dateHistogram()` now sends a plain `date_histogram` with `min_doc_count: 0`.
Update code that reads its buckets:

Before:

```ts
const buckets = result.aggregations.published_at.buckets;
// [{ key: { published_at: '2024-01' }, doc_count: 3 }, ...] (non-empty only)
const label = buckets[0].key.published_at;
```

After:

```ts
const buckets = result.aggregations.published_at.buckets;
// [{ key: 1704067200000, key_as_string: '2024-01', doc_count: 3 }, ...]
// every interval between the first and last document, including empty ones
const label = buckets[0].key_as_string;
```

`aggregateTerm()` ordered by a field other than `_count`, `_key` or the
aggregated field adds a sub-aggregation named `__order_<i>` to each bucket.
Ignore that key when rendering buckets.

### 4.3 Calls that now throw

`QueryBuilder` throws a `TypeError` or `RangeError` for input it used to send
to Elasticsearch (which then failed or returned nothing). For each call site
that builds from user input, check that values are validated first or that
the error is handled (inside `IndexManager` callbacks the error comes back as
an envelope with `errorKind: 'javascript'`):

- `limit()` (integer >= 0), `page()` (integer >= 1), `minScore()`,
  `trackTotalHits()` (`-1` is rejected; use `false`), `rankWindowSize()`,
  `rankConstant()` (integers >= 1).
- `term()` with `undefined`, `null`, an array or an object; `range()` with an
  unknown operator, `NaN`, an invalid `Date`, `between` with min > max, or a
  `Date` with a non-ISO `format`.
- Time zones `EST`, `MST`, `HST`, `ROC`, wrong-case names
  (`america/denver`), offsets beyond ±18:00; date histogram offsets `+1w`,
  `+1M`, `+1q`, `+1y`.
- `should()`/`shouldNot()` with a numeric `minimumShouldMatch` that is not an
  integer or exceeds the number of branches.
- A sub-builder callback (`should`, `shouldNot`, `mustNot`, `filter`,
  `nested`) that sets anything other than conditions (sort, limit, fields,
  aggregations, retrievers, ...). Move those calls to the outer builder.
- `getBody()`/`getQuery()`: retrievers combined with `sort()`,
  `searchAfter()`, `sortByRandom()` or score functions; rescore combined with
  any sort other than `_score` descending; `searchAfter()` with
  `page() > 1`; an explicit `rankWindowSize()` below `limit()` with rrf or
  linear retrievers.

## Step 5 — `SchemaRegistry`

| beta.3 | beta.4 |
| --- | --- |
| `migrateIfNeeded()` → `{ acknowledged, error, completion }` | adds `errorKind`; `acknowledged: false` also for an invalid `timeout` |
| `SchemaMigrationReport` | adds `code`, `migration`, `errorKind`; `before` is the migration's own status |
| `recreateAll()` threw for an empty registry; `summary` always `'SUCCESS'` | envelope; `report: SchemaRecreateReport[]`; `summary` holds each `recreate()` code or `'ERROR'` |
| `getStatus()` | `report: StatusReport[]`, `summary: Record<string, StatusSummary>`, `success` false when any status has an error |
| `dropAll()` → `results` | renamed `report` (`SchemaDropReport[]`); `summary` is `DROPPED`, `MISSING` (success) or `ERROR` |
| registering two versions of one alias was allowed | throws an `Error` at registration |

Every operation returns `{ success, took, report, summary, error, errorKind }`
(`SchemaFleetResult`). Replace `result.results` with `result.report`.
`dropAll()` still drops every registered index without confirmation; that is
unchanged and intentional.

## Step 6 — `IndexNameManager`, utilities and types

- `new IndexManager()` throws a `RangeError` for a prefix or language with
  uppercase letters, an empty language, a negative or fractional version, or
  a full name Elasticsearch would reject. If the application builds the
  prefix from `NODE_ENV` or similar, lowercase it. Names Elasticsearch
  accepted are still accepted, except a name starting with `.` and a part
  that contains the separator.
- `IndexNameManager.parseByName()` throws for names it could not have made
  and returns integer versions as numbers (`3`, not `'3'`). Use
  `tryParseByName()` for a `null` instead of an exception.
- `isValidColumnName()` and the `ColumnName` type are removed.
- `isEmptyObject()` returns `false` for arrays, Dates, Maps, Sets and class
  instances. Check call sites that passed such values.
- New exported types replace local copies the application may have written
  (`StatusSummary`, `MigrationResult`, `MigrationOutcome`, `IndexRecordId`,
  `SortClause`, `RangeOptions`, ...). See the CHANGELOG for the full list.

## Step 7 — Behavior changes to check

These compile unchanged but return different results. Check each one that
step 0 found and decide with the maintainer whether the new behavior is
acceptable; most are fixes.

1. **Highlighting** uses the `unified` highlighter by default (was `fvh`).
   Highlight fragments can differ slightly. `highlighterOptions()` now
   merges into the current options instead of replacing them.
2. **Blank phrases** (`''`, whitespace, `null`, `undefined`) add nothing in
   the match family, `containsExact`, `simpleQueryString`, `semantic`, `rrf`
   and `weightedSemantic`: an empty search box now returns every document
   instead of none. Add an explicit check where an empty search must return
   nothing.
3. **`sort('_score')`** sorts best match first (was ascending).
4. **`page()` without `limit()`** pages by 10 hits.
5. **`matchBoostedPhrase()`** default boosts are exact 5, and 3, or 1: exact
   phrase matches now rank first.
6. **`should()` with one non-empty branch** requires all of that branch's
   conditions. **`shouldNot()`** with one multi-condition branch excludes
   only documents matching all of them. Empty branches are ignored.
7. **`nested()`** no longer sends default `score_mode`, `inner_hits` or
   `ignore_unmapped`; pass them if the application relied on inner hits.
8. **A lone retriever with conditions** (e.g. `knn()` plus `term()`) applies
   the conditions as the retriever's own filter, and scores are no longer
   min-max normalized. Without `rankWindowSize()`, the rank window grows to
   cover the requested page; with no `limit()`, an rrf or linear search
   returns up to `rank_window_size` hits.
9. **`aggregate*` helpers** no longer override a `limit()` the application
   set; they set `limit(0)` only when no limit was set.
10. **`deleteMany()`** with a builder that has only retrievers returns an
    error and deletes nothing. Without conditions it still deletes every
    document.
11. **`flush()`** flushes the versioned index, so it works before the alias
    exists. `drop()` no longer removes the alias separately (Elasticsearch
    removes it with the index).
12. **Migration deletes:** see step 1.

## Step 8 — Verify

1. Type check, lint and the test suite pass.
2. The searches from step 0 return nothing for `valueOf(`, `rexgep`,
   `toPainlessSourcePath`, `isValidColumnName`, `missing_bucket`,
   `percent === 100` and `.results` on a `dropAll()` result.
3. Against a non-production cluster with a copy of the data:
   - run the application's boot path; `migrateIfNeeded()` returns
     `MIGRATION_STARTED` for each index from step 1 and `CURRENT` for the
     others, and every `completion` resolves with `MIGRATED` or the
     immediate code;
   - `getStatus()` reports `summary: 'current'` for every index afterwards;
   - searches with accented words or possessives (`résumé`, `John's`) find
     the documents they should.
4. Every `switch` on `errorKind`, `summary` or a result `code` handles the
   new values.

## Report back

When finished, tell the maintainer:

- every file changed;
- every index whose `version` was raised for `englishplus`, with old and new
  full names;
- how the application now handles `NEWER_VERSION_PRESENT`,
  `INCOMPARABLE_VERSION` and `ALIAS_CONFLICT` at boot;
- every behavior change from step 7 that affects the application, and
  whether it was accepted or worked around;
- any `QueryBuilder` call that now throws for real user input, and how it
  was handled;
- whether step 8.3 was run against a real cluster.
