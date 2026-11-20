# Plan — implement the 2026-11-19 `src/` code review

**Date:** 2026-11-20
**Source:** [`docs/reports/2026-11-19-src-code-review.md`](../reports/2026-11-19-src-code-review.md) (108 bugs `B-001…B-108`, 63 suggestions `S-001…S-063`)
**Executors:** one orchestrator session plus Opus subagents (`Agent` tool, `model: "opus"`), one subagent per task below.
**Status:** implemented on branch `mega-review-fixes` (2026-11-20). All 25 tasks are committed; the final gate passed on serverless and on stateful ES 9.1.10. Handoff notes are in `docs/plans/2026-11-20-handoff/`. The decisions in section 2 were confirmed by the maintainer on 2026-11-20.
**Revised:** 2026-11-20, after [`2026-11-20-index-manager-create-request.md`](./2026-11-20-index-manager-create-request.md) was implemented (its decision D7). That work deleted `SchemaManager` and `getEsClient`, replaced the string schema with an `estypes.IndicesCreateRequest`, and fixed several findings along the way. Findings and task parts that no longer have code were removed from this plan; section 8.3 lists each one and why.

Every remaining finding is assigned to exactly one owning task (a few are split across two tasks, each part named). Section 8 is the coverage matrix.

### What the report describes that no longer exists

The report was written against the old code. When a finding's text mentions any of the following, read it with the current code in mind:

| The report says | Current code |
|---|---|
| `new IndexManager({ index, schema, properties, settings, analyzer, client })` | `new IndexManager(options: ManageOptions, create: estypes.IndicesCreateRequest)`; `client` is required. |
| `this.schema`, `SchemaManager`, `SchemaShape` | `this.createSpec` (the creation request as passed); `getAllFields` / `getFulltextFields` in `src/mappingFields/mappingFields.ts`. |
| `ElasticsearchRecord<ThisSchema>` | `MappingRecord<Create>` (`src/mappingFields/mappingTypes.ts`); search hits are `QueryRecord<Create>`. |
| `getEsClient()` | Gone from the library. Tests use `getTestClient()` in `src/testFixtures/testClient.ts`. |
| `errors.ResponseError` / `instanceof` checks | Classification by the error's `name`; library code imports `@elastic/*` as types only (enforced by `src/typesOnlyImports.spec.ts`). |
| Untyped `QueryBuilder` | `QueryBuilder<Field extends string = string>`; `IndexManager` hands callbacks a builder typed with the mapping's field paths. |

---

## 1. How the work is organized

### 1.1 Constraints this plan is built around

| Constraint | How the plan meets it |
|---|---|
| No two subagents edit the same file at the same time | Every task lists the files it **owns**. Tasks that run in parallel have disjoint ownership. The two big files (`IndexManager.ts`, `QueryBuilder.ts`) are each a **lane**: their tasks run strictly one after another. |
| No context rot | Each task covers 5–13 related findings in one region of one source file. A subagent reads only its own findings in the report (by ID), its region of the source file, and the handoff notes of its direct dependencies. Each task is a fresh subagent. |
| Focus on integration tests | Every task ships a new `*.integration.test.ts` file that runs against real Elasticsearch. Findings whose ES behavior the review did not verify must be **reproduced against a real server before being fixed** (section 3.3). A final task adds cross-module end-to-end scenarios. |

### 1.2 Lanes and waves

A lane advances as soon as its previous task passes the gate (section 5); lanes do not wait for each other except where a dependency is listed.

```
Wave 0   P0-A ──► P0-B                               (sequential, repo-wide)
Wave 1   F1 ║ F2 ║ F3                                (parallel, disjoint files; F1 is now small)
Wave 2+  IndexManager lane:  IM1 ► IM2 ► IM3 ► IM4 ► IM5
         QueryBuilder lane:  QB1 ► QB2 ► QB3 ► QB4 ► QB5 ► QB6 ► QB7 ► QB8 ► QB9
         (the two lanes run in parallel with each other)
After IM5:          SR   (SchemaRegistry)            parallel with the QB lane
After IM5 and QB1:  QR   (QueryRunner)               parallel with the QB lane and SR
Last     DOCS ║ E2E                                  (after every task above)
Final    orchestrator verification
```

Maximum parallelism is three subagents (F1/F2/F3, or QB-lane + SR + QR).

### 1.3 File ownership rules (apply to every task)

1. A task edits **only** the files in its "Owns" list. Anything else it needs changed goes in its handoff note for the owning task or for DOCS.
2. Three files are edited by exactly one task each, to remove any chance of collision:
   - `src/types.ts` → **F1** only. Later tasks declare new types in their own source file.
   - `index.ts`, `README.md`, `CHANGELOG.md`, `AGENTS.md`, `ROADMAP.md`, `src/publicExports.spec.ts`, `src/readmeSamples.spec.ts` → **DOCS** only. `publicExports.spec.ts` pins the exact export list and `readmeSamples.spec.ts` compiles every README sample, so a task that needs a new export or a README change leaves it in its handoff note.
   - `package.json`, `.github/workflows/tests.yml`, `src/testFixtures/*` → **P0-A / P0-B** only (DOCS may touch `package.json` for the `exports` map, after everything else is done).
