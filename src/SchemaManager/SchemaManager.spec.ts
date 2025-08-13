import { describe, expect, it } from 'bun:test';
import SchemaManager from './SchemaManager';

describe('SchemaManager', () => {
  it('should handle named', () => {
    const schema = {
      tag: 'keyword',
    };
    const mgr = new SchemaManager(schema);
    expect(mgr.toMappings()).toEqual({
      properties: {
        tag: { type: 'keyword' },
      },
    });
  });
  it('should handle dots', () => {
    const schema = {
      created_at: 'date.epoch_second',
    };
    const mgr = new SchemaManager(schema);
    expect(mgr.toMappings()).toEqual({
      properties: {
        created_at: { type: 'date', format: 'epoch_second' },
      },
    });
  });
  it('should handle fulltext', () => {
    const schema = {
      content_description: 'text',
    };
    const mgr = new SchemaManager(schema);
    expect(mgr.toMappings()).toEqual({
      properties: {
        content_description: {
          type: 'text',
          fields: {
            exact: {
              type: 'text',
              analyzer: 'standard',
            },
            fulltext: {
              type: 'text',
              analyzer: 'english',
            },
          },
          term_vector: 'with_positions_offsets',
        },
      },
    });
  });
});
