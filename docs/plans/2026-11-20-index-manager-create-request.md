# Plan — `IndexManager` takes a client and an `IndicesCreateRequest`

**Date:** 2026-11-20
**Executors:** one orchestrator session plus Opus subagents (`Agent` tool, `model: "opus"`), one subagent per task in section 5.
**Status:** not started. All decisions in section 2 were confirmed by the maintainer on 2026-11-20.

## Goals

1. **New constructor.** `new IndexManager(options: ManageOptions, create: estypes.IndicesCreateRequest)`.
2. **No more `SchemaShape`.** Callers pass a real Elasticsearch creation specification. `SchemaManager` and the string-schema types are removed. New functions extract the full-text fields and all field names from the creation specification.
3. **Typed field names.** Field names in queries are checked against the creation specification at compile time (section 3 is the feasibility analysis; the answer is yes).
4. **No default client.** `getEsClient()` is removed and `client` is required. Library code imports `@elastic/elasticsearch` **only as types**.

The package is at `3.0.0-beta.2`, so breaking changes are acceptable. Every one is listed in section 7 for the CHANGELOG.

---

## 1. Target design

### 1.1 Constructor

```ts
import type { Client, estypes } from "@elastic/elasticsearch";

export type ManageOptions = {
  client: Client;
  separator?: string; // default '~'
  version?: number | string; // default 1
  prefix?: string; // default ''
  language?: string; // default 'english'
  serverless?: boolean;
};

class IndexManager<
  const Create extends
    estypes.IndicesCreateRequest = estypes.IndicesCreateRequest,
> {
  constructor(options: ManageOptions, create: Create);
}
```

Example after the change:

```ts
const booksIndex = new IndexManager(
  { client, version: 1, prefix: "prod" },
  {
    index: "books",
    settings: { analysis: englishplus.analysis },
    mappings: {
      properties: {
        id: { type: "keyword" },
        title: {
          type: "text",
          analyzer: "englishplus",
          fields: { exact: { type: "keyword", ignore_above: 256 } },
        },
        categories: {
          type: "nested",
          properties: { id: { type: "integer" }, name: { type: "text" } },
        },
      },
    },
  },
);
// prod~english~books~v1 (index), prod~english~books (alias)
```

Behavior:

| Topic                       | Rule                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Index name                  | `ManageOptions` has no `name`, so **`create.index` is the logical name** (`books`). `IndexManager` builds an `IndexNameManager` from `{ name: create.index, separator, version, prefix, language }`. `IndexNameManager` itself does not change. (Decision D1.) |
| Stored specification        | Kept as a public read-only property named **`createSpec`** (the name `create` is already a method). The caller's object is never mutated.                                                                                                                      |
| `getCreateRequest(more)`    | Body is `{ ...createSpec, index: getFullName(), ...more }`. Everything else in the specification (`settings`, `mappings`, `aliases`, `wait_for_active_shards`, timeouts) passes through unchanged.                                                             |
| `client`                    | Required. The constructor throws a `TypeError` naming the missing option when `options` or `options.client` is absent.                                                                                                                                         |
| Removed public properties   | `schema`, `settings`, `analyzer`.                                                                                                                                                                                                                              |
| Kept public properties      | `index`, `client`, `serverless`, `fulltextFields`, `allFields` (now computed by the functions in 1.2).                                                                                                                                                         |
| `serverless`                | Unchanged, including the `ES_SERVERLESS` env fallback in `isServerless()`.                                                                                                                                                                                     |
| Removed constructor options | `index` (object), `schema`, `properties`, `settings`, `analyzer`. There is no automatic `.exact` / `.fulltext` sub-field generation and no automatic `nested` typing any more; the mapping is exactly what the caller wrote.                                   |

### 1.2 Field extraction functions

New module `src/mappingFields/mappingFields.ts`, pure functions with no dependencies:

```ts
getAllFields(create, options?: { subFields?: boolean; containers?: boolean }): string[]
getFulltextFields(create, options?: { subFields?: boolean }): string[]
```

Both accept an `estypes.IndicesCreateRequest` and walk `create.mappings.properties`. Semantics (the type-level helpers in 1.3 must match these exactly):

