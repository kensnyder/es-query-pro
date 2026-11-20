# Overview

This file provides guidance to AI AGENTS when working with code in this repository.

## Project

`es-query-pro` — a TypeScript query builder and index manager for Elasticsearch 9.x, distributed as an **ESM-only** package (`dist/index.mjs` plus `dist/index.d.ts`; there is no CommonJS build). `@elastic/elasticsearch` is a peer dependency the application supplies. Runtime is **Bun**, not Node.

## Commands

```bash
bun install                 # install deps
bun test                    # run all tests (integration tests need a server)
bun run test:unit           # unit specs only (bun test .spec.ts)
bun run test:integration    # integration tests only (bun test .integration.test.ts)
bun test <path>             # run a single test file, e.g. bun test src/QueryBuilder/QueryBuilder.spec.ts
bun test --watch            # watch mode
bun run coverage            # run tests with coverage report
bun run lint                # biome lint
bun run format:check        # biome format check (biome check .)
bun run format:write        # biome format, writes changes
bun run build               # full build: clean, .d.ts bundle, esm, gzip size report
bun run test:import         # build, then smoke-test dist/index.mjs through the exports map
bun run typecheck           # tsc --noEmit -p . (enforces type-level tests); must report zero errors
```

Tests use `bun:test` (`import { describe, it, test } from 'bun:test'`), not vitest/jest. Type-level assertions (`expectTypeOf`, `// @ts-expect-error`) are enforced by `bun run typecheck`, not by `bun test`. Positional `bun test` arguments are path substrings, so new test files must keep the `.spec.ts` / `.integration.test.ts` suffixes.

Two kinds of test files exist side by side:

- `*.spec.ts` — pure unit tests, no external services required. Request shapes and error paths use the scripted recording client (`getRecordingClient()` in `src/testFixtures/recordingClient.ts`: `{ client, sent, script }`; `script(route, ...replies)` plays responses or thrown errors per route; helpers `responseError()`, `connectionError()`, `timeoutError()`, `thrownError()`).
- `*.integration.test.ts` — hit a real Elasticsearch instance. Each file creates one kit with `await createTestKit('<label>')` from `src/testFixtures/esTestKit.ts` and calls `kit.cleanup()` in `afterAll`. The kit gives a client, a unique per-file index prefix (`esqpt_<time>_<label>_<random>`; never delete by a wider wildcard), `makeIndex(create, docs)`, `waitFor(probe)` (no fixed sleeps), and capability flags (`kit.caps.serverless`, `tasksApi`, `retrievers`, `inference`) for `kit.testIf(cap)`. Fixtures: `src/testFixtures/books.ts`, `places.ts` (geo, vectors, nested), `articles.ts` (`semantic_text`, behind `caps.inference`). The client comes from `getTestClient()` (`src/testFixtures/testClient.ts`, env vars `ES_ENDPOINT`, `ES_API_KEY` or `ES_USERNAME`/`ES_PASSWORD`, `ES_SERVERLESS`).

Two integration targets: an Elastic Cloud Serverless project (the local `.env`), and a stateful Elasticsearch 9.1 in Docker:

```bash
docker compose up -d --wait
ES_ENDPOINT=http://localhost:9200 ES_API_KEY= ES_SERVERLESS=false bun test .integration.test.ts
docker compose down -v
```

CI runs the integration tests against a matrix of Elasticsearch versions, each as a Docker service (see `.github/workflows/tests.yml`; to refresh the versions, follow `docs/rules/update-elasticsearch-test-matrix.md`).

## Conventions

