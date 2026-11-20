# DOCS handoff — public surface and documentation

## Done (B-094, B-099 README part, S-010, S-026 README part, every handoff note for DOCS)
- `index.ts`: 173 names (9 runtime, unchanged). Added every type the notes asked for (F1/QB2 `RangeOptions`; F2 `IndexNameRelation`; IM2 `IndexLifecycleCode`, `IndexCreateOnlyResult`, `IndexCreateRequestShape`; IM3's 12; IM4's 3; IM5's migration types + `IndexMigrateResult`; QB3–QB8's 26; QR's 6; SR's 8) plus S-010's `IndexName`, `IndexNameAttributes`, `IndexRecreateResult`, `MigrationParams`, `HighlightDefinition`. Package stays ESM-only (D8).
- `publicExports.spec.ts`: new list, 9-member `IndexErrorKind`, new test pinning `StatusSummary`/`IndexLifecycleCode`/`MigrationCode`/outcome codes. `bun run typecheck`: 0 errors.
- `readmeSamples.spec.ts`: also extracts every code span in the "Example" column of the quick-reference tables (each row must have one; 63 examples), compiles them strict + non-strict, and runs each on a fresh builder followed by `getQuery()`.
- README rewritten: envelope/throw conventions, error kinds + Bun `HttpConnection` note, IndexManager lifecycle/records/status tables (D6 `deleteMany`, putBulk chunks and ids, `findById` not found, lifecycle codes), D1 migration flow, options, codes, `completion`, D2 limitation, `_meta` marker; QueryRunner (`updateMany`, `count` + D10); SchemaRegistry (envelope, named map, alias-collision throw, D6 `dropAll`, migrate options/outcome table); quick reference rebuilt from the real signatures; `filter`, `must`, `shouldNot`, `nested`, retriever rules (D5, D11), sort/paging, date histogram/time zones; `exactField` (D3); englishplus; test kit/Docker. Size badge 12kb → 25kb (minified+gzipped is 24.7 kB).
- CHANGELOG `v3.0.0-beta.4 (unreleased)`: 46 breaking items by class, Added, Fixed. Guide: `docs/consumers/upgrading-to-beta-4.md`.
- AGENTS.md: ESM-only, scripts, kit/recording client/fixtures, Docker run, conventions, `migrate.ts`; "does not type-check cleanly" removed; dead `.junie/guidelines.md` reference removed.
- ROADMAP: ticked `filter`, `reindex`, `updateByQuery`, `deleteByQuery`, `indices.updateAliases`.
- `import-test.ts` imports `es-query-pro` through the `exports` map (Bun and Node both resolve it to `dist/index.mjs`), checks the export list, no `@elastic` in the bundle, new builder behavior and envelopes. New script `test:import` (build, then run).

## Not done, and why
- Version: titled beta.4 because beta.3 already has a CHANGELOG entry and guide; but `package.json` is still `3.0.0-beta.2` and beta.3 is unreleased (not on `main`). If both ship together, merge the two entries. Badges still say beta.2.
- `'filter'` in `FieldType` (QB7/F1 suggestion): `src/types.ts` is F1's; `ResetName` already covers it.
- `isDefined`/`normalizeTimeZone` not exported; `isEmptyObject` kept (removing a runtime export is breaking). Removal candidates (unused by library code, still exported and pinned): `IntervalType`, `FieldTypeOrTypes`, `QueryDslDecayFunctionBase`, `GetRequestParams`, `PutRequestParams`, `BulkRequestParams`, `PatchRequestParams`, `InferenceCohereSimilarityType`, `AggregationsAggregateOrder`; `FieldType`/`Prettify` are internals too. `IndexStatusReport` duplicates `StatusReport`.
- `biome.json` `$schema`/`recommended` infos (P0-A): not my file.
- ROADMAP "Nested schema creation ✅" describes a feature removed in beta.3; left, since this work did not remove it.

## Problems found in the source/build (not fixed; not my files)
- **Published types lose `| null`.** `tsconfig.json` (and so `tsconfig.bundle-generator.json`) has no `strict`/`strictNullChecks`, so inferred return types in `dist/index.d.ts` drop nulls: e.g. `findMany().total` is `number` in the bundle, `number | null` in source. A probe with `strict: true` gave 155 `| null` vs 107. Fix: add `"strictNullChecks": true` to `tsconfig.bundle-generator.json` and check `bun run build`. (`findFirst().record` is non-null in both; may need an explicit return type.)
- `rawCondition()` stores the caller's object by reference and does not validate; `must()` copies and validates. Documented as is.
- `package.json` was changed by someone else during this task (dts-bundle-generator 9.5.1 → 10.0.0, `build:dts:link` removed, `bun.lock` updated); the build gate passes with it.