1. **Paths are dotted and complete**: `categories.name`, `meta.deep.leaf`. (The old `getAllFields()` returned bare leaf names with no parent path; that was a bug and is not preserved.)
2. A property with `properties` is a **container** (`object` or `nested`, with or without an explicit `type`). The walk recurses into it to any depth. Containers are returned only with `containers: true`.
3. Multi-field entries under `fields` (e.g. `title.exact`) are **sub-fields**. They are returned only with `subFields: true`. Sub-fields do not nest.
4. Keys of `create.mappings.runtime` are included in `getAllFields` as leaf fields.
5. Order is declaration order, depth-first; no duplicates.
6. **Full-text types**: `text`, `match_only_text`, `search_as_you_type`, `semantic_text`. A leaf is full-text when its `type` is one of these. With `subFields: true`, sub-fields of those types are also returned. An `alias` field counts as full-text when the field at its `path` does. (`completion` and `token_count` were in the old list and are dropped: neither can be the target of a `match` query. Decision D4.)
7. Missing `mappings`, missing `properties`, or an empty object return `[]`. Nothing throws.

`IndexManager` sets `this.allFields = getAllFields(create)` and `this.fulltextFields = getFulltextFields(create)` (default options).

### 1.3 Type-level helpers

New module `src/mappingFields/mappingTypes.ts`, types only:

| Type                          | Meaning                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MappingFieldPath<Create>`    | Union of every path a query may name: leaves, containers, sub-fields and runtime fields. Falls back to `string` when the paths are not statically known (see section 3). |
| `MappingFulltextPath<Create>` | Union of full-text paths, rule 6 above, including full-text sub-fields. Same fallback.                                                                                   |
| `MappingRecord<Create>`       | The document shape for `put` / `putBulk` / `patch` and search results. Replaces `ElasticsearchRecord<SchemaShape>`.                                                      |

`MappingRecord` rules: every field is optional and nullable; every field also accepts an array of its type; containers map to an object (`nested` to an object or an array of objects); numeric types map to `number`, `boolean` to `boolean`, `date` / `date_nanos` to `string | number | Date`, string-like types (`keyword`, `text`, `wildcard`, `constant_keyword`, `match_only_text`, `ip`, `version`) to `string`; anything else is `unknown`. Keys not in the mapping are allowed unless `mappings.dynamic` is `'strict'`. When the paths are not statically known the type is `Record<string, any>`.

The inferring types on `IndexManager` become:

```ts
export type IndexInferCreate<T> = T extends IndexManager<infer C> ? C : never;
export type IndexInferRecordShape<T> = MappingRecord<IndexInferCreate<T>>;
export type IndexInferFields<T> = MappingFieldPath<IndexInferCreate<T>>;
```

`IndexInferSchema` is removed.

### 1.4 Typed query building

`QueryBuilder` gains one type parameter that defaults to today's behavior:

```ts
class QueryBuilder<Field extends string = string> { … }
```

- Every method parameter that names **one concrete field** changes from `string` to `Field` (`term`, `exists`, `range`, `match*`, `wildcard`, `containsExact`, `rexgep`, `queryString`'s field form, `moreLikeThis`, `termsSet`, `knn`, `semantic`, `highlightField`, the `aggregate*` helpers and `dateHistogram`, `nested`'s `path`, and the field arguments of `rrf` / `weightedSemantic`).
- Parameters that accept **patterns, boosts or raw DSL** stay `string`: `fields` / `sourceIncludes` / `excludeFields` / `sourceExcludes` (wildcards), `multiMatch` fields (`title^3`), `sort` (`SortCombinations`), `rawCondition`, `must`, `aggs`.
- Callbacks and `clone()` carry the parameter through: `should`, `shouldNot`, `mustNot`, `nested` and `rescore` callbacks receive `QueryBuilder<Field>`.
- `new QueryBuilder()` on its own is `QueryBuilder<string>` and behaves exactly as before. No runtime behavior changes in `QueryBuilder`.

`QueryRunner<Create>` holds a `QueryBuilder<MappingFieldPath<Create>>`. `IndexManager.findMany` / `findFirst` / `count` / `deleteMany` / `run` pass that typed builder to their callbacks, so:

```ts
booksIndex.findMany((qb) => {
  qb.term("categories.id", 101); // ok
  qb.term("categoreis.id", 101); // compile error
});
```

`QueryRunner.updateMany(newValues)` keys become `Partial<Record<MappingFieldPath<Create>, unknown>>`.

### 1.5 Types-only use of `@elastic/elasticsearch`

Today three library files import it at runtime:

| File                                   | Runtime import                                                        | Replacement                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/getEsClient/getEsClient.ts`       | `Client`, `HttpConnection`                                            | File deleted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/IndexManager/IndexManager.ts`     | `errors` (for `instanceof` in `_formatError` and `isApiNotAvailable`) | Classify by the error's `name` string: `ResponseError`, `ConnectionError`, `TimeoutError`, `NoLivingConnectionsError` (confirmed in `node_modules/@elastic/transport/lib/errors.js`). `isApiNotAvailable` checks `name === 'ResponseError'` plus `meta.body.error.type`. Import becomes `import type { Client, estypes }`. This also fixes the misclassification when the application has a second copy of the client package (review finding near "duplicate client copies"). |
| `src/SchemaRegistry/SchemaRegistry.ts` | `import { estypes }` (not marked `type`)                              | `import type { estypes }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Rule after this plan: in `index.ts` and every `src/**/*.ts` file that is not a test (`*.spec.ts`, `*.integration.test.ts`) and not under `src/testFixtures/`, every import from `@elastic/*` is `import type`. Tests and fixtures may import the client at runtime; it stays a devDependency and a peerDependency (the types are still needed by consumers).

