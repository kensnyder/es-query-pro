import { describe, expect, it } from 'bun:test';
import NestedFieldsProcessor from './NestedFieldsProcessor';

describe('NestedFieldsProcessor', () => {
  const processor = new NestedFieldsProcessor('.');

  it('should create a simple nested query', () => {
    const query = { term: { 'category.id': '123' } };
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
    const query = { exists: { field: 'category.id' } };
    const result = processor.process(query);

    expect(result).toEqual({
      nested: {
        path: 'category',
        query: {
          exists: {
            field: 'category.id',
          },
        },
      },
    });
  });
  //
  //   it('should process a bool query with multiple nested conditions', () => {
  //     const query = {
  //       bool: {
  //         must: [
  //           { term: { 'category->id': 'cat1' } },
  //           { match: { 'author->name': 'John' } },
  //         ],
  //       },
  //     };
  //
  //     const result = processor.processNestedFields(query);
  //
  //     expect(result).toEqual({
  //       bool: {
  //         must: [
  //           {
  //             nested: {
  //               path: 'category',
  //               query: {
  //                 term: { 'category.id': 'cat1' },
  //               },
  //             },
  //           },
  //           {
  //             nested: {
  //               path: 'author',
  //               query: {
  //                 match: { 'author.name': 'John' },
  //               },
  //             },
  //           },
  //         ],
  //       },
  //     });
  //   });
  //

  it('should handle range queries with gt', () => {
    const query = { range: { 'price.amount': { gt: 100 } } };
    const result = processor.process(query);

    expect(result).toEqual({
      nested: {
        path: 'price',
        query: {
          range: {
            'price.amount': {
              gt: 100,
            },
          },
        },
      },
    });
  });

  it('should handle range queries with multiple conditions', () => {
    const query = {
      range: {
        'date.timestamp': {
          gte: '2023-01-01',
          lte: '2023-12-31',
        },
      },
    };
    const result = processor.process(query);

    expect(result).toEqual({
      nested: {
        path: 'date',
        query: {
          range: {
            'date.timestamp': {
              gte: '2023-01-01',
              lte: '2023-12-31',
            },
          },
        },
      },
    });
  });

  it('should handle multi_match queries with one nested field', () => {
    const query = {
      multi_match: {
        query: 'search term',
        fields: ['metadata.keywords'],
      },
    };

    const result = processor.process(query);

    expect(result).toEqual({
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

  it('should handle multi_match queries with a mix of fields', () => {
    const query = {
      multi_match: {
        query: 'search term',
        fields: ['title', 'metadata.keywords'],
      },
    };

    const result = processor.process(query);

    expect(result).toEqual({
      bool: {
        should: [
          {
            multi_match: {
              query: 'search term',
              fields: ['title'],
            },
          },
          {
            nested: {
              path: 'metadata',
              query: {
                multi_match: {
                  query: 'search term',
                  fields: ['metadata.keywords'],
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
        fields: ['metadata.keywords'],
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

  it('should handle multi_match with multiple paths', () => {
    const query = {
      multi_match: {
        query: 'search term',
        fields: [
          'title',
          'content',
          'tags.name',
          'tags.description',
          'metadata.*',
        ],
      },
    };

    const result = processor.process(query);

    expect(result).toEqual({
      bool: {
        should: [
          {
            multi_match: {
              query: 'search term',
              fields: ['title', 'content'],
            },
          },
          {
            nested: {
              path: 'tags',
              query: {
                multi_match: {
                  query: 'search term',
                  fields: ['tags.name', 'tags.description'],
                },
              },
            },
          },
          {
            nested: {
              path: 'metadata',
              query: {
                multi_match: {
                  query: 'search term',
                  fields: ['metadata.*'],
                },
              },
            },
          },
        ],
      },
    });
  });
});
