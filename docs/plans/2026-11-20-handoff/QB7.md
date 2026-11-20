# QB7 handoff — bool composition and filter context

## Findings fixed
- **B-015**: a single non-empty `should()` branch adds *all* its clauses (its `filter()` clauses stay filters). Multi-clause branches in several-branch `should` are `{bool:{must:[...]}}` as before.
- **B-101**: empty branches are **skipped, as if not passed** (documented). A positive numeric `minimumShouldMatch` above the non-empty count is lowered to it; all-empty or `[]` adds nothing. Server confirmed: `should:[A]` + msm 2 matches nothing.
- **B-102**: numeric msm must be an integer with `|msm| <= withBuilders.length` (`RangeError`); `''` → `RangeError`, non number/string → `TypeError`. `shouldNot([A], {msm: 2})` throws (server confirmed it would exclude nothing). `shouldNot` now emits `must_not: [<should as one query>]`, so one branch with two clauses excludes only docs matching both.
- **S-019 / S-057 (first bullet) / D5**: new `filter(cb)` → `bool.filter`; `getFilter()` (copy); `_buildBoolQuery()` → `match_all` | lone must clause | `{bool:{must?, filter}}`. Existing methods still emit `must`. Retriever path: must and filter clauses both go into `linear.filter` (JSDoc on `filter()`). Integration: filter leaves `_score` unchanged (same range in `must` adds +1).
- **S-026 (code)**: `shouldNot` options optional; `must(): this`, validates an object (`TypeError`) and copies it.
- **S-055**: empty `mustNot` adds nothing; `mustNot` puts the sub-builder's must + filter clauses under `must_not` (any-of semantics kept). `nested()` unwraps a lone clause, uses `match_all` for an empty callback, sends `score_mode`/`inner_hits`/`ignore_unmapped` only when given; `innerHits: true` → `{}`; inputs validated (`TypeError`); JSDoc example uses full paths.
- **S-056**: private `_runSubBuilder(method, cb)` used by `should`/`shouldNot`/`mustNot`/`filter`/`nested`: after the callback, any own property differing from a fresh builder (except `_must`, `_filter`, `_limitFromAggregations`) → `TypeError` naming the method and state; nothing is added to the outer builder.
- **S-060 (bool methods)**: no `any`; callbacks typed `=> unknown`. **S-029**: covered by the new spec/integration files.

## Public API (CHANGELOG)
- **Breaking:** `nested()` output shape (no `bool.must` wrapper for one clause, no default keys); `should()`/`shouldNot()` throw on bad `minimumShouldMatch`/non-function branches; `should` with one multi-clause branch now requires all clauses; empty `mustNot`/`should` add nothing; sub-builder callbacks throw when they set sort/limit/aggs/fields/highlight/retrievers/rescore/etc.; `must()` copies and validates.
- **Added:** `filter(cb)`, `getFilter()`, `reset('filter')` (`reset('must')` does not clear filters; `reset()` clears both), `nested({ innerHits: true })`. New types in `QueryBuilder.ts`: `ShouldOptions`, `NestedOptions<Field>`, `ResetName` (= `FieldType | 'filter'`; `reset()` now takes `ResetName | ResetName[] | null`).

## For other tasks
- **QB8:** `_runSubBuilder` flags every new own property you add to the class when a sub-builder sets it; if you add condition-like state that sub-builders may set, add it to `CONDITION_STATE`.
- **QB9:** I changed `getBody()` only at `hasFilters` (now `_must.length > 0 || _filter.length > 0`), added one line each to `clone()` (`_filter`) and `reset()` (`'filter'`). `_buildBoolQuery()` still returns live `_must`/`_filter` arrays inside `getBody()` output (B-104/S-058 territory). S-057 bullets 2–3 (lone retriever + conditions wrapped in `linear`) untouched. `rescore()`'s inner builder does not use `_runSubBuilder` (state other than conditions there is still ignored).
- **F1/DOCS:** consider adding `'filter'` to `FieldType` in `src/types.ts`.
- **DOCS:** export `ShouldOptions`, `NestedOptions`, `ResetName`. README: add `filter(cb)` row + filter-context section (scores unchanged; on retrievers all conditions are filters); fix `### must — omitted` (there is `must(clause)`); `shouldNot(withBuilders, options?)` with custom `minimumShouldMatch` is supported (drop the mustNot+should workaround text); document empty-branch rule and msm validation; `nested` options and `innerHits: true`. Biome's `useIterableCallbackReturn` flags `qb.filter((sub) => { ... })` with a block body and no `return` (it treats `.filter` as `Array#filter`): use expression bodies or `return sub` in samples.

## Pre-existing tests edited (S-055 shape only)
- `QueryBuilder.spec.ts` nested test: `query` is the lone `term` (no `bool.must`).
- `QueryBuilder.fields.spec.ts` "emit field names verbatim": nested has no `bool.must` wrapper and no `score_mode`/`inner_hits`/`ignore_unmapped` defaults.

## Tests (serverless target; Docker not run)
- `QueryBuilder.bool.spec.ts` 61 unit + type tests (46 failed before the fix). `QueryBuilder.bool.integration.test.ts` 22 tests; one gated on `caps.retrievers` (knn + filter/must on the `linear` path), ran on serverless.