A unit test enforces the rule (task T6), and the build gate checks that `dist/index.mjs` contains no `@elastic` string.

---

## 2. Decisions (confirmed 2026-11-20)

The maintainer confirmed the **default** for every row below (D1–D5 as written; D6: T2 and T5 stay in scope; D7: this plan runs before `2026-11-20-code-review-fixes.md`). The "Alternative" column is kept for the record only; do not implement it.

| #   | Topic                                               | Default chosen                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Alternative                                                                   |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| D1  | Where the index name comes from                     | `create.index` is the logical name; the manager replaces it with the versioned full name when sending.                                                                                                                                                                                                                                                                                                                                                                              | Add `name` to `ManageOptions` and ignore/forbid `create.index`.               |
| D2  | `create.aliases`                                    | Passed through to Elasticsearch untouched. The manager still creates and moves its own alias (`getAliasName()`) separately. Constructor throws if `create.aliases` contains the manager's own alias name, since migration must control it.                                                                                                                                                                                                                                          | Strip or forbid `aliases` entirely.                                           |
| D3  | Dynamic fields vs. typed field names                | Field names are strict when the mapping is statically known, **unless** `mappings.dynamic` is explicitly `true`, `'true'` or `'runtime'`, in which case `MappingFieldPath` is `string`. An index that relies on Elasticsearch's implicit default (`dynamic` omitted) is treated as strict. Opt-out for one manager: `new IndexManager<estypes.IndicesCreateRequest>(…)`.                                                                                                            | Treat omitted `dynamic` as loose (most indexes would then get no checking).   |
| D4  | Full-text type list                                 | `text`, `match_only_text`, `search_as_you_type`, `semantic_text`.                                                                                                                                                                                                                                                                                                                                                                                                                   | Keep `completion` and `token_count` as before.                                |
| D5  | Convenience for the old `'text'` behavior           | None. The README shows how to write the `.exact` / analyzer sub-fields by hand.                                                                                                                                                                                                                                                                                                                                                                                                     | Export a small `textField({ analyzer })` helper that returns the old mapping. |
| D6  | Typed field names (goal 3)                          | Implemented in this plan (tasks T2 and T5). Cutting it removes T5 and the `MappingFieldPath` half of T2; nothing else depends on it.                                                                                                                                                                                                                                                                                                                                                | Ship goals 1, 2 and 4 only and treat section 3 as analysis.                   |
| D7  | Order relative to `2026-11-20-code-review-fixes.md` | **Run this plan first.** It deletes `SchemaManager` and `getEsClient`, which that plan's tasks F1, F3, IM1 and IM2 and its decisions D3, D4 and D7 spend effort fixing. Afterwards that plan needs an edit pass: drop the findings that no longer have code (B-021, B-023, B-026, B-068–B-071, S-008, S-009, S-036 for `SchemaManager`; B-022, B-027, S-012 for `getEsClient`; B-004 is replaced by `MappingRecord`), and repoint its P0-B test kit at this plan's `testClient.ts`. | Run the review plan first and rebase this one onto it.                        |

