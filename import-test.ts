// Smoke test of the built ESM bundle: `bun run test:import` (which runs
// `bun run build` first). "es-query-pro" resolves through package.json's
// `exports` map to ./dist/index.mjs. Needs no Elasticsearch server; nothing
// here sends a request.
import assert from 'node:assert/strict';
import * as bundle from './dist/index.mjs';
import * as lib from 'es-query-pro';
import {
  englishplus,
  getAllFields,
  getFulltextFields,
  IndexManager,
  QueryBuilder,
  SchemaRegistry,
} from 'es-query-pro';

assert.equal(lib.QueryBuilder, bundle.QueryBuilder, 'exports map -> dist');
assert.deepEqual(Object.keys(lib).sort(), [
  'IndexManager',
  'IndexNameManager',
  'QueryBuilder',
  'QueryRunner',
  'SchemaRegistry',
  'englishplus',
  'getAllFields',
  'getFulltextFields',
  'isEmptyObject',
]);
assert.equal('getEsClient' in lib, false, 'getEsClient was removed');
assert.equal('SchemaManager' in lib, false, 'SchemaManager was removed');

const source = await Bun.file(
  new URL('./dist/index.mjs', import.meta.url),
).text();
assert.equal(source.includes('@elastic'), false, 'no @elastic in the bundle');

const qb = new QueryBuilder();
qb.matchPhrase({ field: 'title', phrase: 'Harry Potter' });
const query = qb.getQuery();
assert.deepEqual(query.query, {
  match_phrase: { title: { query: 'Harry Potter', slop: 0 } },
});
console.log('QueryBuilder:', JSON.stringify(query));

const filtered = new QueryBuilder()
  .match({ field: 'title', phrase: 'potter' })
  .filter((sub) => sub.term('country', 'UK'));
assert.deepEqual(filtered.getQuery().query, {
  bool: {
    must: [{ match: { title: { query: 'potter' } } }],
    filter: [{ term: { country: 'UK' } }],
  },
});
assert.equal(
  Object.hasOwn(QueryBuilder.prototype, 'valueOf'),
  false,
  'valueOf removed',
);
assert.equal(new QueryBuilder().toKibana().split('\n')[0], 'GET _search');
assert.throws(() => new QueryBuilder().limit(-1), RangeError);
assert.throws(() => new QueryBuilder().term('a', undefined as never), TypeError);
console.log('QueryBuilder validation: ok');

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
assert.throws(
  () => new IndexManager({ client: stubClient, prefix: 'Smoke' }, create),
  RangeError,
);
console.log('IndexManager:', books.getFullName(), '->', books.getAliasName());

// Envelopes, not exceptions: the stub client has no methods, so the request
// fails with a TypeError, reported as errorKind 'javascript'
const found = await books.findById('1');
assert.ok(found.error instanceof Error);
assert.equal(found.errorKind, 'javascript');
const fleet = await new SchemaRegistry().dropAll();
assert.equal(fleet.success, false);
assert.equal(fleet.errorKind, 'configuration');
console.log('envelopes: ok');

console.log('import-test: ok');
