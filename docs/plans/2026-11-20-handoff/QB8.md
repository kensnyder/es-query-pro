# QB8 handoff — retriever builders

## Findings fixed
- **B-043**: retriever methods store an intent (private `_retrievers: RetrieverIntent[]`); the DSL is built at `getBody()`/`getRetrievers()` time, so `rankWindowSize`/`rankConstant`/`normalizer` apply in any call order and follow `reset()`. Server: `rrf().rankConstant(60)` → top score 2/61; `rrf().rankWindowSize(1)` → 1 hit.
- **B-042**: `weightedSemantic` uses the builder's rank settings and normalizer (was hardcoded 100/10/minmax; defaults are now 50/20).
- **B-012 (D3)**: new `exactField?: Field | false` (default `${standardField}.raw`; `false` drops the contains clause, S-046). Server: on a keyword `.raw` the contains clause adds its constant boost (6) and puts the literal-phrase doc first; on an unmapped field it silently matches nothing.
- **B-089**: `boosts` is now `[contains, phrase, match]` (default `[6, 4, 1]`); the 4th (semantic) boost is removed (RRF uses rank only) and passing 4 throws `TypeError`. JSDoc says `weight` only applies inside `linear`.
- **B-048** (reproduced: `similarity: 'cosine'` → 400 `number_format_exception`): `similarity?: number`; strings throw `TypeError`. `knnDef` cast and `InferenceCohereSimilarityType` import gone.
- **B-092 / S-023**: `weight` optional (default 1) in `knn`/`semantic`/`rrf`/`weightedSemantic`, validated `>= 0`. knn: field non-empty, vector non-empty finite numbers, `k` integer >= 1, `numCandidates` integer >= k, filter objects only; `filter: []` omitted. Not added: `query_vector_builder`, `rescore_vector`.
- **B-097**: knn vector/filter copied on input; `getRetrievers()` builds new objects each call.
- **S-018**: `normalizer(n)` (`none`/`minmax`/`l2_norm`, else `TypeError`); `getNormalizer()` typed.
- **S-045**: blank phrase (`''`, whitespace, null, undefined) adds nothing in `weightedSemantic`, and also `rrf`/`semantic` (same rule); non-string → `TypeError`.
- **S-020**: covered (weightedSemantic, rrf with `rankWindowSize()` after, knn similarity).

## Found on stateful 9.1 (fixed in library)
- knn retriever **requires `num_candidates`** on 9.1 (`Required [num_candidates]`): `knn()` now always sends it, default `max(k, min(ceil(1.5k), 10000))` (ES's own default).
- 9.1 rejects a top-level `linear.normalizer` with `retrievers`: the normalizer now goes only on each inner retriever (also fixes QB7's gated linear test on 9.1).
- `int8_hnsw` (9.1 default) quantization let cosine 0.943 pass a 0.95 cutoff: my test index uses `index_options: { type: 'hnsw' }`.

## Public API (CHANGELOG)
- Breaking: `weightedSemantic` boosts 3-tuple, rank defaults now builder's (50/20); `knn` similarity numeric only and always sends `num_candidates`; linear body has no top-level `normalizer`; retriever methods throw on invalid input; blank phrases are no-ops; `_retrievers` is private (intents, not DSL).
- Added: `normalizer()`, `exactField`. New types in `QueryBuilder.ts`: `KnnOptions`, `SemanticOptions`, `RrfOptions`, `WeightedSemanticOptions` (all `<Field>`).

## For other tasks
- **QB9**: `getBody()` retriever branch is now one line: `body.retriever = this._getRetrieverBody(hasFilters)`. New private helpers after `getRetrievers()`: `_getRetrieverBody(hasConditions)` (lone retriever or `linear` with `filter: [_buildBoolQuery()]`) and `_buildRetriever(intent)`; module helpers `semanticRetriever`, `weightedLexicalRetriever`. The `linear` tsc error is fixed. `reset('retrievers')` sets `[]`; `clone()` structuredClones intents (unchanged line). Linear needs `rank_window_size >= size` (server: `[linear] requires [rank_window_size: 2] be greater than or equal to [size: 10]`); rrf does not reject it, it returns at most rank_window_size hits (B-040 is yours).
- **DOCS**: export the 4 types; README: `weightedSemantic` row (options, `exactField`, boosts slots, mapping must declare the keyword sub-field, leading wildcard cost), `normalizer()` row, knn `similarity` is a number, `numCandidates` default, `weight` optional and only used in `linear`.
- **Orchestrator**: on 9.1 four other QB integration tests fail (range Date+format, two fvh B-044 raw tests, moreLikeThis several fields); not in my files. `rrf`/`weightedSemantic` gated locally on `caps.retrievers && caps.inference` (kit `testIf` takes one cap).

## Tests
- `QueryBuilder.retrievers.spec.ts` 35 unit + type tests (24 failed before the fix). `QueryBuilder.retrievers.integration.test.ts` 12 tests: serverless 12 pass (all gated tests ran); Docker 9.1 7 pass, 5 skipped (inference).
- Edited `QueryBuilder.spec.ts`: knn similarity test used `'cosine'` (B-048), now `0.8`.
