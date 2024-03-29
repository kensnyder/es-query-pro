# es-query-pro

[![NPM Link](https://img.shields.io/npm/v/es-query-pro?v=1.0.0)](https://npmjs.com/package/es-query-pro)
[![Build Status](https://ci.appveyor.com/api/projects/status/github/kensnyder/es-query-pro?branch=master&svg=true&v=1.0.0)](https://ci.appveyor.com/project/kensnyder/es-query-pro/branch/master)
[![Code Coverage](https://codecov.io/gh/kensnyder/es-query-pro/branch/master/graph/badge.svg?v=1.0.0)](https://codecov.io/gh/kensnyder/es-query-pro)
[![ISC License](https://img.shields.io/npm/l/es-query-pro.svg?v=1.0.0)](https://opensource.org/licenses/ISC)

Simple and powerful ElasticSearch query builder

## Installation

`npm install es-query-pro`

## Function reference

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
| queryString(fieldOrFields, query)                    | Lucene expression | queryString('body', '(tech AND support) OR (service desk)')  |

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

| Function     | Purpose                                      |
| ------------ | -------------------------------------------- |
| toKibana()   | Get a string suitable for running in Kibana  |
| getFields()  | Get the list of fields that will be returned |
| getBody()    | Get the structure of the query body          |
| getOptions() | Get the size, from, sort                     |
| getQuery()   | Return the fields, body and options to query |

## Examples

```js
const EsQueryBuilder = require('es-query-pro');

const query = new EsQueryBuilder();
query.term('author', 15);
query.matchBoostedPhrase(['fulltext_*'], 'Cold pressed juice');
query.range('created_at', '>=', '2021-01-01');
query.sort('created_at', 'desc');
query.limit(25);
query.page(2);
```

```js
const textProcessor = new TextProcessor();
textProcessor.setArrayJoiner('ψ');
textProcessor.registerPattern(
	{ find: /([a-z])&([a-z0-9])/gi, replace: '$1ε$2' },
	{ find: /([a-z])ε([a-z0-9])/gi, replace: '$1&$2' }
);
textProcessor.registerField(/^fulltext_/);
QueryBuilder.registerProcessor(textProcessor);
```

### Unit Tests and Code Coverage

Powered by jest

```bash
npm test
npm run coverage
```

## Contributing

Contributions are welcome. Please open a GitHub ticket for bugs or feature
requests. Please make a pull request for any fixes or new code you'd like to be
incorporated.

## License

Open Source under the [ISC License](https://opensource.org/licenses/ISC).