---

## 3. Feasibility of typed field names

**Conclusion: feasible, with small cost.** A prototype was type-checked against the installed `@elastic/elasticsearch` 9.5.1 types under both TypeScript 7.0.2 and 5.9.3 (the two compilers this repo uses), in strict and non-strict mode. It covered everything in the table below. Check time was about 0.05 s; the recursion only touches the caller's own literal, not the large `MappingProperty` union.

How it works: the constructor's `const` type parameter makes TypeScript keep the literal shape of an inline specification, while `extends estypes.IndicesCreateRequest` still validates it. Recursive mapped types then walk `mappings.properties`:

```ts
type PathsOf<P> = {
  [K in keyof P & string]:
    | K
    | (P[K] extends { properties: infer S } ? `${K}.${PathsOf<S>}` : never)
    | (P[K] extends { fields: infer F } ? `${K}.${keyof F & string}` : never);
}[keyof P & string];
```

What the prototype confirmed:

| Case                                                                               | Result                                                                            |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Inline specification passed to the constructor                                     | Paths inferred; unknown top-level, nested and sub-field names are compile errors. |
| Three levels of `properties`, `nested`, multi-fields                               | Inferred correctly.                                                               |
| A typo inside the mapping itself (`type: 'keywrd'`)                                | Still an error; the constraint keeps validating.                                  |
| Arrays in the specification (`filter: [...]`, `copy_to`, index sort)               | Accepted; no `readonly` conflict with the client's mutable array types.           |
| `createSpec` passed back to `client.indices.create`                                | Assignable, including `{ ...createSpec, index: fullName }`.                       |
| Full-text-only path union and a record type derived from the mapping               | Work, including rejecting a wrong value type.                                     |
| `QueryBuilder<Field>` with callbacks that propagate `Field`                        | Works; a typed builder is assignable to an untyped `QueryBuilder`.                |
| `IndexManager[]` holding managers with different specifications (`SchemaRegistry`) | Assignable.                                                                       |

Limits, all of which degrade to today's behavior (`string`) and never to a false error:

1. **The specification must be visible as a literal.** Inline, or declared with `as const satisfies estypes.IndicesCreateRequest`. A variable annotated as `estypes.IndicesCreateRequest`, or a specification returned from a function with that return type, gives `string`. The README must show the `satisfies` pattern.
2. **Consumers need TypeScript 5.0+** (`const` type parameters). Document it in the README.
3. **Fields that exist only at runtime** (dynamic mapping, dynamic templates, fields added by another writer) are unknown to the types. See D3 and its opt-out.
4. **Patterns and boosts are not validated** (`title*`, `title^3`); those parameters stay `string` (section 1.4).
5. **Per-method type narrowing is out of scope**: `match` accepts any known path, not only full-text ones, and `term` values are not checked against the field's type. `MappingFulltextPath` is exported so this can be added later.
6. **Declaration bundling.** `dts-bundle-generator` runs on TypeScript 5.9 and must emit the `const` type parameter and the recursive types intact. T5's gate verifies this with a consumer type test against `dist/index.d.ts`.

---

## 4. How the work is organized

### 4.1 Waves

```
Wave 1 (parallel, disjoint files)   T1 ║ T2 ║ T3
Wave 2 (sequential)                 T4 ► T5
Wave 3                              T6
Final                               orchestrator verification
```

### 4.2 Rules for every task

