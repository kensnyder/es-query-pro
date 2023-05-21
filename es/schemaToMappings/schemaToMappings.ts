/**
 * Convert shorthand schema format to ElasticSearch mappings
 * @param {Object} schema  name-type pairs
 * @returns {Object}  Object suitable for setting ElasticSearch mappings
 */
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'schemaToMa... Remove this comment to see the full error message
function schemaToMappings(schema: any) {
  const properties = {};
  // @ts-expect-error TS(2550): Property 'entries' does not exist on type 'ObjectC... Remove this comment to see the full error message
  for (const [name, type] of Object.entries(schema)) {
    if (type.includes('.')) {
      const [main, format] = type.split('.');
      if (format === 'unsearchable') {
        if (main === 'object') {
          // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
          properties[name] = { type: main, enabled: false };
        } else {
          // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
          properties[name] = { type: main, index: false };
        }
      } else {
        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        properties[name] = { type: main, format };
      }
    } else if (type === 'fulltext') {
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      properties[name] = {
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
        // see https://www.elastic.co/guide/en/elasticsearch/reference/7.17/highlighting.html#fast-vector-highlighter
        // see https://www.elastic.co/guide/en/elasticsearch/reference/7.17/term-vector.html
        term_vector: 'with_positions_offsets',
      };
    } else {
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      properties[name] = { type };
    }
  }
  return { properties };
}

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = schemaToMappings;