3. New tests go in **new files named for the task's topic**, e.g. `src/QueryBuilder/QueryBuilder.sort.spec.ts` and `src/QueryBuilder/QueryBuilder.sort.integration.test.ts`. This keeps test files small and gives each task its own.
4. The pre-existing test files (`QueryBuilder.spec.ts`, `QueryBuilder.fields.spec.ts`, `IndexManager.spec.ts`, `IndexManager.fields.spec.ts`, `SchemaRegistry.spec.ts`, and the two existing integration tests) belong to their lane. The active lane task may edit them, but only to correct assertions that lock in a bug it is fixing (e.g. B-045, B-048).
5. Subagents never run git write commands (`add`, `commit`, `stash`, `checkout`). The orchestrator commits after each task passes its gate, staging only that task's owned files.
6. Locate code by **method name**, not by the line numbers in the report. P0-A reformats `QueryBuilder.ts`, and every lane task shifts lines for the next one.
7. **Keep typed field names working.** In `QueryBuilder`, a parameter that names one concrete field is typed `Field`, callbacks receive `QueryBuilder<Field>`, and `clone()` returns `QueryBuilder<Field>`. New or changed methods (for example `filter`, `regexp`, `normalizer`) follow the same rule, and `QueryBuilder.fields.spec.ts` and `IndexManager.fields.spec.ts` must keep passing. No library file may import `@elastic/*` at runtime (`src/typesOnlyImports.spec.ts`).
8. `src/mappingFields/*` is not owned by any task. A task that needs a change there says so in its handoff note.

---

## 2. Decisions

The review leaves several design choices open. The maintainer confirmed the decisions below on 2026-11-20. The package is at `3.0.0-beta.2`, so breaking changes are acceptable; each one must be recorded in the task's handoff note for the CHANGELOG.

| # | Finding(s) | Decision |
|---|---|---|
| D1 | S-003, B-002, B-037, B-083 | **Migration design deviates from S-003 steps 3–4.** Reindex into a new index that is *not yet in the alias*, using `dest.version_type: 'external'`; run a catch-up pass; swap the alias in one atomic `updateAliases`; run a final catch-up; verify; then remove the old index. Reads, `findById`, `put` and `patch` keep working against the old index for the whole reindex, re-running is idempotent, and a crash leaves a consistent state. Do not implement S-003's steps 3–4 as the report writes them (new index becomes the write index first, `op_type: 'create'`): that still has duplicate reads, failing `findById` and failing `patch` during the reindex. Full detail in task IM5. |
| D2 | B-002 (deletes) | Deletes made on the old index during the reindex window can reappear in the new index. This is **documented as a known limitation**; there is no tombstone mechanism. |
| D3 | B-012, B-044 | The library no longer generates mappings, so only the query side remains. Default highlighter becomes `unified` (it needs no term vectors). `weightedSemantic`'s contains clause targets a configurable `exactField`, defaulting to `${standardField}.raw` as today; the README states that the mapping must declare that keyword sub-field. |
| D5 | S-019, S-057 | Filter context is **opt-in**: new `filter(cb)` method that puts the callback's clauses in `bool.filter`. Existing methods keep emitting `bool.must`. On the retriever path, `must` clauses remain filters (required so that non-matching docs stay excluded); this is documented. |
| D6 | B-034, S-032 | **No confirmation and no warning**, matching Elasticsearch itself, where `_delete_by_query` with `match_all` and `DELETE /<index>` run without a guard. `deleteMany()` with no callback, or with a builder that has no conditions, deletes every document. `SchemaRegistry.dropAll()` drops every registered index. Both behaviors are stated in the JSDoc and README. Two parts of the findings remain: `deleteMany()` returns an error envelope when the builder produces no `query` (a retriever-only builder), since the server rejects that request; and `dropAll()` documents that it drops only `getFullName()`, leaving older versioned indexes in place. |
| D8 | S-010 | The package **stays ESM-only**. No CJS build is added. AGENTS.md is corrected where it says "dual ESM/CJS" and where it lists `cjs` in the build steps. |
| D9 | B-054 | Composite helpers gain an `after` option. `dateHistogram()` switches to a plain `date_histogram` with `min_doc_count: 0` (response shape changes). |
| D10 | B-018 | `count()` on a builder with retrievers returns `{ total: null, error }` saying retrievers are unsupported. |
| D11 | B-040, B-058, S-021, S-027 | `getBody()` raises `rank_window_size` to cover `from + size` unless the caller set it explicitly, and **throws a descriptive error** for combinations ES rejects (retriever with `min_score`/`search_after`/`sort`, rescore with a non-`_score` sort). Rescore on the retriever path uses the `rescorer` retriever if the server accepts it. |
| D12 | S-059 | Remove `QueryBuilder.valueOf()`. |
| D13 | S-003 scope | The migration implementation moves to a new internal module `src/IndexManager/migrate.ts`; `IndexManager.migrateIfNeeded()` stays as the public entry point and delegates. This keeps `IndexManager.ts` readable and the migration unit-testable. |

D4 and D7 were removed with the code they concerned (automatic `nested` mapping; `ES_VERSION` in `getEsClient`). The remaining numbers are unchanged so references elsewhere still hold.

Convention used throughout: **`QueryBuilder` throws synchronously** (`RangeError`/`TypeError`) on invalid input; **`IndexManager`, `QueryRunner` and `SchemaRegistry` never throw** and convert everything, including builder errors, into the `{ …, error, errorKind }` envelope.

---

## 3. Testing strategy

### 3.1 Test targets

- **Local (current `.env`)**: a remote Elastic Cloud **Serverless** project, authenticated by API key (`ES_SERVERLESS="true"`). It is shared by every subagent running at once.
- **CI**: Elasticsearch 9.1 in Docker, basic license, security off (`.github/workflows/tests.yml`).
- **P0-B adds** a `docker-compose.yml` for a local stateful ES 9.1 with a trial license, so behavior that differs between serverless and stateful (flush, `_tasks`, index settings, license-gated retrievers) can be checked on both. Wave gates should run the integration suite against both targets when Docker is available.

### 3.2 Rules for integration tests

