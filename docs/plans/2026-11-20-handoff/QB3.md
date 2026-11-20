# QB3 handoff — term-level queries

## Findings fixed
- **B-049** (reproduced, serverless): `{ terms_set: { tags: { terms } } }` → 400 `query_shard_exception: No minimum should match has been specified`. `termsSet()` now takes at most one of `minimumShouldMatch` (integer or `'75%'`), `minimumShouldMatchField` (typed `Field`), `script` (string source or `estypes.Script`); none → `minimum_should_match: 1`. More than one → `TypeError`; non-array `terms` → `TypeError`; fractional number → `RangeError`. Also `boost`; `terms` is copied. Server: all four forms return the expected docs (`'100%'` works).
- **B-052 / S-005**: new `regexp(field, value, options?)` / `regexp({ field, value, ...options })`, case-insensitive by default in **both** forms; options `caseSensitive`, `flags`, `max_determinized_states` (integer >= 1, else `RangeError`), `rewrite`, `boost`. `rexgep` kept as a `@deprecated` alias (same overloads) because `QueryBuilder.fields.spec.ts` calls it.
- **B-100 / S-050**: `term`, `wildcard`, `containsExact`, `regexp`, `queryString` have overloads (positional with optional `options`, or object). `term` value is `TermValue` (string/number/boolean); `undefined`/`null`/array/object → `TypeError`, NaN/Infinity → `RangeError`. `term` options `caseSensitive` (default true; `false` → `case_insensitive: true`) and `boost`; without options the shorthand `{ term: { f: v } }` is kept. `wildcard` options `caseSensitive` (default false), `boost`, `rewrite`; non-string value → `TypeError`.
- **S-051**: `containsExact` uses static `escapeWildcards`; a blank value (empty, whitespace, `null`, `undefined`) adds nothing (same rule as QB2's S-045); non-string → `TypeError`. Takes the `wildcard` options.
- **S-024**: `queryString` takes `QueryStringOptions` (all `query_string` keys except `query`/`fields`/`default_field`); non-string query → `TypeError`. New `simpleQueryString({ fields?, query, ...options })` (blank query adds nothing; `fields` copied, may carry `^boost`). `moreLikeThis` `field: Field | Field[]` (copied); empty array or missing `like` → `TypeError`.
- **B-099 (my methods)**: JSDoc rewritten for all of the above (`moreLikeThis` example no longer nests `options`; "MorkLikeThis" gone; `containExact` → `containsExact`; `'\\d+'`; examples use `title.raw`/`sku`, not `.keyword`).
- **S-025 (my methods)**: both call forms of `wildcard`/`containsExact`/`term`/`regexp`, `termsSet` without a script.

## Public API (CHANGELOG)
- Breaking: `rexgep('f', v)` (string form) is now case-insensitive. `term` and the pattern methods throw on missing/invalid values (previously sent malformed DSL). `containsExact('f', '')` is a no-op (was `**`, matched every doc with the field). `termsSet` without a minimum now sends `minimum_should_match: 1` (was a 400).
- Added: `regexp`, `simpleQueryString`, options params above; `rexgep` deprecated. New types in `QueryBuilder.ts`: `TermValue`, `TermOptions`, `WildcardOptions`, `RegexpOptions`, `QueryStringOptions`, `SimpleQueryStringOptions`, `TermsSetOptions<Field>`.

## For other tasks
- **DOCS**: export the 7 types above from `index.ts` (+ `publicExports.spec.ts`). README: add rows for `wildcard`, `containsExact`, `regexp` (note `rexgep` deprecated), `simpleQueryString`; fix `moreLikeThis` row (options are top-level, `field` may be an array), `termsSet` row (minimum forms, default 1), `queryString` options, `term` options, blank `containsExact`. Remaining B-099 README bullets (knn `weight`, `aggregateTerm` `orderBy`, `dateHistogram` positional, histogram rows) are DOCS/QB4/QB5.
- **QB4**: B-099 `aggregateTerm` JSDoc (syntax error, `exclude` takes term values); S-025 rescore shape and `aggregateTerm` orderBy tests. **QB5**: S-025 histogram aggs, `dateHistogram` offset, `includeFacets`. **QB8**: S-025 knn similarity test asserts an invalid value.
- Instance `escapeWildcards` is still used by `weightedSemantic` (QB8).

## Tests
- `QueryBuilder.term.spec.ts` (29 unit + type tests). `QueryBuilder.term.integration.test.ts` (19 tests, serverless target, no capability gating; Docker not run). No pre-existing test file edited.
- Gate: `bun test src/QueryBuilder` 274 pass; QueryRunner + IndexManager.fields + readmeSamples + typesOnlyImports 36 pass; biome clean on owned files; typecheck: only the 6 baseline `QueryBuilder.ts` errors + 1 `publicExports.spec.ts` (IndexManager errors from the parallel agent ignored).
