# es-builder-pro

[![NPM Link](https://badgen.net/npm/v/es-query-pro?v=3.0.0)](https://npmjs.com/package/es-query-pro)
[![Language](https://badgen.net/static/language/TS?v=3.0.0)](https://github.com/search?q=repo:kensnyder/es-query-pro++language:TypeScript&type=code)
[![Code Coverage](https://codecov.io/gh/kensnyder/es-query-pro/branch/main/graph/badge.svg?v=3.0.0)](https://codecov.io/gh/kensnyder/es-query-pro)
![GzippedSize](https://badgen.net/static/size/10kb?v=3.0.0)
[![ISC License](https://badgen.net/static/license/ISC/green?v=3.0.0)](https://opensource.org/licenses/ISC)

Powerful ElasticSearch query builder and Index Manager with consistent APIs

** Only works with Elasticsearch 9.x **

## Installation

`npm install es-builder-pro`

## Basic usage

Query Builder

```ts
import { QueryBuilder } from "es-builder-pro";

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

```ts
import { IndexManager, SchemaRegistry } from "es-builder-pro";

const schemaRegistry = new SchemaRegistry();

export const booksIndex = new IndexManager({
  index: {
    name: "books",
    version: 1,
    prefix: process.env.NODE_ENV,
    language: "english",
  },
  analyzer: "englishplus",
  schema: {
    id: "integer",
    title: "text",
    premise: "text",
    categories: {
      id: "integer",
      name: "text",
    },
    author: "keyword",
  },
  // optional
  settings: {
    analysis: {
      char_filter: {
        tm_strip: { type: "mapping", mappings: ["®=>", "™=>"] },
      },
      filter: {
        wdg: { type: "word_delimiter_graph" },
        dbl_metaphone: {
          type: "phonetic",
          encoder: "double_metaphone",
          replace: false,
        },
      },
      normalizer: {
        keyword_fold: {
          type: "custom",
          filter: ["lowercase", "asciifolding"],
        },
      },
      analyzer: {
        title_index: {
          type: "custom",
          tokenizer: "standard",
          char_filter: ["tm_strip"],
          filter: ["lowercase", "asciifolding", "wdg"],
        },
        title_search: {
          type: "custom",
          tokenizer: "standard",
          char_filter: ["tm_strip"],
          filter: ["lowercase", "asciifolding"],
        },
        title_phonetic: {
          type: "custom",
          tokenizer: "standard",
          char_filter: ["tm_strip"],
          filter: ["lowercase", "asciifolding", "dbl_metaphone"],
        },
      },
    },
  },
  // optional: additional fields
  properties: {
    title: {
      type: "text" as const,
      analyzer: "title_index",
      search_analyzer: "title_search",
      fields: {
        phonetic: {
          type: "text" as const,
          analyzer: "title_phonetic",
          search_analyzer: "title_phonetic",
        },
      },
    },
  },
});

schemaRegistry.add(booksIndex);

schemaManager.createOrMigrate();
```

## Table of Contents

## Query Builder function quick reference

### Match conditions

| Function                                                  | Match Type        | Example                                                      |
| --------------------------------------------------------- | ----------------- | ------------------------------------------------------------ |
| term({ field, value })                                    | Exact field value | term({ field: 'created_by', value: 123 })                    |
| matchBoostedPhrase({ field, phrase, operators, weights }) | Full-text         | matchBoostedPhrase(\['title'], 'AT&T Wireless')              |
| match({ field, phrase, options })                         | Full-text         | match('title', 'Market research')                            |
| exists({ field })                                         | Exact field       | exists('deleted_at')                                         |
| range(field, operator, value)                             | Exact field value | range('age', 'between', \[18, 35])                           |
| ----------------------------------------------------      | ----------------- | ------------------------------------------------------------ |
| matchPhrase({ field, phrase, options })                   | Full-text         | matchPhrase('title', 'Little Red Riding Hood')               |
| matchPhrasePrefix({ field, phrase, options })             | Full-text         | matchPhrasePrefix('title', 'Little Red R')                   |
| queryString({ field, queryString })                       | Lucene expression | queryString('body', '(tech AND support) OR (service desk)')  |

### Other functions

| Function                                         | Purpose                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| should({ withBuilders, minimumShouldMatch })     | Where subquery matches                                                        |
| mustNot(withBuilder)                             | Where subquery matches                                                        |
| nested({ withBuilder, path, scoreMode })         | Add conditions for a nested field                                             |
| limit(limitTo)                                   | Sets limit                                                                    |
| page(pageNo)                                     | Sets page                                                                     |
| sort(field)                                      | Sets field sorting                                                            |
| sortByRandom(trueOrFalse)                        | If true, sort by random                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| fields(fieldNames)                               | Set which fields to return. Default is \['\*'] which returns all fields       |
| highlighterOptions(options)                      | Set additional sorting options                                                |
| highlightField(name, overrideOptions)            | Enable highlights for a particular field                                      |
| includeFacets(forFields, limit)                  | Include counts for each field                                                 |
| decayFunctionScore(definition)                   | Give match weight based on a bell-curve                                       |
| aggregateTerm(field, limit, exclusions)          | A count of field values (like GROUP BY in SQL)                                |
| dateHistogram(dateField, intervalName, timezone) | Aggregate matches by time periods                                             |
| reset(field)                                     | Reset all instance values                                                     |
| ------------                                     | ----------------------------------------------                                |
| toKibana()                                       | Get a string suitable for running in Kibana                                   |
| getFields()                                      | Get the list of fields that will be returned                                  |
| getBody()                                        | Get the structure of the builder body                                         |
| getOptions()                                     | Get the size, from, sort                                                      |
| getQuery()                                       | Return the fields, body and options to builder                                |

## Full documentation

# Roadmap

- client.search() ✅
- client.msearch()
- client.count() ✅
- client.explain()
- client.termsEnum()
- client.validateQuery()
- client.index() ✅
- client.create() ✅
- client.get() ✅
- client.mget()
- client.update() ✅
- client.delete() ✅
- client.bulk() ✅
- client.reindex()
- client.updateByQuery()
- client.deleteByQuery()
- client.indices.create() ✅
- client.indices.createFromSource()
- client.indices.delete() ✅
- client.indices.exists() ✅
- client.indices.get() ✅
- client.indices.open()
- client.indices.close()
- client.indices.refresh()
- client.indices.flush() ✅
- client.indices.clearCache()
- client.indices.stats()
- client.indices.segments()
- client.indices.recovery()
- client.indices.shardsStores()
- client.indices.forcemerge()
- client.indices.addBlock()
- client.indices.putSettings()
- client.indices.getSettings()
- client.indices.putMapping()
- client.indices.getMapping()
- client.indices.getFieldMapping()
- client.indices.putAlias() ✅
- client.indices.getAlias() ✅
- client.indices.existsAlias() ✅
- client.indices.deleteAlias() ✅
- client.indices.updateAliases()
- client.indices.resolveIndex()
- client.indices.getDataStream()
- client.indices.createDataStream()
- client.indices.deleteDataStream()
- client.indices.migrateToDataStream()
- must ✅
- must_not ✅
- filter
- exists ✅
- query_string ✅
- multi_match ✅
- term ✅
- match ✅
- match_phrase ✅
- range ✅
- Boosts ✅
- Nested queries ✅
- Nested schema creation ✅
- Facets ✅
- Date Histogram ✅
- Limit, page, sort ✅
- Sort on nested fields
- Sort by random ✅
- Function scores ✅
- Highlighting ✅
- Get Kibana Query ✅
- Migrate Index schema and data ✅
- Fancy englishplus analyzer ✅
- Text processing on insert and fetch ✅
- \_source ✅
- \_source_excludes ✅

### Unit Tests and Code Coverage

Powered by bun

```bash
bun test
bun run coverage
```

## Contributing

Contributions are welcome. Please open a GitHub ticket for bugs or feature
requests. Please make a pull request for any fixes or new code you'd like to be
incorporated.

## License

Open Source under the [ISC License](https://opensource.org/licenses/ISC).
