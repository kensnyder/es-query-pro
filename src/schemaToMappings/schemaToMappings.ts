import { estypes } from '@elastic/elasticsearch';
import { ElasticsearchType } from '../types';

/**
 * Convert a schema object to Elasticsearch mapping properties
 */
export default function schemaToMappings<Schema>(
  schema: Schema,
  analyzerName: string = 'englishplus',
  isRoot: boolean = true
) {
  const properties: estypes.MappingProperty = {};

  for (const [field, typeOrObject] of Object.entries(schema)) {
    if (typeof typeOrObject === 'string') {
      // Simple field with type
      properties[field] = getPropertyType(
        typeOrObject as ElasticsearchType,
        analyzerName
      );
    } else if (typeof typeOrObject === 'object' && typeOrObject !== null) {
      // Nested object
      properties[field] = {
        type: 'nested',
        properties: schemaToMappings(typeOrObject, analyzerName, false),
      };
    }
  }

  // Only wrap in properties object for the root level to match test expectations
  return isRoot ? { properties } : properties;
}

/**
 * Convert a schema type to Elasticsearch mapping property
 */
function getPropertyType(
  type: ElasticsearchType,
  analyzerName: string
): estypes.MappingProperty {
  // Handle date format like 'date.epoch_second'
  if (typeof type === 'string' && type.startsWith('date.')) {
    const [, format] = type.split('.');
    return { type: 'date', format };
  }

  switch (type) {
    case 'keyword':
      return { type: 'keyword' };
    case 'text':
      return {
        type: 'text',
        analyzer: analyzerName,
      };
    case 'fulltext':
      return {
        type: 'text',
        term_vector: 'with_positions_offsets',
        fields: {
          exact: {
            type: 'text',
            analyzer: 'standard',
          },
          fulltext: {
            type: 'text',
            analyzer: analyzerName,
          },
        },
      };
  }
  return { type };
}
