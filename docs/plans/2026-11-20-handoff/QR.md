# QR handoff — QueryRunner

## Findings fixed
- **B-017** (reproduce-first, **reproduced** on serverless and Docker 9.1.10: `_count` → 400 `parsing_exception: request does not support [sort]`). `count()` now sends `{ index, query }` plus `min_score` from `minScore()` and `more` (`more` wins); paging, sort, aggs, highlight, `_source`, `search_after`, `track_total_hits`, rescore are never sent.
- **B-018 / D10**: retrievers are detected with `getRetrievers()` *before* `getBody()`; returns `{ total: null, request: null, error: Error('count() does not support retrievers …'), errorKind: 'javascript' }`, nothing sent. All request building is inside `try`.
- **B-019**: `findFirstOrThrow()` rethrows `result.error` (ResponseError, ConnectionError, builder TypeError) before the not-found check. Not found: `Error` with `name: 'NotFoundError'`, `status: 404`, `result` (no `@ts-expect-error`).
- **B-020 / B-059 / S-033**: one fixed Painless script `UPDATE_MANY_SCRIPT` (exported from `QueryRunner.ts`) walks `params.updates = [{ path: string[], value }]`; field names never enter the source. Missing/null parents become maps; a list on the way (nested arrays) sets the field on every object in it; a scalar on the way throws (`is not an object`). Keys validated at run time against `getAllFields(createSpec, { containers: true })`, plus paths allowed by a loose `dynamic` (`true`/`'true'`/`'runtime'`, per object, inherited) or inside `flattened`. Rejected without a request (RangeError/TypeError envelope): empty/all-undefined values, empty segments (`''`, `'.'`, `a..b`), unknown keys (all listed), sub-fields (`title.raw`), a key inside another key (`publishing` + `publishing.year`), non-object input. `undefined` values are skipped.
- **B-060**: `limit()` → `max_docs`; `conflicts: 'proceed'` default; `more` overrides. `limit(0)` (also set implicitly by `aggregate*()`) returns an error envelope instead of sending `max_docs: 0` (server: 400 `[max_docs] should be >= [slices]`). No `refresh` default (same as `deleteMany`).
- **B-061**: `updateMany()` never throws: `{ success, updated, total, versionConflicts, noops, failures, request, took, error, errorKind, response }`, mirroring `deleteMany` (failures → `AggregateError`, `timed_out` → error, both `errorKind: 'response'`, `response: { statusCode: 200, body }`).
- **B-065**: `QueryRecord<Create> = MappingRecord<Create> & { _id: string; _score: number | null; _highlight?; _sort? }`, mapped from the hit (meta keys win over `_source` keys).
- **B-108**: every runner result has `error`, `errorKind`, `response` via `index._formatError`/`_formatNonError`; on error `total: null`, `aggregations: null`, `records: []`; `aggregations` is `null` when absent; `findFirst` `record: null`; `took` is wall-clock ms everywhere (as in IndexManager); `request` is null when nothing was sent (builder threw).
- **S-030**: `findFirst()` passes `{ size: 1, ...more }` through `getQuery(overrides)`; builder untouched. `findMany(more)` also uses `getQuery(more)` (windows sized for overrides).
- **S-006**: `QueryRunner.spec.ts` 67 tests (54 failed on the pre-QR code). **S-063 (runner)**: commented-out code, `toPainlessSourcePath`, `as any` removed.

## Public API / breaking (CHANGELOG)
- Removed `QueryRunner.toPainlessSourcePath()`. `updateMany` returns an envelope (was the raw ES response, and threw); `more` excludes `script`; defaults `conflicts: 'proceed'`; honors `limit()`; rejects unknown keys at run time.
- `findFirst` `record` is `null` (was `undefined`); `findMany.took` is wall-clock (ES's is in `response.took`); error `response` is the error meta (was null); `aggregations` null when absent; new `errorKind`.
- `count()` with retrievers returns the D10 envelope (was a rejected promise).
- `request` stays the client params object (not IndexManager's `{ method, endpoint, body }`): `IndexManager.integration.test.ts` asserts `res.request` has `index`/`query`.

## For other tasks (IMPORTANT, routed by orchestrator)
- **`src/IndexManager/IndexManager.fields.spec.ts:106-108` now fails** (`bun test`): it asserts the old injected script contains `ctx._source['categories']['name']` (the B-020 bug). Replace with: `expect((sent.at(-1)?.body as any).script.params.updates).toEqual([{ path: ['title'], value: 'x' }, { path: ['categories', 'name'], value: 'y' }]);`. Typing assertions in that file still pass.
- **IndexManager wrappers** (`findMany`/`findFirst`/`count` catch, owner IM lane): align with runner: `findFirst` error `record: null` (now `undefined`), `findMany`/`findFirst` error `took: Date.now() - start` (now `null`). Not required for correctness; the result types are unions today.
- **DOCS**: export from `index.ts`: `QueryUpdateManyResult`, `QueryFindParams`, `QueryCountParams`, `QueryUpdateManyParams`, `QueryUpdateValues`, `QueryNotFoundError` (all in `QueryRunner.ts`); README: updateMany semantics (validation, lists, missing parents, `limit`, `conflicts`, no refresh default), count ignores paging/sort and refuses retrievers, record meta keys and `_sort` → `searchAfter()` (page 1 only).

## Tests
- `QueryRunner.integration.test.ts` 17 tests, no capability gates (knn retriever is basic-license); pass on serverless and Docker 9.1.10. Highlight assertion tolerates `<em class="hlt1">` (Docker default tags differ).
