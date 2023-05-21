/**
 * Convert shorthand schema format to ElasticSearch mappings
 * @param {Object} schema  name-type pairs
 * @returns {Object}  Object suitable for setting ElasticSearch mappings
 */
function schemaToMappings(schema) {
  const properties = {};
  for (const [name, type] of Object.entries(schema)) {
    if (type.includes('.')) {
      const [main, format] = type.split('.');
      if (format === 'unsearchable') {
        if (main === 'object') {
          properties[name] = { type: main, enabled: false };
        } else {
          properties[name] = { type: main, index: false };
        }
      } else {
        properties[name] = { type: main, format };
      }
    } else if (type === 'fulltext') {
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
      properties[name] = { type };
    }
  }
  return { properties };
}

module.exports = schemaToMappings;