1. A task edits only the files in its **Owns** list. Anything else goes in its final report for the owning task.
2. Subagents never run git write commands. The orchestrator creates a working branch first (the tree currently has uncommitted changes on `main` that are unrelated; leave them alone) and commits each task's owned files after its gate passes.
3. Find code by symbol name, not line number.
4. `src/QueryBuilder/QueryBuilder.ts` is not Biome-formatted today (double quotes). Do **not** run `format:write` on it; keep diffs to the lines being changed. Run `bunx biome check` only on files a task creates or that were already clean.
5. Follow the code style in `AGENTS.md` (braces on every block, no nested ternaries, one statement per line, avoid `any` where a real type is feasible).
6. Unit tests use `bun:test`. Type-level assertions use `expectTypeOf` from `bun:test` where it is enough and `// @ts-expect-error` lines otherwise; the latter only count if the file is type-checked, so each task that adds them runs the type gate in section 6.
7. Integration tests need a server (`.env`). Run them if `ES_ENDPOINT` is reachable; if not, say so plainly in the report instead of claiming they pass.

---

## 5. Tasks

### T1 — Field extraction functions (wave 1)

- **Owns (new):** `src/mappingFields/mappingFields.ts`, `src/mappingFields/mappingFields.spec.ts`.
- **Work:** implement `getAllFields` and `getFulltextFields` exactly per section 1.2. One shared internal walker; no imports other than `import type { estypes }`.
- **Unit tests:** one test per numbered rule in 1.2, plus: three-level nesting; `object` without an explicit `type`; `nested`; a text field with a keyword sub-field and a keyword field with a text sub-field (both option settings); each of the four full-text types; `completion` and `token_count` excluded; `alias` to a text field and to a keyword field; runtime fields; property names containing dots; `subFields` and `containers` together; empty and missing `mappings`; input object not mutated; the books mapping from section 1.1 as a full expected-output snapshot.

### T2 — Type-level helpers (wave 1)

- **Owns (new):** `src/mappingFields/mappingTypes.ts`, `src/mappingFields/mappingTypes.spec.ts`.
- **Work:** implement `MappingFieldPath`, `MappingFulltextPath`, `MappingRecord` per sections 1.3 and 3, including the `string` / `Record<string, any>` fallbacks and D3. Start from the `PathsOf` sketch in section 3. Do not import from `IndexManager`; the types take the creation-request type directly.
- **Unit tests (type-level):** every row of the table in section 3 that concerns these types; fallback for a widened `estypes.IndicesCreateRequest`; `as const satisfies` declaration; a specification with no `mappings`; `dynamic: true` gives `string` and `dynamic: 'strict'` forbids extra record keys; record value types for each mapped group, arrays, `null`, nested arrays of objects; an unknown mapping type yields `unknown`. Add one runtime test that feeds the same fixture to T1's rules by hand-listing the expected paths, so the two modules' semantics are pinned to the same list (T6 replaces the hand list with a direct comparison once both exist).

### T3 — Test client and fixtures (wave 1)

- **Owns:** `src/testFixtures/*` (new `testClient.ts`, new `recordingClient.ts`, edits to `books.ts`), `src/QueryBuilder/QueryBuilder.integration.test.ts`.
- **Work:**
  1. `testClient.ts`: `getTestClient()` builds a `Client` from `ES_ENDPOINT`, `ES_API_KEY` or `ES_USERNAME` / `ES_PASSWORD`. This is the old `getEsClient()` body moved to test-only code, minus `ES_VERSION` and the `Accept` header override. Memoize it so one process shares one client.
  2. `recordingClient.ts`: move `getRecordingClient()` out of `IndexManager.spec.ts` unchanged (T4 switches the spec to import it).
  3. `books.ts`: replace `getBooksSchema()` with `getBooksCreateRequest(index: string): estypes.IndicesCreateRequest` built from the existing `getBooksMappings()`; keep `getBooksMappings()` and `getBooksData()`; switch the three helpers from `getEsClient()` to `getTestClient()`. Leave `getBooksSchema` exported until T4 stops using it, then T4 reports it for removal in T6.
  4. `QueryBuilder.integration.test.ts`: use `getTestClient()`.
- **Tests:** `bun test src/QueryBuilder/QueryBuilder.integration.test.ts` passes against the server; a small `testClient.spec.ts` checks API-key vs. basic auth selection and memoization without a network call.

