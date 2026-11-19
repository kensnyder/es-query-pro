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
```

Tests use `bun:test` (`import { describe, it, test } from 'bun:test'`), not vitest/jest.

Two kinds of test files exist side by side:

- `*.spec.ts` — pure unit tests, no external services required.
- `*.integration.test.ts` — hit a real Elasticsearch instance (env vars `ES_ENDPOINT`, `ES_API_KEY` or `ES_USERNAME`/`ES_PASSWORD`, `ES_VERSION`). CI spins up an ES 9.1 Docker service for these (see `.github/workflows/tests.yml`); locally you need Elasticsearch running to pass them.

## Architecture

The library is composed of small, single-responsibility classes that compose together. Read order for onboarding: `IndexNameManager` → `SchemaManager` → `IndexManager` → `QueryBuilder` → `QueryRunner` → `SchemaRegistry`.

- **`IndexNameManager`** (`src/IndexNameManager`) — pure naming logic. Computes the versioned concrete index name (`getFullName()`, e.g. `prod~english~books~v1`) versus the stable alias name (`getAliasName()`, e.g. `prod~english~books`) apps read/write through. Validates index/column name characters.
- **`SchemaManager`** (`src/SchemaManager`) — converts a plain-object schema shape (e.g. `{ title: 'text', author: 'keyword', categories: { id: 'integer' } }`) into Elasticsearch mapping `properties`, including nested-object handling and derived field lists (`getAllFields()`, `getFulltextFields()`). `'text'` fields automatically get `.exact` (standard analyzer) and `.fulltext` (custom analyzer) sub-fields.
- **`IndexManager`** (`src/IndexManager`) — the main per-index façade apps use. Wraps an `IndexNameManager` + `SchemaManager` + an `@elastic/elasticsearch` `Client` (default from `getEsClient()`). Owns CRUD (`put`, `putBulk`, `patch`, `deleteById`, `deleteMany`), index/alias lifecycle (`create`, `createOnly`, `createAlias`, `drop`, `recreate`, `exists`, `aliasExists`), and **zero-downtime migration** (`migrateIfNeeded`): detects when the alias points at an out-of-date index version, creates the new index, reindexes in the background with progress callbacks, then repoints the alias and drops the old index. Every public method returns a consistent envelope shape (`{ ...result, request, took, error, errorKind }`) via the `_formatError`/`_formatNonError` helpers rather than throwing — callers check `.error` instead of using try/catch. `IndexManager` is generic over the schema shape (`IndexManager<ThisSchema>`), enabling `IndexInferSchema<T>` / `IndexInferRecordShape<T>` to derive typed record shapes elsewhere.
- **`QueryBuilder`** (`src/QueryBuilder`) — fluent builder for Elasticsearch DSL: match/term/range/wildcard/knn/semantic/rrf conditions, `bool.should`/`mustNot` composition (subqueries are built via callback functions that receive a fresh `QueryBuilder`), aggregations, highlighting, sorting/paging, rescore, and retrievers. `getBody()`/`getQuery()` serialize the accumulated state; there's no explicit `must()` — anything added directly becomes a `bool.must` clause. See the README's function reference table for the full method list and the "Full documentation" section for `should`/`shouldNot`/`mustNot` semantics (`shouldNot` is `mustNot(should(...))` under the hood, so its exclusion semantics change with `minimumShouldMatch`).
- **`QueryRunner`** (`src/QueryRunner`) — binds a `QueryBuilder` to a specific `IndexManager` and executes it (`findMany`, `findFirst`, `findFirstOrThrow`, `count`, `updateMany` via generated Painless scripts). `IndexManager.findMany/findFirst/count/run()` are thin wrappers that construct a `QueryRunner` on demand.
- **`SchemaRegistry`** (`src/SchemaRegistry`) — holds a collection of `IndexManager`s for fleet-wide operations: `migrateIfNeeded()`/`recreateAll()`/`getStatus()`/`dropAll()` across all registered indexes, processed in concurrency-limited chunks.
- **`getEsClient`** (`src/getEsClient/getEsClient.ts`) — constructs the default `@elastic/elasticsearch` `Client` from env vars (`ES_ENDPOINT`, `ES_API_KEY` or `ES_USERNAME`/`ES_PASSWORD`, `ES_VERSION`), setting the `Accept` header for API version compatibility.
- **`src/getEsClient/EsFetchClient.ts`** — an in-progress, unfinished experiment to replace the `@elastic/elasticsearch` SDK client with a lightweight `fetch`-based client. Not wired into the rest of the library and not exported from `index.ts`; treat as scaffolding/WIP, not a reference implementation.
- **`src/types.ts`** — shared types: `SchemaShape`, `MappingProperties`/`MappingProperty`, `ElasticsearchType`, `ElasticsearchRecord<Schema>`, and the various request/response param shapes used across `IndexManager`.
- **`src/analyzers/englishplus.ts`** — a reusable custom Elasticsearch analyzer definition.
- **`index.ts`** is the package entrypoint — all public exports (classes and their derived types) are re-exported from here; anything not exported there is internal.

## Code style (enforced by Biome, see `biome.json`, and `.junie/guidelines.md`)

- Single quotes, 2-space indent, 80-char line width, organize imports on save.
- Avoid `return` on the same line as preceding logic; always brace `if`/`for`/`while` blocks with the body on a new line.
- Avoid nested ternaries — use `if` blocks instead. Ternary expressions should fit in ≤80 chars.
- One statement per line.
- Avoid `any`/`as any` when a real type is feasible (Biome's `noExplicitAny` is otherwise off, so this is a style preference, not a lint failure).
- Prefer Bun-native APIs over external packages where practical.
