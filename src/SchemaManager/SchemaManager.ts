import {
  ElasticsearchType,
  MappingProperty,
  Mappings,
  SchemaShape,
} from '../types';

export default class SchemaManager<Schema = SchemaShape> {
  public schema: Schema;
  public nestedSeparator: string;
  public mappings: Mappings;

  constructor({
    schema = {} as Schema,
    nestedSeparator = '/',
    mappings = {} as Mappings,
  }: {
    schema?: Schema;
    nestedSeparator?: string;
    mappings?: Mappings;
  }) {
    this.schema = schema;
    this.nestedSeparator = nestedSeparator;
    this.mappings = mappings;
  }

  toMappings() {
    // Wrap the result in a properties object to match the expected structure
    return {
      properties: {
        ...this._schemaToMappings(this.schema),
        ...this.mappings,
      },
    };
  }

  private _schemaToMappings<T>(
    schema: T,
    analyzerName: string = 'english'
  ): Mappings {
    const properties: Mappings = {};

    for (const [field, typeOrObject] of Object.entries(schema)) {
      if (typeof typeOrObject === 'string') {
        // Simple field with type
        properties[field] = this.getPropertyType(
          typeOrObject as ElasticsearchType,
          analyzerName
        );
      } else if (typeof typeOrObject === 'object' && typeOrObject !== null) {
        // Nested object - don't wrap in properties for nested objects
        const nestedMappings = this._schemaToNestedMappings(
          typeOrObject,
          analyzerName
        );
        properties[field] = {
          type: 'nested',
          ...nestedMappings,
        };
      }
    }
    return properties;
  }

  private _schemaToNestedMappings<T>(
    schema: T,
    analyzerName: string = 'english'
  ): { properties: Mappings } {
    const properties: Mappings = {};

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
          ...this._schemaToNestedMappings(typeOrObject, analyzerName),
        };
      }
    }

    return { properties };
  }

  getAllFieldsFromSchema(data: Schema): string[] {
    const allFields: string[] = [];
    for (const [field, typeOrObject] of Object.entries(data)) {
      if (typeof typeOrObject === 'string') {
        allFields.push(field);
      } else if (typeof typeOrObject === 'object' && typeOrObject !== null) {
        allFields.push(...this.getAllFieldsFromSchema(typeOrObject));
      }
    }
    return allFields;
  }

  getAllFields() {
    const allFields = this.getAllFieldsFromSchema(this.schema);
    allFields.push(...Object.keys(this.mappings));
    return allFields;
  }

  getFulltextFieldsFromSchema(data: Schema, _path: string[] = []) {
    const fulltextFields: string[] = [];
    for (const [field, typeOrObject] of Object.entries(data)) {
      if (typeOrObject === 'text') {
        fulltextFields.push([..._path, field].join(this.nestedSeparator));
      } else if (typeof typeOrObject === 'object' && typeOrObject !== null) {
        fulltextFields.push(
          ...this.getFulltextFieldsFromSchema(typeOrObject, [..._path, field])
        );
      }
    }
    return fulltextFields;
  }

  getFulltextFields() {
    const fields = this.getFulltextFieldsFromSchema(this.schema);
    const textSearchTypes = [
      'text',
      'match_only_text',
      'completion',
      'search_as_you_type',
      'semantic_text',
      'token_count',
    ];
    for (const [field, mapping] of Object.entries(this.mappings)) {
      if (textSearchTypes.includes(mapping.type)) {
        fields.push(field);
      }
    }
    return fields;
  }

  getPropertyType(type: string, analyzerName: string): MappingProperty {
    // Handle date format like 'date.epoch_second'
    if (typeof type === 'string' && type.startsWith('date.')) {
      const [, format] = type.split('.');
      return { type: 'date', format };
    }

    switch (type) {
      case 'text':
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
