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
              organization: {
                type: 'text',
                analyzer: 'english',
                search_analyzer: 'english',
              },
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

  it('should handle multi_match with multiple path types', async () => {
    const query = {
      multi_match: {
        query: 'Bloomsbury',
        fields: [
          'title',
          'premise',
          'categories/name',
          'publishing/organization',
        ],
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
});