1. Import the shared kit from `src/testFixtures/esTestKit.ts` (built in P0-B). Do not construct ad-hoc clients or naming schemes.
2. Every index a test creates uses the kit's unique per-file run prefix. **Never delete by a wildcard wider than that prefix** — the cluster is shared with other running subagents. The existing `afterAll` that deletes `test~english~books_*` is replaced in P0-B.
3. Clean up in `afterAll` through the kit, including after failures.
4. No fixed sleeps. Use `refresh: true`/`wait_for` on writes and the kit's `waitFor()` poll helper for asynchronous server state.
5. Gate tests on capabilities, not on environment names: `kit.caps.serverless`, `kit.caps.tasksApi`, `kit.caps.retrievers` (rrf/linear license), `kit.caps.inference` (a usable inference endpoint for `semantic_text`). Use `test.skipIf(!caps.x)` and log one line saying what was skipped and why. A capability-gated test must run on at least one of the two targets.
6. Assert on **server behavior** (documents returned, order, counts, bucket keys, error type), not just "no error". For every DSL-shape fix there is one integration test showing ES accepts the new shape and returns the right result.
7. Run only your own test files while working (`bun test <path>`); the orchestrator runs the full suite at gates.

### 3.3 Reproduce-first findings

The review marks these as unverified against a live server ("from knowledge", Medium confidence). For each one, the owning task **first writes an integration test that demonstrates the bug on real ES**, then fixes it. If the server does not behave as the report says, do not change the code; record what was observed in the handoff note.

`B-002, B-011, B-013, B-017, B-029, B-037, B-040, B-044, B-046, B-047, B-049, B-050, B-058, B-072, B-083`

### 3.4 Unit tests

- Pure logic and request shapes go in `*.spec.ts` using the shared recording/stub client from `src/testFixtures/recordingClient.ts` (it already exists; P0-B extends it to script per-request responses and thrown errors).
- Every finding gets at least one unit test that fails before the fix. Error paths that cannot be provoked on a real server (connection errors, timeouts, 5xx, task failures, duplicate client copies) are covered with the stub client.
- Type-level findings get type tests (`expectTypeOf` from `bun:test`, plus `@ts-expect-error` assertions checked by `bun run typecheck`). The existing type-level specs (`mappingTypes.spec.ts`, `QueryBuilder.fields.spec.ts`, `IndexManager.fields.spec.ts`) show the pattern.

---

## 4. Tasks

Each task block lists: dependencies, owned files, findings, notes that are not obvious from the report, and the integration tests required. Unit tests for every listed finding are always required and are not repeated per task.

### Wave 0 — groundwork (sequential)

#### P0-A — Formatting and typecheck baseline
- **Depends on:** nothing. Runs alone; touches most files mechanically.
- **Owns:** every file changed by `bun run format:write`; `package.json`.
- **Findings:** B-093, S-034 (formatting part only).
- **Work:**
  1. Run `bun run format:write`; confirm `bun run format:check` and `bun test` (unit specs) still pass. No hand edits.
  2. Add scripts: `test:unit`, `test:integration` (verify the `bun test` path filters select the right files). `typecheck` already exists.
  3. Record the baseline `tsc` error count per file in the handoff note. At the time of this revision it is 11 errors under TypeScript 7.0.2: `QueryBuilder.ts` 6, `IndexNameManager.spec.ts` 3, `IndexNameManager.ts` 1, `isEmptyObject.spec.ts` 1. Later tasks must bring their owned files to zero errors and add none elsewhere.
- **Integration tests:** none.

#### P0-B — Integration harness and fixtures
- **Depends on:** P0-A.
- **Owns:** `src/testFixtures/*` (including new `esTestKit.ts` and the existing `testClient.ts`, `recordingClient.ts`, `books.ts`), `docker-compose.yml`, `.github/workflows/tests.yml`, `src/IndexManager/IndexManager.integration.test.ts`, `src/QueryBuilder/QueryBuilder.integration.test.ts`.
- **Findings:** B-076 (remaining parts: `price` is mapped `integer` but the data has decimals; `insertBooksData` uses `body:` instead of `operations:`. The schema parts are gone with `getBooksSchema`).
- **Work:**
  1. `esTestKit.ts`: unique run prefix, `makeIndex()` that registers indexes for cleanup, `cleanup()`, `waitFor()`, and capability detection (section 3.2 rule 5). The client comes from the existing `getTestClient()`; do not add a second factory.
  2. `recordingClient.ts`: keep `getRecordingClient()` as it is and add per-route scripted responses and scripted errors (`ResponseError` with status/type, `ConnectionError`, `TimeoutError`). Errors are classified by `name`, so scripted errors may be plain objects with the right `name`.
  3. Fix the books fixture (B-076) and add fixtures later tasks need, as creation requests like `getBooksCreateRequest()`: a `dense_vector` field, a nested object, a geo point, and a `semantic_text` field behind `caps.inference`.
  4. Port the two existing integration tests to the kit without changing what they assert (fix the mislabeled `describe` in the IndexManager one).
  5. `docker-compose.yml` for ES 9.1 single node with a trial license; set the same license option in the CI service so retriever tests run in CI.
- **Integration tests:** a kit self-test (create, write, read, cleanup leaves nothing behind; capability flags have sensible values on the current target).

### Wave 1 — foundations (parallel)

#### F1 — Shared types
- **Depends on:** P0-B.
- **Owns:** `src/types.ts`, new `src/types.spec.ts`.
- **Findings:** B-079, S-048 (the `RangeShape` type only).
- **Notes:** This task is small now that `SchemaManager` and the string-schema types are gone. It exists so that `src/types.ts` has one owner: pre-declare here the types later tasks need so they never have to edit this file (widened `RangeShape`, corrected `IndexExistParams`). The error-kind union already exists as `IndexErrorKind` in `IndexManager.ts`; IM1 extends it there.
- **Integration tests** (`types.integration.test.ts`): `exists()` accepts the index-exists options the corrected `IndexExistParams` allows (for example `flat_settings`) against a real server.

#### F2 — IndexNameManager
- **Depends on:** P0-B.
- **Owns:** `src/IndexNameManager/*`.
- **Findings:** B-024, B-025, B-067, B-075, S-011 (naming part).
- **Notes:** Add a static helper that compares two parsed names (same prefix/language/name, numeric version order); IM4 uses it for B-008.
- **Integration tests** (`IndexNameManager.integration.test.ts`): a table of names. Every name the validator accepts can be created on the server; a sample of names it rejects are also rejected by the server.

