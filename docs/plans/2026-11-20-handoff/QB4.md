# QB4 handoff — rescore and terms aggregation

## Findings fixed (all reproduce-first findings reproduced on serverless)
- **B-003**: `rescore_query` is now the inner builder's `getBody().query` (conditions + score functions only); stray `length` gone. Server rejected the old shape (`[_source] query malformed`). New `RescoreOptions` (`windowSize` integer >= 1, `queryWeight`, `rescoreQueryWeight` finite, `scoreMode` one of avg/max/min/multiply/total); options now optional, unset ones are omitted. Callback must be a function (`TypeError`).
- **S-021 (rescore part)**: inner builder with no condition → no phase added; inner builder with a retriever (knn/semantic) → `TypeError`. **D11 check:** module function `assertRescoreSort(sort)` (+ `isScoreDescending`), called in `getBody()` right after `body.rescore` is set, when `body.sort` exists. Server (observed): only a lone `_score` desc is accepted (`'_score'`, `{_score:'desc'}`, `{_score:{order:'desc'}}`); `_score` asc, any field, and `_score` desc + tie-breaker are all rejected with "Cannot use [sort] option in conjunction with [rescore]". Throws `TypeError`. **QB6/QB9: keep this call** when reworking `sort`/`getBody`.
- **B-013** (reproduced: `max` on keyword → 400), **B-046** (reproduced: multi-key order object applies only its *last* key; dotted sub-agg name → `invalid_path`): `aggregateTerm` order built by `buildTermsOrder()`: `_count`/`_key` as is, the aggregated field → `_key` (no sub-agg), other fields → sub-agg `__order_<i>` with `min` for asc / `max` for desc (the old mapping was inverted; now matches ES multi-value sort modes). One criterion → object, several → array. Empty `orderBy`, bad `order`/`field` → `TypeError`.
- **B-047** (reproduced: `[terms] unknown field [missing_bucket]`, same for `missing_order`): both options removed; new `missing?: TermValue`. Passing either removed key throws `TypeError` pointing to `missing`.
- **B-053**: `includeFacets({ fields, limit = 25 })` implemented (one `aggregateTerm` per field), returns `this`.
- **B-097 (aggs/rescore)**: `aggs()` structuredClones its input (and throws `TypeError` for non-objects/arrays); `getAggs()`, `getRescore()`, and `getBody().aggs`/`.rescore` return copies.
- **B-098**: `aggregate*` call private `_defaultToNoHits()`: sets `_limit = 0` only when no limit was set, and flags it (`_limitFromAggregations`). `reset('aggs')` then restores `limit` to null; `limit()` and `reset('limit')` clear the flag; `clone()` copies it. Touched one line each in `limit`, `reset`, `clone`, and the `limit(0)` line of `aggregateHistogram`/`aggregateDateHistogram`/`aggregateGeotileGrid`.
- **B-099 / S-025 (my methods)**: JSDoc rewritten for `rescore`, `getRescore`, `aggregateTerm` (example syntax fixed, `exclude` = term values, no "composite" claim), `includeFacets`, `aggs`, `getAggs`. `limit` and `exclude` validated (`RangeError`/`TypeError`), `exclude` copied.

## Public API (CHANGELOG)
- Breaking: `aggregateTerm` drops `missing_bucket`/`missing_order` (throw), orders by other fields via `min`(asc)/`max`(desc) sub-aggs named `__order_<i>` (visible in buckets), throws on `limit` < 1. `getBody()` throws for rescore + non-`_score`-desc sort. `aggregate*` no longer override a user limit. `aggs()` copies; getters return copies.
- Added: `rescore` options `queryWeight`, `rescoreQueryWeight`, `scoreMode`; `windowSize` optional; `includeFacets` works. New exported types in `QueryBuilder.ts`: `RescoreOptions`, `TermsOrderBy<Field>`, `AggregateTermOptions<Field>`.

## For other tasks
- **QB6**: `sort('_score')` emits `{_score:{order:'asc'}}`, which the D11 check (correctly) rejects with rescore; my tests use raw `_sorts` for that reason. `sort()` types reject `{_score:'asc'}`/`[{price:'asc'}]` shapes the runtime accepts.
- **QB5**: S-022 `name` option for `aggregateTerm` not done (yours). **QB9**: rescore on the retriever path (`canRescore` logic) untouched.
- **DOCS**: export the 3 types above; README rows: `aggregateTerm({ field, limit, exclude, orderBy, missing, showTermDocCountError })` (not `order`), `rescore(withBuilder, { windowSize, queryWeight, rescoreQueryWeight, scoreMode })`, `includeFacets` sets size 0, rescore + sort rule, `aggregate*` default size 0 only without a limit.

## Tests
- `QueryBuilder.rescore-terms.spec.ts` (31 unit + type tests). `QueryBuilder.rescore-terms.integration.test.ts` (18 tests, serverless, no capability gating; Docker not run). Run against the pre-fix builder: 13/18 fail. No pre-existing test file edited.
- Gate: `bun test src/QueryBuilder` 323 pass; QueryRunner + IndexManager.fields + readmeSamples + typesOnlyImports 36 pass; biome clean; typecheck: only the 6 baseline `QueryBuilder.ts` errors + 1 `publicExports.spec.ts`.
- Note: `git status` showed my new spec file staged (`AM`) by someone else; I ran no git write commands.
