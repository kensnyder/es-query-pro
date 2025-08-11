import { describe, expect, it } from 'bun:test';
import NestedFieldsProcessor from './NestedFieldsProcessor';

describe('NestedFieldsProcessor', () => {
  const processor = new NestedFieldsProcessor('/');

  it('should create a simple non-nested query', () => {
    const query = { term: { country: 'United Kingdom' } };
    const result = processor.process(query);

    expect(result).toEqual(query);
  });

  it('should create a simple non-nested query with bool', () => {
    const query = {
      bool: { should: [{ term: { country: 'United Kingdom' } }] },
    };
    const result = processor.process(query);

    expect(result).toEqual(query);
  });

  it('should recurse with extra bools', () => {
    const query = {
      bool: {
        should: { bool: { should: [{ term: { country: 'United Kingdom' } }] } },
      },
    };
    const result = processor.process(query);

    expect(result).toEqual(query);
  });

  it('should recurse with array fields', () => {
    const query = {
      bool: { should: [{ terms: { heroes: ['Harry Potter'] } }] },
    };
    const result = processor.process(query);

    expect(result).toEqual(query);
  });

  it('should create a simple nested query', () => {
    const query = { term: { 'category/id': '123' } };
    const result = processor.process(query);

    expect(result).toEqual({
      nested: {
        path: 'category',
        query: {
          term: {
            'category.id': '123',
          },
        },
      },
    });
  });

  it('should create a nested query with exists', () => {
    const query = { exists: { field: 'publishing/organization' } };
    const result = processor.process(query);

    expect(result).toEqual({
      nested: {
        path: 'publishing',
        query: {
          exists: {
            field: 'publishing.organization',
          },
        },
      },
    });
  });

  it('should handle range queries with gt', () => {
    const query = { range: { 'publishing/year': { gt: 2000 } } };
    const result = processor.process(query);

    expect(result).toEqual({
      nested: {
        path: 'publishing',
        query: {
          range: {
            'publishing.year': {
              gt: 2000,
            },
          },
        },
      },
    });
  });

  it('should process range queries with multiple conditions', () => {
    const query = { range: { 'publishing/year': { gte: 1999, lt: 2000 } } };
    const result = processor.process(query);

    expect(result).toEqual({
      nested: {
        path: 'publishing',
        query: {
          range: {
            'publishing.year': { gte: 1999, lt: 2000 },
          },
        },
      },
    });
  });

  it('should process multi_match queries with one nested field', () => {
    const query = {
      multi_match: {
        query: 'Coming',
        fields: ['categories/name'],
      },
    };

    const result = processor.process(query);

    expect(result).toEqual({
      nested: {
        path: 'categories',
        query: {
          multi_match: {
            query: 'Coming',
            fields: ['categories.name'],
          },
        },
      },
    });
  });

  it('should handle multi_match queries with a mix of fields', () => {
    const query = {
      multi_match: {
        query: 'uncover',
        type: 'phrase',
        fields: ['premise', 'categories/name'],
      },
    };

    const result = processor.process(query);

    expect(result).toEqual({
      bool: {
        should: [
          {
            multi_match: {
              query: 'uncover',
              type: 'phrase',
              fields: ['premise'],
            },
          },
          {
            nested: {
              path: 'categories',
              query: {
                multi_match: {
                  query: 'uncover',
                  type: 'phrase',
                  fields: ['categories.name'],
                },
              },
            },
          },
        ],
      },
    });
  });

  it('should handle range plus nested multi_match', () => {
    const query = {
      range: { price: { gt: 100 } },
      multi_match: {
        fields: ['metadata/keywords'],
        query: 'search term',
      },
    };

    const result = processor.process(query);

    expect(result).toEqual({
      range: { price: { gt: 100 } },
      nested: {
        path: 'metadata',
        query: {
          multi_match: {
            query: 'search term',
            fields: ['metadata.keywords'],
          },
        },
      },
    });
  });

  it('should handle multi_match with multiple path types', () => {
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

    const result = processor.process(query);

    expect(result).toEqual({
      bool: {
        should: [
          {
            multi_match: {
              query: 'Bloomsbury',
              fields: ['title', 'premise'],
            },
          },
          {
            nested: {
              path: 'categories',
              query: {
                multi_match: {
                  query: 'Bloomsbury',
                  fields: ['categories.name'],
                },
              },
            },
          },
          {
            nested: {
              path: 'publishing',
              query: {
                multi_match: {
                  query: 'Bloomsbury',
                  fields: ['publishing.organization'],
                },
              },
            },
          },
        ],
      },
    });
  });
});
