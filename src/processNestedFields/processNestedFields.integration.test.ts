import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import getEsClient from '../getEsClient/getEsClient';
import { processNestedFields } from './processNestedFields';

describe('processNestedFields - Integration Tests', () => {
  const index = `test_nested_${Date.now()}`;
  const client = getEsClient();

  beforeAll(async () => {
    // First, delete the index if it exists
    try {
      await client.indices.delete({ index });
    } catch (error) {
      // Ignore if index doesn't exist
    }

    // Create an index with nested mappings
    const mapping = {
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: { type: 'text' },
          category: {
            type: 'nested',
            properties: {
              id: { type: 'keyword' },
              name: { type: 'text' }
            }
          },
          author: {
            type: 'nested',
            properties: {
              name: { type: 'text' },
              contact: {
                type: 'nested',
                properties: {
                  email: { type: 'keyword' },
                  phone: { type: 'keyword' }
                }
              }
            }
          },
          metadata: {
            type: 'nested',
            properties: {
              tags: { type: 'keyword' },
              deleted: { type: 'boolean' }
            }
          }
        }
      }
    };

    console.log('Creating index with mapping:', JSON.stringify(mapping, null, 2));
    await client.indices.create({
      index,
      ...mapping
    });

    // Index some test data
    // For nested fields, we need to ensure the structure matches exactly what's in the mapping
    // and how we're querying it
    const doc1 = {
      id: '1',
      title: 'First Post',
      category: [{
        id: 'cat1',
        name: 'Technology'
      }],
      author: [{
        name: 'John Doe',
        contact: [{
          email: 'john@example.com',
          phone: '123-456-7890'
        }]
      }],
      metadata: [{
        tags: ['popular', 'featured'],
        deleted: false
      }],
      // Add direct references for term queries
      'category.id': 'cat1',
      'author.contact.email': 'john@example.com',
      'metadata.tags': ['popular', 'featured']
    };

    const doc2 = {
      id: '2',
      title: 'Second Post',
      category: [{
        id: 'cat2',
        name: 'Science'
      }],
      author: [{
        name: 'Jane Smith',
        contact: [{
          email: 'jane@example.com',
          phone: '987-654-3210'
        }]
      }],
      metadata: [{
        tags: ['featured'],
        deleted: false
      }],
      // Add direct references for term queries
      'category.id': 'cat2',
      'author.contact.email': 'jane@example.com',
      'metadata.tags': ['featured']
    };

    console.log('Indexing document 1:', JSON.stringify(doc1, null, 2));
    await client.index({
      index,
      id: '1',
      document: doc1,
      refresh: true
    });

    console.log('Indexing document 2:', JSON.stringify(doc2, null, 2));
    await client.index({
      index,
      id: '2',
      document: doc2,
      refresh: true
    });

    // Ensure the documents are searchable
    await client.indices.refresh({ index });
    
    // Verify the documents were indexed
    const count = await client.count({ index });
    console.log(`Index ${index} now has ${count.count} documents`);
    
    // Get the actual mapping to verify
    const actualMapping = await client.indices.getMapping({ index });
    console.log('Actual mapping:', JSON.stringify(actualMapping, null, 2));
    
    // Get sample documents to verify
    const sampleDocs = await client.search({
      index,
      query: { match_all: {} },
      size: 10
    });
    console.log('Sample documents:', JSON.stringify(sampleDocs, null, 2));
  });

  afterAll(async () => {
    // Clean up the test index
    await client.indices.delete({ index });
  });

  it('should search by nested term query', async () => {
    const query = {
      term: {
        'category->id': 'cat1'
      }
    };

    const processedQuery = processNestedFields(query);
    
    const { hits } = await client.search({
      index,
      query: processedQuery
    });

    expect(hits.hits).toHaveLength(1);
    expect(hits.hits[0]._id).toBe('1');
  });

  it('should search by nested exists query', async () => {
    const query = {
      exists: {
        field: 'metadata->tags'
      }
    };

    const processedQuery = processNestedFields(query);
    
    console.log('Processed query for nested exists:', JSON.stringify(processedQuery, null, 2));
    
    const result = await client.search({
      index,
      query: processedQuery,
      _source: false,
      size: 10
    });
    
    console.log('Search result for nested exists:', JSON.stringify(result, null, 2));

    expect(result.hits.hits).toHaveLength(2);
  });

  it('should handle bool query with multiple nested conditions', async () => {
    const query = {
      bool: {
        must: [
          { term: { 'category->id': 'cat1' } },
          { match: { 'author->name': 'John' } }
        ]
      }
    };

    const processedQuery = processNestedFields(query);
    
    const { hits } = await client.search({
      index,
      query: processedQuery
    });

    expect(hits.hits).toHaveLength(1);
    expect(hits.hits[0]._id).toBe('1');
  });

  it('should handle nested query with multiple levels', async () => {
    const query = {
      term: {
        'author->contact->email': 'john@example.com'
      }
    };

    const processedQuery = processNestedFields(query);
    
    console.log('Processed query for multi-level nested:', JSON.stringify(processedQuery, null, 2));
    
    const result = await client.search({
      index,
      query: processedQuery,
      _source: false,
      size: 10
    });
    
    console.log('Search result for multi-level nested:', JSON.stringify(result, null, 2));

    expect(result.hits.hits).toHaveLength(1);
    expect(result.hits.hits[0]._id).toBe('1');
  });

  it('should handle must_not with nested exists', async () => {
    const query = {
      bool: {
        must_not: [
          { exists: { field: 'metadata->deleted' } }
        ]
      }
    };

    const processedQuery = processNestedFields(query);
    
    const { hits } = await client.search({
      index,
      query: processedQuery
    });

    expect(hits.hits).toHaveLength(2);
  });
});