- **`QueryBuilder` throws synchronously** (`TypeError` for wrong types or unsupported combinations, `RangeError` for out-of-range values) and adds nothing when it throws. `getBody()`/`getOptions()`/`getQuery()` throw for combinations Elasticsearch rejects.
- **`IndexManager`, `QueryRunner` and `SchemaRegistry` never throw** (constructors, `SchemaRegistry.register*()`, `findFirstOrThrow()` and `IndexManager.run()`, which returns its callback's result, excepted). Every method returns an envelope `{ ...fields, request, took, error, errorKind, response }` built with `IndexManager._formatError`/`_formatNonError`; builder errors from callbacks are converted too. `error` is always an `Error` or `null`. `errorKind` (`IndexErrorKind`) is decided by the error's `name`, not `instanceof`.

## Architecture

The library is composed of small, single-responsibility classes that compose together. Read order for onboarding: `IndexNameManager` → `mappingFields` → `IndexManager` → `QueryBuilder` → `QueryRunner` → `SchemaRegistry`.

- **`IndexNameManager`** (`src/IndexNameManager`) — pure naming logic. Computes the versioned concrete index name (`getFullName()`, e.g. `prod~english~books~v1`) versus the stable alias name (`getAliasName()`, e.g. `prod~english~books`) apps read/write through. The constructor throws `RangeError` for names Elasticsearch would reject. `parseByName()`/`tryParseByName()` parse full names; `compare()` classifies another name as `same`/`older`/`newer`/`incomparable`/`unrelated`.
- **`mappingFields`** (`src/mappingFields`) — works on a plain Elasticsearch `estypes.IndicesCreateRequest`. `mappingFields.ts` has the runtime functions `getAllFields(create, { subFields?, containers? })` and `getFulltextFields(create, { subFields? })` (dotted paths, depth first, declaration order; full-text types are `text`, `match_only_text`, `search_as_you_type`, `semantic_text`, plus `alias` fields pointing at one). `mappingTypes.ts` has their type-level counterparts: `MappingFieldPath<Create>`, `MappingFulltextPath<Create>` and the document shape `MappingRecord<Create>`; they fall back to `string` / `Record<string, any>` when the mapping is not a visible literal or `mappings.dynamic` is `true`/`'true'`/`'runtime'`. The two modules must agree; `mappingTypes.spec.ts` compares them on a shared fixture.
- **`IndexManager`** (`src/IndexManager`) — the main per-index façade apps use: `new IndexManager(options: ManageOptions, create: estypes.IndicesCreateRequest)`. `options.client` (an `@elastic/elasticsearch` `Client`) is required; there is no default client. `create.index` is the logical name; the manager builds an `IndexNameManager` from it plus `separator`/`version`/`prefix`/`language`, keeps the request unchanged as `createSpec`, and sends `{ ...createSpec, index: getFullName() }` from `getCreateRequest()`. The mapping is used exactly as written (no generated sub-fields or `nested` types). Owns CRUD (`put`, `putBulk`, `patch`, `findById`, `deleteById`, `deleteMany`), index/alias lifecycle (`create`, `createOnly`, `createIfNeeded`, `createAlias`, `createAliasIfNeeded`, `drop`, `recreate`, `exists`, `aliasExists`; codes in `IndexLifecycleCode`; never points the alias at two indexes), status (`getStatus()` → `StatusReport` with a `StatusSummary`), and migration. `IndexManager` is generic over the creation request (`IndexManager<const Create extends estypes.IndicesCreateRequest>`), so `IndexInferCreate<T>` / `IndexInferFields<T>` / `IndexInferRecordShape<T>` derive typed field names and record shapes, and query callbacks receive a `QueryBuilder<MappingFieldPath<Create>>`.
- **Migration** (`src/IndexManager/migrate.ts`; `IndexManager.migrateIfNeeded()` delegates to `migrateIndex()`) — zero downtime: `getStatus()` → create the new index without the alias → `_reindex` old → new in the background (`version_type: 'external'`, `conflicts: 'proceed'`) → catch-up pass → one atomic `_aliases` swap (new index is the write index) → refresh old, final catch-up pass → verify counts → delete old index(es). Returns a `MigrationResult` with a `code` and a `completion` promise (`MigrationOutcome`, never rejects). Refuses downgrades (`NEWER_VERSION_PRESENT`, `INCOMPARABLE_VERSION`); re-running resumes, finding a running copy through the task id stored in the new index's mapping `_meta["es-query-pro-migration"]` (serverless has no tasks list) or the tasks list. Known limitation: deletes made during the copy can reappear (no tombstones).
- **`QueryBuilder`** (`src/QueryBuilder`) — fluent builder for Elasticsearch DSL: match/term/range/wildcard/regexp/query-string conditions, `filter()` (filter context), `should`/`shouldNot`/`mustNot` composition (subqueries are built via callbacks that receive a fresh `QueryBuilder` and may only add conditions), `must(clause)` for raw clauses, aggregations, highlighting, sorting/paging, score functions, rescore, and retrievers (`knn`, `semantic`, `rrf`, `weightedSemantic`). `QueryBuilder<Field extends string = string>`: parameters naming one concrete field are typed `Field`; pattern/boost/raw-DSL parameters stay `string`. `getBody()`/`getQuery()` serialize the accumulated state into new objects. With retrievers, all conditions become retriever filters. See the README's quick reference and "Full documentation" sections.
- **`QueryRunner`** (`src/QueryRunner`) — binds a `QueryBuilder` to a specific `IndexManager` and executes it (`findMany`, `findFirst`, `findFirstOrThrow`, `count`, `updateMany` via one fixed Painless script whose field paths are params). `IndexManager.findMany/findFirst/count/run()` are thin wrappers that construct a `QueryRunner` on demand.
- **`SchemaRegistry`** (`src/SchemaRegistry`) — holds a collection of `IndexManager`s (array or named map) for fleet-wide operations: `migrateIfNeeded()`/`recreateAll()`/`getStatus()`/`dropAll()`, run through a concurrency-limited worker pool (`runLimited`). All four resolve to `SchemaFleetResult` (`{ success, took, report, summary, error, errorKind }`).
- **`src/types.ts`** — shared types: query-builder option shapes and aliases of the `estypes` request/response types used across `IndexManager` and `QueryBuilder`.
- **`src/analyzers/englishplus.ts`** — a reusable custom Elasticsearch analyzer definition (`settings: { analysis: englishplus.analysis }`). Changing it changes indexed tokens, which needs a reindex in consumers.
- **`src/testFixtures`** — test-only helpers (see the test file kinds above).
- **`index.ts`** is the package entrypoint — all public exports (classes and their derived types) are re-exported from here; anything not exported there is internal. `src/publicExports.spec.ts` pins the export list.

### `@elastic/elasticsearch` is imported as types only

In `index.ts` and every `src/**/*.ts` file that is not a test (`*.spec.ts`, `*.integration.test.ts`) and not under `src/testFixtures/`, every import from an `@elastic/*` package must be `import type` (no value imports, no mixed `import { type A, b }`, no `import()`/`require()`). The application supplies the client; the bundle must not load one. `src/typesOnlyImports.spec.ts` enforces this, and `dist/index.mjs` must not contain the string `@elastic` after `bun run build`. Tests and fixtures may import the client at runtime; it stays a devDependency and a peerDependency.

### README samples are compiled

`src/readmeSamples.spec.ts` type-checks every top-level ```` ```ts ```` block in `README.md` that imports from `"es-query-pro"` (and requires every `new IndexManager` sample to do so), in strict and non-strict mode. It also type-checks and runs every code span in the "Example" column of the "Query Builder function quick reference" tables (each is an expression on a builder named `qb`; every row needs one). Keep samples self-contained.

## Code style (enforced by Biome, see `biome.json`)

- Single quotes, 2-space indent, 80-char line width, organize imports on save.
- Avoid `return` on the same line as preceding logic; always brace `if`/`for`/`while` blocks with the body on a new line.
- Avoid nested ternaries — use `if` blocks instead. Ternary expressions should fit in ≤80 chars.
- One statement per line.
- Avoid `any`/`as any` when a real type is feasible (Biome's `noExplicitAny` is otherwise off, so this is a style preference, not a lint failure).
- Prefer Bun-native APIs over external packages where practical.
- Biome's `useIterableCallbackReturn` treats `qb.filter((sub) => { ... })` like `Array#filter`: use an expression body or `return sub`.
