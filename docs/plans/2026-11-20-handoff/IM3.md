# IM3 handoff — CRUD

## Findings fixed
- **B-033** `deleteMany(cb, more)` merges `more` into the request (`conflicts`, `refresh`, `max_docs`, ... reach the server); typed `IndexDeleteManyParams = Omit<DeleteByQueryRequest, 'index'|'query'>`.
- **B-034 / D6** no guard: no callback or a condition-less builder deletes everything (`match_all`, stated in JSDoc). A builder with no `query` (retriever-only, e.g. `knn()`; also `semantic()`, which emits a `standard` retriever) sends nothing and returns an error envelope (`errorKind: 'javascript'`). Server check: `_delete_by_query` without a query → 400 `query is missing`.
- **B-039 / S-015** `putBulk`: only `undefined`/`null` ids get a UUID (`0` → `'0'`; `''` is sent and ES rejects that row, observed: `if _id is specified it must not be empty`, other rows stored). `report` rows are `{ id, status, effect, version, error }` (null, not undefined), one per record, in order, including generated ids. Full envelope; `more` no longer copied into the result. Empty array sends nothing. Chunks by `chunkSize` (default 1000 records) and `chunkBytes` (default 5 MiB of serialized records) via a new 3rd arg `options`; stops at the first failed request (unsent rows `status: null`). Row errors → `error: AggregateError`, `errorKind: 'response'`, `response: { statusCode: 200, body: <merged BulkResponse> }`. Success `response` is the merged `BulkResponse`. `bulkBody: any[]` gone.
- **B-085** `patch().result` is ES's (`noop`, `created`, `updated`); verified on the server.
- **B-086** `findById` returns `request` and `found` on every path; a missing doc (404 with `found: false`) is `{ record: null, found: false, error: null, response: <404 body> }`; a missing index stays an error. `more` can no longer replace `index`/`id`.
- **B-087** `findMany`/`findFirst`/`count`/`deleteMany` catch callback errors (sync or async) and errors thrown while building the request, returning an envelope.
- **S-014** `put(id, body, more?)` and `deleteById(id, more?)` take params (`refresh`, `if_seq_no`/`if_primary_term`, `op_type`, `routing`); all id params are `IndexRecordId = string | number`. `patch` sends `retry_on_conflict: 3` unless `more` sets it or `if_seq_no`/`if_primary_term` (ES rejects both together).
- **S-016** `deleteMany` result: `{ success, deleted, versionConflicts, failures, request: { method, endpoint, body }, took, error, errorKind, response }`. `failures` or `timed_out` → `success: false` with an error (`AggregateError` for failures). With `conflicts: 'proceed'`, conflicts are counted and `success` stays true. Uses `QueryBuilderProvider`.
- **S-017 (CRUD)** `IndexManager.crud.spec.ts` (45 tests, recording client).
- **B-017 (IM part)** `count(cb, more?: IndexCountParams)` with `IndexCountParams = Omit<CountRequest, 'index'|'query'>`.

## Breaking changes (CHANGELOG)
- `patch()` `result` is `null` on failure (was `'error'`); `patch()` sends `retry_on_conflict=3` by default.
- `putBulk()` report rows renamed/added `id`, nulls instead of undefined; new `error`/`errorKind`/`response` keys; `more` excludes `index`/`operations` and is not echoed. Method is `POST /<alias>/_bulk` in `request`.
- `findById()` 404-not-found is no longer an error; adds `found`, `request`.
- `deleteById()` adds `result`. `deleteMany()` result shape (above); `more` type changed. `count()`'s `more` type changed (search-only keys like `size`/`sort` rejected by tsc).
- `patch`/`findById`/`put` `more` types omit `index`/`id`/`doc`/`document`.

## For other tasks
- **QR**: IndexManager's `findMany`/`findFirst`/`count` error branch is `{ ..., request: null, error, errorKind, response }` (`findFirst`: `record: undefined`). Runner results have no `errorKind`, so the return type is a union; please add `errorKind` (via `index._formatError`) to the runner's shapes. Runner still builds requests outside `try` (`getQuery()` throws reach direct `run()`/runner callers), and `count` still sends search keys (rest of B-017).
- **DOCS**: export from `index.ts` (all in `IndexManager.ts`): `IndexRecordId`, `IndexPutParams`, `IndexPutBulkParams`, `IndexPutBulkOptions`, `IndexPutBulkReportRow`, `IndexPatchParams`, `IndexFindByIdParams`, `IndexDeleteByIdParams`, `IndexDeleteManyParams`, `IndexCountParams`, `IndexFindByIdResult`, `IndexDeleteManyResult`. `src/types.ts` `GetRequestParams`, `BulkRequestParams`, `PatchRequestParams` are no longer used by the library (still exported/pinned). README: document D6 for `deleteMany()`, putBulk chunking and `''` ids, `findById` not-found.
- **Orchestrator**: a scratch probe `src/IndexManager/zz_probe_im3.integration.test.ts` was auto-staged (IDE) and then deleted; run `git rm --cached` on it (I may not run git writes).

## Lane test file edited
- `IndexManager.spec.ts` "should send the fields to merge under "doc"": expects `querystring: 'retry_on_conflict=3'` (S-014).

## Tests
`IndexManager.crud.integration.test.ts`: 18 tests, all pass on serverless (the `conflicts: 'proceed'` test throttles `_delete_by_query` with `scroll_size: 1`, `requests_per_second: 0.5`; passed 4/4 runs). No capability gates. Docker target not run.
Gate: `bun test src/IndexManager` 222 pass; SR/QR/typesOnlyImports/readmeSamples/QB integration 65 pass; biome clean; typecheck: only the known `publicExports.spec.ts` error outside `src/QueryBuilder/*`.
