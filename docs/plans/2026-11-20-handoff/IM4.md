# IM4 handoff — status

## Findings fixed (each had a failing unit test first; `IndexManager.status.spec.ts`, 33 tests)
- **B-035** `getStatus()` never reports `needsCreation` on a failed check: any failure gives `summary: 'unknown'`, both booleans false, `error`/`errorKind` of the first failure (index check, then alias). `aliasExists` is now derived from the alias lookup (`null` when it failed). The `migrateIfNeeded` half ("abort when `status.error`") is **IM5 step 1, not done here**.
- **B-038** `needsCreation()` works: `Promise<boolean | null>` = `getStatus().needsCreation`, null on error.
- **B-008 (classification only)** siblings are parsed with `IndexNameManager.tryParseByName(name, this.index.separator)` + `compare()`, into older / newer / incomparable / unrelated. Per the orchestrator, `incomparable` is its own list (no order guessed). Refusing downgrades is IM5's.
- **S-041** two requests (`HEAD <index>`, `GET /_alias/<alias>`) in `Promise.all` (was three, sequential); `error`/`errorKind` added; no nested ternary. The "alias fetched twice in `migrateIfNeeded`" part is left for IM5: use `status.aliasIndexes` / `status.siblings`.
- **S-017 (status part)** unit tests for every state and error path above.

## Public API (all in `IndexManager.ts`; breaking)
```ts
export type SiblingIndexes = { all: string[]; older: string[]; newer: string[]; incomparable: string[]; unrelated: string[] };
// all: server order; older/newer: oldest first; incomparable/unrelated: by name
export type StatusSummary = 'unknown' | 'newerVersionPresent' | 'needsMigration' | 'aliasConflict' | 'needsCreation' | 'needsAlias' | 'current';
// precedence = this order: newer > older|incomparable > unrelated > index missing > alias missing > current
export type StatusReport = {
  took: number; fullName: string; aliasName: string;
  indexExists: boolean | null; aliasExists: boolean | null;
  aliasIndexes: string[]; aliasAttached: boolean | null; siblings: SiblingIndexes;
  needsMigration: boolean; /* summary === 'needsMigration' */ needsCreation: boolean; /* summary === 'needsCreation' */
  summary: StatusSummary; error: Error | null; errorKind: IndexErrorKind | null;
};
```
- `getSiblingIndexes()` returned `string[]`; now `getAliasMetadata()`'s envelope minus `indexes`, plus `aliasIndexes` and `siblings` (`IndexSiblingIndexesResult`). Old value = `.siblings.all`.
- `needsMigration()` → `boolean | null` (`isMigrationNeeded`: older or incomparable present and no newer; one request). Previously true for any other index on the alias.
- `needsAlias`/`newerVersionPresent`/`aliasConflict` are new; these used to be `current` / `needsMigration` / `needsMigration`.
- IM2's `getAliasConflict()` now uses the same `classifySiblings()` helper (behavior unchanged; lifecycle tests pass).

## For IM5
- `migrateIfNeeded` is unchanged. Interim behavior with the new status: `unknown`, `newerVersionPresent`, `aliasConflict` and `needsAlias` all fall into its final "current" branch (success, nothing done), so the B-008 downgrade and the B-035 create-on-error no longer happen, but it still says `success: true`. IM5 step 1: abort on `status.error`, return `NEWER_VERSION_PRESENT` for `siblings.newer`, decide on `siblings.incomparable` (IM2's `createIfNeeded` calls it `NEEDS_MIGRATION`; the summary does too). Step 2: `needsAlias` is the index-without-alias case.
- Migrate only from `siblings.older` (and maybe `incomparable`), never `aliasIndexes` wholesale.

## For SR (3 new typecheck errors, unavoidable once `summary` widens)
- `SchemaRegistry.ts` `OUTCOME_BY_PRIOR_STATUS` needs keys `unknown`, `newerVersionPresent`, `aliasConflict`, `needsAlias`; the local `summary` record in `getStatus()` should be `Record<string, StatusSummary>`.
- `SchemaRegistry.spec.ts` `status()` helper must add `aliasIndexes`, `aliasAttached`, `siblings`, `error: null`, `errorKind: null`. Runtime tests still pass.

## For DOCS
Export `StatusSummary`, `SiblingIndexes`, `IndexSiblingIndexesResult` from `index.ts`. CHANGELOG: everything under Public API. README migration section: `getStatus()` summaries and that `before.summary` can be `unknown`.

## Tests
`IndexManager.status.integration.test.ts`: 9 tests, pass on serverless (none, current, index without alias, older, newer, unrelated, incomparable, mixed v1+v3 alias, unreachable cluster via `HttpConnection` → `unknown`). No capability gates. Docker not run. No lane test files edited.
Gate: `bun test src/IndexManager` 264 pass; SR/QR/typesOnlyImports/readmeSamples 44 pass; biome clean; typecheck: 0 in owned files, 3 new in `src/SchemaRegistry/*` (above), plus known `publicExports.spec.ts` and `QueryBuilder.ts`.
