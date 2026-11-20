# IM2 handoff — create, drop and alias lifecycle

## Findings fixed
- **B-029** reproduced on serverless before the fix: after v1→v2, `createIfNeeded()` returned `CREATED`/`success: true`, the alias pointed at v1 and v2, and `put` through it failed with `illegal_argument_exception: no write index is defined for alias`. Now `create()`, `createIfNeeded()`, `createAliasIfNeeded()` and `recreate()` check where the alias points first (`getAliasMetadata`) and never add it to a second index.
- **B-006** `drop()` sends only `DELETE /<index>` (ES removes the aliases with the index); no `aliasExists`/`deleteAlias`.
- **B-030** (a) an existing index without its alias gets the alias (`ALIAS_CREATED`); (b) `createIfNeeded()` no longer calls `exists()`: it creates and treats `resource_already_exists_exception` as "exists", so concurrent callers all succeed.
- **B-031** `create(more?)` returns the same keys on every path (below), `error`/`errorKind` null on success. `createIfNeeded(more?)` and `recreate(more?)` also accept `more`.
- **B-078** `createAliasIfNeeded()` has `took` (and the same keys) on every path.
- **B-080** `recreate()` stops on an exists or drop error, skips flush after a failed create, reports a failed flush, and `took` covers every step.
- **S-040 (these methods)** `request.endpoint` comes from the merged body in `getCreateRequest`, `drop`, `createAlias`, `dropAlias`; else-after-return and `const res` shadowing gone. `performance.now()` not adopted (same as IM1).
- **S-002 (these methods)** `IndexManager.lifecycle.spec.ts` (36 tests).

## Result shapes (public API change; breaking)
- `create()` / `createIfNeeded()`: `{ success, code, aliasIndexes, indexResponse, aliasResponse, request, took, error, errorKind, response }`. `request` is the create-index request; `aliasIndexes` is where the alias pointed when checked; sub-responses are null when the step did not run; `error`/`errorKind`/`response` describe the failed step.
- `recreate()`: the same plus `dropResponse`, `flushResponse` (null when skipped).
- `createAliasIfNeeded()`: `{ success, code, aliasIndexes, aliasResponse, request (the put-alias request), took, error, errorKind, response }`.
- New `export type IndexLifecycleCode` (in `IndexManager.ts`): `CREATED | ALREADY_EXISTS | ALIAS_CREATED` (`success: true`); `NEEDS_MIGRATION` (alias on an older or `incomparable` version), `NEWER_VERSION_PRESENT` (alias on a newer version; wins over others), `ALIAS_CONFLICT` (alias on an index that is not a version of this one): `success: false` with **`error: null`**, nothing changed; `EXISTS_CHECK_ERROR | CREATE_ERROR | ALIAS_ERROR | DROP_ERROR | FLUSH_ERROR`: a request failed. `createAliasIfNeeded()`'s old `'ERROR'` code is replaced by `EXISTS_CHECK_ERROR` / `ALIAS_ERROR`.
- `create()` with the alias on another index still **creates the index** but leaves the alias alone (returns the conflict code). `createIfNeeded()` and `createAliasIfNeeded()` create nothing in that case.
- `createAlias()` is unchanged: a raw `putAlias` that does not check (documented in its JSDoc).
- Also exported from `IndexManager.ts` (not `index.ts`): `IndexCreateOnlyResult`, `IndexCreateRequestShape`.

## For other tasks
- **IM4**: classification is `getAliasConflict()` (module function) + private `_getAliasState()`; reuse or align `StatusReport` with it (`incomparable` counts as `NEEDS_MIGRATION` here). Out of scope, noticed: `needsCreation()` returns `!indexExists` on an envelope object, so it is always false.
- **IM5**: in the migration branch, `migrateIfNeeded` calls `create()`, which now creates v2 **without** the alias and returns `code: 'NEEDS_MIGRATION', success: false` (result ignored; the existing `updateAliases` adds the alias, so the end state is unchanged). In the creation branch, `createResult.error !== null` now works (before, a successful `create()` had `error: undefined`, so that branch reported failure). Helper `isAlreadyExists(failure)` exists for step 3. `console.log`s in `migrateIfNeeded` remain.
- **SR**: `dropAll()` now gets `acknowledged: true` after a real drop. `recreateAll()` still marks every result `SUCCESS` unless it throws; it should read `result.success`/`code`.
- Known gap: the alias check and the put-alias are two requests, so a process attaching the alias elsewhere in between is not detected.

## Test files outside the new ones
- `IndexManager.integration.test.ts`: `expect(created.error).toBeUndefined()` → `toBe(null)` (locked in B-031).
- `IndexManager.metadata.spec.ts` (IM1): "should resolve when the alias check itself rejects" asserted that `drop()` calls `aliasExists()`; replaced by "should not depend on the alias check (B-006)".

## For DOCS
Export `IndexLifecycleCode` (and optionally the two result types) from `index.ts` + `publicExports.spec.ts`. CHANGELOG: every shape/code change above. README: `createIfNeeded()` at boot returns `NEEDS_MIGRATION` after a version bump; run `migrateIfNeeded()`.

## Tests
`IndexManager.lifecycle.integration.test.ts`: 15 tests, all pass on serverless; no capability gates. Docker target not run.
Gate: `bun test src/IndexManager` 159 pass; SchemaRegistry/QueryRunner/typesOnlyImports/readmeSamples 44 pass; biome clean; typecheck: only the known `publicExports.spec.ts` error outside `src/QueryBuilder/*`.
