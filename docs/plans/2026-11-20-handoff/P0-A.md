# P0-A handoff — formatting and typecheck baseline

## Findings fixed
- **B-093** — `bun run format:write` reformatted `src/QueryBuilder/QueryBuilder.ts`
  (double to single quotes). `bun run format:check` now exits 0.
- **S-034 (formatting part only)** — `src/normalizeTimeZone/normalizeTimeZone.ts`
  reformatted. The behavior parts of S-034 (more zone formats, docs) are
  still open for whichever task owns `normalizeTimeZone` (F3).
- Also reformatted: `src/QueryBuilder/QueryBuilder.spec.ts` (one line joined).
  No hand edits to source. Unit specs: 309 pass, 0 fail, 14 files.

## Scripts added to `package.json`
- `test:unit` = `bun test .spec.ts`
- `test:integration` = `bun test .integration.test.ts`

Positional `bun test` arguments are substring filters on the file path, so
`.spec.ts` selects only `*.spec.ts` (14 files today) and
`.integration.test.ts` selects only `*.integration.test.ts` (2 files today).
Checked with `--reporter=junit` (integration run used a bogus `ES_ENDPOINT` and
a `-t` pattern matching no test, so the shared cluster was never contacted).
New files must keep these suffixes to be picked up.

## Typecheck baseline (`bun run typecheck`, TypeScript 7.0.2): 11 errors
Unchanged by formatting. Line numbers are after formatting.
- `src/QueryBuilder/QueryBuilder.ts` — 6: `aggregateHistogram` (1307 TS2344,
  1309 TS2322), `aggregateDateHistogram` (1380 TS2344, 1388 TS2339),
  `aggregateGeotileGrid` (1453 TS2344), `getBody` (2017 TS2339, `linear` not
  on `RetrieverContainer`).
- `src/IndexNameManager/IndexNameManager.spec.ts` — 3: lines 54, 66, 78,
  TS2578 unused `@ts-expect-error`.
- `src/IndexNameManager/IndexNameManager.ts` — 1: line 108 TS2769.
- `src/isEmptyObject/isEmptyObject.spec.ts` — 1: line 23 TS7009.

## Notes for other tasks
- Biome only checks `src/**/*` and `scripts/*` (`biome.json` `files.includes`);
  `index.ts` and README are outside it.
- `format:check` still prints 2 infos (not errors) about `biome.json`: the
  `$schema` URL is 2.2.6 while Biome is 2.6.8, and `linter.rules.recommended`
  is deprecated in favor of `preset`. `biome migrate` would fix them; P0-A
  does not own `biome.json`, so left for P0-B/DOCS or the orchestrator.
- `bun run lint` exits 0.