#### F3 — Analyzer and utilities
- **Depends on:** P0-B.
- **Owns:** `src/analyzers/*`, `src/normalizeTimeZone/*`, `src/isEmptyObject/*`, `src/isDefined/*`, plus new spec files beside each.
- **Findings:** B-072, B-073, B-074, S-034 (behavior part), S-035, S-011 (utility part: `englishplus`, `isDefined`, `isEmptyObject`).
- **Integration tests:**
  - `englishplus.integration.test.ts`: create an index with the analyzer and use `_analyze` to show `résumés` and `resumes` produce the same token, and possessives are stripped (reproduce-first for B-072).
  - `normalizeTimeZone.integration.test.ts`: every form the function accepts is accepted by a real `date_histogram` `time_zone`.

### IndexManager lane (sequential)

All tasks own `src/IndexManager/IndexManager.ts` plus their own new test files. Each reads only the methods named.

#### IM1 — Error envelope, existence and metadata
- **Depends on:** F1.
- **Methods:** `_formatError`, `_formatNonError`, `isApiNotAvailable`, `exists`, `aliasExists`, `getIndexMetadata`, `getAliasMetadata`, `flush`.
- **Findings:** B-007, B-077, S-001, S-037, S-038, S-039, S-040 (these methods), S-002 (these methods).
- **Notes:** Parts of these are already done; do only what remains.
  - B-007: the catch in `aliasExists` now reads `meta` safely. Remaining: remove the `console.log`, return `_formatError(e)` for non-404 errors, and make `drop()` not reject.
  - S-001: `IndexErrorKind` and the declared return type exist. Remaining: classify `RequestAbortedError`, `SerializationError` / `DeserializationError`, `ProductNotSupportedError` and `ConfigurationError` (by `name`) and add the matching kinds to the union.
  - S-037: `StatusReport` is typed. Remaining: `IndexRunShape`.
- **Integration tests** (`IndexManager.metadata.integration.test.ts`): `exists`/`aliasExists` true and false cases; `getIndexMetadata` on a healthy index; `getAliasMetadata` for no alias, one index, and a nonexistent `more.index`; `flush` after `createOnly()`; a real 404 and a real 400 classify as `errorKind: 'response'`; a client pointed at a closed port yields `errorKind: 'connection'` without throwing.

#### IM2 — Create, drop and alias lifecycle
- **Depends on:** IM1.
- **Methods:** `getCreateRequest`, `createOnly`, `create`, `drop`, `recreate`, `createAlias`, `dropAlias`, `createIfNeeded`, `createAliasIfNeeded`.
- **Findings:** B-006, B-029, B-030, B-031, B-078, B-080, S-040 (these methods), S-002 (these methods).
- **Notes:** B-029: `createIfNeeded()` must not attach the alias to a second index; when the alias already points at an older version it returns a `NEEDS_MIGRATION` code and leaves the alias alone.
- **Integration tests** (`IndexManager.lifecycle.integration.test.ts`): `drop()` reports success when the alias existed; two concurrent `createIfNeeded()` calls both succeed; `createIfNeeded()` after a v1→v2 bump leaves the alias on v1 only (reproduce-first B-029); alias repaired when the index exists without it; `recreate()` leaves an empty, aliased index; envelope keys identical on every path.

#### IM3 — CRUD
- **Depends on:** IM2.
- **Methods:** `put`, `putBulk`, `patch`, `findById`, `findMany`, `findFirst`, `count`, `deleteById`, `deleteMany`.
- **Findings:** B-033, B-034, B-039, B-085, B-086, B-087, S-014, S-015, S-016, S-017 (CRUD part), plus the `IndexManager.count()` `more` type change from B-017.
- **Notes:** Decision D6. B-086: `record` is already typed `MappingRecord<Create> | null`; the envelope and not-found parts remain. B-039: the id is now `id ? String(id) : crypto.randomUUID()`, which still replaces `0` and `''`.
- **Integration tests** (`IndexManager.crud.integration.test.ts`): `putBulk` with id `0` and `''`, generated ids returned, empty array, a batch larger than the chunk size, and a batch with one bad document (aggregated error, good rows stored); `patch` reporting `noop` and `created`; `findById` hit and miss; `put`/`deleteById` with `refresh` and `if_seq_no`; `deleteMany` honoring `conflicts`/`refresh`, deleting every document when called with no callback, and returning an error envelope (nothing deleted) for a retriever-only builder; a throwing builder callback returns an envelope.

#### IM4 — Status
- **Depends on:** IM3, F2.
- **Methods:** `getStatus`, `needsCreation`, `needsMigration`, `getSiblingIndexes`.
- **Findings:** B-035, B-038, B-008 (classifying siblings as older / newer / unrelated), S-041, S-017 (status part).
- **Notes:** `StatusReport` gains `error`, `errorKind`, a `summary: 'unknown'` state, and the sibling classification IM5 needs. Keep this task small; it is the interface IM5 builds on.
- **Integration tests** (`IndexManager.status.integration.test.ts`): status for no index, current index, index without alias, alias on an older version, alias on a newer version, alias on an unrelated index; unreachable cluster reports `unknown`, not `needsCreation`.

