import { describe, expect, it } from 'bun:test';
import NestedFieldsProcessor from './NestedFieldsProcessor';

describe('NestedFieldsProcessor', () => {
  describe('with default separator', () => {
    const processor = new NestedFieldsProcessor();

    it('should create a simple nested query', () => {
      const query = { term: { 'category->id': '123' } };
      const result = processor.createNestedQuery('category->id', query);

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
      const result = processor.createNestedQuery('category->id', query);

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
      const result = processor.createNestedQuery('metadata->tags', query, true);

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
      const result = processor.createNestedQuery('category.id', query);

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
});
