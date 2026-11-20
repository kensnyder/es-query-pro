# QB6 handoff — paging, sorting and score functions

## Findings fixed
- **B-014**: `sort('_score')` → `{ _score: { order: 'desc' } }` (best match first, confirmed on serverless); `sort('_score', 'asc')`/`'-_score'` honored; other fields still default to `asc`. Works with QB4's `assertRescoreSort()` (kept in `getBody()`).
- **B-055**: `sort(clause | clause[])`; `SortClause = SortCombinations | { [field]: SortOrder }`. Strings, `{f:'asc'}` (→ `{f:{order}}`), option objects (copied, not double-wrapped; `order` validated), several-key objects (one clause per key, key order) and `_geo_distance`/`_script` objects. Overloads: `sort(field: string, direction?)`, `sort(clause | clause[])`; a direction with an object/array is a type error and a `TypeError`. Bad input → `TypeError`/`RangeError`, nothing added. `getSort()` returns a copy.
- **B-056 / S-054**: `getOptions()` computes `from` from `limit ?? 10`, so `page(3)` alone → `from: 20`; `from` is omitted when 0. `page()` needs an integer >= 1, `limit()` an integer >= 0 (`RangeError`; non-number `TypeError`).
- **B-041**: server confirmed (`[from] parameter must be set to 0 when [search_after] is used`). `getOptions()`/`getQuery()` throw `TypeError` when `searchAfter()` is set and `page() > 1` (I chose throwing over silently dropping `from`).
- **B-103 / S-060**: `reset('shouldSortByRandom')` works and is in the no-argument list; `reset('sorts')` still also clears random sort; unknown names throw `TypeError` (nothing reset). No nested ternary or shadowed names in `sort`/`reset`.
- **S-028**: `sortByRandom(enabled = true, { seed, field })`: with a seed → `random_score: { seed, field: field ?? '_seq_no' }` (stable pages, verified); `field` without `seed` → `TypeError`; `false` forgets the seed. When `sort()` clauses exist and the first is not `_score`, the body puts `_score desc` first (field sorts become tie-breakers; enables random + `searchAfter`). `boost_mode: 'replace'` only if no `boostMode` option is set. Observed: a seed without `field` is accepted by serverless; `field: '_id'` is rejected (fielddata disabled).
- **S-053**: new `scoreFunction(fn)` (copies; `TypeError` for non-objects); `decayFunctionScore` is an alias. New `functionScoreOptions({ scoreMode, boostMode, maxBoost, minScore })` (merges, `undefined` removes, unknown keys/modes `TypeError`, non-finite `RangeError`), sent only when a function or random sort exists; `getFunctionScoreOptions()`. `reset('functionScores')` clears both.
- **S-029 (these methods)**: covered by the new spec and integration file.

## Public API (CHANGELOG)
- **Breaking:** `sort('_score')` is now descending; sort objects are normalized to `{ field: { order } }` (`{ _score: 'desc' }` → `{ _score: { order: 'desc' } }`); `page()` without `limit()` now pages by 10; `limit()`, `page()`, `sort()`, `sortByRandom()`, `reset()` throw on invalid input; `searchAfter()` + `page() > 1` throws at `getQuery()`; random sort now overrides field sorts.
- **Added:** `scoreFunction`, `functionScoreOptions`, `getFunctionScoreOptions`, `getSortByRandomOptions`, `sortByRandom` options. New types in `QueryBuilder.ts`: `SortClause`, `RandomSortOptions<Field>`, `FunctionScoreOptions`.

## For other tasks
- **DOCS:** export the 3 types. README rows: `sort` forms and `_score` default, `page` (default size 10), `searchAfter` (page 1 only), `sortByRandom(enabled, { seed, field })` (`_seq_no` ties across shards → add a tie-breaker sort), `scoreFunction`/`decayFunctionScore` alias, `functionScoreOptions`, `reset` names.
- **QB9:** `getBody()` now takes sorts from private `_getSortClauses()` (a copy) in both standard branches; `getOptions()` paging lines and the `search_after` throw are mine. I added two lines to `clone()` (`_randomScore`, `_functionScoreOptions`). `getFunctionScores()` still returns the live array (B-104 is yours).
- **QR:** feed a hit's `sort` array to `searchAfter()` only on page 1 (otherwise `getQuery()` throws `TypeError`; convert to the envelope). `count()` must keep stripping `from`/`search_after`.
- `getSortByRandomOptions()` returns the untyped `RandomSortOptions`: typing it with `Field` made `QueryBuilder<'a'>` unassignable to `QueryBuilder` (`QueryBuilder.fields.spec.ts`).

## Pre-existing tests edited
- `QueryBuilder.spec.ts` sort test: `{ _score: 'desc' }` now expected as `{ _score: { order: 'desc' } }`; dropped two `as any` casts.
- `QueryBuilder.rescore-terms.spec.ts`: removed the stale "sort('_score') emits ascending (QB6)" comment; the allowed `_score` sorts are also checked through public `sort()`.

## Tests (serverless target; Docker not run; no capability gates)
- `QueryBuilder.paging-sort.spec.ts` 44 unit + type tests (31 failed before the fix). `QueryBuilder.paging-sort.integration.test.ts` 17 tests: `_score` both directions, array/option/multi-key sorts, `page()` without limit, `searchAfter` walk, server rejection of `from` + `search_after`, seeded random pages (stable, disjoint, seed-dependent, `_seq_no` + tie-breaker with `searchAfter`), `function_score` options.
- Gate: `bun test src/QueryBuilder` 444 pass; QueryRunner + IndexManager.fields + readmeSamples + typesOnlyImports 36 pass; biome clean; typecheck: only `linear` in `QueryBuilder.ts` + `publicExports.spec.ts` (others are the parallel agent's `src/IndexManager/*`/`src/SchemaRegistry/*`).
