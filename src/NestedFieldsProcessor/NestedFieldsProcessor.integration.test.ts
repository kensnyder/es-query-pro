import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import getEsClient from '../getEsClient/getEsClient';
import NestedFieldsProcessor from './NestedFieldsProcessor';

describe('NestedFieldsProcessor - Integration Tests', () => {
  const index = `test_nested_${Date.now()}`;
  const client = getEsClient();
  const processor = new NestedFieldsProcessor();

  beforeAll(async () => {
    // First, delete the index if it exists
    try {
      await client.indices.delete({ index });
    } catch (error) {
      // Ignore if index doesn't exist
    }

    // Create the index with mappings directly in the create call
    // Using the correct type structure for Elasticsearch 9.1.0
    await client.indices.create({
      index,
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: { type: 'text' },
          category: {
            type: 'nested',
            properties: {
              id: { type: 'keyword' },
              name: { type: 'text' },
            },
          },
          author: {
            type: 'nested',
            properties: {
              name: { type: 'text' },
              contact: {
                type: 'nested',
                properties: {
                  email: { type: 'keyword' },
                  phone: { type: 'keyword' },
                },
              },
            },
          },
          metadata: {
            type: 'nested',
            properties: {
              tags: { type: 'keyword' },
              deleted: { type: 'boolean' },
              created_at: { type: 'date' },
              keywords: { type: 'keyword' },
              description: { type: 'text' }
            },
          },
          price: {
            type: 'nested',
            properties: {
              amount: { type: 'float' },
              currency: { type: 'keyword' }
            }
          },
          content: { type: 'text' },
        },
      },
    } as const);

    // Index some test documents
    await client.bulk({
      refresh: 'wait_for',
      body: [
        // Document 1
        { index: { _index: index, _id: '1' } },
        {
          id: '1',
          title: 'Test Document 1',
          category: {
            id: 'cat1',
            name: 'Category 1',
          },
          author: {
            name: 'John Doe',
            contact: {
              email: 'john@example.com',
              phone: '123-456-7890',
            },
          },
          metadata: {
            tags: ['important', 'test'],
            deleted: false,
          },
        },

        // Document 2
        { index: { _index: index, _id: '2' } },
        {
          id: '2',
          title: 'Test Document 2',
          category: {
            id: 'cat2',
            name: 'Category 2',
          },
          author: {
            name: 'Jane Smith',
            contact: {
              email: 'jane@example.com',
              phone: '098-765-4321',
            },
          },
          metadata: {
            tags: ['test'],
            deleted: false,
          },
        },

        // Document 3 (deleted)
        { index: { _index: index, _id: '3' } },
        {
          id: '3',
          title: 'Deleted Document',
          category: {
            id: 'cat1',
            name: 'Category 1',
          },
          author: {
            name: 'John Doe',
            contact: {
              email: 'john@example.com',
              phone: '123-456-7890',
            },
          },
          metadata: {
            tags: ['deleted'],
            deleted: true,
          },
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

  it('should find documents by nested term query', async () => {
    const result = await client.search({
      index,
      query: processor.processNestedFields({
        term: { 'category->id': 'cat1' }
      }),
      _source: false,
      fields: ['id'],
      size: 10,
    });

    expect(result.hits.hits.map((hit: any) => hit._id).sort()).toEqual([
      '1',
      '3',
    ]);
  });

  it('should find documents by deeply nested field', async () => {
    const result = await client.search({
      index,
      query: processor.processNestedFields({
        term: { 'author->contact->email': 'john@example.com' }
      }),
      _source: false,
      fields: ['id'],
      size: 10,
    });

    expect(result.hits.hits).toHaveLength(2);
    expect(result.hits.hits.map((hit: any) => hit._id).sort()).toEqual([
      '1',
      '3',
    ]);
  });

  it('should find documents by multi-level nested field', async () => {
    const result = await client.search({
      index,
      query: processor.processNestedFields({
        term: { 'author->contact->email': 'john@example.com' }
      }),
      _source: false,
      fields: ['id'],
      size: 10,
    });

    expect(result.hits.hits).toHaveLength(2);
    expect(result.hits.hits.map((hit: any) => hit._id).sort()).toEqual([
      '1',
      '3',
    ]);
  });

  it('should find documents with must_not on nested field', async () => {
    const result = await client.search({
      index,
      query: {
        bool: {
          must_not: [
            {
              nested: {
                path: 'metadata',
                query: {
                  term: { 'metadata.deleted': true },
                },
              },
            },
          ],
        },
      },
      _source: false,
      fields: ['id'],
      size: 10,
    });

    expect(result.hits.hits).toHaveLength(2);
    expect(result.hits.hits.map((hit: any) => hit._id).sort()).toEqual([
      '1',
      '2',
    ]);
  });

  it('should handle bool query with multiple nested conditions', async () => {
    // First, verify the test data is as expected
    const allDocs = await client.search({
      index,
      query: { match_all: {} },
      _source: false,
      fields: ['id'],
      size: 10,
    });

    // The test is looking for a document where:
    // 1. category.id is 'cat1'
    // 2. author.name is 'John Doe'
    // 3. metadata.deleted is not true
    // This should match document with _id '1'

    const query = processor.processNestedFields({
      bool: {
        must: [
          { term: { 'category->id': 'cat1' } },
          { match: { 'author->name': 'John Doe' } },
        ],
        must_not: [
          { term: { 'metadata->deleted': true } },
        ],
      },
    });

    const result = await client.search({
      index,
      query,
      _source: false,
      fields: ['id'],
      size: 10,
    });

    // Debug output (commented out in production)
    // console.log('Search results:', JSON.stringify(result.hits.hits, null, 2));

    // We expect document with _id '1' to match all conditions
    expect(result.hits.hits).toHaveLength(1);
    // Type assertion for test assertion
    const hits = result.hits.hits as Array<{ _id: string }>;
    expect(hits[0]._id).toBe('1');
  });

  it('should handle must_not with nested queries', async () => {
    // Create a bool query with nested conditions using arrow notation
    const query = processor.processNestedFields({
      bool: {
        must: [
          { term: { 'category->id': 'cat1' } },
        ],
        must_not: [
          { term: { 'metadata->deleted': true } },
        ],
      },
    });

    const result = await client.search({
      index,
      query,
      _source: false,
      fields: ['id'],
      size: 10,
    });

    expect(result.hits.hits).toHaveLength(1);
    // Type assertion for test assertion
    const hits = result.hits.hits as Array<{ _id: string }>;
    expect(hits[0]._id).toBe('1');
  });

  it('should handle exists query on nested fields', async () => {
    // Create an exists query with arrow notation
    const query = processor.processNestedFields({
      exists: { field: 'metadata->tags' },
    });

    const result = await client.search({
      index,
      query,
      _source: false,
      fields: ['id'],
      size: 10,
    });

    // All three test documents have metadata.tags
    expect(result.hits.hits).toHaveLength(3);
  });

  it('should handle match query on nested fields', async () => {
    // Create a match query with arrow notation
    const query = processor.processNestedFields({
      match: { 'author->name': 'John' },
    });

    const result = await client.search({
      index,
      query,
      _source: false,
      fields: ['id'],
      size: 10,
    });

    // Documents 1 and 3 have author.name 'John Doe'
    expect(result.hits.hits).toHaveLength(2);
    expect(result.hits.hits.map((hit: any) => hit._id).sort()).toEqual([
      '1',
      '3',
    ]);
  });

  it('should handle range query on nested fields', async () => {
    // First, add a document with a nested numeric field for testing range queries
    await client.index({
      index,
      id: 'doc-range',
      document: {
        title: 'Document with Price',
        price: {
          amount: 199.99,
          currency: 'USD'
        },
        metadata: {
          created_at: '2023-01-15T00:00:00Z'
        }
      },
      refresh: true
    });

    // Test range query on nested numeric field
    const priceQuery = processor.processNestedFields({
      range: { 'price->amount': { gte: 150, lte: 200 } }
    });

    // Ensure we have a single query container, not an array
    const query = Array.isArray(priceQuery) ? { bool: { must: priceQuery } } : priceQuery;

    const priceResult = await client.search({
      index,
      query,
      _source: ['title', 'price.amount']
    });

    expect(priceResult.hits.hits.length).toBe(1);
    expect(priceResult.hits.hits[0]._source).toMatchObject({
      title: 'Document with Price',
      price: { amount: 199.99 }
    });

    // Test range query on nested date field
    const dateQuery = processor.processNestedFields({
      range: { 'metadata->created_at': { gte: '2023-01-01T00:00:00Z', lte: '2023-12-31T23:59:59Z' } }
    });

    const dateResult = await client.search({
      index,
      query: dateQuery,
      _source: ['title']
    });

    expect(dateResult.hits.hits.length).toBe(1);
    expect(dateResult.hits.hits[0]._source).toMatchObject({
      title: 'Document with Price'
    });
  });

  it('should handle multi_match query with nested fields', async () => {
    // Add a document with text fields for testing multi_match
    await client.index({
      index,
      id: 'doc-multimatch',
      document: {
        title: 'Multi-match Test Document',
        content: 'This is a test document for multi-match queries',
        metadata: {
          keywords: ['test', 'document', 'multi-match'],
          description: 'A document to test multi-match functionality'
        }
      },
      refresh: true
    });

    // Test multi_match with nested and non-nested fields
    const query = processor.processNestedFields({
      multi_match: {
        query: 'test document',
        fields: ['title', 'content', 'metadata->keywords', 'metadata->description']
      }
    });

    const result = await client.search({
      index,
      query,
      _source: ['title']
    });

    const doc = result.hits.hits.find((hit: any) => hit._id === 'doc-multimatch');
    expect(doc).toBeDefined();
    expect(doc?._source).toMatchObject({
      title: 'Multi-match Test Document'
    });
  });

  it('should handle multi_match with wildcard fields', async () => {
    // Test multi_match with wildcard for nested fields
    const query = processor.processNestedFields({
      multi_match: {
        query: 'test',
        fields: ['title', 'metadata->keywords']
      }
    });

    const result = await client.search({
      index,
      query,
      _source: ['title']
    });

    // Should find our test document
    const doc = result.hits.hits.find((hit: any) => hit._id === 'doc-multimatch');
    expect(doc).toBeDefined();
    
    if (doc) {
      expect(doc._source).toMatchObject({
        title: 'Multi-match Test Document'
      });
    }
  });
});