#### IM5 — Zero-downtime migration
- **Depends on:** IM4.
- **Owns additionally:** new `src/IndexManager/migrate.ts` (D13).
- **Findings:** B-001, B-002, B-008 (refuse downgrades), B-009, B-010, B-032, B-036, B-037, B-082, B-083, B-084, S-003, S-004, S-061 (IndexManager side), S-017 (migration part).
- **Design (D1):**
  1. Abort if `status.error` is set. Return `NEWER_VERSION_PRESENT` if the alias holds a newer version. Ignore unrelated indexes.
  2. Fresh creation and "current" branches: create what is missing, including the alias (B-009, B-036).
  3. `createOnly()` the new index; "already exists" means resume. Look for a running reindex into it and attach instead of starting another (B-010). Fall back cleanly where the tasks API is unavailable.
  4. Reindex old → new with `version_type: 'external'`, `conflicts: 'proceed'`, `wait_for_completion: false`. Poll with retry/backoff, `maxPollErrors` and `timeout` (B-032).
  5. On completion check `error` and `failures`; on failure call `onError`, keep the old index and alias, and leave the new index for inspection (B-001).
  6. Catch-up pass, then one atomic `updateAliases` (remove old, add new with `is_write_index`), then a final catch-up pass.
  7. Verify counts, remove the old index, delete the task result document.
  8. Return `completion: Promise<MigrationOutcome>`; `onComplete` fires only on success, including for an empty source (B-082). Options: `timeout`, `maxPollErrors`, `slices`, `requestsPerSecond`. No `console.log`.
- **Integration tests** (`IndexManager.migration.integration.test.ts`) — the most important file in the plan. Use `requestsPerSecond` to hold a reindex open where a test needs to act mid-flight.
  - v1 → v2 with data: all documents present, alias on v2 only, v1 gone, `completion` resolves.
  - Reindex with failures (v2 mapping rejects some v1 documents): old index and alias untouched, `onError` called, `completion` reports failure.
  - During a throttled reindex: `findById`, `findMany` and `count` return correct, non-duplicated results; `put` of a new doc, `put` over an existing doc and `patch` all succeed and are present with the new values after completion (reproduce-first B-002, B-037, B-083).
  - Delete during the reindex: assert and document the D2 limitation.
  - Running `migrateIfNeeded` a second time mid-flight attaches or resumes; exactly one final copy of each document.
  - A v1 manager run against an alias on v2 changes nothing and returns `NEWER_VERSION_PRESENT`.
  - Fresh creation returns `success: true`; index-without-alias is repaired; empty old index migrates and fires `onComplete`.
  - `timeout` expiry leaves a consistent, resumable state.
  - Stub-client unit tests cover poll errors, task cancellation and swallowed-delete paths that cannot be forced on a real server.

### QueryBuilder lane (sequential)

All tasks own `src/QueryBuilder/QueryBuilder.ts` plus their own new test files. Each task's integration file is `QueryBuilder.<topic>.integration.test.ts` and runs the built query through a real search.

#### QB1 — Config, source filtering and highlighting
- **Depends on:** F1.
- **Methods:** `fields`/`sourceIncludes`, `excludeFields`/`sourceExcludes`, `highlighterOptions`, `highlightField`, `getHighlighter`, `rankWindowSize`, `rankConstant`, `minScore`, `searchAfter` (setter), `trackTotalHits`, and how `_source` is emitted in `getQuery`/`toKibana`.
- **Findings:** B-011, B-044, B-090, B-095 (config methods), S-043, S-044, S-049, S-020 (these methods).
- **Integration tests** (`…source.integration.test.ts`): `fields` + `excludeFields` together return exactly the included fields minus the excluded (reproduce-first B-011); `fields([])` returns no source; default highlighter works on a text field, its sub-fields and a keyword field (reproduce-first B-044).

#### QB2 — Range and match family
- **Depends on:** QB1.
- **Methods:** `range`, `match`, `matchPhrase`, `matchPhrasePrefix`, `matchBoostedPhrase`, `multiMatch`, `escapeWildcards`.
- **Findings:** B-045, B-091, B-095 (match methods), S-042, S-045, S-047, S-048 (implementation), S-020 (these methods).
- **Integration tests** (`…match.integration.test.ts`): `matchBoostedPhrase` ranks an exact-phrase document above an all-words document above an any-word document; `range` with `Date`, numbers, open-ended `between`, and options (`format`, `time_zone`); blank phrase behaves as no condition; `matchPhrase` options accepted.

#### QB3 — Term-level queries
- **Depends on:** QB2.
- **Methods:** `term`, `wildcard`, `containsExact`, `rexgep`/`regexp`, `queryString`, `moreLikeThis`, `termsSet`.
- **Findings:** B-049, B-052, B-099 (JSDoc for these methods), B-100, S-005, S-024, S-050, S-051, S-025 (these methods).
- **Integration tests** (`…term.integration.test.ts`): `termsSet` with each minimum-match form (reproduce-first B-049); `regexp` in both call forms with the same case behavior, plus `flags`; `term` with `caseSensitive: false`; `queryString` options and `simpleQueryString` tolerating bad syntax; `moreLikeThis` with multiple fields.

#### QB4 — Rescore and terms aggregation
- **Depends on:** QB3.
- **Methods:** `rescore`, `getRescore`, `aggregateTerm`, `includeFacets`, `aggs`, `getAggs`.
- **Findings:** B-003, B-013, B-046, B-047, B-053, B-097 (aggs/rescore getters and setters), B-098, B-099 (JSDoc for these methods), S-021 (rescore with a non-score sort), S-025 (these methods).
- **Integration tests** (`…rescore-terms.integration.test.ts`): a rescore request is accepted and reorders the top window; `aggregateTerm` ordered by key ascending, by count, by a metric on a dotted field, and by two criteria (reproduce-first B-013, B-046); `missing` bucket (reproduce-first B-047); `includeFacets` returns buckets for each field; a user-set `limit` survives `aggregate*`.

#### QB5 — Composite and histogram aggregations
- **Depends on:** QB4.
- **Methods:** `aggregateHistogram`, `aggregateDateHistogram`, `aggregateGeotileGrid`, `dateHistogram`, the composite helper types.
- **Findings:** B-050, B-051, B-054, B-096, B-099 (JSDoc for these methods), S-022, S-052, S-025 (these methods).
- **Notes:** Decision D9. S-022's `name` option also applies to `aggregateTerm`.
- **Integration tests** (`…histogram.integration.test.ts`): paging a composite histogram to exhaustion with `after`; `dateHistogram` returns empty buckets and is not truncated; every offset form the validator accepts is accepted by the server, and `+1M`-style offsets are rejected locally (reproduce-first B-050); two aggregations on one field with different names; geotile grid on the geo fixture; time zone normalization.

