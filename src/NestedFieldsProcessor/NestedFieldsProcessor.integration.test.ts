import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import getEsClient from '../getEsClient/getEsClient';
import {
  createBooksIndex,
  deleteBooksIndex,
  insertBooksData,
} from '../testFixtures/books';
import NestedFieldsProcessor from './NestedFieldsProcessor';

describe('NestedFieldsProcessor - Integration Tests', () => {
  const index = `test_nested_${Date.now()}`;
  const client = getEsClient();
  const processor = new NestedFieldsProcessor('/');

  beforeAll(async () => {
    await deleteBooksIndex(index);
    await createBooksIndex(index);
    await insertBooksData(index);
  });

  afterAll(async () => {
    await deleteBooksIndex(index);
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
