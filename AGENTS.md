# Overview

This file provides guidance to AI AGENTS when working with code in this repository.

## Project

`es-query-pro` — a TypeScript query builder and index manager for Elasticsearch 9.x, distributed as a dual ESM/CJS package via `@elastic/elasticsearch`. Runtime is **Bun**, not Node.

## Commands

```bash
bun install                 # install deps
bun test                    # run all tests
bun test <path>             # run a single test file, e.g. bun test src/QueryBuilder/QueryBuilder.spec.ts
bun test --watch            # watch mode
bun run coverage            # run tests with coverage report
bun run lint                # biome lint
bun run format:check        # biome format check (biome check .)
bun run format:write        # biome format, writes changes
bun run build               # full build: clean, .d.ts bundle, esm, cjs, gzip size report
bun run typecheck           # tsc --noEmit -p . (enforces type-level tests)
```

Tests use `bun:test` (`import { describe, it, test } from 'bun:test'`), not vitest/jest. Type-level assertions (`expectTypeOf`, `// @ts-expect-error`) are enforced by `bun run typecheck`, not by `bun test`. The repo does not type-check cleanly yet (pre-existing errors in `QueryBuilder.ts`, `IndexNameManager` and `isEmptyObject.spec.ts`); add no new ones.

Two kinds of test files exist side by side:

- `*.spec.ts` — pure unit tests, no external services required.
- `*.integration.test.ts` — hit a real Elasticsearch instance through `getTestClient()` (`src/testFixtures/testClient.ts`, env vars `ES_ENDPOINT`, `ES_API_KEY` or `ES_USERNAME`/`ES_PASSWORD`). CI runs them against a matrix of Elasticsearch versions, each as a Docker service (see `.github/workflows/tests.yml`; to refresh the versions, follow `docs/rules/update-elasticsearch-test-matrix.md`); locally you need Elasticsearch running to pass them.

## Architecture

The library is composed of small, single-responsibility classes that compose together. Read order for onboarding: `IndexNameManager` → `mappingFields` → `IndexManager` → `QueryBuilder` → `QueryRunner` → `SchemaRegistry`.

