import { estypes } from '@elastic/elasticsearch';
import { ElasticsearchType } from '../types';

/**
 * Convert a schema object to Elasticsearch mapping properties
 */
export default function schemaToMappings<Schema>(
  schema: Schema,
  analyzerName: string = 'englishplus'
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
        properties: schemaToMappings(typeOrObject, analyzerName),
      };
    }
  }

  return properties;
}

/**
 * Convert a schema type to Elasticsearch mapping property
 */
function getPropertyType(
  type: ElasticsearchType,
  analyzerName: string
): estypes.MappingProperty {
  switch (type) {
    case 'keyword':
      return {
        type: 'text',
        fields: {
          keyword: {
            type: 'keyword',
            ignore_above: 256,
          },
        },
      };
    case 'text':
      return {
        type: 'text',
        analyzer: analyzerName,
      };
  }
  return { type };
}
