/**
 * Processes nested fields in Elasticsearch queries by converting '->' notation to nested queries
 */
import { estypes } from '@elastic/elasticsearch';

/**
 * Type helper for nested queries
 */
type NestedQuery = estypes.QueryDslNestedQuery;
type QueryContainer = estypes.QueryDslQueryContainer;
type BoolQuery = estypes.QueryDslBoolQuery;
type QueryWithField = 
  | { term: Record<string, unknown> }
  | { match: Record<string, unknown> }
  | { range: Record<string, unknown> }
  | { exists: { field: string } };

/**
 * Processes nested fields in Elasticsearch queries by converting '->' notation to nested queries
 */
export default class NestedFieldsProcessor {
  private fieldSeparator: string;

  /**
   * Creates a new NestedFieldsProcessor
   * @param fieldSeparator The separator used to denote nested fields (default: '->')
   */
  constructor(fieldSeparator: string = '->') {
    this.fieldSeparator = fieldSeparator;
  }

  /**
   * Process a field path with the configured separator and return the nested query structure
   * @template T - The type of the query (e.g., QueryDslQueryContainer)
   * @param fieldPath - The field path with nested fields separated by the configured separator
   * @param query - The query to be nested
   * @param isMustNot - Whether this is a 'must_not' context
   * @returns The query with nested structure applied
   */
  createNestedQuery<T extends estypes.QueryDslQueryContainer>(
    fieldPath: string,
    query: T,
    isMustNot: boolean = false
  ): estypes.QueryDslQueryContainer {
    const parts = fieldPath.split(this.fieldSeparator).map(part => part.trim());

    // Helper function to build a nested query with the given path and inner query
    const buildNestedQuery = (
      path: string,
      innerQuery: any,
      isOuter: boolean = false
    ) => {
      const nestedQuery: any = {
        nested: {
          path: path,
          query: innerQuery
        }
      };
      
      // Add ignore_unmapped for must_not context on the outermost query
      if (isMustNot && isOuter) {
        nestedQuery.nested.ignore_unmapped = true;
      }
      
      return nestedQuery;
    };
    
    // Helper function to create nested queries for each level of nesting
    const createNestedQueries = (fieldParts: string[], innerQuery: any) => {
      if (fieldParts.length === 1) {
        return innerQuery;
      }
      
      let currentQuery = innerQuery;
      
      // Start from the innermost level and work outwards
      for (let i = fieldParts.length - 1; i > 0; i--) {
        const isOuter = i === 1; // Only the outermost query should have ignore_unmapped
        const path = fieldParts.slice(0, i).join('.');
        currentQuery = buildNestedQuery(path, currentQuery, isOuter);
      }
      
      return currentQuery;
    };
    
    // Helper to get the field name from a field path
    const getFieldName = (fieldPath: string) => {
      const parts = fieldPath.split(this.fieldSeparator);
      return parts[parts.length - 1].trim();
    };

    // For exists queries
    if (query.exists) {
      const existsField = query.exists.field;
      
      // If the field path contains the separator, process it as a nested field
      if (existsField.includes(this.fieldSeparator)) {
        const fieldParts = existsField.split(this.fieldSeparator).map(part => part.trim());
        const fullFieldPath = fieldParts.join('.');
        
        // Create the innermost exists query with the full field path
        const innerQuery = {
          exists: {
            field: fieldParts.join('.')
          }
        };
        
        // Create nested queries for each level of nesting
        const result = createNestedQueries(fieldParts, innerQuery);
        
        // Add ignore_unmapped for must_not context
        if (isMustNot && result.nested) {
          result.nested.ignore_unmapped = true;
        }
        
        return result;
      }
      
      // For non-nested fields, return the query as-is
      return query;
    }

    // For term queries
    if (query.term) {
      const termField = Object.keys(query.term)[0];
      const termValue = query.term[termField];
      
      // If the field path contains the separator, process it as a nested field
      if (termField.includes(this.fieldSeparator)) {
        const fieldParts = termField.split(this.fieldSeparator).map(part => part.trim());
        const fullFieldPath = fieldParts.join('.');
        
        // Create the innermost term query with full field path
        const innerQuery = {
          term: {
            [fullFieldPath]: termValue
          }
        };
        
        // Create nested queries for each level of nesting
        return createNestedQueries(fieldParts, innerQuery);
      }
      
      // For non-nested fields, return the query as-is
      return query;
    }

    // For match queries
    if (query.match) {
      const matchField = Object.keys(query.match)[0];
      const matchValue = query.match[matchField];
      
      // If the field path contains the separator, process it as a nested field
      if (matchField.includes(this.fieldSeparator)) {
        const fieldParts = matchField.split(this.fieldSeparator).map(part => part.trim());
        const fullFieldPath = fieldParts.join('.');
        
        // Create the innermost match query with full field path
        const innerQuery = {
          match: {
            [fullFieldPath]: matchValue
          }
        };
        
        // Create nested queries for each level of nesting
        return createNestedQueries(fieldParts, innerQuery);
      }
      
      // For non-nested fields, return the query as-is
      return query;
    }

    // For range queries
    if (query.range) {
      const rangeField = Object.keys(query.range)[0];
      const rangeValue = query.range[rangeField];

      // If it's a multi-level nested path
      if (rangeField.includes(this.fieldSeparator)) {
        const fieldParts = rangeField.split(this.fieldSeparator).map(part => part.trim());
        const fullFieldPath = fieldParts.join('.');
        
        // Create the innermost range query with full field path
        const innerQuery = {
          range: {
            [fullFieldPath]: rangeValue,
          },
        };
        
        // Create nested queries for each level of nesting
        return createNestedQueries(fieldParts, innerQuery);
      }
      
      // For non-nested fields, return the query as-is
      return query;
    }

    // For bool queries
    if (query.bool) {
      const processedBool: any = {};

      // Process each bool clause type (must, must_not, should, filter)
      for (const clause of ['must', 'must_not', 'should', 'filter']) {
        if (query.bool[clause]) {
          processedBool[clause] = this.processNestedFields(
            { bool: { [clause]: query.bool[clause] } },
            isMustNot || clause === 'must_not'
          ).bool[clause];
        }
      }

      return { bool: processedBool };
    }

    // For other query types, return as-is
    return query;
  }