- **`IndexNameManager`** (`src/IndexNameManager`) — pure naming logic. Computes the versioned concrete index name (`getFullName()`, e.g. `prod~english~books~v1`) versus the stable alias name (`getAliasName()`, e.g. `prod~english~books`) apps read/write through. Validates index/column name characters.
- **`mappingFields`** (`src/mappingFields`) — works on a plain Elasticsearch `estypes.IndicesCreateRequest`. `mappingFields.ts` has the runtime functions `getAllFields(create, { subFields?, containers? })` and `getFulltextFields(create, { subFields? })` (dotted paths, depth first, declaration order; full-text types are `text`, `match_only_text`, `search_as_you_type`, `semantic_text`, plus `alias` fields pointing at one). `mappingTypes.ts` has their type-level counterparts: `MappingFieldPath<Create>`, `MappingFulltextPath<Create>` and the document shape `MappingRecord<Create>`; they fall back to `string` / `Record<string, any>` when the mapping is not a visible literal or `mappings.dynamic` is `true`/`'true'`/`'runtime'`. The two modules must agree; `mappingTypes.spec.ts` compares them on a shared fixture.
- **`IndexManager`** (`src/IndexManager`) — the main per-index façade apps use: `new IndexManager(options: ManageOptions, create: estypes.IndicesCreateRequest)`. `options.client` (an `@elastic/elasticsearch` `Client`) is required; there is no default client. `create.index` is the logical name; the manager builds an `IndexNameManager` from it plus `separator`/`version`/`prefix`/`language`, keeps the request unchanged as `createSpec`, and sends `{ ...createSpec, index: getFullName() }` from `getCreateRequest()`. The mapping is used exactly as written (no generated sub-fields or `nested` types). Owns CRUD (`put`, `putBulk`, `patch`, `deleteById`, `deleteMany`), index/alias lifecycle (`create`, `createOnly`, `createAlias`, `drop`, `recreate`, `exists`, `aliasExists`), and **zero-downtime migration** (`migrateIfNeeded`): detects when the alias points at an out-of-date index version, creates the new index, reindexes in the background with progress callbacks, then repoints the alias and drops the old index. Every public method returns a consistent envelope shape (`{ ...result, request, took, error, errorKind }`) via the `_formatError`/`_formatNonError` helpers rather than throwing — callers check `.error` instead of using try/catch. `errorKind` is decided by the error's `name` (`ResponseError`, `ConnectionError`, ...), not `instanceof`. `IndexManager` is generic over the creation request (`IndexManager<const Create extends estypes.IndicesCreateRequest>`), so `IndexInferCreate<T>` / `IndexInferFields<T>` / `IndexInferRecordShape<T>` derive typed field names and record shapes, and query callbacks receive a `QueryBuilder<MappingFieldPath<Create>>`.
- **`QueryBuilder`** (`src/QueryBuilder`) — fluent builder for Elasticsearch DSL: match/term/range/wildcard/knn/semantic/rrf conditions, `bool.should`/`mustNot` composition (subqueries are built via callback functions that receive a fresh `QueryBuilder`), aggregations, highlighting, sorting/paging, rescore, and retrievers. `QueryBuilder<Field extends string = string>`: parameters naming one concrete field are typed `Field`; pattern/boost/raw-DSL parameters stay `string`. `getBody()`/`getQuery()` serialize the accumulated state; there's no explicit `must()` — anything added directly becomes a `bool.must` clause. See the README's function reference table for the full method list and the "Full documentation" section for `should`/`shouldNot`/`mustNot` semantics (`shouldNot` is `mustNot(should(...))` under the hood, so its exclusion semantics change with `minimumShouldMatch`).
- **`QueryRunner`** (`src/QueryRunner`) — binds a `QueryBuilder` to a specific `IndexManager` and executes it (`findMany`, `findFirst`, `findFirstOrThrow`, `count`, `updateMany` via generated Painless scripts). `IndexManager.findMany/findFirst/count/run()` are thin wrappers that construct a `QueryRunner` on demand.
- **`SchemaRegistry`** (`src/SchemaRegistry`) — holds a collection of `IndexManager`s for fleet-wide operations: `migrateIfNeeded()`/`recreateAll()`/`getStatus()`/`dropAll()` across all registered indexes, processed in concurrency-limited chunks.
- **`src/types.ts`** — shared types: query-builder option shapes and aliases of the `estypes` request/response types used across `IndexManager` and `QueryBuilder`.
- **`src/analyzers/englishplus.ts`** — a reusable custom Elasticsearch analyzer definition (`settings: { analysis: englishplus.analysis }`).
- **`src/testFixtures`** — test-only helpers: `getTestClient()` (a `Client` from `ES_ENDPOINT`, `ES_API_KEY` or `ES_USERNAME`/`ES_PASSWORD`, shared per process), `getRecordingClient()` (a stub client for specs) and the books fixture (`getBooksCreateRequest()`, `getBooksData()`).
- **`index.ts`** is the package entrypoint — all public exports (classes and their derived types) are re-exported from here; anything not exported there is internal. `src/publicExports.spec.ts` pins the export list.

### `@elastic/elasticsearch` is imported as types only

In `index.ts` and every `src/**/*.ts` file that is not a test (`*.spec.ts`, `*.integration.test.ts`) and not under `src/testFixtures/`, every import from an `@elastic/*` package must be `import type` (no value imports, no mixed `import { type A, b }`, no `import()`/`require()`). The application supplies the client; the bundle must not load one. `src/typesOnlyImports.spec.ts` enforces this, and `dist/index.mjs` must not contain the string `@elastic` after `bun run build`. Tests and fixtures may import the client at runtime; it stays a devDependency and a peerDependency.

### README samples are compiled

`src/readmeSamples.spec.ts` type-checks every top-level ```` ```ts ```` block in `README.md` that imports from `"es-query-pro"` (and requires every `new IndexManager` sample to do so), in strict and non-strict mode. Keep samples self-contained.

## Code style (enforced by Biome, see `biome.json`, and `.junie/guidelines.md`)

- Single quotes, 2-space indent, 80-char line width, organize imports on save.
- Avoid `return` on the same line as preceding logic; always brace `if`/`for`/`while` blocks with the body on a new line.
- Avoid nested ternaries — use `if` blocks instead. Ternary expressions should fit in ≤80 chars.
- One statement per line.
- Avoid `any`/`as any` when a real type is feasible (Biome's `noExplicitAny` is otherwise off, so this is a style preference, not a lint failure).
- Prefer Bun-native APIs over external packages where practical.
