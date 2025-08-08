import { estypes } from '@elastic/elasticsearch';
import { ElasticsearchType, SchemaShape } from '../types';

export default class SchemaManager<Schema = SchemaShape> {
  public schema: Schema;

  constructor(schema: Schema) {
    this.schema = schema;
  }

  toMappings() {
    return this.schemaToMappings(this.schema);
  }

  private schemaToMappings<T>(schema: T, analyzerName: string = 'englishplus') {
    const properties: estypes.MappingProperty = {};

    for (const [field, typeOrObject] of Object.entries(schema)) {
      if (typeof typeOrObject === 'string') {
        // Simple field with type
        properties[field] = this.getPropertyType(
          typeOrObject as ElasticsearchType,
          analyzerName
        );
      } else if (typeof typeOrObject === 'object' && typeOrObject !== null) {
        // Nested object
        properties[field] = {
          type: 'nested',
          properties: this.schemaToMappings(typeOrObject, analyzerName),
        };
      }
    }
    return properties;
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
    type: ElasticsearchType,
    analyzerName: string
  ): estypes.MappingProperty {
    switch (type) {
      case 'keyword':
        // return {
        //   type: 'text',
        //   fields: {
        //     keyword: {
        //       type: 'keyword',
        //       ignore_above: 256,
        //     },
        //   },
        // };
        return {
          type: 'keyword',
          ignore_above: 256,
        };
      case 'text':
        return {
          type: 'text',
          analyzer: analyzerName,
        };
    }
    return { type };
  }
}
