import { describe, expect, it } from 'bun:test';
import { createNestedQuery, processNestedFields } from './processNestedFields';

describe('createNestedQuery', () => {
  it('should create a simple nested query', () => {
    const query = { term: { field: 'category->id', value: '123' } };
    const result = createNestedQuery('category->id', query);

    expect(result).toEqual({
      nested: {
        path: 'category',
        query: {
          term: {
            field: 'category->id',
            value: '123',
          },
        },
      },
    });
  });

  it('should create a nested query with exists', () => {
    const query = { exists: { field: 'category->id' } };
    const result = createNestedQuery('category->id', query);

    expect(result).toEqual({
      nested: {
        path: 'category',
        query: {
          exists: {
            field: 'category->id',
          },
        },
      },
    });
  });

  it('should handle must_not with ignore_unmapped', () => {
    const query = { exists: { field: 'metadata->tags' } };
    const result = createNestedQuery('metadata->tags', query, true);

    expect(result).toEqual({
      nested: {
        ignore_unmapped: true,
        path: 'metadata',
        query: {
          exists: {
            field: 'metadata->tags',
          },
        },
      },
    });
  });
});

describe('processNestedFields', () => {
  it('should handle simple term query with nested field', () => {
    const query = {
      term: {
        'category->id': '123',
      },
    };

    const result = processNestedFields(query);

    expect(result).toEqual({
      nested: {
        path: 'category',
        query: {
          term: {
            'category->id': '123',
          },
        },
      },
    });
  });

  it('should handle multiple levels of nesting', () => {
    const query = {
      term: {
        'author->contact->email': 'test@example.com',
      },
    };

    const result = processNestedFields(query);

    expect(result).toEqual({
      nested: {
        path: 'author',
        query: {
          term: {
            'author->contact->email': 'test@example.com',
          },
        },
      },
    });
  });

  it('should handle bool queries with nested fields', () => {
    const query = {
      bool: {
        must: [
          { term: { 'category->id': '123' } },
          { match: { 'author->name': 'John' } },
        ],
        must_not: [{ exists: { field: 'metadata->deleted' } }],
      },
    };

    const result = processNestedFields(query);

    expect(result).toEqual({
      bool: {
        must: [
          {
            nested: {
              path: 'category',
              query: {
                term: { 'category->id': '123' },
              },
            },
          },
          {
            nested: {
              path: 'author',
              query: {
                match: { 'author->name': 'John' },
              },
            },
          },
        ],
        must_not: [
          {
            nested: {
              path: 'metadata',
              query: {
                exists: { field: 'metadata->deleted' },
              },
              ignore_unmapped: true,
            },
          },
        ],
      },
    });
  });

  it('should handle multi_match queries with nested fields', () => {
    const query = {
      multi_match: {
        query: 'search term',
        fields: ['title', 'author->name', 'category->name'],
      },
    };

    const result = processNestedFields(query);

    // It should pick the first nested field and create a nested query
    expect(result).toEqual({
      nested: {
        path: 'author',
        query: {
          multi_match: {
            query: 'search term',
            fields: ['title', 'author->name', 'category->name'],
          },
        },
      },
    });
  });

  it('should pass through non-nested fields unchanged', () => {
    const query = {
      term: {
        regular_field: 'value',
      },
    };

    const result = processNestedFields(query);
    expect(result).toEqual(query);
  });
});
