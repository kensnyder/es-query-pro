# QB1 handoff — config, source filtering and highlighting

## Findings fixed
- **B-011** (reproduced, serverless): `_source: [...]` + `_source_excludes` (sent as URL param) returned every field but the excluded one; `toKibana()` body was rejected (`Unknown key for a START_ARRAY in [_source_excludes]`). `getQuery()` now always emits one body `_source` (new private `_getSource()`): `['*']` by default, the includes array when nothing is excluded, `{ includes, excludes }` otherwise. `_source_excludes` is never emitted.
- **S-049**: `fields([])` emits `_source: false` (also when excludes are set). Previously `_source` was omitted.
- **B-044** (reproduced, serverless, D3): `fvh` on a field without term vectors (`title`, keyword `country`) is not always an error: with 6 shards the search returns 200, **0 hits** and `_shards.failures` ("should be indexed with term vector..."); with `allow_partial_search_results: false` it is a 400. `getDefaultHighlighter()` now returns `type: 'unified'` (other defaults unchanged). Per-field `type` overrides via `highlightField(name, { type })` already worked; now documented.
- **S-043**: `highlighterOptions()` now **merges** into the current options; a key passed as `undefined` is removed; a runtime `fields` key is ignored.
- **B-090**: copies on input (`fields`, `sourceIncludes`, `excludeFields`, `sourceExcludes`, `highlighterOptions`, `highlightField`, `searchAfter`) and on output (`getFields`/`getExcludeFields`/aliases, `getHighlighter`, `getSearchAfter`, `getBody().highlight`, `getOptions().search_after`, `getQuery()._source`).
- **S-044**: `rankWindowSize`/`rankConstant` require an integer >= 1, `minScore` a finite number, `trackTotalHits` a boolean or integer >= 0 (`-1` rejected; use `false`). `TypeError` for wrong types, `RangeError` otherwise. `fields`/`excludeFields` throw `TypeError` unless given an array of strings; `searchAfter` unless given an array.
- **B-095 (config part)**: `rankConstant` JSDoc (>= 1, no upper limit, ES default 60, builder default 20), getter JSDoc ("otherwise undefined" removed where a number is always returned), `_rankConstant` comment. The match-method parts and "multipe" (in `matchPhrase`-family JSDoc) are left for **QB2**.
- **S-020 (these methods)**: covered in `QueryBuilder.source.spec.ts` (fields+excludes serialized together, default highlighter output, scalar getters).

## Public API changes (breaking, for CHANGELOG)
- Default highlighter type `fvh` → `unified`.
- `highlighterOptions()` merges instead of replacing.
- `fields([])` → `_source: false`; with excludes, `_source` becomes `{ includes, excludes }` and `_source_excludes` disappears from `getQuery()`.
- Numeric setters, `fields`/`excludeFields` and `searchAfter` throw on invalid input.
- Getters return copies. No new exports; `index.ts` unchanged.

## For other tasks
- **QB6**: `searchAfter()` + `page() > 1` still emits both `search_after` and `from` (S-020 item not tested here; ES requires `from: 0` with `search_after`).
- **QB8**: "rrf when `rankWindowSize()` is called after it" (S-020 item) belongs to B-043; `rankWindowSize`/`rankConstant` now validate, so B-043 can rely on valid stored values.
- **QB9**: I touched only the `highlight` line of `getBody()`, the `search_after` line of `getOptions()`, and `_source` in `getQuery()`.
- **QR**: `QueryRunner.count()` strips `_source`; it no longer needs to worry about `_source_excludes`.

## README/CHANGELOG notes (DOCS)
- README rows for `highlighterOptions` ("merges"), `highlightField` (default `unified`; `fvh` needs `term_vector: with_positions_offsets`), `rankConstant` (integer >= 1), `fields([])` (no source), and that `fields` + `excludeFields` combine.

## Tests
- `QueryBuilder.source.spec.ts` (32 unit tests, incl. recording client: excludes sent in body, not URL).
- `QueryBuilder.source.integration.test.ts` (12 tests, serverless target; no capability gating; Docker not run). Includes raw-server tests documenting B-011 and B-044 behavior.
- No pre-existing test file was edited.
