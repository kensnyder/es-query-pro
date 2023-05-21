// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'schemaToMa... Remove this comment to see the full error message
const schemaToMappings = require('./schemaToMappings.js');

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('schemaToMapping', () => {
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should handle named', () => {
    const schema = {
      tag: 'keyword',
    };
    const mappings = schemaToMappings(schema);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(mappings).toEqual({
      properties: {
        tag: { type: 'keyword' },
      },
    });
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should handle dots', () => {
    const schema = {
      created_at: 'date.epoch_second',
    };
    const mappings = schemaToMappings(schema);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(mappings).toEqual({
      properties: {
        created_at: { type: 'date', format: 'epoch_second' },
      },
    });
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should handle unsearchable', () => {
    const schema = {
      source_code: 'keyword.unsearchable',
    };
    const mappings = schemaToMappings(schema);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(mappings).toEqual({
      properties: {
        source_code: { type: 'keyword', enabled: false },
      },
    });
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should handle fulltext', () => {
    const schema = {
      content_description: 'fulltext',
    };
    const mappings = schemaToMappings(schema);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
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