#### QB6 — Paging, sorting and score functions
- **Depends on:** QB5.
- **Methods:** `limit`, `page`, `sort`, `getSort`, `reset`, `sortByRandom`, `decayFunctionScore`, `_applyScoreFunctions`, `getOptions` (paging keys).
- **Findings:** B-014, B-041, B-055, B-056, B-103, S-028, S-053, S-054, S-060 (`sort`/`reset`), S-029 (these methods).
- **Integration tests** (`…paging-sort.integration.test.ts`): `sort('_score')` returns best match first; array sorts with strings, `{field:'asc'}` and option objects; `page()` without `limit()`; `searchAfter` paging walks the whole result set with no repeats (using `_sort` values from raw hits); seeded random sort gives stable, non-overlapping pages; `function_score` options applied.

#### QB7 — Bool composition and filter context
- **Depends on:** QB6.
- **Methods:** `should`, `shouldNot`, `must`, `mustNot`, `nested`, new `filter`, `_buildBoolQuery`.
- **Findings:** B-015, B-101, B-102, S-019, S-026 (code part), S-055, S-056, S-057 (first bullet), S-060 (bool methods), S-029 (these methods).
- **Notes:** Decision D5.
- **Integration tests** (`…bool.integration.test.ts`): single-branch `should` with two clauses matches only documents satisfying both; empty branches; `shouldNot` with one and several branches and with `minimumShouldMatch`; `filter()` clauses restrict results without changing `_score` (compare scores with and without); `nested` on the nested fixture with `inner_hits`; unsupported state inside a sub-builder callback throws.

#### QB8 — Retriever builders
- **Depends on:** QB7.
- **Methods:** `knn`, `semantic`, `rrf`, `weightedSemantic`, new `normalizer`, `getRetrievers`, `getNormalizer`.
- **Findings:** B-012, B-042, B-043, B-048, B-089, B-092, B-097 (retriever getter and knn `filter`), S-018, S-023, S-045 (`weightedSemantic`), S-046, S-020 (these methods).
- **Notes:** B-043: store intent and build the retriever DSL at `getBody()` time so setter order does not matter. B-012 per the revised D3: no mapping is generated any more, so the fix is the configurable `exactField` plus documentation of the required sub-field (handoff note for DOCS).
- **Integration tests** (`…retrievers.integration.test.ts`): `knn` alone and with a numeric `similarity` cutoff and a filter (runs everywhere); `rrf` and `weightedSemantic` behind `caps.retrievers`; `semantic` behind `caps.inference`; rank settings applied regardless of call order; the contains clause in `weightedSemantic` actually boosts a document containing the multi-word phrase.

#### QB9 — Retriever-path serialization and output safety
- **Depends on:** QB8.
- **Methods:** `getBody`, `getOptions`, `getQuery`, `toKibana`, `clone`, `valueOf`, `getMust`, `getFunctionScores`.
- **Findings:** B-040, B-057, B-058, B-104, S-021 (retriever part), S-027, S-057 (second and third bullets), S-058, S-059, S-029 (these methods).
- **Notes:** Decisions D11 and D12.
- **Integration tests** (`…serialize.integration.test.ts`): retriever query with `limit(100)` succeeds and returns 100 hits (reproduce-first B-040); paging a retriever query past the default window; a lone retriever plus filters excludes non-matching documents; each combination that now throws locally is confirmed to be rejected by the server when sent raw (reproduce-first B-058); rescore on the retriever path; the `toKibana()` body, sent verbatim through the low-level transport, is accepted.

### After the lanes

#### SR — SchemaRegistry
- **Depends on:** IM5.
- **Owns:** `src/SchemaRegistry/*`.
- **Findings:** B-016, B-062, B-063, B-064, B-105, B-106, B-107, S-007, S-031, S-032, S-061 (registry side: consume `completion`, add `timeout`), S-062, S-063 (registry part).
- **Notes:** One shared `runLimited(items, concurrency, fn)` helper replaces the three duplicated lane loops. Decision D6 for `dropAll`: no confirmation option; document that only `getFullName()` is dropped. S-063 (registry part): the runtime `import { estypes }` is already removed; the rest remains.
- **Integration tests** (`SchemaRegistry.integration.test.ts`): three real indexes; `migrateIfNeeded()` creates them, then migrates a version bump on two of them while the third is current; `getStatus()` in registration order; one index made to fail (strict mapping conflict) yields `success: false` with the others completed; `recreateAll()`; `dropAll()` with no options drops all three; an older versioned index left behind an alias is still there afterward (D6). Maximum in-flight count is checked with fakes in the unit spec.

#### QR — QueryRunner
- **Depends on:** IM5 (lane complete), QB1. Uses only public `QueryBuilder` methods.
- **Owns:** `src/QueryRunner/*` (including new `QueryRunner.spec.ts`).
- **Findings:** B-017, B-018, B-019, B-020, B-059, B-060, B-061, B-065, B-108, S-006, S-030, S-033, S-063 (runner part).
- **Notes:** B-020/B-059: one fixed Painless script that walks paths passed as `params` and creates missing intermediate maps; keys are validated at run time against `getAllFields(index.createSpec, { containers: true })`. Decision D10. B-065: `QueryRecord<Create>` already exists in `QueryRunner.ts` with `_score`; extend it with `_id`, `_highlight` and `_sort` and map them from the hit. S-033: `updateMany` keys are already typed as `MappingFieldPath<Create>`; only the run-time validation remains. S-063 (runner part): the tsc errors are already gone.
- **Integration tests** (`QueryRunner.integration.test.ts`): `count` on a builder that has limit, page, sort, aggs, highlight and excluded fields equals the unpaged total (reproduce-first B-017); `count` with a retriever returns the documented envelope; records carry `_id`, `_score`, highlights and sort values, and `_sort` feeds `searchAfter`; `findFirst` sends `size: 1`; `findFirstOrThrow` throws not-found for no match and the real error for a bad query; `updateMany` on top-level and nested paths (including a missing parent object), honoring `limit`, rejecting empty input and hostile keys with nothing modified.

