# IM1 handoff — error envelope, existence and metadata

## Findings fixed
- **B-007** — `aliasExists()` no longer `console.log`s; non-404 errors return `_formatError(e)`. `drop()` now calls `aliasExists()` inside its `try`, so it resolves even if the check rejects.
- **B-077** — `IndexErrorShape` is now the error envelope `{ error: Error; errorKind: IndexErrorKind; response: ErrorMeta | null }`, and `_formatError()` is declared to return it.
- **S-001** — classified by `name`: `RequestAbortedError`→`aborted`, `SerializationError`/`DeserializationError`→`serialization`, `ProductNotSupportedError`→`product`, `ConfigurationError`→`configuration`. `_formatError().error` is always an `Error`: other thrown values (`null`, `undefined`, strings, error-like objects) are wrapped, keeping `name`/`message` and setting `cause` to the thrown value. A thrown `undefined` used to give `error: undefined`, which looked like success.
- **S-037** — `IndexRunShape<T>` is now `QueryRunner<IndexInferCreate<T>>`, the runner `run()` passes to its callback. It used to be `ReturnType` of a generic method, which is always `unknown`.
- **S-038** — `flush()` targets `getFullName()`, so it works after `createOnly()`. Serverless skips `_flush`, so this only shows on stateful clusters. Covered by a unit test; the integration test passes on serverless only as a skip.
- **S-039** — reproduced on serverless. `getAliasMetadata()` treats a 404 as "no alias" only when the body's `error` is a string (`alias [x] missing`). A missing `more.index` (`index_not_found_exception`) and a 404 without a body are now errors. With several names where only some exist, `indexes` lists the ones found.
- **S-040 (these methods)** — `console.log` removed. `request.endpoint` is now built from the merged body, so it reflects `more.index`/`more.name` (lists joined with `,`) in `exists`, `aliasExists`, `getIndexMetadata`, `getAliasMetadata` and `flush`. `performance.now()` for `took` was not adopted, to keep `took` consistent across all methods; it is left for the lane to decide. The `else`-after-`return` and `const res` shadowing in `createAliasIfNeeded` belong to IM2.
- **S-002 (these methods)** — `IndexManager.metadata.spec.ts` (37 tests).

## Envelope (for IM2–IM5, SR, QR)
Success: `{ ...fields, request: { method, endpoint, body }, took, error: null, errorKind: null, response: T }`.
Failure: `{ ...fields, request, took, error: Error, errorKind: IndexErrorKind, response: ErrorMeta | null }` (`response` is non-null only for `errorKind: 'response'`). Checking `errorKind === 'response'` or `!res.error` narrows `response`.
`IndexErrorKind = 'response' | 'connection' | 'timeout' | 'disconnected' | 'aborted' | 'serialization' | 'product' | 'configuration' | 'javascript'`.
New private helpers in `IndexManager.ts` that later tasks can reuse: `isResponseStatus(e, code)`, `toPathPart(names)`, `getAliasEndpoint(body)`, `getMissingAliasEntries(e)`. `toError(e)` now keeps `name`/`message`/`cause`.

## Breaking changes (CHANGELOG)
- `IndexErrorKind` has 4 new members, so an exhaustive `switch` needs new cases.
- `IndexErrorShape` is now an object type (it was a function type).
- `IndexRunShape<T>` is now the `QueryRunner` type (it was `unknown`).
- `flush()` flushes the versioned index, not the alias.
- `getAliasMetadata()` returns `success: false` for a missing `more.index`.
- `aliasExists()` returns `response: false` on the (rare) thrown 404 path (was the error meta).

## For DOCS
- **`src/publicExports.spec.ts:138-140` pins the old 5-member `IndexErrorKind`.** It now fails `bun run typecheck` (1 error, TS2344) until it is updated to the union above. `bun test` still passes. IM1 may not edit that file.
- No new exports are needed.
- README: on Bun, pass `Connection: HttpConnection` to the client. With the default undici connection, a refused connection surfaces as a `TypeError` (`errorKind: 'javascript'`) instead of a `ConnectionError`.

## Tests
- `IndexManager.metadata.integration.test.ts`: 13 tests, all pass on the serverless target. No capability gates (the flush test asserts `skipped === caps.serverless`). The closed-port test binds and releases a local port and uses `HttpConnection`. Docker target not run (no daemon).
- Pre-existing lane test files are unchanged.
