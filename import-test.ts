// Smoke test of the built bundle: `bun run build && bun run import-test.ts`.
// Needs no Elasticsearch server; nothing here sends a request.
import assert from 'node:assert/strict';
import * as lib from './dist/index.mjs';
import {
  englishplus,
  getAllFields,
  getFulltextFields,
  IndexManager,
  QueryBuilder,
} from './dist/index.mjs';

assert.equal('getEsClient' in lib, false, 'getEsClient was removed');
assert.equal('SchemaManager' in lib, false, 'SchemaManager was removed');

const qb = new QueryBuilder();
qb.matchPhrase({ field: 'title', phrase: 'Harry Potter' });
const query = qb.getQuery();
assert.deepEqual(query.query, {
  match_phrase: { title: { query: 'Harry Potter', slop: 0 } },
});
console.log('QueryBuilder:', JSON.stringify(query));

const create = {
  index: 'books',
  settings: { analysis: englishplus.analysis },
  mappings: {
    properties: {
      title: {
        type: 'text',
        analyzer: 'englishplus',
        fields: { exact: { type: 'keyword', ignore_above: 256 } },
      },
      categories: {
        type: 'nested',
        properties: { id: { type: 'integer' }, name: { type: 'text' } },
      },
    },
  },
} as const;

assert.deepEqual(getAllFields(create, { subFields: true, containers: true }), [
  'title',
  'title.exact',
  'categories',
  'categories.id',
  'categories.name',
]);
assert.deepEqual(getFulltextFields(create), ['title', 'categories.name']);
console.log('getAllFields:', getAllFields(create));
console.log('getFulltextFields:', getFulltextFields(create));

// The client is only used to send requests, so a stub is enough here
const stubClient = {} as never;
const books = new IndexManager({ client: stubClient, prefix: 'smoke' }, create);
assert.equal(books.getFullName(), 'smoke~english~books~v1');
assert.equal(books.getAliasName(), 'smoke~english~books');
assert.equal(books.getCreateRequest().body.index, 'smoke~english~books~v1');
assert.throws(() => new IndexManager(undefined as never, create), TypeError);
console.log('IndexManager:', books.getFullName(), '->', books.getAliasName());

console.log('import-test: ok');
