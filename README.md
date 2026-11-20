# es-query-pro

[![NPM Link](https://badgen.net/npm/v/es-query-pro?v=3.0.0-beta.2)](https://npmjs.com/package/es-query-pro)
[![Language](https://badgen.net/static/language/TS?v=3.0.0-beta.2)](https://github.com/search?q=repo:kensnyder/es-query-pro++language:TypeScript&type=code)
[![Code Coverage](https://codecov.io/gh/kensnyder/es-query-pro/branch/main/graph/badge.svg?v=3.0.0-beta.2)](https://codecov.io/gh/kensnyder/es-query-pro)
![Minzipped Size](https://badgen.net/static/size/59kb?v=3.0.0-beta.2)
![Tree Shakeable](https://badgen.net/static/tree%20shakeable/yes/green?v=3.0.0-beta.2)
[![ISC License](https://badgen.net/static/license/ISC/green?v=3.0.0-beta.2)](https://opensource.org/licenses/ISC)

Elasticsearch query builder and index manager with consistent APIs

** Only works with Elasticsearch 9.x **

## Installation

`npm install es-query-pro @elastic/elasticsearch`

`@elastic/elasticsearch` (version 9) is a peer dependency. The package is ESM
only (there is no CommonJS build). Typed field names (see below) need
TypeScript 5.0 or newer.

## Table of Contents

- [Basic usage](#basic-usage)
- [Results and errors](#results-and-errors)
- [IndexManager](#indexmanager)
- [Zero-downtime migration](#zero-downtime-migration)
- [QueryRunner](#queryrunner)
- [SchemaRegistry](#schemaregistry)
- [Query Builder function quick reference](#query-builder-function-quick-reference)
- [Full documentation](#full-documentation)
- [Running tests](#running-tests)

## Basic usage

Query Builder

```ts
import { QueryBuilder } from "es-query-pro";

const builder = new QueryBuilder();
builder.term({ field: "author", value: 15 });
builder.matchBoostedPhrase({
  field: "description",
  phrase: "Mobile phone app",
});
builder.range("created_at", ">=", "2021-01-01");
builder.sort("created_at", "desc");
builder.limit(10);
builder.page(2);
```

Index Manager

An `IndexManager` takes two arguments: options, which include the
Elasticsearch `Client` to send requests with, and a regular Elasticsearch
[index creation request](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-create)
(`estypes.IndicesCreateRequest`). Creating and configuring the client is up
to your application; es-query-pro imports `@elastic/elasticsearch` for its
types only and reads no connection settings from the environment.

```ts
import { Client, HttpConnection } from "@elastic/elasticsearch";
import { englishplus, IndexManager, SchemaRegistry } from "es-query-pro";

const client = new Client({
  node: process.env.ES_ENDPOINT,
  auth: { apiKey: process.env.ES_API_KEY ?? "" },
  // recommended on Bun, see "Results and errors"
  Connection: HttpConnection,
});

export const booksIndex = new IndexManager(
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
// index prod~english~books~v1, read and written through alias prod~english~books

const schemaRegistry = new SchemaRegistry();
schemaRegistry.register(booksIndex);

// create or migrate every registered index
const { completion } = await schemaRegistry.migrateIfNeeded();
const { success, summary } = await completion;

await booksIndex.put("1", {
  id: "1",
  title: "Skyward",
  categories: [{ id: 101, name: "Fantasy" }],
});

const { records, total, error } = await booksIndex.findMany((qb) => {
  qb.match({ field: "title", phrase: "skyward" });
  qb.nested({
    path: "categories",
    query: (sub) => sub.term("categories.id", 101),
  });
});
```

The first argument (`ManageOptions`):

| Option       | Description                                                                                               | Default         |
| ------------ | --------------------------------------------------------------------------------------------------------- | --------------- |
| `client`     | The `Client` from `@elastic/elasticsearch` (required; a missing client throws a `TypeError`)              | _none_          |
| `version`    | Index version: a non-negative integer or a non-empty string. Raising it makes `migrateIfNeeded()` migrate | `1`             |
| `prefix`     | First part of the index name, such as `prod` or an app name. Must be lowercase                            | `""`            |
| `language`   | Language part of the index name. Must be lowercase and not empty                                          | `"english"`     |
| `separator`  | Separator between the name parts                                                                          | `"~"`           |
| `serverless` | Whether the cluster is Elastic Cloud Serverless (see [below](#elastic-cloud-serverless))                  | `ES_SERVERLESS` |

The constructor throws a `RangeError` when the full name or the alias name
would not be a valid Elasticsearch index name (uppercase letters, spaces,
`\ / * ? " < > | , # :`, a leading `- _ + .`, more than 255 bytes), when a
part contains the separator, or when `version` is negative, fractional or
empty. Pass `process.env.NODE_ENV` and similar values in lowercase.

The second argument is the creation request, used as written:

- `index` is the logical name (`books`). The manager sends the versioned full
  name instead (`prod~english~books~v1`) and points the alias
  (`prod~english~books`) at it.
- Everything else (`settings`, `mappings`, `aliases`, `wait_for_active_shards`,
  timeouts) is sent unchanged. `getCreateRequest().body` is the exact body
  sent and `createSpec` holds the object you passed.
- `aliases` may name other aliases, but not the manager's own alias, because
  migrations move that one.
- Nothing is added to the mapping: no sub-fields, no `nested` type, no
  analyzer. See [Writing text fields](#writing-text-fields).

### Typed field names

When the creation request is visible to TypeScript as a literal, field names
in query callbacks are checked against its mapping: leaves, `object` and
`nested` containers, multi-field sub-fields and runtime fields, as dotted
paths. Records passed to `put()`, `putBulk()` and `patch()` are checked too.

```ts
import { Client } from "@elastic/elasticsearch";
import { IndexManager } from "es-query-pro";

const client = new Client({ node: "http://localhost:9200" });

const booksIndex = new IndexManager(
  { client },
  {
    index: "books",
    mappings: {
      properties: {
        title: {
          type: "text",
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

await booksIndex.findMany((qb) => {
  qb.term("title.exact", "Skyward"); // ok: a sub-field
  qb.nested({
    path: "categories",
    query: (sub) => sub.term("categories.id", 101), // ok: a nested path
  });
  // @ts-expect-error  "categoreis.id" is not in the mapping
  qb.term("categoreis.id", 101);
});

// @ts-expect-error  categories.id is an integer
await booksIndex.put("2", { categories: [{ id: "one hundred" }] });
```

To declare the creation request apart from the constructor, keep its literal
type with `as const satisfies estypes.IndicesCreateRequest`. The inferring
types then give you the field names and the record shape:

```ts
import { Client, type estypes } from "@elastic/elasticsearch";
import {
  IndexManager,
  type IndexInferFields,
  type IndexInferRecordShape,
} from "es-query-pro";

const client = new Client({ node: "http://localhost:9200" });

export const authorsCreate = {
  index: "authors",
  mappings: {
    dynamic: "strict",
    properties: {
      name: { type: "text", fields: { raw: { type: "keyword" } } },
      born: { type: "date" },
    },
  },
} as const satisfies estypes.IndicesCreateRequest;

export const authorsIndex = new IndexManager({ client }, authorsCreate);

// "name" | "name.raw" | "born"
export type AuthorField = IndexInferFields<typeof authorsIndex>;

// { name?: string | string[] | null; born?: string | number | Date | ... }
export type Author = IndexInferRecordShape<typeof authorsIndex>;

const author: Author = { name: "Ursula K. Le Guin", born: "1929-10-21" };
// @ts-expect-error  dynamic: "strict" rejects fields that are not mapped
const typo: Author = { nmae: "Ursula K. Le Guin" };
```

The same types are exported for a creation request without a manager:
`MappingFieldPath<Create>`, `MappingFulltextPath<Create>` (full-text paths
only) and `MappingRecord<Create>`; `IndexInferCreate<typeof index>` gives the
creation request type of a manager.

#### Why are my field names not checked?

Checking falls back to plain `string` field names (and
`Record<string, any>` records) instead of reporting false errors when:

- The creation request is not a literal TypeScript can see: a variable
  annotated as `estypes.IndicesCreateRequest`, or one returned from a function
  with that return type. Write it inline or use
  `as const satisfies estypes.IndicesCreateRequest`.
- The creation request has no `mappings`, or `mappings` has neither
  `properties` nor `runtime`.
- `mappings.dynamic` is `true`, `"true"` or `"runtime"`, because Elasticsearch
  then adds fields on its own. When `dynamic` is omitted the mapping is treated
  as complete, so fields added by dynamic mapping, dynamic templates or another
  writer are compile errors. To opt out for one manager, widen its type:
  `new IndexManager<estypes.IndicesCreateRequest>(options, create)`.
- Below an object with a loose `dynamic`, a `flattened` field, or a property
  specification that is not a literal, any `parent.${string}` path is
  accepted.

Other limits:

- Parameters that take patterns, boosts or raw DSL stay `string`: `fields()`,
  `sourceIncludes()`, `sourceExcludes()`, `excludeFields()`, `multiMatch()`
  and `simpleQueryString()` fields such as `title^3`, `sort()`,
  `rawCondition()`, `must()` and `aggs()`.
- Any known path is accepted by every method: `match()` does not require a
  full-text field, and `term()` values are not checked against the field's
  type.
- In records, types without a plain JavaScript counterpart (`geo_point`,
  `dense_vector`, …) are `unknown`. `keyof` a record type includes a
  symbol key, which keeps arrays from passing as a single object.
- A standalone `new QueryBuilder()` accepts any string; only builders handed
  out by an `IndexManager` (`findMany`, `findFirst`, `count`, `deleteMany`,
  `run`) are typed. `QueryBuilder<"a" | "b">` types one by hand.

### Writing text fields

Before 3.0, a string schema such as `{ title: "text", categories: { id: "integer" } }`
generated the mapping: every `text` field got `term_vector` and two
sub-fields, and every sub-object became `nested`. Now the mapping is exactly
what you write. This is the hand-written equivalent of the old `"text"` (the
old default analyzer was `english`):

```ts
import { Client } from "@elastic/elasticsearch";
import { IndexManager } from "es-query-pro";

const client = new Client({ node: "http://localhost:9200" });

export const postsIndex = new IndexManager(
  { client },
  {
    index: "posts",
    mappings: {
      properties: {
        title: {
          type: "text",
          term_vector: "with_positions_offsets",
          fields: {
            exact: { type: "text", analyzer: "standard" },
            fulltext: { type: "text", analyzer: "english" },
          },
        },
        categories: {
          type: "nested",
          properties: { id: { type: "integer" } },
        },
      },
    },
  },
);
```

`term_vector` is only needed for the `fvh` highlighter. The default
highlighter is `unified`, which works on any `text` or `keyword` field.

`QueryBuilder.weightedSemantic()` runs a wildcard "contains" query on a
`keyword` field holding the whole text. That field is `exactField`, which
defaults to `${standardField}.raw`, so either declare that sub-field
(`fields: { raw: { type: "keyword" } }`), pass another `exactField`, or pass
`exactField: false` to leave the clause out. A wildcard on an unmapped field
silently matches nothing. The clause is a leading-wildcard query: slow on
large fields, and rejected when `search.allow_expensive_queries` is false.

### The `englishplus` analyzer

`englishplus` is a custom analyzer to put in `settings.analysis`: lowercase,
ASCII folding (`résumé` matches `resume`), English possessives
(`John's` → `john`), English stop words and the English stemmer, in the order
`english_possessive_stemmer, lowercase, asciifolding, english_stop,
english_stemmer`. On text without accents it produces the same tokens as the
built-in `english` analyzer.

Changing an analyzer changes the tokens stored in the index, so an index
built with an earlier `englishplus` must be reindexed: raise `version` and
run `migrateIfNeeded()`.

### Field lists

`getAllFields(create, { subFields?, containers? })` and
`getFulltextFields(create, { subFields? })` list a creation request's field
paths at runtime, depth first in declaration order. Full-text types are
`text`, `match_only_text`, `search_as_you_type` and `semantic_text`, plus
`alias` fields that point at one of those. An `IndexManager` exposes the
default lists as `allFields` and `fulltextFields`.

```ts
import { getAllFields, getFulltextFields } from "es-query-pro";

const create = {
  index: "books",
  mappings: {
    properties: {
      title: { type: "text", fields: { exact: { type: "keyword" } } },
      categories: {
        type: "nested",
        properties: { name: { type: "text" } },
      },
    },
  },
} as const;

getAllFields(create); // ["title", "categories.name"]
getAllFields(create, { subFields: true, containers: true });
// ["title", "title.exact", "categories", "categories.name"]
getFulltextFields(create); // ["title", "categories.name"]
```

### Index names

`IndexNameManager` computes and parses the names an `IndexManager` uses
(`manager.index` is its instance):

- `getFullName()`: `prefix~language~name~v<version>`, without the prefix
  part when there is no prefix
- `getAliasName()`: the same without the version
- `IndexNameManager.parseByName(fullName, separator = "~")`: parse a full
  name; throws a `RangeError` for a name it could not have made. Versions
  that are plain integers come back as numbers, others (`v2024a`) as strings.
- `IndexNameManager.tryParseByName(fullName, separator = "~")`: the same,
  returning `null` instead of throwing
- `IndexNameManager.compare(base, other)`: `"same"`, `"older"`, `"newer"`,
  `"incomparable"` (a version that is not a plain integer) or `"unrelated"`
  (another prefix, language, name or separator); type `IndexNameRelation`
- `IndexNameManager.isValidEsIndexName(name)`: Elasticsearch's index name
  rules

### TypeScript and `skipLibCheck`

With `skipLibCheck: false`, `@elastic/elasticsearch`'s own declarations
report one error (its `apache-arrow` import). The bundled `dist/index.d.ts`
reports none. Keep `skipLibCheck: true` (the default in most setups) until
the client fixes it.

## Elastic Cloud Serverless

Serverless projects manage some things themselves and reject the APIs for
them. For example, `IndexManager.flush()` is not needed there because
serverless persists data automatically. Mark the cluster as serverless so the
library skips those requests; `flush()` then returns
`{ success: true, skipped: true }` without contacting the server.

Set the `ES_SERVERLESS` env var (`true` or `1`), the one environment variable
the library reads:

```bash
ES_SERVERLESS=true
```

Or pass `serverless` to `IndexManager`, which takes precedence over the env
var. This is useful when you connect to more than one cluster:

```ts
import { Client } from "@elastic/elasticsearch";
import { IndexManager } from "es-query-pro";

const myServerlessClient = new Client({
  node: "https://my-project.es.us-east-1.aws.elastic.cloud",
  auth: { apiKey: "your-base64-api-key" },
});

const booksIndex = new IndexManager(
  { client: myServerlessClient, serverless: true, version: 1 },
  { index: "books", mappings: { properties: { title: { type: "text" } } } },
);
```

If neither is set, the first flush that serverless rejects still returns
`success: true` with `skipped: true`, and the library remembers that client so
later flushes are skipped without a request.

Migrations work on serverless. Serverless has no tasks list and no task
cancellation, so a timed-out copy keeps running there (`cancelled: false`)
and a resumed migration finds the running copy through a marker in the new
index's mapping (see [Zero-downtime migration](#zero-downtime-migration)).

## Results and errors

The library follows two conventions:

- **`QueryBuilder` throws synchronously** on invalid input: a `TypeError` for
  a wrong type or an unsupported combination, a `RangeError` for a value out
  of range. Nothing is added to the builder when a method throws. `getBody()`,
  `getOptions()` and `getQuery()` throw for combinations Elasticsearch would
  reject (see [Retriever rules](#retriever-rules)).
- **`IndexManager`, `QueryRunner` and `SchemaRegistry` never throw**, except
  constructors, `SchemaRegistry.register*()`,
  `QueryRunner.findFirstOrThrow()`, and `IndexManager.run()`, which returns
  (or throws) whatever its callback does. Every method resolves to an envelope:
  the method's own fields plus `request`, `took` (milliseconds),
  `error` (`Error | null`), `errorKind` (`IndexErrorKind | null`) and
  `response`. Builder errors thrown inside a callback are returned in the
  envelope too. Check `.error` instead of using `try`/`catch`.

On success `error` and `errorKind` are `null` and `response` is
Elasticsearch's response. On failure `error` is always an `Error` (a thrown
non-`Error` value is wrapped, with the value as `cause`), and `response` is
the response metadata (`statusCode`, `body`, ...) for `errorKind: "response"`
and `null` otherwise.

`errorKind` (type `IndexErrorKind`) comes from the error's `name`, so errors
thrown by another copy of the client package are classified too:

| `errorKind`     | Error name                                     | Meaning                                       |
| --------------- | ---------------------------------------------- | --------------------------------------------- |
| `response`      | `ResponseError`                                | Elasticsearch answered with an error status   |
| `connection`    | `ConnectionError`                              | The server could not be reached               |
| `timeout`       | `TimeoutError`, `MigrationTimeoutError`        | No answer in time, or a migration's `timeout` |
| `disconnected`  | `NoLivingConnectionsError`                     | No living node to send to                     |
| `aborted`       | `RequestAbortedError`                          | The request was aborted                       |
| `serialization` | `SerializationError`, `DeserializationError`   | A body could not be encoded or decoded        |
| `product`       | `ProductNotSupportedError`                     | The server is not Elasticsearch               |
| `configuration` | `ConfigurationError`; invalid registry options | The client or the call is misconfigured       |
| `javascript`    | anything else                                  | A builder error, a bug, or a non-client error |

On Bun, pass `Connection: HttpConnection` to the `Client`. With the client's
default undici connection, a refused connection surfaces as a `TypeError`
(`errorKind: "javascript"`) instead of a `ConnectionError`.

```ts
import { Client, HttpConnection } from "@elastic/elasticsearch";
import { IndexManager } from "es-query-pro";

const client = new Client({
  node: "http://localhost:9200",
  Connection: HttpConnection,
});

const booksIndex = new IndexManager(
  { client },
  { index: "books", mappings: { properties: { title: { type: "text" } } } },
);

const result = await booksIndex.findById("1");
if (result.error) {
  // e.g. "response" for a missing index, "connection" for a down server
  console.error(result.errorKind, result.error.message);
} else if (!result.found) {
  console.log("no record with id 1");
} else {
  console.log(result.record?.title);
}
```

## IndexManager

### Lifecycle

| Method                     | What it does                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exists(more?)`            | Whether the versioned index exists (`HEAD`); `more` is the index-exists request (`flat_settings`, `include_defaults`, `local`, `ignore_unavailable`, ...) |
| `aliasExists(more?)`       | Whether the alias exists                                                                                                                                  |
| `getIndexMetadata(more?)`  | `GET /<index>`                                                                                                                                            |
| `getAliasMetadata(more?)`  | The indexes the alias points at (`indexes`); a missing alias is `success: true, indexes: []`, a missing `more.index` is an error                          |
| `create(more?)`            | Create the index, then point the alias at it, unless the alias already points elsewhere (the index is still created; the alias is left alone)             |
| `createOnly(more?)`        | Create the index without the alias                                                                                                                        |
| `createIfNeeded(more?)`    | Create the index and alias if missing; add a missing alias; change nothing when the alias points at another index                                         |
| `createAlias(more?)`       | `PUT /<index>/_alias/<alias>` without any check                                                                                                           |
| `createAliasIfNeeded()`    | Add the alias unless it already points somewhere                                                                                                          |
| `dropAlias(more?)`         | Remove the alias from this index                                                                                                                          |
| `drop(more?)`              | `DELETE /<index>`; Elasticsearch removes the index's aliases with it                                                                                      |
| `recreate(more?)`          | Drop the index if it exists, `create()` it again, then flush; stops at the first failed step                                                              |
| `flush(more?)`             | Flush the versioned index (works before the alias exists); skipped on serverless                                                                          |
| `getStatus()`              | A snapshot of the index and alias (see [Status](#status)); never rejects                                                                                  |
| `needsCreation()`          | `boolean \| null`: neither index nor alias exists (`null` when the check failed)                                                                          |
| `needsMigration()`         | `boolean \| null`: the alias points at an older version and no newer one                                                                                  |
| `getSiblingIndexes()`      | The other indexes on the alias, classified as `older`, `newer`, `incomparable` and `unrelated` (type `SiblingIndexes`)                                    |
| `migrateIfNeeded(params?)` | Create, attach or migrate (see [Zero-downtime migration](#zero-downtime-migration))                                                                       |

`create()`, `createIfNeeded()` and `recreate()` return the same keys on
every path: `success`, `code` (type `IndexLifecycleCode`), `aliasIndexes`
(where the alias pointed when checked), `indexResponse` and `aliasResponse`
(null for a step that did not run), plus the envelope; `recreate()` adds
`dropResponse` and `flushResponse`. `createAliasIfNeeded()` returns
`success`, `code`, `aliasIndexes`, `aliasResponse` and the envelope.

| `code`                                                                           | `success` | Meaning                                                                              |
| -------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| `CREATED`                                                                        | `true`    | The index (or alias) was created                                                     |
| `ALREADY_EXISTS`                                                                 | `true`    | The alias already points at this index; nothing was sent                             |
| `ALIAS_CREATED`                                                                  | `true`    | The index existed (or another process created it first); the missing alias was added |
| `NEEDS_MIGRATION`                                                                | `false`   | The alias points at an older (or incomparable) version; run `migrateIfNeeded()`      |
| `NEWER_VERSION_PRESENT`                                                          | `false`   | The alias points at a newer version                                                  |
| `ALIAS_CONFLICT`                                                                 | `false`   | The alias points at an index that is not a version of this one                       |
| `EXISTS_CHECK_ERROR`, `CREATE_ERROR`, `ALIAS_ERROR`, `DROP_ERROR`, `FLUSH_ERROR` | `false`   | That request failed; `error` is set                                                  |

The three `success: false` codes without a failed request have
`error: null`. After a version bump, `createIfNeeded()` at boot returns
`NEEDS_MIGRATION`; call `migrateIfNeeded()` instead.

### Records

| Method                              | What it does                                                                                                                                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `put(id, record, more?)`            | Save a record under `id`, replacing it (`PUT`). `more`: `refresh`, `op_type`, `if_seq_no` with `if_primary_term`, `routing`, ... Returns `result` (`created` or `updated`; null on failure)                                            |
| `putBulk(records, more?, options?)` | Save many records with `_bulk` (see below). Returns `success`, `report`, `errors` and the envelope                                                                                                                                     |
| `patch(id, fields, more?)`          | Merge fields into a record (`_update`). Sends `retry_on_conflict: 3` unless `more` sets it or `if_seq_no`/`if_primary_term`. Returns `result` as Elasticsearch reports it (`updated`, `noop`, `created` by an upsert; null on failure) |
| `findById(id, more?)`               | Returns `record` and `found`. A missing record is not an error: `record: null`, `found: false`, `error: null`. A missing index is an error                                                                                             |
| `deleteById(id, more?)`             | Returns `result` (`deleted`; null on failure). A missing record is an error (404)                                                                                                                                                      |
| `deleteMany(callback?, more?)`      | `_delete_by_query` (see below). Returns `success`, `deleted`, `versionConflicts`, `failures` and the envelope                                                                                                                          |
| `findMany(callback?, more?)`        | Search; returns `records`, `total`, `aggregations` and the envelope (see [QueryRunner](#queryrunner))                                                                                                                                  |
| `findFirst(callback?, more?)`       | Search for one record; returns `record` (null when nothing matched)                                                                                                                                                                    |
| `count(callback?, more?)`           | `_count`; returns `total`. Paging, sorting and the like are not sent; a builder with retrievers returns `total: null` and an error                                                                                                     |
| `run(callback)`                     | Call `callback` with a `QueryRunner` bound to this index and return what it returns                                                                                                                                                    |

Ids are `string | number` (type `IndexRecordId`). Callbacks receive a
`QueryBuilder` typed with the mapping's field names.

`putBulk()` details:

- Each record's `id` is its document id (numbers become strings; `0` is
  kept). A record whose `id` is `undefined` or `null` gets a random UUID,
  returned in `report`. An empty string is sent as is, and Elasticsearch
  rejects that row. An empty array sends nothing.
- Records are sent in chunks, one request at a time: `options.chunkSize`
  records (default 1000) and at most `options.chunkBytes` serialized bytes
  (default 5 MiB) per request. If a request fails, no further chunks are
  sent and unanswered rows have `status: null`.
- `report` has one row per record, in order: `{ id, status, effect,
version, error }` (type `IndexPutBulkReportRow`; `null` when not known).
  When rows were rejected, `success` is false, `error` is an
  `AggregateError` of the row errors, `errorKind` is `"response"` and
  `response` is `{ statusCode: 200, body: <merged bulk response> }`.

`deleteMany()` deletes without confirmation and without a warning, as
Elasticsearch itself does: **without a callback, or with a callback that adds
no conditions, every document in the index is deleted** (`match_all`). A
builder that produces no `query` (only retrievers such as `knn()` or
`semantic()`) cannot select documents: nothing is sent and an error envelope
is returned. Version conflicts abort the request unless `more` sets
`conflicts: "proceed"`; then conflicting documents are counted in
`versionConflicts` and `success` stays true. `failures` or a timeout set
`success: false` and `error` (an `AggregateError` for failures).

```ts
import { Client } from "@elastic/elasticsearch";
import { IndexManager } from "es-query-pro";

const client = new Client({ node: "http://localhost:9200" });

const postsIndex = new IndexManager(
  { client },
  {
    index: "posts",
    mappings: {
      properties: {
        id: { type: "keyword" },
        status: { type: "keyword" },
        title: { type: "text" },
      },
    },
  },
);

const bulk = await postsIndex.putBulk(
  [
    { id: "1", status: "draft", title: "First" },
    { id: "2", status: "published", title: "Second" },
  ],
  { refresh: true },
  { chunkSize: 500 },
);
for (const row of bulk.report) {
  if (row.error) {
    console.error(row.id, row.status, row.error.reason);
  }
}

const removed = await postsIndex.deleteMany(
  (qb) => qb.filter((sub) => sub.term("status", "draft")),
  { conflicts: "proceed", refresh: true },
);
console.log(removed.deleted, removed.versionConflicts);
```

### Status

`getStatus()` sends the index check and the alias lookup in parallel and
never rejects. It resolves to a `StatusReport`: `fullName`, `aliasName`,
`indexExists` and `aliasExists` (`null` when the check failed),
`aliasIndexes`, `aliasAttached`, `siblings` (`SiblingIndexes`),
`needsMigration`, `needsCreation`, `summary`, `took`, `error` and `errorKind`.

`summary` (type `StatusSummary`) is the first rule that applies:

| `summary`             | Meaning                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `unknown`             | A check failed; see `error`. `needsMigration` and `needsCreation` are false    |
| `newerVersionPresent` | The alias points at a newer version                                            |
| `needsMigration`      | The alias points at an older version, or one that cannot be ordered (`v2024a`) |
| `aliasConflict`       | The alias points at an index that is not a version of this one                 |
| `needsCreation`       | Neither the index nor the alias exists                                         |
| `needsAlias`          | The index exists but the alias does not                                        |
| `current`             | The alias points at this index only                                            |

## Zero-downtime migration

`migrateIfNeeded(params?)` brings the index and its alias up to date and
never rejects. It decides from `getStatus()`:

- No index and no alias: create both (`CREATED`). The index without its
  alias: add the alias (`ALIAS_CREATED`). Already current: `CURRENT`.
- The alias on older versions of this index: migrate (below), returning
  `MIGRATION_STARTED`, or `MIGRATION_RESUMED` when the new index already
  existed from an interrupted run.
- The alias on a newer version (`NEWER_VERSION_PRESENT`), on a version that
  cannot be ordered against this one (`INCOMPARABLE_VERSION`), or only on
  unrelated indexes (`ALIAS_CONFLICT`): nothing is changed, `success` is
  false and `error` is null. Migrating backwards is refused, so a rolling
  deploy where old and new code both run `migrateIfNeeded()` ends on the
  newer version.
- A failed status check: `STATUS_ERROR`, nothing changed.

The migration (implemented in `src/IndexManager/migrate.ts`):

1. Create the new index **without** the alias. Reads and writes keep using
   the old index through the alias for the whole copy.
2. Copy the old index(es) into it with `_reindex` in the background, using
   `version_type: "external"` and `conflicts: "proceed"`, so a pass never
   overwrites a document the new index already holds at the same or a newer
   version, and running a pass again is harmless.
3. Run a catch-up pass for writes made during the first copy.
4. Move the alias in one atomic `_aliases` update: the old indexes are
   removed and the new index is added as the write index.
5. Refresh the old index and run a final catch-up pass for writes that
   reached it just before the swap.
6. Verify that the final pass read or accounted for every document of the
   old index(es).
7. Delete the old index(es).

Running `migrateIfNeeded()` again while a migration runs, or after a crash,
resumes: it follows a copy that is still running (found through the task id
stored under `_meta["es-query-pro-migration"]` in the new index's mapping, or
through the tasks list on stateful clusters) or starts the copy again. The
marker is removed when the migration ends. On any failure before the swap the
old index and the alias are left untouched and the new index is kept; after
the swap the old index is kept.

Only older versions of this index are copied and removed. Indexes on the
alias that are not versions of this one are never copied or removed, and old
versions that are no longer on the alias are never cleaned up.

**Known limitation:** a document deleted through the alias while the copy
runs can be present again in the new index afterwards (there are no
tombstones). Writes that reach the old index between the swap and the final
pass are invisible until that pass copies them. Avoid deletes during a
migration, or repeat them afterwards.

Options (`MigrationParams`):

| Option              | Description                                                                                                             | Default   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------- |
| `onProgress`        | Called while each pass runs, and once per old index with `percent: 100` and `phase: "done"` on success                  | _none_    |
| `onComplete`        | Called once, only on success (also after a creation)                                                                    | _none_    |
| `onError`           | Called once with the error on failure                                                                                   | _none_    |
| `timeout`           | Milliseconds from the call before giving up (`TIMEOUT`); a running copy is cancelled where the server allows it         | no limit  |
| `requestsPerSecond` | Throttle the first copy (reindex `requests_per_second`); catch-up passes are not throttled                              | unlimited |
| `batchSize`         | Documents per reindex batch (`source.size`), for every pass including catch-up; a small value slows the whole migration | `1000`    |
| `slices`            | Reindex `slices`: a number or `"auto"`                                                                                  | `1`       |
| `pollInterval`      | Longest wait between task checks in ms (at least 10); checks start at 100 ms and double                                 | `1000`    |
| `maxPollErrors`     | Failed task checks in a row before giving up (`POLL_ERROR`); the copy keeps running on the server                       | `5`       |

A callback that throws is ignored. Progress events (`MigrationProgressDetails`)
carry `phase`, `done`, `total`, `percent` (0 to 99 while running, 0 while
`total` is 0), `taskId`, `oldIndex`, `newIndex`, `alias` and `failures`.

The result (`MigrationResult`): `success`, `code` (`MigrationCode`),
`status` (the `StatusReport` the decision was based on), `newName`,
`aliasName`, `oldNames`, `recordsToMigrate`, `createdIndex`, `createdAlias`,
`resumed`, `attached`, `taskId`, `request` (the reindex request, or null),
`completion`, `took`, `error`, `errorKind` and `response`. The codes
`COUNT_ERROR`, `CREATE_ERROR`, `ALIAS_ERROR` and `REINDEX_ERROR` mean that
request failed.

`completion` is a promise of a `MigrationOutcome` and never rejects. When no
migration started, it is already settled and carries the same code.
Otherwise its `code` (`MigrationOutcomeCode`) is one of:

| Outcome `code`   | Meaning                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `MIGRATED`       | Copied, alias swapped, verified, old index(es) removed (see `cleanupErrors` for failed removals) |
| `REINDEX_FAILED` | A pass finished with an error, bulk failures, a server timeout or a cancellation                 |
| `REINDEX_ERROR`  | A catch-up pass could not be started                                                             |
| `POLL_ERROR`     | `maxPollErrors` task checks in a row failed                                                      |
| `TIMEOUT`        | `timeout` expired (`errorKind: "timeout"`, error name `MigrationTimeoutError`)                   |
| `SWAP_ERROR`     | The alias update failed                                                                          |
| `VERIFY_FAILED`  | The final pass did not account for every old document, or they could not be counted              |

The outcome also has `phase` (where it failed; `done` on success),
`oldIndexes`, `newIndex`, `alias`, `swapped`, `removedIndexes`, `passes`
(one `MigrationPassReport` per finished pass), `taskIds`, `cancelled`,
`counts`, `failures`, `cleanupErrors`, `took`, `error` and `errorKind`.

```ts
import { Client } from "@elastic/elasticsearch";
import { IndexManager } from "es-query-pro";

const client = new Client({ node: "http://localhost:9200" });

// version 2: the mapping changed
const booksIndex = new IndexManager(
  { client, version: 2 },
  {
    index: "books",
    mappings: {
      properties: {
        title: { type: "text", fields: { raw: { type: "keyword" } } },
      },
    },
  },
);

const result = await booksIndex.migrateIfNeeded({
  timeout: 10 * 60_000,
  requestsPerSecond: 500,
  onProgress: ({ phase, done, total, percent }) => {
    console.log(`${phase}: ${done}/${total} (${percent}%)`);
  },
});
if (!result.success) {
  // NEWER_VERSION_PRESENT, INCOMPARABLE_VERSION and ALIAS_CONFLICT
  // have error: null
  console.error(result.code, result.error);
}
const outcome = await result.completion;
if (!outcome.success) {
  console.error(outcome.code, outcome.phase, outcome.error);
}
```

## QueryRunner

A `QueryRunner` binds a `QueryBuilder` (`runner.builder`) to an
`IndexManager` and runs it. `IndexManager.findMany()`, `findFirst()` and
`count()` create one for you; `IndexManager.run()` hands you one.

| Method                      | What it does                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findMany(more?)`           | Search. Returns `records`, `total` (null when not tracked), `aggregations` (null when none) and the envelope. `more` replaces the builder's keys (e.g. `size`)                               |
| `findFirst(more?)`          | Search with `size: 1` (unless `more` sets one; the builder is not changed). Returns `record` (null when nothing matched)                                                                     |
| `findFirstOrThrow(more?)`   | Like `findFirst()`, but throws the request's error, or a `QueryNotFoundError` (`name: "NotFoundError"`, `status: 404`, `result`) when nothing matched                                        |
| `count(more?)`              | `_count` with the builder's query and `minScore()`; paging, sorting, aggregations, highlighting and source filtering are not sent. With retrievers: `total: null` and an error, nothing sent |
| `updateMany(values, more?)` | `_update_by_query` setting `values` on every matching document (see below)                                                                                                                   |

Each record (`QueryRecord<Create>`) is the hit's `_source` plus `_id`,
`_score`, `_highlight` (when the search highlights) and `_sort` (when it
sorts). These keys win over `_source` keys of the same name. Pass the last
record's `_sort` to `searchAfter()` for the next page (on page 1 only). On
error `records` is `[]`, `total` and `aggregations` are null, and `request`
is null when the builder threw before anything was sent.

`updateMany(values, more?)`:

- Keys are dotted paths of mapped fields or object/`nested` containers
  (`{ publishing: { ... } }` replaces the whole object). Unknown keys,
  sub-fields (`title.raw`), a key inside another key, and empty or
  all-`undefined` values are rejected without a request; `undefined` values
  are skipped. Paths are allowed below an object with a loose `dynamic` and
  inside `flattened` fields.
- One fixed Painless script applies the values; field names are passed as
  parameters, never as script source. Missing parent objects are created; a
  path through a list (such as a `nested` field) sets the field on every
  object in it.
- `limit()` becomes `max_docs` (`limit(0)`, also set by the `aggregate*`
  methods, returns an error envelope); sorting and paging are ignored.
  `conflicts` defaults to `"proceed"`. There is no `refresh` default.
- Returns `success`, `updated`, `total`, `versionConflicts`, `noops`,
  `failures` and the envelope; failures or a timeout set `error`.

```ts
import { Client } from "@elastic/elasticsearch";
import { IndexManager } from "es-query-pro";

const client = new Client({ node: "http://localhost:9200" });

const booksIndex = new IndexManager(
  { client },
  {
    index: "books",
    mappings: {
      properties: {
        author: { type: "keyword" },
        publishing: {
          type: "nested",
          properties: { year: { type: "integer" } },
        },
      },
    },
  },
);

const updated = await booksIndex.run((runner) => {
  runner.builder.term("author", "Ursula K. Le Guin");
  return runner.updateMany({ "publishing.year": 1969 }, { refresh: true });
});
if (updated.error) {
  console.error(updated.errorKind, updated.error.message);
}
```

## SchemaRegistry

A `SchemaRegistry` holds a collection of `IndexManager`s for fleet-wide
operations. Register indexes as an array, with `register()`/`registerAll()`,
or as a named map that keeps each manager's type:

```ts
import { Client } from "@elastic/elasticsearch";
import { IndexManager, SchemaRegistry } from "es-query-pro";

const client = new Client({ node: "http://localhost:9200" });

const books = new IndexManager(
  { client },
  { index: "books", mappings: { properties: { title: { type: "text" } } } },
);
const authors = new IndexManager(
  { client },
  { index: "authors", mappings: { properties: { name: { type: "text" } } } },
);

const registry = new SchemaRegistry({ books, authors });
registry.get("books"); // typed as typeof books

const status = await registry.getStatus();
console.log(status.summary); // { "english~books~v1": "current", ... }
```

An index registered twice under the same full name is registered once.
Registering two versions of the same alias throws an `Error` at once;
`registerAll()` registers all or none.

Every operation resolves to the same envelope (`SchemaFleetResult`) and
never throws: `success` (true when every index succeeded), `took`, `report`
(one entry per index, in registration order), `summary` (a code per full
index name), `error` (the first error, or the reason nothing ran) and
`errorKind`. An empty registry, or an invalid `concurrency` or `timeout`, is
`success: false` with `errorKind: "configuration"`, and nothing is sent.

| Method                         | What it does                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrateIfNeeded(params?)`     | Create or migrate every index, one at a time (see below)                                                                                          |
| `recreateAll(concurrency = 2)` | `recreate()` every index. `report`: `SchemaRecreateReport` (`code` is `recreate()`'s code, or `ERROR` when it rejected)                           |
| `getStatus(concurrency = 2)`   | `getStatus()` of every index. `report`: `StatusReport[]`; `summary`: the `StatusSummary` of each; `success` is false when any status has an error |
| `dropAll(concurrency = 2)`     | `drop()` every index. `report`: `SchemaDropReport` with `code` `DROPPED`, `MISSING` (no such index, counts as success) or `ERROR`                 |
| `listIndexes()`                | `{ alias, name, version }` of each index                                                                                                          |
| `getIndexLookup()`             | Registered indexes keyed by alias name                                                                                                            |

`concurrency` is how many indexes are processed at once (at least 1;
fractions are rounded down).

`dropAll()` drops every registered index without confirmation and without
a warning, as `DELETE /<index>` does in Elasticsearch. It drops only each
manager's `getFullName()`: older versioned indexes are left in place.

### SchemaRegistry.migrateIfNeeded(options)

Create or migrate every registered index, one at a time, in registration
order. Each index's own `completion` is awaited before the next one starts.
The call resolves as soon as the work is kicked off. To get the outcome,
await the returned `completion` promise or pass `onAllComplete`; both receive
the same payload.

```ts
import { Client } from "@elastic/elasticsearch";
import { IndexManager, SchemaRegistry } from "es-query-pro";

const client = new Client({ node: "http://localhost:9200" });

const schemaRegistry = new SchemaRegistry([
  new IndexManager(
    { client, version: 2 },
    { index: "books", mappings: { properties: { title: { type: "text" } } } },
  ),
]);

const { acknowledged, error, completion } =
  await schemaRegistry.migrateIfNeeded({
    timeout: 30 * 60_000, // the whole run, in ms (default: no limit)
    slices: 1, // reindex slices per index (default 1)
    pollInterval: 1000, // longest wait between task checks (default 1000)
    onProgress: ({ alias, phase, done, total, percent }) => {},
    onComplete: (progress) => {}, // one index finished creating/migrating
    onError: (error) => {},
    onAllComplete: (details) => {}, // same payload as `completion`
  });

const details = await completion;
if (!details.success) {
  console.error(details.summary);
}
```

Every `IndexManager.migrateIfNeeded()` option (`requestsPerSecond`,
`batchSize`, `maxPollErrors`, ...) is passed to each index. `timeout` covers
the whole run: each index gets the time left as its own `timeout`, and an
index not started in time is reported as `TIMEOUT` (`errorKind: "timeout"`)
without being touched. Callbacks that throw are ignored.

Immediate return value:

| Property     | Description                                                                   |
| ------------ | ----------------------------------------------------------------------------- |
| acknowledged | `false` when no indexes are registered or `timeout` is invalid (≤ 0 or `NaN`) |
| error        | An `Error` when `acknowledged` is false; otherwise `null`                     |
| errorKind    | `"configuration"` when `acknowledged` is false; otherwise `null`              |
| completion   | Promise of the payload below; never rejects                                   |

Payload from `completion` / `onAllComplete` (type `SchemaMigrationDetails`, a
`SchemaFleetResult`): `success`, `took`, `report`, `summary` (outcome keyed
by full index name, e.g. `{ "prod~english~books~v2": "migrated" }`), `error`
and `errorKind`.

Each `report` entry (type `SchemaMigrationReport`):

| Property  | Description                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------- |
| fullName  | Versioned index name, e.g. `prod~english~books~v2`                                                      |
| aliasName | Alias name, e.g. `prod~english~books`                                                                   |
| outcome   | `"created"`, `"migrated"`, `"unchanged"` or `"failed"` (see below)                                      |
| code      | The index's `MigrationOutcome.code`; `TIMEOUT` when it was not started in time; null if it threw        |
| before    | The `StatusReport` the migration decided from (`summary: "unknown"` when it failed); `null` if not read |
| after     | `getStatus()` once the index's `completion` settled (`summary: "unknown"` if that read failed)          |
| migration | The index's `MigrationOutcome`; `null` when it did not run                                              |
| error     | The first `Error` hit for this index; otherwise `null`                                                  |
| errorKind | Its `IndexErrorKind`; otherwise `null`                                                                  |
| took      | Milliseconds spent on this index                                                                        |

| `code`                                                            | `outcome`                    |
| ----------------------------------------------------------------- | ---------------------------- |
| `CREATED`, `ALIAS_CREATED`                                        | `created`                    |
| `MIGRATED`                                                        | `migrated`                   |
| `CURRENT`                                                         | `unchanged`                  |
| `NEWER_VERSION_PRESENT`, `INCOMPARABLE_VERSION`, `ALIAS_CONFLICT` | `failed`, with `error: null` |
| any other code                                                    | `failed`                     |

A failed index does not stop the run; the remaining indexes are still
processed. `onError` is called once per distinct error.

## Query Builder function quick reference

Every example in these tables is type-checked and run against a fresh
`QueryBuilder` by `src/readmeSamples.spec.ts`. Field parameters are typed
with the mapping's field names when the builder comes from an
`IndexManager`. Methods return the builder, so calls chain.

### Conditions

Conditions are scoring `bool.must` clauses unless they are added inside
`filter()`.

| Method                                                                                         | Description                                                                                                                                                                                                                                                                  | Example                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| exists(field)                                                                                  | The field has a value. Also `exists({ field })`                                                                                                                                                                                                                              | `qb.exists('deleted_at')`                                                                               |
| term(field, value, options?)                                                                   | Exact value (string, number or boolean). Options: `caseSensitive` (default `true`), `boost`. Also `term({ field, value, ...options })`. Throws for a missing, `null`, array or object value                                                                                  | `qb.term('status', 'active')` `qb.term({ field: 'status', value: 'Active', caseSensitive: false })`     |
| range(field, operator, value, options?)                                                        | Operators `>` `gt` `<` `lt` `>=` `gte` `<=` `lte`, or `between` with `[min, max]` (inclusive). Values: numbers, strings, `Date`. `null`, `undefined` and blank bounds are open. Options: `format`, `time_zone`, `relation`, `boost`; a `Date` with a non-ISO `format` throws | `qb.range('price', 'between', [10, 20])` `qb.range('published_at', '>=', new Date('2020-01-01'))`       |
| match({ field, phrase, ...options })                                                           | Full-text `match`; any other `match` option (`operator`, `fuzziness`, ...)                                                                                                                                                                                                   | `qb.match({ field: 'title', phrase: 'market research', operator: 'and' })`                              |
| matchPhrase({ field, phrase, slop?, ...options })                                              | `match_phrase`; `slop` defaults to 0                                                                                                                                                                                                                                         | `qb.matchPhrase({ field: 'title', phrase: 'little red riding hood' })`                                  |
| matchPhrasePrefix({ field, phrase, ...options })                                               | `match_phrase_prefix`, for search-as-you-type                                                                                                                                                                                                                                | `qb.matchPhrasePrefix({ field: 'title', phrase: 'little red r' })`                                      |
| multiMatch({ fields?, phrase, ...options })                                                    | `multi_match`; field names may carry a boost (`title^2`) or a wildcard                                                                                                                                                                                                       | `qb.multiMatch({ fields: ['title^2', 'body'], phrase: 'wireless router' })`                             |
| matchBoostedPhrase({ field, phrase, operators?, weights? })                                    | Whole phrase ranks above all words, above any word. `operators`: `exact`, `and`, `or` (default `['exact', 'and']`); `weights` by position, a missing one defaults to exact 5, and 3, or 1                                                                                    | `qb.matchBoostedPhrase({ field: 'title', phrase: 'AT&T Wireless', operators: ['exact', 'and', 'or'] })` |
| wildcard(field, pattern, options?)                                                             | `wildcard` pattern (`*`, `?`); case-insensitive by default. Options: `caseSensitive`, `boost`, `rewrite`. Also the object form                                                                                                                                               | `qb.wildcard('sku', 'WM-2025-*')`                                                                       |
| containsExact(field, text, options?)                                                           | The field contains `text` literally (`*text*`, special characters escaped); case-insensitive by default. Same options as `wildcard`                                                                                                                                          | `qb.containsExact('title.raw', 'United Airlines')`                                                      |
| regexp(field, pattern, options?)                                                               | Anchored Lucene regular expression; case-insensitive by default. Options: `caseSensitive`, `flags`, `max_determinized_states`, `rewrite`, `boost`. `rexgep()` is a deprecated alias                                                                                          | `qb.regexp('model', 'iP(od\|ad\|hone) \\d+')`                                                           |
| queryString(field, query, options?)                                                            | Lucene syntax on one field; invalid syntax fails the search with a 400. Options: any `query_string` option. Also `queryString({ field, queryString, ...options })`                                                                                                           | `qb.queryString('body', '(tech AND support) OR (service desk)')`                                        |
| simpleQueryString({ fields?, query, ...options })                                              | Forgiving syntax for search boxes (`+`, `\|`, `-`, `"phrase"`, `prefix*`); never fails on bad syntax                                                                                                                                                                         | `qb.simpleQueryString({ fields: ['title^2', 'body'], query: '"fried eggs" -frittata' })`                |
| moreLikeThis({ field, like, ...options })                                                      | Similar documents. `field` may be an array; `like` is text, `{ _index, _id }` or an array of these; other `more_like_this` options are top-level                                                                                                                             | `qb.moreLikeThis({ field: ['title', 'body'], like: 'quick brown fox', min_term_freq: 1 })`              |
| termsSet({ field, terms, minimumShouldMatch? \| minimumShouldMatchField? \| script?, boost? }) | At least N of `terms` match. Give at most one minimum; with none, 1 must match                                                                                                                                                                                               | `qb.termsSet({ field: 'tags', terms: ['a', 'b', 'c'], minimumShouldMatch: 2 })`                         |
| nested({ path, query, scoreMode?, innerHits?, ignoreUnmapped? })                               | At least one nested object matches every condition the callback adds (full paths). `innerHits: true` returns the matching objects                                                                                                                                            | `qb.nested({ path: 'reviews', query: (sub) => sub.term('reviews.author', 'ana'), innerHits: true })`    |
| must(clause)                                                                                   | A raw query clause in `bool.must`; the clause is copied                                                                                                                                                                                                                      | `qb.must({ match_phrase: { title: 'quick brown fox' } })`                                               |
| rawCondition(clause)                                                                           | The same as `must()`, but the clause is stored as given (not copied or checked)                                                                                                                                                                                              | `qb.rawCondition({ wildcard: { title: 'wire*' } })`                                                     |

The match family (`match`, `matchPhrase`, `matchPhrasePrefix`,
`multiMatch`, `matchBoostedPhrase`), `simpleQueryString`, `containsExact`,
`semantic`, `rrf` and `weightedSemantic` add nothing for a blank phrase
(empty, whitespace only, `null` or `undefined`), so an empty search box does
not filter. A non-blank phrase is sent as is.

### Boolean composition

| Method                                        | Description                                                                                     | Example                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| filter(callback)                              | The callback's conditions go in `bool.filter`: they must match but do not change `_score`       | `qb.filter((sub) => sub.term('status', 'published').range('price', '<', 20))`                                   |
| should(callbacks, { minimumShouldMatch? })    | At least `minimumShouldMatch` (default 1) branches match; all conditions of a branch must match | `qb.should([(sub) => sub.term('tag', 'news'), (sub) => sub.range('votes', '>=', 100)])`                         |
| shouldNot(callbacks, { minimumShouldMatch? }) | Exclude documents matching at least `minimumShouldMatch` (default 1) branches                   | `qb.shouldNot([(sub) => sub.term('hidden', true), (sub) => sub.term('spam', true)], { minimumShouldMatch: 2 })` |
| mustNot(callback)                             | Exclude documents matching any condition the callback adds                                      | `qb.mustNot((sub) => sub.term('status', 'deleted'))`                                                            |

### Retrievers

Retrievers switch the search from `query` to `retriever` (see
[Retriever rules](#retriever-rules)).

| Method                                                                                    | Description                                                                                                                                                                                                            | Example                                                                                            |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| knn({ field, vector, k, numCandidates?, weight?, filter?, similarity? })                  | kNN on a `dense_vector` field. `k` integer >= 1; `numCandidates` integer >= `k`, default `min(ceil(1.5 * k), 10000)`, always sent; `similarity` is a number in the field's metric                                      | `qb.knn({ field: 'embedding', vector: [0.1, 0.2, 0.3], k: 10, similarity: 0.8 })`                  |
| semantic({ field, phrase, weight? })                                                      | `semantic` query on a `semantic_text` field                                                                                                                                                                            | `qb.semantic({ field: 'body_semantic', phrase: 'wireless headphones' })`                           |
| rrf({ semanticField, standardField, phrase, weight? })                                    | Reciprocal rank fusion of a `match` on `standardField` and a `semantic` query                                                                                                                                          | `qb.rrf({ semanticField: 'body_semantic', standardField: 'body', phrase: 'router' })`              |
| weightedSemantic({ semanticField, standardField, phrase, exactField?, boosts?, weight? }) | `rrf` of a semantic query and a lexical retriever ranked by contains (on `exactField`, default `${standardField}.raw`; `false` drops it), phrase and match. `boosts`: `[contains, phrase, match]`, default `[6, 4, 1]` | `qb.weightedSemantic({ semanticField: 'body_semantic', standardField: 'body', phrase: 'router' })` |
| rankWindowSize(size)                                                                      | rrf/linear `rank_window_size`. Default 50, raised to cover `from + size`; an explicit value is sent as is                                                                                                              | `qb.rankWindowSize(100)`                                                                           |
| rankConstant(constant)                                                                    | rrf `rank_constant`, an integer >= 1 (default 20)                                                                                                                                                                      | `qb.rankConstant(60)`                                                                              |
| normalizer(name)                                                                          | Score normalizer of each retriever in a `linear` combination: `minmax` (default), `l2_norm`, `none`                                                                                                                    | `qb.normalizer('l2_norm')`                                                                         |

`weight` (default 1, >= 0) only applies when retrievers are combined in a
`linear` retriever.

### Scoring

| Method                                                             | Description                                                                                                                      | Example                                                                                                |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| scoreFunction(fn)                                                  | Add a `function_score` function (decay, `field_value_factor`, `script_score`, `weight`, ...). `decayFunctionScore()` is an alias | `qb.scoreFunction({ field_value_factor: { field: 'popularity', modifier: 'log1p' } })`                 |
| functionScoreOptions({ scoreMode, boostMode, maxBoost, minScore }) | How functions combine; merged into the current options, `undefined` removes a key                                                | `qb.functionScoreOptions({ scoreMode: 'sum', boostMode: 'multiply' })`                                 |
| sortByRandom(enabled?, { seed?, field? })                          | Random order; with a `seed` the order is stable across pages (`field` defaults to `_seq_no`)                                     | `qb.sortByRandom(true, { seed: 42 })`                                                                  |
| rescore(callback, options?)                                        | Re-score the top hits with the callback's query. Options: `windowSize`, `queryWeight`, `rescoreQueryWeight`, `scoreMode`         | `qb.rescore((sub) => sub.matchPhrase({ field: 'title', phrase: 'harry potter' }), { windowSize: 50 })` |
| minScore(score)                                                    | Minimum `_score` of a hit                                                                                                        | `qb.minScore(0.5)`                                                                                     |

### Aggregations

`aggregateTerm`, `includeFacets`, the composite `aggregate*` helpers and
`dateHistogram` set the limit to 0 (aggregations only, no hits) unless a
limit was set with `limit()`; `reset('aggs')` undoes that.

| Method                                                                                                 | Description                                                                                                                                                                                                      | Example                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| aggregateTerm({ field, name?, limit?, orderBy?, missing?, exclude?, showTermDocCountError? })          | `terms` aggregation (GROUP BY). `limit` default 25. `orderBy`: `[{ field, order }]` with `_count`, `_key`, the field, or another field (via a `min`/`max` sub-aggregation `__order_<i>`). `exclude` takes values | `qb.aggregateTerm({ field: 'author', limit: 10, orderBy: [{ field: '_key', order: 'asc' }] })`              |
| includeFacets({ fields, limit? })                                                                      | One `aggregateTerm()` per field, named after the field                                                                                                                                                           | `qb.includeFacets({ fields: ['author', 'country'], limit: 10 })`                                            |
| aggregateHistogram({ field, interval, name?, limit?, after?, order?, orderBy? })                       | Composite `histogram`: pages of non-empty buckets in key order. Pass the response's `after_key` as `after` for the next page                                                                                     | `qb.aggregateHistogram({ field: 'price', interval: 50, after: { price: 100 } })`                            |
| aggregateDateHistogram({ field, calendarInterval \| fixedInterval, timeZone?, format?, offset?, ... }) | Composite `date_histogram`; exactly one interval. Same paging as above                                                                                                                                           | `qb.aggregateDateHistogram({ field: 'created_at', calendarInterval: 'month', timeZone: 'America/Denver' })` |
| aggregateGeotileGrid({ field, precision?, bounds?, ... })                                              | Composite `geotile_grid`; `precision` 0 to 29 (server default 7). Same paging as above                                                                                                                           | `qb.aggregateGeotileGrid({ field: 'location', precision: 6 })`                                              |
| dateHistogram({ field, interval, name?, timeZone?, offset?, extendedBounds? })                         | Plain `date_histogram` for charts: every interval, including empty ones, not paged. `interval`: `year`, `quarter`, `month`, `week`, `day`, `hour`, `minute`, `second`                                            | `qb.dateHistogram({ field: 'created_at', interval: 'month', timeZone: 'America/Denver' })`                  |
| aggs(definitions)                                                                                      | Replace all aggregations with raw DSL (copied); leaves the limit alone                                                                                                                                           | `qb.aggs({ avg_price: { avg: { field: 'price' } } })`                                                       |

### Paging, sorting and output

| Method                             | Description                                                                                                                                                                                                                                                                                              | Example                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| limit(size)                        | `size`, an integer >= 0                                                                                                                                                                                                                                                                                  | `qb.limit(25)`                                                               |
| page(page)                         | Page number from 1; pages are `limit()` long, or 10 without a limit                                                                                                                                                                                                                                      | `qb.page(3)`                                                                 |
| sort(field, direction?)            | `'name'` ascending, `'-name'` descending; `'_score'` descending unless a direction is given                                                                                                                                                                                                              | `qb.sort('created_at', 'desc')` `qb.sort('-created_at')`                     |
| sort(clause \| clause[])           | `{ name: 'asc' }`, an Elasticsearch sort object, or an array of these and strings                                                                                                                                                                                                                        | `qb.sort([{ name: 'asc' }, { price: { order: 'desc', missing: '_last' } }])` |
| searchAfter(values)                | Deep paging from the previous page's last `sort` values; page 1 only                                                                                                                                                                                                                                     | `qb.sort('created_at').searchAfter([1700000000000])`                         |
| trackTotalHits(value)              | `true`, `false`, or an integer >= 0 to count up to                                                                                                                                                                                                                                                       | `qb.trackTotalHits(true)`                                                    |
| fields(names)                      | `_source` includes (patterns allowed; default `['*']`; `[]` returns no `_source`). `sourceIncludes()` is an alias                                                                                                                                                                                        | `qb.fields(['id', 'title'])`                                                 |
| excludeFields(names)               | `_source` excludes, combined with `fields()`. `sourceExcludes()` is an alias                                                                                                                                                                                                                             | `qb.excludeFields(['internal.*'])`                                           |
| highlightField(name, options?)     | Highlight a field. The default highlighter is `unified`; `{ type: 'fvh' }` needs `term_vector: with_positions_offsets`                                                                                                                                                                                   | `qb.highlightField('title', { number_of_fragments: 1 })`                     |
| highlighterOptions(options)        | Global highlight options, merged into the current ones; `undefined` removes a key                                                                                                                                                                                                                        | `qb.highlighterOptions({ fragment_size: 100 })`                              |
| index(name)                        | The index name used by `getQuery()` and `toKibana()`                                                                                                                                                                                                                                                     | `qb.index('books')`                                                          |
| getQuery(overrides?)               | The full search request (`index`, `_source`, body, `size`, `from`, ...); a new object each call                                                                                                                                                                                                          | `qb.getQuery({ size: 1 })`                                                   |
| getBody()                          | `query` or `retriever`, `sort`, `highlight`, `aggs`, `rescore`                                                                                                                                                                                                                                           | `qb.getBody()`                                                               |
| getOptions()                       | `size`, `from`, `min_score`, `search_after`, `track_total_hits`                                                                                                                                                                                                                                          | `qb.getOptions()`                                                            |
| toKibana(index?)                   | A Kibana Dev Tools request (`GET <index>/_search`, or `GET _search` without an index)                                                                                                                                                                                                                    | `qb.toKibana('books')`                                                       |
| toJSON(), toString()               | `getQuery()` for `JSON.stringify()`; `getQuery()` as indented JSON                                                                                                                                                                                                                                       | `qb.toString()`                                                              |
| clone()                            | A deep copy of the same class                                                                                                                                                                                                                                                                            | `qb.clone()`                                                                 |
| reset(names?)                      | Reset one part, a list, or everything. Names: `fields`, `excludeFields`, `must`, `filter`, `aggs`, `functionScores`, `highlighter`, `sorts`, `shouldSortByRandom`, `retrievers`, `normalizer`, `rankWindowSize`, `rankConstant`, `rescore`, `minScore`, `searchAfter`, `trackTotalHits`, `page`, `limit` | `qb.reset(['limit', 'page'])`                                                |
| QueryBuilder.escapeWildcards(text) | Escape `\`, `*` and `?` for a `wildcard` value (also an instance method)                                                                                                                                                                                                                                 | `QueryBuilder.escapeWildcards('50%*off?')`                                   |

Getters return copies: `getIndex()`, `getFields()`, `getExcludeFields()`,
`getSourceIncludes()`, `getSourceExcludes()`, `getHighlighter()`,
`getMust()`, `getFilter()`, `getRetrievers()`, `getRankWindowSize()`,
`getRankConstant()`, `getNormalizer()`, `getRescore()`,
`getFunctionScores()`, `getFunctionScoreOptions()`, `getSortByRandom()`,
`getSortByRandomOptions()`, `getAggs()`, `getLimit()`, `getPage()`,
`getSort()`, `getSearchAfter()`, `getTrackTotalHits()`, `getMinScore()`.

## Full documentation

### should(withBuilders, { minimumShouldMatch })

Build a boolean disjunction (OR) of alternative branches. Each item in
`withBuilders` is a function that receives a fresh `QueryBuilder` (and its
index) to define one branch; all conditions a branch adds must match for the
branch to match. The branches are collected under `bool.should`.

- `minimumShouldMatch` (number or string) is how many branches must match
  (default `1`). A negative integer means "all but that many"; strings such as
  `"50%"` are percentages. A numeric value must be an integer whose absolute
  value is at most the number of branches (`RangeError` otherwise).
- A branch that adds no condition is skipped, as if it were not passed. When
  that leaves fewer non-empty branches than a positive numeric
  `minimumShouldMatch`, it is lowered to their number. When every branch is
  empty, nothing is added.
- With one non-empty branch, its conditions are added directly.
- Branch builders may only add conditions (including `filter()`, `should()`,
  `mustNot()` and `nested()`); setting anything else on them (sort, limit,
  aggregations, retrievers, ...) throws a `TypeError`.

Real‑world examples:

- News feed: return items that are either recently created OR highly upvoted.
- E‑commerce: show products that match any of several acceptable brands, but require at least two of several quality signals.

```ts
import { QueryBuilder } from "es-query-pro";

// Example 1: get recent or highly upvoted
const qb1 = new QueryBuilder();
qb1.should(
  [
    (qb) => qb.range("created_at", ">=", "now-7d"),
    (qb) => qb.range("upvotes", ">=", 100),
  ],
  { minimumShouldMatch: 1 },
);
```

### shouldNot(withBuilders, { minimumShouldMatch })

Exclude documents that match at least `minimumShouldMatch` of the branches
(default 1): a `bool.must_not` holding one `should` query built with the same
rules as `should()`. A branch matches when all of its conditions match, so a
single branch with two conditions excludes only documents matching both.

Real‑world examples:

- Content filtering: exclude items that are hidden OR soft-deleted.
- Fraud detection review: exclude only when several risk signals are present
  at once.

```ts
import { QueryBuilder } from "es-query-pro";

// Example 1: exclude docs where visibility=hidden OR status=soft_deleted
const qb1 = new QueryBuilder();
qb1.shouldNot([
  (qb) => qb.term({ field: "visibility", value: "hidden" }),
  (qb) => qb.term({ field: "status", value: "soft_deleted" }),
]);

// Example 2: exclude only when BOTH risk signals match
const qb2 = new QueryBuilder();
qb2.shouldNot(
  [
    (b) => b.term({ field: "risk.ip", value: "high" }),
    (b) => b.term({ field: "risk.device", value: "high" }),
  ],
  { minimumShouldMatch: 2 },
);
// Allows documents that have only one risk signal; excludes those with both.
```

### mustNot(withBuilder)

Add negative clauses under `bool.must_not`. Each condition the callback adds
becomes its own `must_not` entry, so a document is excluded if it matches any
of them (NOT A AND NOT B). Clauses the callback adds with `filter()` are
excluded the same way. An empty callback adds nothing. To exclude only
documents matching several conditions together, use `shouldNot()` with one
branch.

```ts
import { QueryBuilder } from "es-query-pro";

const qb = new QueryBuilder();
qb.mustNot((b) =>
  b
    .term({ field: "status", value: "soft_deleted" })
    .term({ field: "visibility", value: "hidden" }),
);
// Excludes docs matching either condition
```

### must(clause)

Condition methods (`term`, `match`, `range`, ...) add `bool.must` clauses.
`must(clause)` adds a raw Elasticsearch query clause the same way, for DSL
the builder has no method for. The clause is copied; a non-object throws a
`TypeError`. To add a raw clause in filter context, call
`filter((qb) => qb.must(clause))`.

### filter(withBuilder)

Conditions added inside `filter()` go in `bool.filter`: they must match, but
they do not change `_score`, and Elasticsearch can cache them. Use it for
yes/no conditions such as `term`, `range` and `exists`. Conditions added any
other way stay scoring `bool.must` clauses. An empty callback adds nothing.
`reset('filter')` clears filters; `reset('must')` does not.

```ts
import { QueryBuilder } from "es-query-pro";

const qb = new QueryBuilder();
qb.match({ field: "title", phrase: "apple pie" }).filter((sub) =>
  sub.term("status", "published").range("price", "<", 20),
);
// { bool: { must: [{ match: ... }], filter: [{ term: ... }, { range: ... }] } }
```

### nested(options)

Documents match when at least one nested object matches every condition the
callback adds. Conditions use full field paths (`reviews.stars`, not
`stars`). A lone condition is sent as is; an empty callback matches documents
that have at least one nested object (`match_all`). `scoreMode`,
`innerHits` (`true` for the defaults) and `ignoreUnmapped` are sent only when
given.

### Retriever rules

`knn()`, `semantic()`, `rrf()` and `weightedSemantic()` add retrievers; the
body then has a `retriever` instead of a `query`.

- Conditions, scoring or not, become the retriever's filter: they exclude
  documents but do not change the rank. A lone retriever takes them as its
  own `filter` (its scores are not normalized); several retrievers are
  combined in a `linear` retriever whose `filter` holds them.
- `rankWindowSize()`, `rankConstant()` and `normalizer()` apply whenever
  they are called. Without `rankWindowSize()`, the window sent is the
  largest of 50, `from + size` and every rescore `windowSize`. When no
  `limit()` is set, Elasticsearch returns up to `rank_window_size` hits for
  an rrf or linear retriever, not 10.
- Rescore phases wrap the retrievers in a `rescorer` retriever; a phase
  without `windowSize` uses the rank window.
- `minScore()` and `trackTotalHits()` still apply.
- `getBody()` throws a `TypeError` for retrievers combined with `sort()`,
  `sortByRandom()` or score functions, and `getOptions()`/`getQuery()` for
  retrievers with `searchAfter()`. It throws a `RangeError` when an explicit
  `rankWindowSize()` or rescore `windowSize` is below `limit()`, or a rescore
  window is above the rank window of an rrf or linear retriever.
- `count()` refuses builders with retrievers (`total: null` and an error,
  nothing sent), and `deleteMany()` and `updateMany()` refuse builders that
  have no `query`.

### Sorting, paging and rescore

- `sort('_score')` sorts best match first; other fields sort ascending unless
  a direction is given. Sort objects are stored as `{ field: { order } }`.
- `page()` without `limit()` pages by 10. `searchAfter()` works on page 1
  only: with `page() > 1`, `getOptions()` and `getQuery()` throw a
  `TypeError`.
- `sortByRandom(true, { seed })` sorts by `_score` first; `sort()` clauses
  then only break ties. With a seed, `_seq_no` can tie across shards, so add
  a tie-breaker sort when paging with `searchAfter()`.
- Rescore cannot be combined with any sort other than a lone `_score`
  descending: `getBody()` throws a `TypeError`.

### Date histograms and time zones

`dateHistogram()` returns every interval, including empty ones:
`aggregations.<name>.buckets` is
`[{ key: <epoch ms>, key_as_string, doc_count }, ...]`. Use the composite
`aggregateDateHistogram()` to page through non-empty buckets instead.

`timeZone` accepts a zone name (`"America/Denver"`, `"UTC"`, `"CET"`,
`"EST5EDT"`), an offset (`"+05:30"`, `"+0530"`, `"+05"`) or minutes **east**
of UTC (`330`; the opposite sign of `Date#getTimezoneOffset()`). Prefer zone
names: fixed offsets ignore daylight saving time. Names Elasticsearch
rejects (`EST`, wrong case such as `america/denver`) and offsets beyond
±18:00 throw a `RangeError`. Accepted names depend on the runtime's ICU data.

`offset` is an optional sign, a whole number and one of `nanos`, `micros`,
`ms`, `s`, `m`, `h`, `d` (`"+6h"`, `"-30m"`, `"1d"`). Elasticsearch has no
week, month, quarter or year offsets, so `"+1w"`, `"+1M"`, `"+1q"` and
`"+1y"` throw a `RangeError`.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for planned and completed features.

## Running tests

Tests are powered by bun. There are two kinds of test files:

- `*.spec.ts` are unit tests and need no external services.
- `*.integration.test.ts` run against a real Elasticsearch server.

```bash
bun run test:unit         # all unit tests (bun test .spec.ts)
bun run test:integration  # all integration tests (needs a server)
bun test src/QueryBuilder/QueryBuilder.spec.ts   # a single file
bun run coverage          # all tests with a coverage report
bun run typecheck         # tsc --noEmit; type-level tests only count here
bun run test:import       # build, then smoke-test the bundle (import-test.ts)
```

Type-level assertions (`expectTypeOf`, `// @ts-expect-error`) are checked by
`bun run typecheck`, not by `bun test`. `src/readmeSamples.spec.ts` compiles
the README's code samples and the quick reference examples, so keep samples
self-contained (each imports from `"es-query-pro"`).

### Connecting integration tests to Elasticsearch

The library itself reads no connection settings; the tests build their client
with `getTestClient()` in `src/testFixtures/testClient.ts`, which reads the
variables below (one client is shared by the whole test run). Bun loads a
`.env` file from the project root automatically, so the easiest setup is to
copy the example file and fill in your server's values:

```bash
cp .env.example .env
```

| Variable                     | Description                                      | Default                 |
| ---------------------------- | ------------------------------------------------ | ----------------------- |
| `ES_ENDPOINT`                | URL of the Elasticsearch server                  | `http://localhost:9200` |
| `ES_API_KEY`                 | API key (takes precedence over username)         | _none_                  |
| `ES_USERNAME`, `ES_PASSWORD` | Basic auth credentials, if not using API key     | _none_                  |
| `ES_SERVERLESS`              | `true` if the server is Elastic Cloud Serverless | `false`                 |

For example, to use an Elastic Cloud deployment:

```bash
ES_ENDPOINT=https://my-deployment.es.us-east-1.aws.elastic.cloud:443
ES_API_KEY=your-base64-api-key
```

`.env` is listed in `.gitignore`, so your credentials stay out of commits.
Variables already set in your shell take precedence over values in `.env`.

To run a local server instead, start the Elasticsearch 9.1 container in
`docker-compose.yml` (security disabled, trial license so rrf and linear
retrievers work), then run the integration tests against it. The empty
`ES_API_KEY` and `ES_SERVERLESS=false` override a `.env` that points at
another cluster:

```bash
docker compose up -d --wait
ES_ENDPOINT=http://localhost:9200 ES_API_KEY= ES_SERVERLESS=false \
  bun test .integration.test.ts
docker compose down -v
```

Each integration test file creates its indexes under its own prefix
(`esqpt_<time>_<label>_<random>`, from `src/testFixtures/esTestKit.ts`) and
deletes them by exact name when it finishes; leftovers older than 3 hours
are removed by the next run. Tests that need a feature the server lacks
(the tasks API, rrf/linear retrievers, an inference endpoint) are skipped
with a message. Use a development cluster, not one with production data. CI
runs the integration tests against self-managed Elasticsearch containers, and
they also pass against Elastic Cloud Serverless.

## Contributing

Contributions are welcome. Please open a GitHub ticket for bugs or feature
requests. Please make a pull request for any fixes or new code you'd like to be
incorporated.

## License

Open Source under the [ISC License](https://opensource.org/licenses/ISC).