### T4 — `IndexManager` constructor, creation request, error classification (wave 2)

- **Depends on:** T1, T2, T3.
- **Owns:** `src/IndexManager/IndexManager.ts`, `src/IndexManager/IndexManager.spec.ts`, `src/IndexManager/IndexManager.integration.test.ts`, `src/QueryRunner/QueryRunner.ts`, `src/SchemaRegistry/SchemaRegistry.ts`, `src/SchemaRegistry/SchemaRegistry.spec.ts`.
- **Work:**
  1. Constructor and properties per section 1.1; export `ManageOptions`. Apply D2.
  2. Class type parameter becomes `const Create extends estypes.IndicesCreateRequest`. Replace `ElasticsearchRecord<ThisSchema>` with `MappingRecord<Create>` in `put`, `putBulk`, `patch`; type `findById`'s `record` as `MappingRecord<Create>`. Replace `IndexInferSchema` / `IndexInferRecordShape` per section 1.3.
  3. `getCreateRequest` per section 1.1. Remove all `SchemaManager`, `getEsClient`, `SchemaShape`, `IndexSettings`, `MappingProperties` usage from this file.
  4. `_formatError` and `isApiNotAvailable` per section 1.5; the import line becomes type-only. `aliasExists` currently casts to `errors.ResponseError`; use a local structural type. Remove the stale example comment at the bottom of the file or rewrite it for the new signature.
  5. `QueryRunner`: type parameter becomes `Create extends estypes.IndicesCreateRequest`; records are `MappingRecord<Create>`. Leave its builder as plain `QueryBuilder` (T5 types it).
  6. `SchemaRegistry`: `import type { estypes }`; `listIndexes()` reads `index.index.version` instead of the broken `index.schema.schema.version`.
  7. Update the specs and the integration test to the new constructor, using `getRecordingClient()`, `getTestClient()` and `getBooksCreateRequest()` from T3.
- **Unit tests** (stub or recording client, no server):
  - Names: `create.index` plus each of `separator`, `version`, `prefix`, `language`, and their defaults, produce the expected full and alias names; an invalid `create.index` throws.
  - Missing `options`, missing `client`: `TypeError` with a clear message. D2 alias collision throws.
  - `getCreateRequest()`: `index` is the full name; `settings`, `mappings`, `aliases` and other keys pass through; `more` overrides; `createSpec` and the caller's object are unchanged afterwards. `createOnly()` sends that body (recording client, check path and body).
  - `allFields` / `fulltextFields` equal T1's output for the specification.
  - Error classification with plain objects/`Error`s carrying each `name`: `response`, `connection`, `timeout`, `disconnected`, and `javascript` for anything else; an error from a _different class with the same name_ still classifies (the duplicate-package case); `flush()` treats a `ResponseError`-named error with `api_not_available_exception` as skipped.
  - Type-level: `put` rejects a wrong value type; `IndexInferRecordShape` and `IndexInferFields` resolve for an inline specification and fall back for a widened one; `IndexManager[]` accepts differently-typed managers.
  - `SchemaRegistry.listIndexes()` returns the version.
  - Existing `put` / `patch` / `flush` tests keep passing with only their construction changed.
- **Integration tests:** the existing file passes with the books creation request; add one test that `create()` produces an index whose mapping, read back with `getIndexMetadata()`, contains a custom analyzer and a sub-field from the specification (proves pass-through of `settings` and `fields`).

### T5 — Typed field names in `QueryBuilder`, `QueryRunner`, `IndexManager` (wave 2, after T4)

