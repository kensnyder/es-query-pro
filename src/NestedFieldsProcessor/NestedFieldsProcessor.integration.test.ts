import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import getEsClient from '../getEsClient/getEsClient';
import NestedFieldsProcessor from './NestedFieldsProcessor';

describe('NestedFieldsProcessor - Integration Tests', () => {
  const index = `test_nested_${Date.now()}`;
  const client = getEsClient();
  const processor = new NestedFieldsProcessor('/');

  beforeAll(async () => {
    // First, delete the index if it exists
    try {
      await client.indices.delete({ index });
    } catch (error) {
      // Ignore if index doesn't exist
    }

    await client.indices.create({
      index,
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: {
            type: 'text',
            analyzer: 'english',
            search_analyzer: 'english',
          },
          premise: {
            type: 'text',
            analyzer: 'english',
            search_analyzer: 'english',
          },
          country: { type: 'keyword' },
          categories: {
            type: 'nested',
            properties: {
              id: { type: 'integer' },
              name: {
                type: 'text',
                analyzer: 'english',
                search_analyzer: 'english',
              },
            },
          },
          author: {
            type: 'keyword',
          },
          publishing: {
            type: 'nested',
            properties: {
              author: { type: 'keyword' },
              organization: { type: 'keyword' },
              year: { type: 'integer' },
            },
          },
          heroes: { type: 'keyword' },
          price: { type: 'integer' },
        },
      },
    });

    await client.bulk({
      refresh: 'wait_for',
      body: [
        { index: { _index: index, _id: '1' } },
        {
          id: '1',
          title: "Harry Potter and the Sorcerer's Stone",
          premise:
            'A young boy discovers he’s a wizard and must confront a dark sorcerer while uncovering the truth about his own mysterious past.',
          country: 'United Kingdom',
          categories: [
            {
              id: 101,
              name: 'Fantasy',
            },
            {
              id: 102,
              name: 'Coming of Age',
            },
            {
              id: 104,
              name: 'Uncovering mystery',
            },
          ],
          publishing: {
            author: 'JK Rowling',
            organization: 'Bloomsbury Publishing',
            year: 1998,
          },
          heroes: ['Harry Potter', 'Hermione Granger', 'Ron Weasley'],
          price: 24.99,
        },
        { index: { _index: index, _id: '2' } },
        {
          id: '2',
          title: 'Harry Potter and the Chamber of Secrets',
          premise:
            'At Hogwarts, Harry uncovers the mystery behind a hidden chamber',
          country: 'United Kingdom',
          categories: [
            {
              id: 101,
              name: 'Fantasy',
            },
            {
              id: 102,
              name: 'Coming of Age',
            },
          ],
          publishing: {
            author: 'JK Rowling',
            organization: 'Bloomsbury Publishing',
            year: 1999,
          },
          heroes: ['Harry Potter', 'Hermione Granger', 'Ron Weasley'],
          price: 22.99,
        },
        { index: { _index: index, _id: '3' } },
        {
          id: '3',
          title: 'Skyward',
          premise:
            'A determined young pilot-in-training fights to prove herself worthy in a world under constant alien attack',
          country: 'United States of America',
          categories: [
            {
              id: 101,
              name: 'Fantasy',
            },
            {
              id: 103,
              name: 'Military',
            },
            {
              id: 104,
              name: 'Uncovering mystery',
            },
          ],
          publishing: {
            author: 'Brandon Sanderson',
            organization: 'Delacorte Press',
            year: 2018,
          },
          heroes: ['Spensa'],
          price: 18.99,
        },
      ],
    });
  });

  afterAll(async () => {
    // Clean up
    try {
      await client.indices.delete({ index });
    } catch (error) {
      // Ignore
    }
  });

  it('should handle non-nested query', async () => {
    const query = { term: { country: 'United Kingdom' } };
    const result = await client.search({
      index,
      query: processor.process(query),
      _source: ['id'],
    });
    const ids = result.hits.hits.map((hit: any) => hit._source.id).sort();
    expect(ids).toEqual(['1', '2']);
  });

  it('should handle a simple non-nested query with bool', async () => {
    const query = {
      bool: { should: [{ term: { country: 'United Kingdom' } }] },
    };
    const result = await client.search({
      index,
      query: processor.process(query),
      _source: ['id'],
    });

    const ids = result.hits.hits.map((hit: any) => hit._source.id).sort();
    expect(ids).toEqual(['1', '2']);
  });

  it('should recurse with extra bools', async () => {
    const query = {
      bool: {
        should: { bool: { should: [{ term: { country: 'United Kingdom' } }] } },
      },
    };
    const result = await client.search({
      index,
      query: processor.process(query),
      _source: ['id'],
    });

    const ids = result.hits.hits.map((hit: any) => hit._source.id).sort();
    expect(ids).toEqual(['1', '2']);
  });

  it('should recurse with array fields', async () => {
    const query = {
      bool: { should: [{ terms: { heroes: ['Harry Potter'] } }] },
    };
    const result = await client.search({
      index,
      query: processor.process(query),
      _source: ['id'],
    });

    const ids = result.hits.hits.map((hit: any) => hit._source.id).sort();
    expect(ids).toEqual(['1', '2']);
  });

  it('should handle a simple nested query', async () => {
    const query = { term: { 'categories/id': 101 } };
    const result = await client.search({
      index,
      query: processor.process(query),
      _source: ['id'],
    });

    const ids = result.hits.hits.map((hit: any) => hit._source.id).sort();
    expect(ids).toEqual(['1', '2', '3']);
  });

  it('should handle a nested query with exists', async () => {
    const query = { exists: { field: 'publishing/organization' } };
    const result = await client.search({
      index,
      query: processor.process(query),
      _source: ['id'],
    });

    const ids = result.hits.hits.map((hit: any) => hit._source.id).sort();
    expect(ids).toEqual(['1', '2', '3']);
  });

  it('should handle range queries with gt', async () => {
    const query = { range: { 'publishing/year': { gt: 2000 } } };
    const result = await client.search({
      index,
      query: processor.process(query),
      _source: ['id'],
    });

    const ids = result.hits.hits.map((hit: any) => hit._source.id).sort();
    expect(ids).toEqual(['3']);
  });

  it('should handle range queries with multiple conditions', async () => {
    const query = { range: { 'publishing/year': { gte: 1999, lt: 2000 } } };
    const result = await client.search({
      index,
      query: processor.process(query),
      _source: ['id'],
    });

    const ids = result.hits.hits.map((hit: any) => hit._source.id).sort();
    expect(ids).toEqual(['2']);
  });

  it('should handle multi_match queries with one nested field', async () => {
    const query = {
      multi_match: {
        query: 'Coming',
        fields: ['categories/name'],
      },
    };
    const result = await client.search({
      index,
      query: processor.process(query),
      _source: ['id'],
    });

    const ids = result.hits.hits.map((hit: any) => hit._source.id).sort();
    expect(ids).toEqual(['1', '2']);
  });

  it('should handle multi_match queries with a mix of fields', async () => {
    const query = {
      multi_match: {
        query: 'uncovering',
        fields: ['premise', 'categories/name'],
      },
    };
    const result = await client.search({
      index,
      query: processor.process(query),
      _source: ['id'],
    });

    const ids = result.hits.hits.map((hit: any) => hit._source.id).sort();
    expect(ids).toEqual(['1', '2', '3']);
  });

  // it('should find documents by nested term query', async () => {
  //   const result = await client.search({
  //     index,
  //     query: processor.processNestedFields({
  //       term: { 'category->id': 'cat1' }
  //     }),
  //     _source: false,
  //     fields: ['id'],
  //     size: 10,
  //   });
  //
  //   expect(result.hits.hits.map((hit: any) => hit._id).sort()).toEqual([
  //     '1',
  //     '3',
  //   ]);
  // });
  //
  // it('should find documents by deeply nested field', async () => {
  //   const result = await client.search({
  //     index,
  //     query: processor.processNestedFields({
  //       term: { 'author->contact->email': 'john@example.com' }
  //     }),
  //     _source: false,
  //     fields: ['id'],
  //     size: 10,
  //   });
  //
  //   expect(result.hits.hits).toHaveLength(2);
  //   expect(result.hits.hits.map((hit: any) => hit._id).sort()).toEqual([
  //     '1',
  //     '3',
  //   ]);
  // });
  //
  // it('should find documents by multi-level nested field', async () => {
  //   const result = await client.search({
  //     index,
  //     query: processor.processNestedFields({
  //       term: { 'author->contact->email': 'john@example.com' }
  //     }),
  //     _source: false,
  //     fields: ['id'],
  //     size: 10,
  //   });
  //
  //   expect(result.hits.hits).toHaveLength(2);
  //   expect(result.hits.hits.map((hit: any) => hit._id).sort()).toEqual([
  //     '1',
  //     '3',
  //   ]);
  // });
  //
  // it('should find documents with must_not on nested field', async () => {
  //   const result = await client.search({
  //     index,
  //     query: {
  //       bool: {
  //         must_not: [
  //           {
  //             nested: {
  //               path: 'metadata',
  //               query: {
  //                 term: { 'metadata.deleted': true },
  //               },
  //             },
  //           },
  //         ],
  //       },
  //     },
  //     _source: false,
  //     fields: ['id'],
  //     size: 10,
  //   });
  //
  //   expect(result.hits.hits).toHaveLength(2);
  //   expect(result.hits.hits.map((hit: any) => hit._id).sort()).toEqual([
  //     '1',
  //     '2',
  //   ]);
  // });
  //
  // it('should handle bool query with multiple nested conditions', async () => {
  //   // First, verify the test data is as expected
  //   const allDocs = await client.search({
  //     index,
  //     query: { match_all: {} },
  //     _source: false,
  //     fields: ['id'],
  //     size: 10,
  //   });
  //
  //   // The test is looking for a document where:
  //   // 1. category.id is 'cat1'
  //   // 2. author.name is 'John Doe'
  //   // 3. metadata.deleted is not true
  //   // This should match document with _id '1'
  //
  //   const query = processor.processNestedFields({
  //     bool: {
  //       must: [
  //         { term: { 'category->id': 'cat1' } },
  //         { match: { 'author->name': 'John Doe' } },
  //       ],
  //       must_not: [
  //         { term: { 'metadata->deleted': true } },
  //       ],
  //     },
  //   });
  //
  //   const result = await client.search({
  //     index,
  //     query,
  //     _source: false,
  //     fields: ['id'],
  //     size: 10,
  //   });
  //
  //   // Debug output (commented out in production)
  //   // console.log('Search results:', JSON.stringify(result.hits.hits, null, 2));
  //
  //   // We expect document with _id '1' to match all conditions
  //   expect(result.hits.hits).toHaveLength(1);
  //   // Type assertion for test assertion
  //   const hits = result.hits.hits as Array<{ _id: string }>;
  //   expect(hits[0]._id).toBe('1');
  // });
  //
  // it('should handle must_not with nested queries', async () => {
  //   // Create a bool query with nested conditions using arrow notation
  //   const query = processor.processNestedFields({
  //     bool: {
  //       must: [
  //         { term: { 'category->id': 'cat1' } },
  //       ],
  //       must_not: [
  //         { term: { 'metadata->deleted': true } },
  //       ],
  //     },
  //   });
  //
  //   const result = await client.search({
  //     index,
  //     query,
  //     _source: false,
  //     fields: ['id'],
  //     size: 10,
  //   });
  //
  //   expect(result.hits.hits).toHaveLength(1);
  //   // Type assertion for test assertion
  //   const hits = result.hits.hits as Array<{ _id: string }>;
  //   expect(hits[0]._id).toBe('1');
  // });
  //
  // it('should handle exists query on nested fields', async () => {
  //   // Create an exists query with arrow notation
  //   const query = processor.processNestedFields({
  //     exists: { field: 'metadata->tags' },
  //   });
  //
  //   const result = await client.search({
  //     index,
  //     query,
  //     _source: false,
  //     fields: ['id'],
  //     size: 10,
  //   });
  //
  //   // All three test documents have metadata.tags
  //   expect(result.hits.hits).toHaveLength(3);
  // });
  //
  // it('should handle match query on nested fields', async () => {
  //   // Create a match query with arrow notation
  //   const query = processor.processNestedFields({
  //     match: { 'author->name': 'John' },
  //   });
  //
  //   const result = await client.search({
  //     index,
  //     query,
  //     _source: false,
  //     fields: ['id'],
  //     size: 10,
  //   });
  //
  //   // Documents 1 and 3 have author.name 'John Doe'
  //   expect(result.hits.hits).toHaveLength(2);
  //   expect(result.hits.hits.map((hit: any) => hit._id).sort()).toEqual([
  //     '1',
  //     '3',
  //   ]);
  // });
  //
  // it('should handle range query on nested fields', async () => {
  //   // First, add a document with a nested numeric field for testing range queries
  //   await client.index({
  //     index,
  //     id: 'doc-range',
  //     document: {
  //       title: 'Document with Price',
  //       price: {
  //         amount: 199.99,
  //         currency: 'USD'
  //       },
  //       metadata: {
  //         created_at: '2023-01-15T00:00:00Z'
  //       }
  //     },
  //     refresh: true
  //   });
  //
  //   // Test range query on nested numeric field
  //   const priceQuery = processor.processNestedFields({
  //     range: { 'price->amount': { gte: 150, lte: 200 } }
  //   });
  //
  //   // Ensure we have a single query container, not an array
  //   const query = Array.isArray(priceQuery) ? { bool: { must: priceQuery } } : priceQuery;
  //
  //   const priceResult = await client.search({
  //     index,
  //     query,
  //     _source: ['title', 'price.amount']
  //   });
  //
  //   expect(priceResult.hits.hits.length).toBe(1);
  //   expect(priceResult.hits.hits[0]._source).toMatchObject({
  //     title: 'Document with Price',
  //     price: { amount: 199.99 }
  //   });
  //
  //   // Test range query on nested date field
  //   const dateQuery = processor.processNestedFields({
  //     range: { 'metadata->created_at': { gte: '2023-01-01T00:00:00Z', lte: '2023-12-31T23:59:59Z' } }
  //   });
  //
  //   const dateResult = await client.search({
  //     index,
  //     query: dateQuery,
  //     _source: ['title']
  //   });
  //
  //   expect(dateResult.hits.hits.length).toBe(1);
  //   expect(dateResult.hits.hits[0]._source).toMatchObject({
  //     title: 'Document with Price'
  //   });
  // });
  //
  // it('should handle multi_match query with nested fields', async () => {
  //   // Add a document with text fields for testing multi_match
  //   await client.index({
  //     index,
  //     id: 'doc-multimatch',
  //     document: {
  //       title: 'Multi-match Test Document',
  //       content: 'This is a test document for multi-match queries',
  //       metadata: {
  //         keywords: ['test', 'document', 'multi-match'],
  //         description: 'A document to test multi-match functionality'
  //       }
  //     },
  //     refresh: true
  //   });
  //
  //   // Test multi_match with nested and non-nested fields
  //   const query = processor.processNestedFields({
  //     multi_match: {
  //       query: 'test document',
  //       fields: ['title', 'content', 'metadata->keywords', 'metadata->description']
  //     }
  //   });
  //
  //   const result = await client.search({
  //     index,
  //     query,
  //     _source: ['title']
  //   });
  //
  //   const doc = result.hits.hits.find((hit: any) => hit._id === 'doc-multimatch');
  //   expect(doc).toBeDefined();
  //   expect(doc?._source).toMatchObject({
  //     title: 'Multi-match Test Document'
  //   });
  // });
  //
  // it('should handle multi_match with wildcard fields', async () => {
  //   // Test multi_match with wildcard for nested fields
  //   const query = processor.processNestedFields({
  //     multi_match: {
  //       query: 'test',
  //       fields: ['title', 'metadata->keywords']
  //     }
  //   });
  //
  //   const result = await client.search({
  //     index,
  //     query,
  //     _source: ['title']
  //   });
  //
  //   // Should find our test document
  //   const doc = result.hits.hits.find((hit: any) => hit._id === 'doc-multimatch');
  //   expect(doc).toBeDefined();
  //
  //   if (doc) {
  //     expect(doc._source).toMatchObject({
  //       title: 'Multi-match Test Document'
  //     });
  //   }
  // });
});
