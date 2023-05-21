const schemaToMappings = require('./schemaToMappings.js');

describe('schemaToMapping', () => {
  it('should handle named', () => {
    const schema = {
      tag: 'keyword',
    };
    const mappings = schemaToMappings(schema);
    expect(mappings).toEqual({
      properties: {
        tag: { type: 'keyword' },
      },
    });
  });
  it('should handle dots', () => {
    const schema = {
      created_at: 'date.epoch_second',
    };
    const mappings = schemaToMappings(schema);
    expect(mappings).toEqual({
      properties: {
        created_at: { type: 'date', format: 'epoch_second' },
      },
    });
  });
  it('should handle unsearchable', () => {
    const schema = {
      source_code: 'keyword.unsearchable',
    };
    const mappings = schemaToMappings(schema);
    expect(mappings).toEqual({
      properties: {
        source_code: { type: 'keyword', enabled: false },
      },
    });
  });
  it('should handle fulltext', () => {
    const schema = {
      content_description: 'fulltext',
    };
    const mappings = schemaToMappings(schema);
    expect(mappings).toEqual({
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
              analyzer: 'englishplus',
            },
          },
          term_vector: 'with_positions_offsets',
        },
      },
    });
  });
});