### Last

#### DOCS — Public surface and documentation
- **Depends on:** every task above. Reads all handoff notes.
- **Owns:** `index.ts`, `README.md`, `CHANGELOG.md`, `AGENTS.md`, `ROADMAP.md`, `package.json` (build/exports only), `import-test.ts`, `src/publicExports.spec.ts`, `src/readmeSamples.spec.ts`, `docs/consumers/*`.
- **Findings:** B-094, B-099 (README part), S-010, S-026 (README part), plus every documentation note left in handoff files.
- **Work:** export review (the package stays ESM-only, D8), updating `publicExports.spec.ts` to the new list (S-010: `QueryBuilderProvider` is already exported; the rest remains); README function table and examples match real signatures (`readmeSamples.spec.ts` already compiles every sample that imports from `es-query-pro`; make the quick-reference table's examples compile the same way); CHANGELOG lists each breaking change from the handoff notes; a consumer upgrade guide in `docs/consumers/` in the style of `upgrading-to-beta-3.md`; AGENTS.md updated for the new migration flow, `migrate.ts`, test kit and scripts, and corrected to describe an ESM-only package (D8).
- **Integration tests:** `import-test` runs against the built ESM bundle.

#### E2E — Cross-module scenarios
- **Depends on:** every task except DOCS; runs in parallel with DOCS.
- **Owns:** new `src/e2e/*.integration.test.ts`.
- **Findings:** none of its own; this is the regression net for the whole review.
- **Scenarios:** (1) application lifecycle: registry of two indexes → `migrateIfNeeded` → bulk load → search with match, filter, sort, paging and aggregations → `updateMany` → `count` → `deleteMany` → `dropAll`. (2) Version bump under load: a writer loop running `put`/`patch`/`findById` through the alias while a v1 → v2 migration runs; no operation errors, no lost or duplicated documents afterward. (3) Rolling-deploy simulation: v1 and v2 managers calling `migrateIfNeeded` alternately; ends on v2 with all data. (4) Hybrid search path behind capability flags.

---

## 5. Gates

**Per task** (subagent runs these before reporting; orchestrator re-runs them before committing):

```bash
bun test <the task's spec and integration files>
bun test <the lane's pre-existing test files>      # lane tasks only
bunx biome check <owned files>
bun run typecheck                                  # zero errors in owned files, no new errors elsewhere
```

**Per wave / lane completion** (orchestrator): `bun test` (full suite), `bun run lint`, `bun run build`.

**Final:** full suite against the serverless target and the Docker 9.1 target; `bun run typecheck` reports zero errors; `bun run format:check` clean; `bun run coverage` reviewed; every ID in sections 8.1 and 8.2 is checked off against a handoff note; every "did not reproduce" entry is summarized for the maintainer.

A task that fails its gate goes back to the **same** subagent (via `SendMessage`) with the failing output. A fresh subagent is used only if the first one's context is exhausted.

---

## 6. Orchestrator protocol

1. Create a working branch. Section 2 is already confirmed; do not reopen it.
2. Launch tasks per section 1.2. For each task, send the prompt in section 7 with the task block pasted in.
3. Keep the orchestrator's own context small: do not read subagent diffs in full. Rely on the gates, the handoff note, and a `git diff --stat` check that only owned files changed. If a file outside the owned list changed, reject the task result.
4. After a task passes: commit its owned files with a message naming the task and finding IDs, then start the lane's next task.
5. Handoff notes live in `docs/plans/2026-11-20-handoff/<TASK>.md`, at most ~40 lines:
   - findings fixed, and any finding that **did not reproduce** on a real server (with what was observed)
   - public API added, changed or removed; breaking changes
   - anything another task must do (named by task ID)
   - README/CHANGELOG notes for DOCS
   - capability-gated tests and which target they ran on

---

## 7. Subagent prompt template

```
You are implementing task <ID> of docs/plans/2026-11-20-code-review-fixes.md
in the es-query-pro repository. Read AGENTS.md first, then section 1.3, 2, 3
and 5 of the plan, then your task block (pasted below).

Findings to implement: <IDs>. Read ONLY those entries in
docs/reports/2026-11-19-src-code-review.md (search for the anchor, e.g.
`id="b-015"`). Do not read the rest of the report.

Read these handoff notes before starting: <docs/plans/2026-11-20-handoff/X.md, …>

Files you own (edit nothing else): <list>
Methods in scope: <list>. Find them by name; report line numbers are stale.

Method:
1. For each finding, write a failing unit test first. For reproduce-first
   findings (<IDs>), write the integration test against real Elasticsearch
   first and confirm the bug exists; if it does not, do not change the code
   and record what you observed.
2. Fix, then write the integration tests listed in the task block using
   src/testFixtures/esTestKit.ts.
3. Run the per-task gate from section 5 until it passes.
4. Write docs/plans/2026-11-20-handoff/<ID>.md.

Rules: no git write commands; no wildcard index deletes beyond your test
prefix; no fixed sleeps in tests; follow the code style in AGENTS.md.

Final report: gate output summary, list of files changed, and anything that
blocked you. State plainly if any finding is unfinished.

<task block>
```

---

## 8. Coverage matrix

### 8.1 Bugs

| Task | Bug IDs |
|---|---|
| P0-A | B-093 |
| P0-B | B-076 (remaining part) |
| F1 | B-079 |
| F2 | B-024, B-025, B-067, B-075 |
| F3 | B-072, B-073, B-074 |
| IM1 | B-007 (remaining part), B-077 |
| IM2 | B-006, B-029, B-030, B-031, B-078, B-080 |
| IM3 | B-033, B-034, B-039, B-085, B-086 (remaining part), B-087 |
| IM4 | B-008 (classification), B-035, B-038 |
| IM5 | B-001, B-002, B-008 (refusal), B-009, B-010, B-032, B-036, B-037, B-082, B-083, B-084 |
| QB1 | B-011, B-044, B-090, B-095 (part) |
| QB2 | B-045, B-091, B-095 (part) |
| QB3 | B-049, B-052, B-099 (part), B-100 |
| QB4 | B-003, B-013, B-046, B-047, B-053, B-097 (part), B-098, B-099 (part) |
| QB5 | B-050, B-051, B-054, B-096, B-099 (part) |
| QB6 | B-014, B-041, B-055, B-056, B-103 |
| QB7 | B-015, B-101, B-102 |
| QB8 | B-012, B-042, B-043, B-048, B-089, B-092, B-097 (part) |
| QB9 | B-040, B-057, B-058, B-104 |
| SR | B-016, B-062, B-063, B-064, B-105, B-106, B-107 |
| QR | B-017 (IM3 does the `IndexManager.count` type), B-018, B-019, B-020, B-059, B-060, B-061, B-065, B-108 |
| DOCS | B-094, B-099 (README part) |

### 8.2 Suggestions

| Task | Suggestion IDs |
|---|---|
| P0-A | S-034 (formatting) |
| F1 | S-048 (type) |
| F2 | S-011 (part) |
| F3 | S-011 (part), S-034 (behavior), S-035 |
| IM1 | S-001 (remaining part), S-002 (part), S-037 (remaining part), S-038, S-039, S-040 (part) |
| IM2 | S-002 (part), S-040 (part) |
| IM3 | S-014, S-015, S-016, S-017 (part) |
| IM4 | S-017 (part), S-041 |
| IM5 | S-003, S-004, S-017 (part), S-061 (part) |
| QB1 | S-020 (part), S-043, S-044, S-049 |
| QB2 | S-020 (part), S-042, S-045 (part), S-047, S-048 (implementation) |
| QB3 | S-005, S-024, S-025 (part), S-050, S-051 |
| QB4 | S-021 (part), S-025 (part) |
| QB5 | S-022, S-025 (part), S-052 |
| QB6 | S-028, S-029 (part), S-053, S-054, S-060 (part) |
| QB7 | S-019, S-026 (code), S-029 (part), S-055, S-056, S-057 (part), S-060 (part) |
| QB8 | S-018, S-020 (part), S-023, S-045 (part), S-046 |
| QB9 | S-021 (part), S-027, S-029 (part), S-057 (part), S-058, S-059 |
| SR | S-007, S-031, S-032, S-061 (part), S-062, S-063 (part) |
| QR | S-006, S-030, S-033 (remaining part), S-063 (part) |
| DOCS | S-010, S-026 (README) |

### 8.3 Findings removed in the 2026-11-20 revision

These are closed. No task owns them and the final gate does not check them off.

| Finding | Why it was removed |
|---|---|
| B-004 | `ElasticsearchRecord` was deleted; `MappingRecord` types every numeric type as `number` and every field as optional. |
| B-005 | Fixed: `getIndexMetadata` reads the response directly; an integration test covers it. |
| B-021, B-028 | The `analyzer` option and the generated `.fulltext` sub-field no longer exist; the caller writes the analyzer in the mapping. |
| B-022 | `getEsClient` was deleted; nothing in the library reads `ES_VERSION` or sets compatibility headers. |
| B-023, B-070, B-071, S-036 | `SchemaManager` and the string-schema types were deleted. |
| B-026, B-068, B-069 | `getAllFields` / `getFulltextFields` were rewritten in `src/mappingFields/mappingFields.ts`: full dotted paths, no duplicates, and a full-text list of `text`, `match_only_text`, `search_as_you_type`, `semantic_text`. |
| B-027 | Fixed: `englishplus` is typed `{ analysis: estypes.IndicesIndexSettingsAnalysis }`. |
| B-066 | `getEsClient` was deleted. The same empty-credentials behavior now lives only in the test helper `getTestClient()`. |
| B-081 | Fixed: errors are classified by `name`, and `isApiNotAvailable` no longer uses `instanceof`. |
| B-088 | Fixed: `IndexManager.ts` has no type errors. |
| S-008, S-009 | The library no longer decides `nested` vs `object`, the `.exact` sub-field or `term_vector`; the mapping is exactly what the caller wrote. |
| S-012 | There is no default client; `client` is a required option. |
| S-013 | `getCreateRequest` was rewritten: `{ ...createSpec, index: getFullName(), ...more }`. |

Partly done, still owned by a task for the remainder (see the task's notes): B-007, B-065, B-076, B-086, S-001, S-010, S-011, S-033, S-037, S-063.

---

## 9. Risks

- **Shared remote cluster.** The local target is a shared serverless project. Three subagents plus leftover indexes from failed runs can accumulate. The kit's prefix-scoped cleanup and a `kit.sweep()` for stale run prefixes (older than a few hours) handle this; never widen a delete pattern to work around it.
- **Serverless vs stateful differences.** Tasks API, flush, index settings and license-gated retrievers differ. Anything gated must run on at least one target, and IM5 must pass on both.
- **Migration redesign (D1) is the largest single change.** IM4 is deliberately small so IM5 starts from a settled status interface, and E2E scenario 2 exercises it under concurrent writes.
- **QueryBuilder lane is the critical path** (nine sequential tasks). SR, QR and the IndexManager lane run alongside it, so wall-clock time is set by QB1 → QB9.
- **Typed field names must survive the QueryBuilder lane.** Nine tasks rewrite method signatures in `QueryBuilder.ts`. Rule 7 in section 1.3 and the two `*.fields.spec.ts` files guard this; a lane task that has to change one of those specs explains why in its handoff note.
