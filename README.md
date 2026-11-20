# es-query-pro

[![NPM Link](https://badgen.net/npm/v/es-query-pro?v=3.0.0-beta.2)](https://npmjs.com/package/es-query-pro)
[![Language](https://badgen.net/static/language/TS?v=3.0.0-beta.2)](https://github.com/search?q=repo:kensnyder/es-query-pro++language:TypeScript&type=code)
[![Code Coverage](https://codecov.io/gh/kensnyder/es-query-pro/branch/main/graph/badge.svg?v=3.0.0-beta.2)](https://codecov.io/gh/kensnyder/es-query-pro)
![Minzipped Size](https://badgen.net/static/size/12kb?v=3.0.0-beta.2)
[![ISC License](https://badgen.net/static/license/ISC/green?v=3.0.0-beta.2)](https://opensource.org/licenses/ISC)

Powerful ElasticSearch query builder and Index Manager with consistent APIs

** Only works with Elasticsearch 9.x **

## Installation

`npm install es-query-pro @elastic/elasticsearch`

`@elastic/elasticsearch` (version 9) is a peer dependency. The package is ESM
only. Typed field names (see below) need TypeScript 5.0 or newer.

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
import { Client } from "@elastic/elasticsearch";
import { englishplus, IndexManager, SchemaRegistry } from "es-query-pro";

const client = new Client({
  node: process.env.ES_ENDPOINT,
  auth: { apiKey: process.env.ES_API_KEY ?? "" },
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

const { records, total } = await booksIndex.findMany((qb) => {
  qb.match({ field: "title", phrase: "skyward" });
  qb.nested({
    path: "categories",
    query: (sub) => sub.term("categories.id", 101),
  });
});
```

See [SchemaRegistry.migrateIfNeeded](#schemaregistrymigrateifneededoptions)
for the full result payload.

The first argument (`ManageOptions`):

| Option       | Description                                                                                  | Default           |
| ------------ | -------------------------------------------------------------------------------------------- | ----------------- |
| `client`     | The `Client` from `@elastic/elasticsearch` (required)                                        | _none_            |
| `version`    | Index version; raising it makes `migrateIfNeeded()` create a new index and reindex into it   | `1`               |
| `prefix`     | First part of the index name, such as `prod` or an app name                                  | `""`              |
| `language`   | Language part of the index name                                                              | `"english"`       |
| `separator`  | Separator between the name parts                                                             | `"~"`             |
| `serverless` | Whether the cluster is Elastic Cloud Serverless (see [below](#elastic-cloud-serverless))     | `ES_SERVERLESS`   |

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
  fields such as `title^3`, `sort()`, `rawCondition()`, `must()` and
  `aggs()`.
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

`QueryBuilder.weightedSemantic({ semanticField, standardField, ... })` also
runs a wildcard query on `${standardField}.raw`, so the standard field needs a
`raw` sub-field, for example `fields: { raw: { type: "keyword" } }`. No
mapping gets one automatically.

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

### TypeScript and `skipLibCheck`

With `skipLibCheck: false`, the bundled `dist/index.d.ts` reports three errors
(a constraint on composite aggregation sources in `QueryBuilder`) and
`@elastic/elasticsearch`'s own declarations report one (its `apache-arrow`
import). Neither affects your code; keep `skipLibCheck: true` (the default in
most setups) until they are fixed.

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

## Table of Contents

## Query Builder function quick reference

### Match conditions

| Function                                                             | Match Type              | Example                                                                 |
| -------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| exists({ field })                                                    | Exact field             | exists('deleted_at')                                                    |
| knn({ field, vector, k, numCandidates, weight, filter, similarity }) | kNN retrieval           | knn({ field: 'vec', vector: \[0.1, 0.2\], k: 10, numCandidates: 100 })  |
| match({ field, phrase, options })                                    | Full-text               | match('title', 'Market research')                                       |
| matchBoostedPhrase({ field, phrase, operators, weights })            | Full-text (boosted)     | matchBoostedPhrase(\['title'], 'AT&T Wireless')                         |
| matchPhrase({ field, phrase, options })                              | Full-text               | matchPhrase('title', 'Little Red Riding Hood')                          |
| matchPhrasePrefix({ field, phrase, options })                        | Full-text               | matchPhrasePrefix('title', 'Little Red R')                              |
| moreLikeThis({ field, like, options })                               | Similar documents       | moreLikeThis({ field: 'body', like: 'quick brown fox' })                |
| queryString({ field, queryString })                                  | Lucene expression       | queryString('body', '(tech AND support) OR (service desk)')             |
| range(field, operator, value)                                        | Exact field value       | range('age', 'between', \[18, 35\])                                     |
| rawCondition(query)                                                  | Raw ES query container  | rawCondition({ wildcard: { title: 'wire\*' } })                         |
| rrf({ semanticField, standardField, phrase, weight })                | Reciprocal rank fusion  | rrf({ semanticField: 'vec', standardField: 'title', phrase: 'router' }) |
| semantic({ field, phrase, weight })                                  | Vector/semantic scoring | semantic({ field: 'title.embedding', phrase: 'wireless', weight: 2 })   |
| term({ field, value })                                               | Exact field value       | term({ field: 'created_by', value: 123 })                               |
| termsSet({ field, terms, script })                                   | Terms set               | termsSet({ field: 'tags', terms: \['a','b'\]                            |

### Other functions

| Function                                                               | Purpose                                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| aggregateTerm({ field, limit, exclude, order, showTermDocCountError }) | Count of field values (GROUP BY-like)                                 |
| aggs(aggs)                                                             | Set custom aggregations                                               |
| clone()                                                                | Clone the current builder                                             |
| dateHistogram(dateField, intervalName, timezone)                       | Aggregate matches by time periods                                     |
| decayFunctionScore(definition)                                         | Give match weight based on a bell-curve                               |
| excludeFields(fieldNames)                                              | Alias for sourceExcludes                                              |
| fields(fieldNames)                                                     | Set which fields to return. Default is ['*'] which returns all fields |
| getAggs()                                                              | Get custom aggregations                                               |
| getBody()                                                              | Get the structure of the builder body                                 |
| getFields()                                                            | Get the list of fields that will be returned                          |
| getFunctionScores()                                                    | Get function score definitions                                        |
| getHighlighter()                                                       | Get the full highlighter definition                                   |
| getIndex()                                                             | Get the index name                                                    |
| getLimit()                                                             | Get limit                                                             |
| getMinScore()                                                          | Get minimum score                                                     |
| getMust()                                                              | Get must conditions                                                   |
| getOptions()                                                           | Get the size, from, sort                                              |
| getPage()                                                              | Get page                                                              |
| getQuery(overrides?)                                                   | Return the fields, body and options to builder                        |
| getRankConstant()                                                      | Get rank constant                                                     |
| getRankWindowSize()                                                    | Get window size                                                       |
| getRescore()                                                           | Get rescore definition                                                |
| getRetrievers()                                                        | Get retriever blocks (e.g., kNN)                                      |
| getSearchAfter()                                                       | Get search_after values                                               |
| getSort()                                                              | Get sort                                                              |
| getSortByRandom()                                                      | Get the random sort flag                                              |
| getSourceExcludes()                                                    | Get current \_source excludes                                         |
| getSourceIncludes()                                                    | Get current \_source includes                                         |
| getTrackTotalHits()                                                    | Get track_total_hits                                                  |
| highlighterOptions(options)                                            | Set highlighter options                                               |
| highlightField(name, overrideOptions)                                  | Enable highlights for a particular field                              |
| includeFacets({ fields, limit })                                       | Include counts for each field                                         |
| index(name)                                                            | Set the index name                                                    |
| limit(limitTo)                                                         | Sets limit                                                            |
| minScore(score)                                                        | Set minimum score                                                     |
| mustNot(withBuilder)                                                   | Where subquery does not match                                         |
| nested({ query, path, scoreMode, innerHits, ignoreUnmapped })          | Add conditions for a nested field                                     |
| page(pageNo)                                                           | Sets page                                                             |
| rankConstant(constant)                                                 | Set rank constant for RRF                                             |
| rankWindowSize(size)                                                   | Set window size for rank/rerank                                       |
| rescore(withBuilder, { windowSize })                                   | Add a rescore block with the given query                              |
| reset(field?)                                                          | Reset all instance values                                             |
| searchAfter(values)                                                    | Set search_after values                                               |
| should(withBuilders, { minimumShouldMatch })                           | Where at least K subqueries match                                     |
| shouldNot(withBuilders, { minimumShouldMatch })                        | Where at least K subqueries do not match                              |
| sort(field, direction?)                                                | Sets field sorting                                                    |
| sortByRandom(trueOrFalse)                                              | If true, sort by random                                               |
| sourceExcludes(fieldNames)                                             | Set \_source excludes                                                 |
| sourceIncludes(fieldNames)                                             | Set \_source includes                                                 |
| toJSON()                                                               | Serialize to JSON                                                     |
| toKibana(index?)                                                       | Get a string suitable for running in Kibana                           |
| toString()                                                             | String representation                                                 |
| trackTotalHits(value)                                                  | Set track_total_hits                                                  |
| valueOf()                                                              | Coerce to value                                                       |

## Full documentation

### should(withBuilders, { minimumShouldMatch })

Build a boolean disjunction (OR) of multiple alternative subqueries. Each item in `withBuilders` is a function that receives a fresh `QueryBuilder` to define one branch. The branches are collected under a `bool.should` clause.

- `minimumShouldMatch` (number | string) controls how many of the branches must match for the document to match:
  - If omitted, defaults to `1` (at least one branch must match).
  - If set to `K` (the exact number of branches), all branches must match. This makes the `should` act like an AND for matching semantics while preserving scoring behavior of `should` clauses.
  - You may also use percentage strings like `"50%"`.

Real‑world examples:

- News feed: return items that are either recently created OR highly upvoted.
- E‑commerce: show products that match any of several acceptable brands, but require at least two of several quality signals.

Code examples:

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

Express a negative condition over alternatives: “these alternatives should not match.” Internally, this is modeled as a `must_not` of a nested `bool.should`.

Current behavior in this library:

- `shouldNot(withBuilders)` calls `mustNot(qb => qb.should(withBuilders))`.
- Because `should()` defaults `minimumShouldMatch` to `1`, this excludes any document that matches at least one branch (i.e., NOT(A OR B ...)). This is equivalent to adding each branch as its own `must_not` clause when `minimumShouldMatch = 1`.
- If you need a different `minimumShouldMatch` (e.g., exclude only when at least 2 branches match), use the explicit form with `mustNot` + `should`:
  ```ts
  qb.mustNot((qb2) => {
    qb2.should(withBuilders, { minimumShouldMatch: 2 });
  });
  ```

Real‑world examples:

- Content filtering: exclude items that are NSFW OR from blocked authors.
- Fraud detection review: exclude only when multiple risk signals are present simultaneously (e.g., IP risk AND device risk).

Code examples:

```ts
import { QueryBuilder } from "es-query-pro";

// Example 1: minimumShouldMatch = 1
const qb1 = new QueryBuilder();
qb1.shouldNot(
  [
    (qb) => {
      qb.term({ field: "visibility", value: "hidden" });
    },
    (qb) => {
      qb.term({ field: "status", value: "soft_deleted" });
    },
  ],
  { minimumShouldMatch: 1 },
);
// Excludes docs where visibility=hidden OR status=soft_deleted

// Example 2: exclude only when BOTH risk signals match (msm = 2)
const qb2 = new QueryBuilder();
qb2.mustNot((qb) => {
  qb.should(
    [
      (b) => {
        b.term({ field: "risk.ip", value: "high" });
      },
      (b) => {
        b.term({ field: "risk.device", value: "high" });
      },
    ],
    { minimumShouldMatch: 2 },
  );
});
// Allows documents that have only one risk signal; excludes those with both.
```

### mustNot(withBuilder)

Add one or more negative clauses directly under `bool.must_not`. The provided builder can add multiple conditions; each becomes its own entry under `must_not`.

Semantics:

- A document is excluded if it matches any of the `must_not` queries.
- Multiple `must_not` entries behave like a logical OR inside the negation: NOT(A) AND NOT(B) is equivalent to NOT(A OR B) for matching with `msm=1`.

Real‑world examples:

- Hide soft-deleted or hidden content.
- Exclude out-of-stock items.

Code examples:

```ts
import { QueryBuilder } from "es-query-pro";

const qb = new QueryBuilder();
qb.mustNot((b) => {
  b.term({ field: "status", value: "soft_deleted" });
  b.term({ field: "visibility", value: "hidden" });
});
// Excludes docs matching either condition
```

### must — omitted

All conditions you add by default are `must` clauses. There is no explicit `must()` function; when you call builder methods like `term`, `match`, `range`, etc., they are placed under `bool.must` automatically. This keeps the API concise while covering the most common case (conjunction/AND of conditions).

### SchemaRegistry.migrateIfNeeded(options)

Create or migrate every registered index, one at a time, in registration order. An index that does not exist is created with its alias; an index whose alias points at an older version is created, reindexed in the background, and the old index is dropped; an index that is already current is left alone.

The call resolves as soon as the work is kicked off. To get the outcome, await the returned `completion` promise or pass `onAllComplete` — both receive the same payload.

```ts
const { acknowledged, error, completion } =
  await schemaRegistry.migrateIfNeeded({
    slices: 1, // reindex slices per index (default 1)
    pollInterval: 1000, // ms between reindex progress checks (default 1000)
    onProgress: ({ alias, oldIndex, newIndex, done, total, percent }) => {},
    onComplete: (progress) => {}, // one index finished creating/reindexing
    onError: (error) => {},
    onAllComplete: (details) => {}, // same payload as `completion`
  });

const details = await completion;
if (!details.success) {
  console.error(details.summary);
}
```

Immediate return value:

| Property     | Description                                                 |
| ------------ | ----------------------------------------------------------- |
| acknowledged | `false` only when no indexes are registered                 |
| error        | An `Error` when no indexes are registered; otherwise `null` |
| completion   | Promise of the payload below; never rejects                 |

Payload from `completion` / `onAllComplete` (type `SchemaMigrationDetails`):

| Property | Description                                                                      |
| -------- | -------------------------------------------------------------------------------- |
| success  | `true` when no index failed                                                      |
| took     | Total milliseconds                                                               |
| report   | One entry per registered index, in registration order (see below)                |
| summary  | Outcome keyed by full index name, e.g. `{ "prod~english~books~v2": "migrated" }` |

Each `report` entry (type `SchemaMigrationReport`):

| Property  | Description                                                                        |
| --------- | ---------------------------------------------------------------------------------- |
| fullName  | Versioned index name, e.g. `prod~english~books~v2`                                 |
| aliasName | Alias name, e.g. `prod~english~books`                                              |
| outcome   | `"created"`, `"migrated"`, `"unchanged"` or `"failed"`                             |
| before    | `IndexManager.getStatus()` result before migrating; `null` if it could not be read |
| after     | `IndexManager.getStatus()` result after migrating; `null` if it could not be read  |
| error     | The first `Error` hit for this index; otherwise `null`                             |
| took      | Milliseconds spent on this index                                                   |

Example payload:

```ts
{
  success: false,
  took: 5210,
  report: [
    {
      fullName: "prod~english~books~v2",
      aliasName: "prod~english~books",
      outcome: "migrated",
      before: { summary: "needsMigration", needsMigration: true, /* ... */ },
      after: { summary: "current", needsMigration: false, /* ... */ },
      error: null,
      took: 4980,
    },
    {
      fullName: "prod~english~authors~v1",
      aliasName: "prod~english~authors",
      outcome: "failed",
      before: { summary: "needsCreation", needsCreation: true, /* ... */ },
      after: { summary: "needsCreation", needsCreation: true, /* ... */ },
      error: new Error("..."),
      took: 230,
    },
  ],
  summary: {
    "prod~english~books~v2": "migrated",
    "prod~english~authors~v1": "failed",
  },
}
```

Error handling:

- A failed index does not stop the run; the remaining indexes are still processed and the failure is listed in `report` and `summary` with `outcome: "failed"`.
- `onError` is called once per distinct error. If an index has already failed, a further failure reading its `after` status is not reported.
- Exceptions thrown by `onError` or `onAllComplete` are logged with `console.error` and do not interrupt the run.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for planned and completed features.

## Running tests

Tests are powered by bun. There are two kinds of test files:

- `*.spec.ts` are unit tests and need no external services.
- `*.integration.test.ts` run against a real Elasticsearch server.

```bash
bun test                # all tests (integration tests need a server)
bun test src/QueryBuilder/QueryBuilder.spec.ts   # a single file
bun run coverage        # all tests with a coverage report
bun run typecheck       # tsc --noEmit; type-level tests only count here
```

Type-level assertions (`expectTypeOf`, `// @ts-expect-error`) are checked by
`bun run typecheck`, not by `bun test`. `src/readmeSamples.spec.ts` compiles
the README's code samples, so keep them self-contained (each imports from
`"es-query-pro"`).

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

To run a local server instead, start the same image CI uses, with security
disabled so no credentials are needed:

```bash
docker run --rm -p 9200:9200 \
  -e discovery.type=single-node \
  -e xpack.security.enabled=false \
  -e ES_JAVA_OPTS="-Xms1g -Xmx1g" \
  docker.elastic.co/elasticsearch/elasticsearch:9.1.0
```

Then run only the integration tests:

```bash
bun test integration
```

Integration tests create indexes named `test~english~books_*` and
`test_query_builder_*`, and delete them when they finish. Use a development
cluster, not one with production data. CI runs them against a self-managed
Elasticsearch 9.1 container, and they also pass against Elastic Cloud
Serverless.

## Contributing

Contributions are welcome. Please open a GitHub ticket for bugs or feature
requests. Please make a pull request for any fixes or new code you'd like to be
incorporated.

## License

Open Source under the [ISC License](https://opensource.org/licenses/ISC).
