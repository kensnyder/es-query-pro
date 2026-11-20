# QB2 handoff — range and match family

## Findings fixed
- **B-045**: `matchBoostedPhrase()` default boosts are now per operator: exact 5, and 3, or 1. `weights` is still positional; a missing entry takes the operator's default (was 1). Unknown operator → `TypeError`; negative/non-finite weight → `RangeError`. Server shows exact > all words > any word (and each default boost as a score ratio).
- **B-091**: `range()` throws `TypeError` for an array with a non-`between` operator, a non-string/unknown operator, and values that are not number/string/`Date`; throws `RangeError` for NaN/Infinity, an invalid `Date`, and `between` with numeric or `Date` min > max (strings are not compared: date math, custom formats). `null`/`undefined`/blank-string bounds are open; a range with no bounds adds nothing (also for comparison operators, whose value type now accepts `null | undefined`). Server: `gte: ''` returns 0 hits silently.
- **S-048**: `range(field, op, value, options?)`, `options: RangeOptions` = `Pick<QueryDslUntypedRangeQuery, 'format' | 'time_zone' | 'relation' | 'boost'>` (declared and exported in `QueryBuilder.ts`). Only those four keys are copied; undefined ones are omitted. `Date` values are stored as `toISOString()` (no reference kept). **Found on the server:** an ISO date with a custom `format` (e.g. `dd/MM/yyyy`) is not rejected, it silently matches nothing; so `range()` throws `TypeError` for a `Date` combined with a format that has no ISO part (`strict_date_optional_time`, `date_optional_time`, `strict_date_optional_time_nanos`, `strict_date_time`, `date_time`, as one `||` alternative).
- **S-042**: `matchPhrase()` takes `Omit<estypes.QueryDslMatchPhraseQuery, 'query'> & { field; phrase }` (`slop` still defaults to 0 and is always emitted).
- **S-045 (my methods)**: `match`, `matchPhrase`, `matchPhrasePrefix`, `multiMatch`, `matchBoostedPhrase` add nothing for `''`, whitespace-only, `null` or `undefined` phrases. Non-blank phrases are sent untrimmed.
- **S-047**: `static QueryBuilder.escapeWildcards(text)` (documented, `TypeError` on non-strings); the instance method remains as an alias, so `containsExact`/`weightedSemantic` are unchanged.
- **B-095 (match part)**: "multipe" ×2, `cutoff_frequency` removed from `match`/`multiMatch` JSDoc, stray fragment removed, `multiMatch` example fixed. `multiMatch` now copies a `fields` array and omits `fields` when not given.
- **S-020 (these methods)**: tests for `multiMatch`, `escapeWildcards`, `matchPhrasePrefix`/`matchPhrase`/`match` option passthrough.

## Public API changes (CHANGELOG)
- Breaking: `matchBoostedPhrase` default weights (exact now highest); missing weights default by operator; throws on unknown operator / bad weight.
- Breaking: `range()` throws on the invalid inputs above; `Date` + non-ISO `format` throws; blank strings are open bounds.
- Breaking (behavior): blank phrases are a no-op in the match family (an empty search box returns everything instead of nothing).
- Added: `range()` 4th `options` param; `RangeOptions` type; `matchPhrase` options; static `QueryBuilder.escapeWildcards`.

## For other tasks
- **QB8**: S-045 for `weightedSemantic` (blank phrase) and its S-020 test are still open; it may call the static `QueryBuilder.escapeWildcards`. **QB3**: `containsExact` likewise.
- **DOCS**: export `RangeOptions` from `index.ts` and add it to `publicExports.spec.ts`. README table rows for `match`/`matchBoostedPhrase`/`matchPhrase`/`matchPhrasePrefix` show positional call forms (`match('title', ...)`) that do not exist; document `range` options and the `Date`/`format` rule, the new boost defaults, blank-phrase no-op, and `escapeWildcards`.

## Tests
- `QueryBuilder.match.spec.ts` (46 unit + type tests). `QueryBuilder.match.integration.test.ts` (20 tests, serverless target, no capability gating; Docker not run).
- Edited pre-existing `QueryBuilder.spec.ts`: the default `matchBoostedPhrase` test asserted exact boost 1 (B-045); now 5.
- Gate: `bun test src/QueryBuilder` 226 pass; QueryRunner + fields + readmeSamples 13 pass; biome clean; typecheck: only the 6 baseline `QueryBuilder.ts` errors in my files.