  /**
   * Process query object to handle nested fields by converting '->' notation to nested queries
   * @template T - The type of the query (e.g., QueryDslQueryContainer)
   * @param query - The query to process
   * @param isMustNot - Whether this is a 'must_not' context
   * @returns The processed query with nested fields
   */
  processNestedFields<T extends estypes.QueryDslQueryContainer>(
    query: T | T[], 
    isMustNot: boolean = false
  ): estypes.QueryDslQueryContainer | estypes.QueryDslQueryContainer[] {
    // Handle array of queries (e.g., in bool.must, bool.should, etc.)
    if (Array.isArray(query)) {
      const results: estypes.QueryDslQueryContainer[] = [];
      for (const q of query) {
        const result = this.processNestedFields(q, isMustNot);
        if (Array.isArray(result)) {
          results.push(...result);
        } else {
          results.push(result);
        }
      }
      return results;
    }

    // Handle leaf query (term, match, range, etc.)
    const queryWithField = query as QueryWithField;
    let fieldPath: string | undefined;

    if ('term' in queryWithField) {
      fieldPath = Object.keys(queryWithField.term)[0];
    } else if ('match' in queryWithField) {
      fieldPath = Object.keys(queryWithField.match)[0];
    } else if ('range' in queryWithField) {
      fieldPath = Object.keys(queryWithField.range)[0];
    } else if ('exists' in queryWithField) {
      fieldPath = queryWithField.exists.field;
    }

    // If the field path contains the separator, process it as a nested field
    if (fieldPath && fieldPath.includes(this.fieldSeparator)) {
      return this.createNestedQuery(fieldPath, query, isMustNot);
    }

    // Handle compound queries (bool, etc.)
    const boolQuery = query as { bool?: BoolQuery };
    if (boolQuery.bool) {
      const processedBool: any = {};

      // Process each bool clause
      for (const clause of ['must', 'must_not', 'should', 'filter'] as const) {
        const boolClause = boolQuery.bool?.[clause];
        if (boolClause) {
          processedBool[clause] = this.processNestedFields(
            boolClause as QueryContainer,
            isMustNot || clause === 'must_not'
          );
        }
      }

      return { bool: processedBool };
    }

    // For other query types, return as-is
    return query;
  }
}
