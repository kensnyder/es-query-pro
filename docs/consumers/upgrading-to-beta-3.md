# Upgrading a consumer codebase from `es-query-pro` 3.0.0-beta.2 to 3.0.0-beta.3

These are instructions for an AI agent (or a person) changing an application
that uses `es-query-pro`. Follow the steps in order. The goal is a code-only
upgrade: **the mappings sent to Elasticsearch must stay exactly the same**, so
no index needs to be migrated.

## What changed, in one paragraph

`IndexManager` no longer builds a mapping from a string schema and no longer
creates its own Elasticsearch client. You now pass a client and a real
Elasticsearch index-creation request: `new IndexManager(options, create)`.
`SchemaManager`, `getEsClient()` and the string-schema types are gone. In
return, field names in query callbacks and records passed to `put` / `putBulk`
/ `patch` are checked against the mapping at compile time. `QueryBuilder`
itself builds the same DSL as before.

## Requirements

- TypeScript 5.0 or later (the library uses `const` type parameters).
- `@elastic/elasticsearch` 9.x installed in the application. It was already a
  peer dependency; the application now also creates the client.

## Step 0 — Find the affected code

Run these searches in the consumer repository and keep the list of files.
Every hit needs one of the steps below.

```bash
grep -rnE "new IndexManager|getEsClient|SchemaManager|SchemaShape" src
grep -rnE "IndexInferSchema|ManagerInferSchema|ManagerInferRecordShape" src
grep -rnE "ElasticsearchRecord|ElasticsearchType|ColumnType" src
grep -rnE "MappingProperties|MappingProperty|IndexSettings" src
grep -rnE "\.schema\b|\.settings\b|\.analyzer\b|allFields|fulltextFields" src
grep -rnE "ES_VERSION|ES_ENDPOINT|ES_API_KEY|ES_USERNAME|ES_PASSWORD" .
```

**Before changing anything**, record the creation request each manager
produces today. Step 6 compares against it.

```ts
// scratch script, run once on beta.2 for every IndexManager in the app
console.log(JSON.stringify(booksIndex.getCreateRequest().body, null, 2));
```

Save each output to a scratch file named after the index.

