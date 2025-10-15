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

| Function                                                             | Match Type              | Example                                                                 |
| -------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| exists({ field })                                                    | Exact field             | exists('deleted_at')                                                    |
| knn({ field, vector, k, numCandidates, weight, filter, similarity }) | kNN retrieval           | knn({ field: 'vec', vector: [0.1, 0.2], k: 10, numCandidates: 100 })    |
| match({ field, phrase, options })                                    | Full-text               | match('title', 'Market research')                                       |
| matchBoostedPhrase({ field, phrase, operators, weights })            | Full-text (boosted)     | matchBoostedPhrase(\['title'], 'AT&T Wireless')                         |
| matchPhrase({ field, phrase, options })                              | Full-text               | matchPhrase('title', 'Little Red Riding Hood')                          |
| matchPhrasePrefix({ field, phrase, options })                        | Full-text               | matchPhrasePrefix('title', 'Little Red R')                              |
| moreLikeThis({ field, like, options })                               | Similar documents       | moreLikeThis({ field: 'body', like: 'quick brown fox' })                |
| queryString({ field, queryString })                                  | Lucene expression       | queryString('body', '(tech AND support) OR (service desk)')             |
| range(field, operator, value)                                        | Exact field value       | range('age', 'between', [18, 35])                                       |
| rawCondition(query)                                                  | Raw ES query container  | rawCondition({ wildcard: { title: 'wire\*' } })                         |
| rrf({ semanticField, standardField, phrase, weight })                | Reciprocal rank fusion  | rrf({ semanticField: 'vec', standardField: 'title', phrase: 'router' }) |
| semantic({ field, phrase, weight })                                  | Vector/semantic scoring | semantic({ field: 'title.embedding', phrase: 'wireless', weight: 2 })   |
| term({ field, value })                                               | Exact field value       | term({ field: 'created_by', value: 123 })                               |
| termsSet(field, terms, minimumShouldMatchScript)                     | Terms set               | termsSet('tags', ['a','b'], 'Math.max(1, params.num_terms/2)')          |

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
| nested({ withBuilder, path, scoreMode, innerHits, ignoreUnmapped })    | Add conditions for a nested field                                     |
| page(pageNo)                                                           | Sets page                                                             |
| rankConstant(constant)                                                 | Set rank constant for RRF                                             |
| rankWindowSize(size)                                                   | Set window size for rank/rerank                                       |
| rescore({ windowSize, withBuilder })                                   | Add a rescore block                                                   |
| reset(field?)                                                          | Reset all instance values                                             |
| searchAfter(values)                                                    | Set search_after values                                               |
| should({ withBuilders, minimumShouldMatch })                           | Where subquery matches                                                |
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
