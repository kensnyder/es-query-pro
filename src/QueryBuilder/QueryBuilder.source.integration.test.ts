import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { getBooksCreateRequest, getBooksData } from '../testFixtures/books';
import { createTestKit } from '../testFixtures/esTestKit';
import QueryBuilder from './QueryBuilder';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('qb-source');
const client = kit.client;
let index = '';

beforeAll(async () => {
  index = await kit.makeIndex(getBooksCreateRequest('books'), getBooksData());
});

afterAll(async () => {
  await kit.cleanup();
});

/** The `_source` keys of each hit, sorted, keyed by `_id` */
function sourceKeysById(response: estypes.SearchResponse) {
  const byId: Record<string, string[] | undefined> = {};
  for (const hit of response.hits.hits) {
    const source = hit._source as Record<string, unknown> | undefined;
    byId[String(hit._id)] = source ? Object.keys(source).sort() : undefined;
  }
  return byId;
}

/** The highlight fragments of each hit for `field`, keyed by `_id` */
function highlightsById(response: estypes.SearchResponse, field: string) {
  const byId: Record<string, string[] | undefined> = {};
  for (const hit of response.hits.hits) {
    byId[String(hit._id)] = hit.highlight?.[field];
  }
  return byId;
}

describe('QueryBuilder source filtering - Integration', () => {
  it('server: a _source_excludes URL param drops the body includes (B-011)', async () => {
    // The shape getQuery() emitted before the fix: the client sends
    // `_source` in the body and `_source_excludes` in the URL.
    const response = await client.search({
      index,
      query: { term: { id: '1' } },
      _source: ['id', 'title', 'country'],
      _source_excludes: ['country'],
    });
    const keys = sourceKeysById(response)['1'];
    expect(keys).toContain('premise');
    expect(keys).not.toContain('country');
  });

  it('fields() + excludeFields() return the includes minus the excludes', async () => {
    const qb = new QueryBuilder({ index });
    qb.fields(['id', 'title', 'country']);
    qb.excludeFields(['country']);
    const response = await client.search(qb.getQuery());
    const byId = sourceKeysById(response);
    expect(Object.keys(byId).sort()).toEqual(['1', '2', '3']);
    for (const keys of Object.values(byId)) {
      expect(keys).toEqual(['id', 'title']);
    }
  });

  it('fields() + excludeFields() with patterns', async () => {
    const qb = new QueryBuilder({ index });
    qb.fields(['publishing.*', 'id']);
    qb.excludeFields(['publishing.movie*']);
    qb.term({ field: 'id', value: '1' });
    const response = await client.search(qb.getQuery());
    const source = response.hits.hits[0]._source as Record<string, any>;
    expect(Object.keys(source).sort()).toEqual(['id', 'publishing']);
    expect(Object.keys(source.publishing).sort()).toEqual([
      'author',
      'organization',
      'series',
      'year',
    ]);
  });

  it('excludeFields() alone keeps every other field', async () => {
    const qb = new QueryBuilder({ index });
    qb.excludeFields(['premise', 'categories']);
    qb.term({ field: 'id', value: '2' });
    const response = await client.search(qb.getQuery());
    expect(sourceKeysById(response)['2']).toEqual([
      'country',
      'heroes',
      'id',
      'price',
      'published_at',
      'publishing',
      'title',
    ]);
  });

  it('fields([]) returns no _source', async () => {
    const qb = new QueryBuilder({ index });
    qb.fields([]);
    const response = await client.search(qb.getQuery());
    expect(response.hits.hits).toHaveLength(3);
    for (const hit of response.hits.hits) {
      expect(hit._source).toBeUndefined();
    }
  });

  it('the toKibana() body is accepted verbatim by the server', async () => {
    const qb = new QueryBuilder({ index });
    qb.fields(['id', 'title']);
    qb.excludeFields(['title']);
    const kibana = qb.toKibana();
    const body = JSON.parse(kibana.slice(kibana.indexOf('\n') + 1));
    const response = (await client.transport.request({
      method: 'POST',
      path: `/${encodeURIComponent(index)}/_search`,
      body,
    })) as estypes.SearchResponse;
    for (const keys of Object.values(sourceKeysById(response))) {
      expect(keys).toEqual(['id']);
    }
  });
});

describe('QueryBuilder highlighting - Integration', () => {
  // With several shards the search "succeeds" with the failing shards'
  // hits silently missing; with allow_partial_search_results: false (or a
  // single shard) the whole search fails.
  for (const [label, query, field] of [
    ['a text field', { match: { title: 'harry' } }, 'title'],
    ['a keyword field', { term: { country: 'United Kingdom' } }, 'country'],
  ] as const) {
    it(`server: fvh fails on ${label} without term vectors (B-044)`, async () => {
      const request: estypes.SearchRequest = {
        index,
        query,
        highlight: { type: 'fvh', fields: { [field]: {} } },
      };
      const partial = await client.search(request);
      expect(partial.hits.hits).toHaveLength(0);
      expect(partial._shards.failed).toBeGreaterThan(0);
      expect(JSON.stringify(partial._shards.failures)).toContain('term vector');
      let error: unknown;
      try {
        await client.search({
          ...request,
          allow_partial_search_results: false,
        });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).toContain('term vector');
    });
  }

  it('default highlighter works on a text field without term vectors', async () => {
    const qb = new QueryBuilder({ index });
    qb.match({ field: 'title', phrase: 'harry' });
    qb.highlightField('title');
    const response = await client.search(qb.getQuery());
    const byId = highlightsById(response, 'title');
    expect(Object.keys(byId).sort()).toEqual(['1', '2']);
    expect(byId['1']?.[0]).toContain('<em class="hlt1">Harry</em>');
    expect(byId['2']?.[0]).toContain('<em class="hlt1">Harry</em>');
  });

  it('default highlighter works on a sub-field with term vectors', async () => {
    const qb = new QueryBuilder({ index });
    qb.match({ field: 'title.fvh', phrase: 'Chamber' });
    qb.highlightField('title.fvh');
    const response = await client.search(qb.getQuery());
    const byId = highlightsById(response, 'title.fvh');
    expect(Object.keys(byId)).toEqual(['2']);
    expect(byId['2']?.[0]).toContain('<em class="hlt1">Chamber</em>');
  });

  it('default highlighter works on a keyword field', async () => {
    const qb = new QueryBuilder({ index });
    qb.term({ field: 'country', value: 'United Kingdom' });
    qb.highlightField('country');
    const response = await client.search(qb.getQuery());
    const byId = highlightsById(response, 'country');
    expect(Object.keys(byId).sort()).toEqual(['1', '2']);
    expect(byId['1']).toEqual(['<em class="hlt1">United Kingdom</em>']);
  });

  it('a per-field type override is honored', async () => {
    const qb = new QueryBuilder({ index });
    qb.match({ field: 'title', phrase: 'harry' });
    qb.highlightField('title', { type: 'plain', number_of_fragments: 0 });
    const response = await client.search(qb.getQuery());
    const byId = highlightsById(response, 'title');
    expect(byId['1']).toEqual([
      '<em class="hlt1">Harry</em> Potter and the Sorcerer\'s Stone',
    ]);
  });
});