Then install the new version: `bun add es-query-pro@3.0.0-beta.3` (or the
equivalent for the project's package manager).

## Step 1 — Create the Elasticsearch client yourself

The library no longer reads `ES_ENDPOINT`, `ES_API_KEY`, `ES_USERNAME`,
`ES_PASSWORD` or `ES_VERSION`. It still reads `ES_SERVERLESS`.

If the application called `getEsClient()` or relied on the default client (an
`IndexManager` built with no `client` option), add one module that creates a
single shared client and import it everywhere. This reproduces what
`getEsClient()` did:

```ts
// src/esClient.ts (in the consumer application)
import { Client, HttpConnection } from '@elastic/elasticsearch';

const apiKey = process.env.ES_API_KEY;

export const esClient = new Client({
  node: process.env.ES_ENDPOINT || 'http://localhost:9200',
  auth: apiKey
    ? { apiKey }
    : {
        username: process.env.ES_USERNAME || '',
        password: process.env.ES_PASSWORD || '',
      },
  Connection: HttpConnection,
});
```

Notes:

- The old default client created a new `Client` for every `IndexManager`.
  Share one instead.
- The old client also sent `Accept: application/vnd.elasticsearch+json;
compatible-with=${ES_VERSION || 9}`. The installed client version now decides
  compatibility. Only if the application set `ES_VERSION` to something other
  than the client's major version, add that `headers` entry back yourself and
  tell the maintainer.
- If the application already passed its own `client`, keep it; it only moves
  (step 2).
- Replace every remaining `getEsClient()` call with the shared client.

## Step 2 — Convert every `new IndexManager(...)`

### 2.1 Where each old option goes

| beta.2 constructor option                             | beta.3                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `client` (optional)                                   | `options.client` (**required**; a missing client throws a `TypeError`)    |
| `serverless`                                          | `options.serverless`                                                      |
| `index.name`                                          | `create.index` (the logical name, e.g. `'books'`, not the versioned name) |
| `index.version`, `.prefix`, `.language`, `.separator` | `options.version`, `.prefix`, `.language`, `.separator` (same defaults)   |
| `schema`                                              | `create.mappings.properties`, converted with the rules in 2.2             |
| `properties`                                          | merged into `create.mappings.properties` (see 2.2, rule 5)                |
| `settings`                                            | `create.settings`, unchanged                                              |
| `analyzer`                                            | removed. It never had any effect in beta.2 (see 2.2, rule 1)              |

Index and alias names are computed exactly as before
(`prefix~language~name~v<version>` and `prefix~language~name`), so existing
indexes are found under the same names.

### 2.2 Converting a string schema to mapping properties

Apply these rules to every entry of the old `schema` object. They reproduce
exactly what beta.2 sent to Elasticsearch.

1. `'text'` becomes the following. The `fulltext` analyzer is always
   `'english'`, **even if the old code passed an `analyzer` option or a
   non-English `language`**: beta.2 ignored both when building the mapping.

   ```ts
   {
     type: 'text',
     term_vector: 'with_positions_offsets',
     fields: {
       exact: { type: 'text', analyzer: 'standard' },
       fulltext: { type: 'text', analyzer: 'english' },
     },
   }
   ```

2. `'date.<format>'` (for example `'date.epoch_second'`) becomes
   `{ type: 'date', format: '<format>' }`. beta.2 kept only the text between
   the first and second `.`; if the old format itself contained a `.`, use the
   value from the output recorded in step 0, not the source string.
3. Any other string `'<type>'` (`'keyword'`, `'integer'`, `'boolean'`,
   `'date'`, …) becomes `{ type: '<type>' }`.
4. A sub-object becomes `{ type: 'nested', properties: { … } }`, with these
   rules applied to its entries, at any depth.
5. Then spread the old `properties` option over the result. An old
   `properties` key with the same name as a schema key replaces it.

Nothing is added automatically any more. If a `text` field is written without
the `exact` / `fulltext` sub-fields or `term_vector`, the mapping changes, and
queries that name `title.exact` or `title.fulltext` and the default `fvh`
highlighter stop working for that field.

To avoid repeating rule 1, the application may define its own helper (the
library does not export one):

```ts
import type { estypes } from '@elastic/elasticsearch';

export const legacyText = {
  type: 'text',
  term_vector: 'with_positions_offsets',
  fields: {
    exact: { type: 'text', analyzer: 'standard' },
    fulltext: { type: 'text', analyzer: 'english' },
  },
} as const satisfies estypes.MappingProperty;
```

### 2.3 Example

Before (beta.2):

```ts
import { IndexManager } from 'es-query-pro';

export const booksIndex = new IndexManager({
  index: { name: 'books', version: 2, prefix: 'prod' },
  schema: {
    id: 'keyword',
    title: 'text',
    published_at: 'date.epoch_second',
    categories: { id: 'integer', name: 'text' },
  },
  properties: { price: { type: 'scaled_float', scaling_factor: 100 } },
  settings: { number_of_shards: 1 },
});
```

After (beta.3):

```ts
import { IndexManager } from 'es-query-pro';
import { esClient } from './esClient';
import { legacyText } from './legacyText';

export const booksIndex = new IndexManager(
  { client: esClient, version: 2, prefix: 'prod' },
  {
    index: 'books',
    settings: { number_of_shards: 1 },
    mappings: {
      properties: {
        id: { type: 'keyword' },
        title: legacyText,
        published_at: { type: 'date', format: 'epoch_second' },
        categories: {
          type: 'nested',
          properties: { id: { type: 'integer' }, name: legacyText },
        },
        price: { type: 'scaled_float', scaling_factor: 100 },
      },
    },
  },
);
```

### 2.4 Keep the creation request a literal

Field-name checking only works when TypeScript can see the literal shape.

- Write the request inline in the constructor call, **or** declare it with
  `as const satisfies estypes.IndicesCreateRequest`.
- Do **not** annotate it (`const spec: estypes.IndicesCreateRequest = …`) and
  do not return it from a function with that return type. That compiles, but
  silently turns field checking off for the manager.

```ts
export const booksCreate = {
  index: 'books',
  mappings: { properties: { title: legacyText } },
} as const satisfies estypes.IndicesCreateRequest;

export const booksIndex = new IndexManager({ client: esClient }, booksCreate);
```

### 2.5 Other constructor rules

- `create.aliases` is passed through to Elasticsearch, but it must not contain
  the manager's own alias name (`getAliasName()`); the constructor throws if it
  does. The manager still creates and moves that alias itself.
- Do not change `version` as part of this upgrade. Bump it only when the
  mapping really changes, as before.

## Step 3 — Replace removed members and functions

| beta.2                                              | beta.3                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `index.schema` (a `SchemaManager`)                  | `index.createSpec` (the creation request as passed, read-only)                                              |
| `index.schema.toMappings()`                         | `index.createSpec.mappings`                                                                                 |
| `index.schema.getAllFields()`                       | `index.allFields`, or `getAllFields(index.createSpec, options)`                                             |
| `index.schema.getFulltextFields()`                  | `index.fulltextFields`, or `getFulltextFields(index.createSpec, options)`                                   |
| `index.settings`                                    | `index.createSpec.settings`                                                                                 |
| `index.analyzer`                                    | removed; read the analyzer from the mapping                                                                 |
| `new SchemaManager({ schema }).toMappings()`        | write the mapping by hand (2.2)                                                                             |
| `getEsClient()`                                     | the application's own client (step 1)                                                                       |

`allFields` and `fulltextFields` changed content. Check every place that reads
them:

- `allFields` now holds **full dotted paths** (`categories.name`). beta.2
  returned bare leaf names for nested fields (`name`).
- Neither list includes sub-fields (`title.exact`) or containers
  (`categories`) by default. Ask for them with
  `getAllFields(create, { subFields: true, containers: true })` and
  `getFulltextFields(create, { subFields: true })`.
- `fulltextFields` contains fields of type `text`, `match_only_text`,
  `search_as_you_type` and `semantic_text`, plus `alias` fields that point at
  one. `completion` and `token_count` fields are no longer included.

## Step 4 — Replace removed types

| beta.2 type                                         | beta.3 replacement                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| `IndexInferRecordShape<typeof index>`               | same name; now derived from the mapping                                           |
| `IndexInferSchema<typeof index>`                    | `IndexInferCreate<typeof index>` (the creation request type)                      |
| `ElasticsearchRecord<Schema>`                       | `MappingRecord<Create>` or `IndexInferRecordShape<typeof index>`                  |
| `ManagerInferRecordShape<…>`, `ManagerInferSchema<…>` | `MappingRecord<Create>`, the creation request type                              |
| `SchemaShape`, `ColumnType`, `ElasticsearchType`    | `estypes.IndicesCreateRequest`, `estypes.MappingProperty`                         |
| `MappingProperties`, `MappingProperty`              | `Record<string, estypes.MappingProperty>`, `estypes.MappingProperty`              |
| `IndexSettings`                                     | `estypes.IndicesIndexSettings`                                                    |
| (new) field-name union                              | `IndexInferFields<typeof index>` or `MappingFieldPath<Create>`                    |
| (new) search hit                                    | `QueryRecord<Create>` (`MappingRecord<Create>` plus `_score`)                     |

The record type is not the same shape as before:

- Every field is **optional** and may be `null` or an array of its type.
  Code that read a field as always present now needs a null check.
- All numeric mapping types are `number`. beta.2 typed every numeric type
  except `integer` as `string`; remove conversions and casts that existed only
  to satisfy that.
- `date` and `date_nanos` are `string | number | Date`.
- Types without a plain JavaScript counterpart (`geo_point`, `dense_vector`,
  …) are `unknown`.
- Keys that are not in the mapping are allowed unless `mappings.dynamic` is
  `'strict'`.
- An array is rejected where a single record is expected (`put('1', [...])`).

## Step 5 — Fix the new compile errors

Run the project's type check. Errors now appear in three places.

### 5.1 Field names in query callbacks

The builders given to `index.findMany`, `findFirst`, `count`, `deleteMany` and
`index.run` only accept field names from the mapping in methods that take one
concrete field (`term`, `match*`, `range`, `exists`, `wildcard`,
`containsExact`, `rexgep`, `queryString`, `moreLikeThis`, `termsSet`, `knn`,
`semantic`, `rrf`, `weightedSemantic`, `highlightField`, the `aggregate*`
helpers, `dateHistogram`, and `nested`'s `path`). The keys of
`runner.updateMany({...})` are checked the same way.

For each error, decide which case it is:

| Cause                                                                       | Fix                                                                                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A typo or a field that really is not in the mapping                         | Fix the name. This was a silent bug before; tell the maintainer.                                                                      |
| A nested field named without its parent (`name` instead of `categories.name`) | Use the full dotted path.                                                                                                           |
| A sub-field such as `title.exact` that the converted mapping lacks          | The mapping conversion dropped it. Fix the mapping (2.2), not the query.                                                              |
| A field Elasticsearch adds at run time (dynamic mapping, dynamic templates, another writer) | If the index really relies on dynamic mapping, say so in the mapping: `mappings: { dynamic: true, … }`. This matches the server default, so the index does not change, and field names become plain `string` for that manager. |
| The field name is computed at run time (`string` variable)                  | Narrow it: type the variable as `IndexInferFields<typeof index>`, or validate it against `index.allFields` first.                     |
| None of the above fits and checking must be off for one manager             | `new IndexManager<estypes.IndicesCreateRequest>(options, create)`. Leave a comment saying why.                                        |

Not affected:

- A standalone `new QueryBuilder()` accepts any string, as before.
- Parameters that take patterns, boosts or raw DSL are still `string`:
  `fields`, `sourceIncludes`, `excludeFields`, `sourceExcludes`, `multiMatch`
  fields (`title^3`), `sort`, `rawCondition`, `must`, `aggs`.
- A helper typed `(qb: QueryBuilder) => void` can still be passed as a
  callback, and a typed builder can still be passed to a function that takes a
  plain `QueryBuilder`. To get checking inside such a helper, type its
  parameter as `QueryBuilder<IndexInferFields<typeof index>>`.

### 5.2 Records passed to `put`, `putBulk` and `patch`

Values are checked against the mapping type (step 4). A wrong value type is a
real bug or a wrong mapping; fix whichever is wrong. Do not cast the record to
`any`.

### 5.3 Result types

- Search records are `QueryRecord<Create>`; `findById` returns
  `record: MappingRecord<Create> | null`. Add null handling where fields are
  read (step 4).
- `StatusReport.indexExists` and `.aliasExists` are `boolean | null` (`null`
  when the check itself failed).

Do not silence errors with `as any`, `// @ts-ignore`, or by widening every
manager. If an error does not fit a row above, stop and report it.

## Step 6 — Behavior changes to check

1. **Error classification.** `errorKind` is decided by the error's `name`
   (`ResponseError` → `'response'`, `ConnectionError` → `'connection'`,
   `TimeoutError` → `'timeout'`, `NoLivingConnectionsError` →
   `'disconnected'`, anything else → `'javascript'`). Application code that
   checks `errorKind` needs no change. Tests that fake a client error with a
   plain object or a custom class must give it the right `name`.
2. **`getIndexMetadata()`** returned an error for every call in beta.2. It now
   returns the metadata. Remove any workaround.
3. **`weightedSemantic`** queries `${standardField}.raw`. No version of the
   library created that sub-field; if the application uses this method, the
   mapping must declare `fields: { raw: { type: 'keyword' } }` on that field.
   Adding it is a mapping change and needs a version bump.
4. **Environment variables.** Remove `ES_VERSION` from `.env` files and
   deployment configuration unless step 1 kept it. The other `ES_*` connection
   variables are now read only by the application's own client module.

## Step 7 — Verify

1. **Mappings are unchanged.** For every manager, print
   `JSON.stringify(index.getCreateRequest().body, null, 2)` again and diff it
   against the output saved in step 0. The only acceptable differences are key
   order and an explicit `dynamic: true` added in step 5.1. If `mappings`
   differs in any other way, fix the conversion; do not bump the version to
   make it pass.
2. **Names are unchanged.** `index.getFullName()` and `index.getAliasName()`
   return the same strings as before.
3. The searches from step 0 return nothing for the removed names.
4. Type check, lint and the test suite pass.
5. Against a non-production cluster, `await index.getStatus()` reports the
   existing index as current (no creation or migration needed).

## Report back

When finished, tell the maintainer:

- every file changed;
- any field name that turned out to be wrong in existing queries (5.1, row 1);
- any manager where checking was turned off (`dynamic: true` or the widened
  type) and why;
- any mapping that could not be reproduced exactly;
- whether step 7.5 was run against a real cluster.
