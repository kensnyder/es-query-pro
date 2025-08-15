# es-builder-pro

[![NPM Link](https://badgen.net/npm/v/es-query-pro?v=2.0.0-beta.3)](https://npmjs.com/package/es-query-pro)
[![Language](https://badgen.net/static/language/TS?v=2.0.0-beta.3)](https://github.com/search?q=repo:kensnyder/es-query-pro++language:TypeScript&type=code)
[![Build Status](https://github.com/kensnyder/es-query-pro/actions/workflows/tests.yml/badge.svg?v=2.0.0-beta.3)](https://github.com/kensnyder/es-query-pro/actions)
[![Code Coverage](https://codecov.io/gh/kensnyder/es-query-pro/branch/main/graph/badge.svg?v=2.0.0-beta.3)](https://codecov.io/gh/kensnyder/es-query-pro)
![GzippedSize](https://deno.bundlejs.com/?q=es-query-pro&badge&v=2.0.0-beta.3)
[![ISC License](https://badgen.net/static/license/ISC/green?v=2.0.0-beta.3)](https://opensource.org/licenses/ISC)

Simple and powerful ElasticSearch query builder and Index Manager

## Installation

`npm install es-builder-pro`

## Basic usage

Query Builder

```ts
import { QueryBuilder } from 'es-builder-pro';

const builder = new QueryBuilder();
builder.term('author', 15);
builder.matchBoostedPhrase('description', 'Mobile phone app');
builder.range('created_at', '>=', '2021-01-01');
builder.sort('created_at', 'desc');
builder.limit(10);
builder.page(2);
```

Index Manager

```ts
import { IndexManager, schemaRegistry } from 'es-builder-pro';

const schemaRegistry = new SchemaRegistry();

export const booksIndex = new IndexManager({
  index: {
    name: 'books',
    version: 1,
    prefix: process.env.NODE_ENV,
    language: 'english',
  },
  analyzer: 'english',
  schema: {
    id: 'integer',
    title: 'text',
    premise: 'text',
    categories: {
      id: 'integer',
      name: 'text',
    },
    author: 'keyword',
  },
});

schemaRegistry.add(booksIndex);

schemaManager.createOrMigrate();
```

## Table of Contents

## Query Builder function reference

### Basic

| Function                                     | Match Type        | Example                                         |
| -------------------------------------------- | ----------------- | ----------------------------------------------- |
| term(fieldOrFields, valueOrValues, anyOrAll) | Exact field value | term('created_by', 123)                         |
| matchBoostedPhrase(fields, terms, options)   | Full-text         | matchBoostedPhrase(\['title'], 'AT&T Wireless') |
| match(field, valueOrValues)                  | Full-text         | match('title', 'Market research')               |
| exists(fieldOrFields)                        | Exact field       | exists('deleted_at')                            |
| range(field, op, value)                      | Exact field value | range('age', 'between', \[18, 35])              |

### Advanced

| Function                                             | Match Type        | Example                                                      |
| ---------------------------------------------------- | ----------------- | ------------------------------------------------------------ |
| multiTerm(fields, value, anyOrAll)                   | Exact field value | multiTerm(\['created_by','modified_by'], 123)                |
| matchPhrase(field, phraseOrPhrases)                  | Full-text         | matchPhrase('title', 'Little Red Riding Hood')               |
| matchPhrasePrefix(fieldOrFields, phraseOrPhrases)    | Full-text         | matchPhrasePrefix('title', 'Little Red R')                   |
| multiMatch(fields, valueOrValues, anyOrAll)          | Full-text         | multiMatch(\['title','body'], \['phone','mobile'], 'ALL')    |
| multiMatchWithPhrase(fields, valueOrValues, options) | Full-text         | multiMatchWithPhrase(\['title','body'], \['phone','mobile']) |
| queryString(fieldOrFields, builder)                  | Lucene expression | queryString('body', '(tech AND support) OR (service desk)')  |

boostedPhrase??

### Negative conditions

| Function                             | Match Type        | Example                                      |
| ------------------------------------ | ----------------- | -------------------------------------------- |
| notTerm(field, valueOrValues)        | Exact field value | notTerm('status', \[2,3,4])                  |
| notMultiTerm(fields, value)          | Exact field value | notMultiTerm(\['border','outline'], 'blue')  |
| notExists(fieldOrFields)             | Exact field       | notExists('category')                        |
| notMatch(field, valueOrValues)       | Full-text         | notMatch('title', 'Market research')         |
| notMultiMatch(fields, valueOrValues) | Full-text         | notMultiMatch(\['title','body'], 'Research') |
| notRange(field, op, value)           | Exact field value | notRange('age', 'between', \[36, 44\])       |

## Sorting and pagination

| Function                  | Example             |
| ------------------------- | ------------------- |
| limit(limitTo)            | limit(10)           |
| page(pageNo)              | page(2)             |
| sort(field)               | sort('-created_at') |
| sortByRandom(trueOrFalse) | sortByRandom(true)  |

## Subqueries

| Function              | Purpose                       |
| --------------------- | ----------------------------- |
| should(subquery)      | Where subquery matches        |
| shouldNot(subquery)   | Where subquery does not match |
| shouldAny(subqueries) | Where any subquery matches    |

## Special functions

| Function                                         | Purpose                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| fields(fieldNames)                               | Set which fields to return. Default is \['\*'] which returns all fields       |
| useHighlighter(definition)                       | Ask for excerpts of text near the matching terms                              |
| includeFacets(forFields, limit)                  | Include counts for each field                                                 |
| decayFunctionScore(definition)                   | Give match weight based on a bell-curve                                       |
| aggregateTerm(field, limit, exclusions)          | A count of field values (like GROUP BY in SQL)                                |
| dateHistogram(dateField, intervalName, timezone) | Aggregate matches by time periods                                             |
| clear(field)                                     | Clear page, limit, must, mustNot, aggs, fields, highlighter, or functionScore |

## Inspection

| Function     | Purpose                                        |
| ------------ | ---------------------------------------------- |
| toKibana()   | Get a string suitable for running in Kibana    |
| getFields()  | Get the list of fields that will be returned   |
| getBody()    | Get the structure of the builder body          |
| getOptions() | Get the size, from, sort                       |
| getQuery()   | Return the fields, body and options to builder |

## Examples

```js
const EsQueryBuilder = require('es-builder-pro');

const builder = new QueryBuilder();
builder.term('author', 15);
builder.matchBoostedPhrase(['fulltext_*'], 'Cold pressed juice');
builder.range('created_at', '>=', '2021-01-01');
builder.sort('created_at', 'desc');
builder.limit(25);
builder.page(2);
```

```js
const textProcessor = new TextProcessor();
textProcessor.registerPattern(
  { find: /([a-z])&([a-z0-9])/gi, replace: '$1ε$2' },
  { find: /([a-z])ε([a-z0-9])/gi, replace: '$1&$2' }
);
```

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
- Support Elasticsearch 6-8

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
