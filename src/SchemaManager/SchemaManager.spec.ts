import { describe, expect, it } from 'bun:test';
import SchemaManager from './SchemaManager';

describe('SchemaManager', () => {
  it('should handle named', () => {
    const schema = {
      tag: 'keyword',
    };
    const mgr = new SchemaManager({ schema });
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
    const mgr = new SchemaManager({ schema });
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
    const mgr = new SchemaManager({ schema });
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
  it('should get fullText fields and all fields', () => {
    const schema = {
      title: 'keyword',
      description: 'text',
    };
    const mappings = {
      drugName: {
        type: 'text' as const,
        analyzer: 'drug_name_index',
        search_analyzer: 'drug_name_search',
        fields: {
          phonetic: {
            type: 'text' as const,
            analyzer: 'drug_name_phonetic',
            search_analyzer: 'drug_name_phonetic',
          },
        },
      },
    };
    const mgr = new SchemaManager({ schema, mappings });
    expect(mgr.getAllFields()).toEqual(['title', 'description', 'drugName']);
    expect(mgr.getFulltextFields()).toEqual(['description','drugName']);
  });
  it('should handle nesting', () => {
    const schema = {
      title: 'keyword',
      user: {
        email: 'keyword',
        name: 'keyword',
      },
    };

    const mgr = new SchemaManager({ schema });
    expect(mgr.toMappings()).toEqual({
      properties: {
        title: { type: 'keyword' },
        user: {
          type: 'nested',
          properties: {
            email: { type: 'keyword' },
            name: { type: 'keyword' },
          },
        },
      },
    });
  });
  it('should handle custom properties', () => {
    const schema = {
      createdAt: 'date',
    };
    const mappings = {
      drugName: {
        type: 'text' as const,
        analyzer: 'drug_name_index',
        search_analyzer: 'drug_name_search',
        fields: {
          phonetic: {
            type: 'text' as const,
            analyzer: 'drug_name_phonetic',
            search_analyzer: 'drug_name_phonetic',
          },
        },
      },
    };
    const mgr = new SchemaManager({ schema, mappings });
    expect(mgr.toMappings()).toEqual({
      properties: {
        createdAt: { type: 'date' },
        drugName: {
          type: 'text',
          analyzer: 'drug_name_index',
          search_analyzer: 'drug_name_search',
          fields: {
            phonetic: {
              type: 'text',
              analyzer: 'drug_name_phonetic',
              search_analyzer: 'drug_name_phonetic',
            },
          },
        },
      },
    });
  });
});
