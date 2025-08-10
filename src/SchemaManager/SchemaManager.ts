import { estypes } from '@elastic/elasticsearch';
import { ElasticsearchType, SchemaShape } from '../types';

export default class SchemaManager<Schema = SchemaShape> {
  public schema: Schema;

  constructor(schema: Schema) {
    this.schema = schema;
  }

  toMappings() {
    // Wrap the result in a properties object to match the expected structure
    return { properties: this.schemaToMappings(this.schema) };
  }

  private schemaToMappings<T>(
    schema: T,
    analyzerName: string = 'englishplus'
  ): Record<string, estypes.MappingProperty> {
    const properties: Record<string, estypes.MappingProperty> = {};

    for (const [field, typeOrObject] of Object.entries(schema)) {
      if (typeof typeOrObject === 'string') {
        // Simple field with type
        properties[field] = this.getPropertyType(
          typeOrObject as ElasticsearchType,
          analyzerName
        );
      } else if (typeof typeOrObject === 'object' && typeOrObject !== null) {
        // Nested object - don't wrap in properties for nested objects
        const nestedMappings = this.schemaToNestedMappings(typeOrObject, analyzerName);
        properties[field] = {
          type: 'nested',
          ...nestedMappings,
        };
      }
    }
    return properties;
  }

  private schemaToNestedMappings<T>(
    schema: T,
    analyzerName: string = 'englishplus'
  ): { properties: Record<string, estypes.MappingProperty> } {
    const properties: Record<string, estypes.MappingProperty> = {};

    for (const [field, typeOrObject] of Object.entries(schema)) {
      if (typeof typeOrObject === 'string') {
        // Simple field with type
        properties[field] = this.getPropertyType(
          typeOrObject as ElasticsearchType,
          analyzerName
        );
      } else if (typeof typeOrObject === 'object' && typeOrObject !== null) {
        // Recursively handle nested objects
        properties[field] = {
          type: 'nested',
          ...this.schemaToNestedMappings(typeOrObject, analyzerName),
        };
      }
    }
    
    return { properties };
  }

  getAllFields(data = this.schema) {
    const allFields: string[] = [];
    for (const [field, typeOrObject] of Object.entries(data)) {
      if (typeof typeOrObject === 'string') {
        allFields.push(field);
      } else if (typeof typeOrObject === 'object' && typeOrObject !== null) {
        allFields.push(...this.getFulltextFields(typeOrObject));
      }
    }
    return allFields;
  }

  getFulltextFields(data = this.schema) {
    const fulltextFields: string[] = [];
    for (const [field, typeOrObject] of Object.entries(data)) {
      if (typeOrObject === 'text') {
        fulltextFields.push(field);
      } else if (typeof typeOrObject === 'object' && typeOrObject !== null) {
        fulltextFields.push(...this.getFulltextFields(typeOrObject));
      }
    }
    return fulltextFields;
  }

  getPropertyType(
    type: string,
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
      default:
        return { type: type as any };
    }
  }
}
