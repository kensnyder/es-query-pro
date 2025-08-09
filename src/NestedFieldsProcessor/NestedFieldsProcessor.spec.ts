import { describe, expect, it } from 'bun:test';
import NestedFieldsProcessor from './NestedFieldsProcessor';
import { estypes } from '@elastic/elasticsearch';

describe('NestedFieldsProcessor', () => {
  describe('with default separator', () => {
    const processor = new NestedFieldsProcessor();

    it('should create a simple nested query', () => {
      const query = { term: { 'category->id': '123' } };
      const result = processor.createNestedQuery(query);

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
      const query = { exists: { field: 'category->id' } };
      const result = processor.createNestedQuery(query);

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

    it('should handle must_not with ignore_unmapped', () => {
      const query = { exists: { field: 'metadata->tags' } };
      const result = processor.createNestedQuery(query, true);

      expect(result).toEqual({
        nested: {
          ignore_unmapped: true,
          path: 'metadata',
          query: {
            exists: {
              field: 'metadata.tags',
            },
          },
        },
      });
    });

    it('should process a simple query with nested fields', () => {
      const query = {
        term: { 'author->name': 'John' },
      };
      const result = processor.processNestedFields(query);

      expect(result).toEqual({
        nested: {
          path: 'author',
          query: {
            term: {
              'author.name': 'John',
            },
          },
        },
      });
    });

    it('should process a bool query with multiple nested conditions', () => {
      const query = {
        bool: {
          must: [
            { term: { 'category->id': 'cat1' } },
            { match: { 'author->name': 'John' } },
          ],
        },
      };

      const result = processor.processNestedFields(query);

      expect(result).toEqual({
        bool: {
          must: [
            {
              nested: {
                path: 'category',
                query: {
                  term: { 'category.id': 'cat1' },
                },
              },
            },
            {
              nested: {
                path: 'author',
                query: {
                  match: { 'author.name': 'John' },
                },
              },
            },
          ],
        },
      });
    });
  });

  describe('with custom separator', () => {
    const processor = new NestedFieldsProcessor('.');

    it('should use the custom separator for field paths', () => {
      const query = { term: { 'category.id': '123' } };
      const result = processor.createNestedQuery(query);

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

    it('should process a query with the custom separator', () => {
      const query = {
        term: { 'author.name': 'John' },
      };
      const result = processor.processNestedFields(query);

      expect(result).toEqual({
        nested: {
          path: 'author',
          query: {
            term: {
              'author.name': 'John',
            },
          },
        },
      });
    });
  });

  describe('range queries', () => {
    const processor = new NestedFieldsProcessor();

    it('should handle range queries with gt', () => {
      const query = { range: { 'price->amount': { gt: 100 } } };
      const result = processor.processNestedFields(query);

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
          'date->timestamp': {
            gte: '2023-01-01',
            lte: '2023-12-31',
          },
        },
      };
      const result = processor.processNestedFields(query);

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
  });

  describe('multi_match queries', () => {
    const processor = new NestedFieldsProcessor();

    it('should handle multi_match queries with nested fields', () => {
      const query = {
        multi_match: {
          query: 'search term',
          fields: ['title', 'content', 'metadata->keywords']
        }
      };
      
      const result = processor.processNestedFields(query);
      
      expect(result).toEqual({
        bool: {
          should: [
            { 
              multi_match: { 
                query: 'search term', 
                fields: ['title', 'content']
              } 
            },
            {
              nested: {
                path: 'metadata',
                query: {
                  multi_match: {
                    query: 'search term',
                    fields: ['metadata.keywords']
                  }
                }
              }
            }
          ]
        }
      });
    });

    it('should handle multi_match with wildcard fields', () => {
      const query = {
        multi_match: {
          query: 'search term',
          fields: ['title', 'content', 'metadata->*']
        }
      };
      
      const result = processor.processNestedFields(query);
      
      expect(result).toEqual({
        bool: {
          should: [
            { 
              multi_match: { 
                query: 'search term', 
                fields: ['title', 'content']
              } 
            },
            {
              nested: {
                path: 'metadata',
                query: {
                  multi_match: {
                    query: 'search term',
                    fields: ['metadata.*']
                  }
                }
              }
            }
          ]
        }
      });
    });
  });
});