- **Depends on:** T4.
- **Owns:** `src/QueryBuilder/QueryBuilder.ts`, new `src/QueryBuilder/QueryBuilder.fields.spec.ts`, `src/QueryRunner/QueryRunner.ts`, `src/IndexManager/IndexManager.ts` (callback types only), new `src/IndexManager/IndexManager.fields.spec.ts`.
- **Work:** section 1.4. Signature-only changes in `QueryBuilder`; no emitted DSL may change. `QueryBuilderProvider` becomes generic over `Field`. `deleteMany` constructs `new QueryBuilder<MappingFieldPath<Create>>()`.
- **Unit tests:**
  - The existing `QueryBuilder.spec.ts` passes **unmodified** (proves the default parameter keeps old behavior and output).
  - `QueryBuilder.fields.spec.ts` (type-level): for `QueryBuilder<'a' | 'b.c'>`, each field-taking method accepts a known field and rejects an unknown one (one `@ts-expect-error` per method listed in 1.4); pattern/boost methods accept arbitrary strings; callbacks of `should`, `shouldNot`, `mustNot`, `nested`, `rescore` receive the same `Field`; `clone()` keeps it; `QueryBuilder<'a'>` is assignable to `QueryBuilder`.
  - `IndexManager.fields.spec.ts` (type-level, stub client): `findMany` / `findFirst` / `count` / `deleteMany` / `run` callbacks reject unknown fields for an inline specification, accept sub-field and nested paths, and accept anything for a widened specification and for `dynamic: true`; `updateMany` keys are checked.
  - Declaration check: after `bun run build`, a scratch consumer file that imports from `dist/index.d.ts` shows the same accept/reject behavior under TypeScript 5.9 (limit 6 in section 3). Keep the consumer file as `src/typeConsumer.spec-d.ts` or similar only if it can be type-checked by the gate without being bundled; otherwise describe the manual check in the report.

### T6 — Removal, public surface, enforcement, docs (wave 3)

