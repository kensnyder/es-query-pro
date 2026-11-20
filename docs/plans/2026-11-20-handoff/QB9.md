# QB9 handoff — retriever-path serialization and output safety

## Findings fixed (reproduce-first ones reproduced on serverless 9.7 and stateful 9.1.10)
- **B-040** (reproduced): rrf/linear with `size` > `rank_window_size` → 400 `[linear|rrf] requires [rank_window_size: 50] be greater than or equal to [size: 100]`; `from + size` past the window → 200, 0 hits. ES checks only a `size` the request **sends** (no `limit()` → no check, and a compound retriever then returns up to rank_window_size hits, not 10). D11: unless `rankWindowSize()` was called (new private flag `_rankWindowSizeSet`; `reset('rankWindowSize')` clears it, `clone()` keeps it), the window sent is `max(50, from + size, every explicit rescore windowSize)`, also for rrf inside linear and in `getRetrievers()`. `getQuery({ size, from })` overrides are covered too. Explicit window < sent `size` with rrf/linear → `RangeError`.
- **B-058** (partly reproduced): `retriever` + `sort` / `search_after` / top-level `rescore` → 400 `cannot specify [retriever] and [X]` on both targets. **`min_score` did not reproduce**: accepted and applied on both, so it is still sent. Now `getBody()` throws `TypeError` for retrievers + `sort()` (incl. `_score`), `sortByRandom()`, score functions (S-027: they had nowhere to go); `getOptions()`/`getQuery()` for retrievers + `searchAfter()`. One error lists every problem.
- **S-021 (retriever part, D11)**: rescore with retrievers → `{ rescorer: { retriever, rescore } }` (accepted on both targets). Server rules found: every rescorer `window_size` >= sent `size`, and <= the wrapped rrf/linear rank_window_size. A phase without `windowSize` gets the rank window; violations throw `RangeError`. Query path unchanged (top-level `rescore`, QB4's `assertRescoreSort()` kept).
- **S-057 bullets 2–3**: a lone retriever + conditions is no longer wrapped in `linear` (+ minmax): conditions go in that retriever's own `filter` (knn/standard/rrf; appended after a knn filter). Several retrievers still use `linear.filter`. Bullet 2 per D5: conditions stay filters on the retriever path (documented in `getBody()`).
- **B-104 / S-058**: `getBody()`/`getQuery()` output shares nothing with the builder (`_buildBoolQuery()` copies); `getMust()`/`getFunctionScores()` return copies. `clone(): this` copies every own property with a new `copyState()` (arrays, plain objects, Dates; functions/class instances shared; `__proto__` keys kept plain), so subclass instances and fields survive and it never throws.
- **B-057**: `toKibana()` prints `GET _search` without an index. **S-059 / D12**: `valueOf()` removed. **S-029**: covered by the new spec.

## Public API (CHANGELOG, breaking)
- `valueOf()` removed (README table row "valueOf() | Coerce to value" must go — DOCS; no compiled sample uses it).
- Lone retriever + conditions: `retriever.{knn|standard|rrf}.filter` instead of `linear` → raw (unnormalized) scores.
- Retrievers + sort/searchAfter/sortByRandom/score functions throw; explicit too-small windows throw (`RangeError`); rescore with retrievers now applies (was dropped or sent where ES rejects it); rank window auto-raised.
- `clone()` returns `this` type; `getMust()`/`getFunctionScores()` return copies. No new exported types.

## For other tasks
- **QR**: `getBody()`, `getOptions()`, `getQuery()` can now throw `TypeError`/`RangeError` (above); `findMany` calls `getQuery()` outside its try — convert to the envelope. `count()` destructures `getQuery()`: with retrievers it should return the D10 envelope *before* calling `getQuery()` (which may throw). No new search-only top-level keys were added; a retriever body may now be `rescorer`.
- **DOCS**: README rows for `rankWindowSize` (auto-raise, explicit = as is), retriever-path rules (filters, rescorer, throws, `min_score` OK), `toKibana`, `clone`. Note that ES returns rank_window_size hits for rrf/linear when no `limit()` is set.
- Left: `rescore()`'s inner builder still bypasses `_runSubBuilder` (QB4's method, not mine).

## Docker-only failures triaged (all test artifacts of shard count, not library bugs)
1. match `a Date with a non-ISO format matches nothing`: 9.1 (1 shard) → 400 `parse_exception` (failed to parse date field); serverless → 200, 0 hits. Now asserts "no hits or that error", plus 400 everywhere with `allow_partial_search_results: false`.
2./3. source `fvh fails on a text/keyword field…`: 9.1 → whole search 400 (`should be indexed with term vector…`); serverless → 200, 0 hits + shard failures. Now accepts either, both checked for "term vector"; partial-off part unchanged.
4. term `moreLikeThis several fields`: Lucene MLT queries each term only in the field with the highest shard-local doc freq (first on ties); with 1 shard 'hiking' maps to `title`, so '2' (hiking in body) is missed. Now uses like `'leather tent'` (unambiguous): title only → ['3'], title+body → ['1','3'] on both.

## Pre-existing tests edited
- `QueryBuilder.spec.ts`: `valueOf()` now `toBe(query)` (D12). `QueryBuilder.bool.spec.ts`: lone knn filter is `retriever.knn.filter` (S-057). `QueryBuilder.retrievers.spec.ts` + `.retrievers.integration.test.ts` linear-settings tests: added a second retriever (weight 0 in integration) so the body is still `linear`. Plus the four triaged files above.

## Tests and gate
- `QueryBuilder.serialize.spec.ts` 44 unit + type tests (31 failed on the pre-QB9 builder). `QueryBuilder.serialize.integration.test.ts` 18 tests; gated: `retrievers` (7, ran on both), `retrievers && inference` (rrf limit(100), ran on serverless only).
- `bun test src/QueryBuilder`: serverless 635 pass; Docker 9.1 629 pass, 6 skip (inference). IndexManager.fields/crud + readmeSamples + typesOnlyImports 81 pass; QueryRunner/IndexManager specs pass; biome clean; typecheck: only the known `publicExports.spec.ts` + `SchemaRegistry/*` errors.
