# SR handoff — SchemaRegistry

## Findings fixed (failing unit test first: `SchemaRegistry.spec.ts` migrate, `.fleet.spec.ts`, `.registration.spec.ts`; 76 unit tests)
- **B-016 / S-063** one exported `runLimited(items, concurrency, fn)` worker pool (settled results, input order, never rejects) replaces the three lane loops; max in-flight == `concurrency` checked with fakes for 1/2/5/10/20. The redundant async IIFE and unused imports are gone. `chunkify()` is **removed**.
- **B-062 / B-063 / B-105** each index's envelope is read (`result.success`/`error`), a throw becomes that index's entry, every lane settles before returning, `report[i]` follows registration order.
- **B-064** invalid `concurrency` (0, negative, NaN, non-number) → envelope `success: false`, `RangeError`, `errorKind: 'configuration'`, nothing sent; fractions are floored. `runLimited` itself runs one at a time for such values.
- **B-106** register/registerAll/constructor dedupe on `getFullName()` (later copies ignored) and **throw** (`Error`, synchronous, like `IndexManager`'s constructor) when two full names share an alias; `registerAll` is all-or-none. **B-107** the constructor copies its array.
- **S-031** all four operations use one envelope `SchemaFleetResult<Entry, Code>` = `{ success, took, report, summary, error: Error | null, errorKind }`; an empty registry is `success: false`, `errorKind: 'configuration'` everywhere (`recreateAll` no longer throws).
- **S-032 / D6** `dropAll()` JSDoc: no confirmation; only `getFullName()` is dropped, older versions stay (integration-tested).
- **S-061 (registry)** awaits each index's `completion` and maps `MigrationOutcome.code` (no more `percent === 100` counting). New `timeout` for the whole run: each index gets the time left as its own `timeout`; an index not started in time is `code: 'TIMEOUT'`, `errorKind: 'timeout'`, error name `MigrationTimeoutError`. Invalid `timeout` (≤ 0, NaN) → `acknowledged: false`, configuration error. All `MigrationParams` (`maxPollErrors`, `requestsPerSecond`, `batchSize`, ...) are passed through.
- **S-062** `SchemaRegistry<Named>`: `new SchemaRegistry({ books, authors })` keeps types; `get('books')` is `typeof books`, `getNamedIndexes()`; unknown names are type errors. Array form unchanged (`get` unusable there).
- **S-007** coverage: all of the above plus `listIndexes`, `getIndexLookup`, `registerAll`, real `IndexManager`s over the scripted client for `dropAll`.

## Public API changes (breaking; for CHANGELOG)
- `migrateIfNeeded()` returns `{ acknowledged, error, errorKind, completion }`. `SchemaMigrationDetails` gains `error`/`errorKind`. `SchemaMigrationReport` gains `code: MigrationOutcomeCode | null`, `migration: MigrationOutcome | null`, `errorKind`; `before` is now the migration's own `result.status` (one fewer `getStatus()`); `after` is read once the index's `completion` settles. Outcome by code: `CREATED`/`ALIAS_CREATED` → `created`, `MIGRATED` → `migrated`, `CURRENT` → `unchanged`, anything else → `failed` (`NEWER_VERSION_PRESENT`/`INCOMPARABLE_VERSION`/`ALIAS_CONFLICT` fail with `error: null`). A failing `after` read no longer fails the index (it shows `summary: 'unknown'`).
- Callbacks that throw are ignored silently (as in IM5); no `console.error`.
- `recreateAll()`: `report: SchemaRecreateReport[]` `{ fullName, aliasName, success, code, result, error, errorKind, took }`, `summary` = `recreate()` code or `'ERROR'` (was `'SUCCESS'`).
- `getStatus()`: `report: StatusReport[]` (a rejected call becomes `summary: 'unknown'`), `summary: Record<string, StatusSummary>`, `success` false when any status has an error.
- `dropAll()`: `results` → **`report: SchemaDropReport[]`**; `summary` `DROPPED | MISSING | ERROR`; a 404 `index_not_found_exception` is `MISSING` and counts as success.
- `indexes` is `readonly` (the array is still mutable; use `register()`); `_migrateOne()` signature changed.

## For DOCS
- Export from `index.ts` (+ `publicExports.spec.ts`): `SchemaFleetResult`, `SchemaNamedIndexes`, `AnyIndexManager`, `SchemaRecreateReport`, `SchemaRecreateCode`, `SchemaRecreateResultShape`, `SchemaDropReport`, `SchemaDropCode`. `runLimited` stays internal.
- README `SchemaRegistry.migrateIfNeeded` section: add `timeout` (whole run) and pass-through options, `errorKind`, new report fields, outcome-by-code table, `acknowledged: false` also for an invalid `timeout`. Add `recreateAll`/`getStatus`/`dropAll` (envelope, `concurrency`, D6 sentence), named-map form, alias-collision throw. README samples compile unchanged.
- Nothing needed from `src/IndexManager/*`.

## Tests and targets
`SchemaRegistry.integration.test.ts` (7 tests, no capability gates): create 3 → version bump on 2 with the 3rd current → `getStatus` order → strict-mapping `REINDEX_FAILED` with the others `created`/`unchanged` → `recreateAll` → `dropAll` drops all (D6: `d` v1 and its alias survive) → `MISSING`. Serverless: `bun test src/SchemaRegistry` 83 pass (~28 s). Docker ES 9.1.10 trial: 83 pass (~2 s). Typecheck: 0 errors in `src/SchemaRegistry/*`; only the known `publicExports.spec.ts` error remains.