- **Depends on:** T4, T5.
- **Owns:** deletes `src/SchemaManager/*` and `src/getEsClient/getEsClient.ts`; edits `src/types.ts`, `index.ts`, `src/testFixtures/books.ts` (remove `getBooksSchema`), `README.md`, `AGENTS.md`, `CHANGELOG.md`, `.env.example`, `import-test.ts`, `package.json` (scripts only); new `src/typesOnlyImports.spec.ts`; `src/mappingFields/mappingTypes.spec.ts` (the comparison noted in T2).
- **Work:**
  1. Delete the two modules. Remove from `src/types.ts`: `ColumnType`, `SchemaShape`, `ElasticsearchType`, `ElasticsearchRecord`, and `IndexSettings` / `MappingProperties` / `MappingProperty` if nothing uses them any more.
  2. `index.ts`: remove `getEsClient`, `SchemaManager`, `ManagerInferRecordShape`, `ManagerInferSchema`, `IndexInferSchema`; add `ManageOptions`, `IndexInferCreate`, `IndexInferFields`, `getAllFields`, `getFulltextFields`, `MappingFieldPath`, `MappingFulltextPath`, `MappingRecord`.
  3. `src/typesOnlyImports.spec.ts`: scan `index.ts` and all non-test, non-fixture files under `src/` (use `Bun.Glob`) and fail on any `import` or `export … from` an `@elastic/` package that is not type-only, including mixed forms such as `import { type Client, errors }` and dynamic `import()` / `require()`. Include self-tests of the matcher on sample strings so the check cannot silently pass.
  4. Add a `typecheck` script if none exists yet (`tsc --noEmit -p .`) so type-level tests are enforced.
  5. README: new "Basic usage" for `IndexManager` (client construction is the caller's job; show a `Client` being created and passed), the `as const satisfies` pattern, typed field names with the limits from section 3, a "writing text fields" note covering the old `.exact` / `.fulltext` sub-fields (D5), the serverless example, and the test-setup section (`getTestClient`, no `ES_VERSION`). AGENTS.md: architecture list (drop `SchemaManager`, `getEsClient` and the nonexistent `EsFetchClient.ts`; add `mappingFields`), read order, the types-only rule. `.env.example`: say the variables are used by the test suite only; drop `ES_VERSION`. CHANGELOG: a `3.0.0-beta.3` entry listing section 7.
- **Unit tests:** `typesOnlyImports.spec.ts` as above; a spec that imports from `index.ts` and asserts the new exports exist and the removed ones do not; every README `IndexManager` code sample is compiled by a spec (type-check only, stub client).

---

## 6. Gates

**Per task** (subagent runs before reporting; orchestrator re-runs before committing):

```bash
bun test <the task's spec files>
bun test src/**/*.spec.ts                 # no regressions in unit tests
bunx biome check <files the task created>
bunx tsc --noEmit -p .                    # see note
```

Type-check note: the repo does not type-check cleanly today. Before wave 1 the orchestrator records the baseline error list (`bunx tsc --noEmit -p . > baseline.txt` in its scratch directory). A task passes when its owned files have **zero** errors and no file outside them has new ones. T4 and T6 remove files and types, so their error count elsewhere must go down, not up.

**After T4, T5 and T6** additionally: `bun test` (full suite, with a server), `bun run lint`, `bun run build`.

**Final** (orchestrator):

1. `bun test` full suite green against the server in `.env`.
2. `bun run build` succeeds, then `grep -c "@elastic" dist/index.mjs` prints `0`.
3. `grep -rn "getEsClient\|SchemaManager\|SchemaShape" index.ts src README.md AGENTS.md` returns nothing.
4. `bun run import-test.ts` works against the built bundle.
5. Each row of section 7 appears in the CHANGELOG.

A task that fails its gate goes back to the same subagent (`SendMessage`) with the failing output.

---

## 7. Breaking changes (for the CHANGELOG)

1. `new IndexManager({ index, schema, … })` → `new IndexManager(options, create)`.
2. `client` is required; `getEsClient()` is removed and `ES_ENDPOINT` / `ES_API_KEY` / `ES_USERNAME` / `ES_PASSWORD` / `ES_VERSION` are no longer read by the library (`ES_SERVERLESS` still is).
3. String schemas (`SchemaShape`) are gone, along with `SchemaManager`, `ManagerInferSchema`, `ManagerInferRecordShape`, `IndexInferSchema`, `ElasticsearchRecord`, `ElasticsearchType`, `ColumnType`.
4. `text` fields no longer get `.exact` / `.fulltext` sub-fields or `term_vector` automatically; sub-objects are no longer mapped as `nested` automatically; the `analyzer` option is gone. Declare all of these in the mapping.
5. `IndexManager.schema`, `.settings`, `.analyzer` are removed; `.createSpec` is added.
6. `allFields` now contains full dotted paths; `fulltextFields` no longer includes `completion` or `token_count` fields.
7. Field names passed to query callbacks from an `IndexManager` are type-checked (compile-time only). Requires TypeScript 5.0+.
8. Error `errorKind` is decided by the error's `name`, not `instanceof`.

---

## 8. Subagent prompt template

```
You are implementing task <ID> of
docs/plans/2026-11-20-index-manager-create-request.md in the es-query-pro
repository. Read AGENTS.md, then sections 1, 3 and 4.2 of the plan, then your
task block (pasted below). Every decision in section 2 is settled: use the
"Default chosen" column.

Files you own (edit or delete nothing else): <list>
Reports from tasks you depend on: <pasted final reports>

Method:
1. Write the unit tests listed in your task block first; confirm they fail for
   the right reason.
2. Implement until they pass.
3. Run the per-task gate in section 6 and fix what it finds in your files.

Rules: no git write commands; do not reformat files you did not create; follow
the code style in AGENTS.md; do not weaken or delete an existing test to make
it pass — if an existing assertion is wrong under the new design, say which
one and why.

Final report: gate output summary; files changed; public API added, changed or
removed; anything another task must do (name the task); whether integration
tests were actually run against a server; anything unfinished, stated plainly.

<task block>
```

---

## 9. Risks

- **`IndexManager.ts` has pre-existing type errors** (for example `e.meta` on `unknown`, `response.body`). T4 fixes those it touches and must not be blocked by the rest; the baseline comparison in section 6 handles this.
- **`weightedSemantic` targets a `.raw` sub-field** that no mapping in this library ever created. This plan does not change it, but with hand-written mappings the README must state which sub-field that method expects (T6).
- **Inference depends on how callers write the specification** (section 3, limit 1). The fallback is silent, so the README needs a short "why are my field names not checked?" note.
- **Declaration bundling of `const` type parameters** (section 3, limit 6) is verified in T5; if `dts-bundle-generator` cannot emit it, the fallback is a static factory `IndexManager.define(options, create)` carrying the `const` parameter, with the class parameter left non-`const`.
