/**
 * Processes nested fields in Elasticsearch queries by converting '->' notation to nested queries
 */
export class NestedFieldsProcessor {
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
   */
  createNestedQuery(fieldPath: string, query: any, isMustNot: boolean = false): any {
    const parts = fieldPath.split(this.fieldSeparator).map(part => part.trim());
    
    // Helper function to build a nested query with the given path and inner query
    const buildNestedQuery = (path: string, innerQuery: any, isOuter: boolean = false) => {
      return {
        nested: {
          path: path,
          query: innerQuery,
          ...(isMustNot && isOuter ? { ignore_unmapped: true } : {})
        }
      };
    };
    
    // Helper to get the field name from a field path
    const getFieldName = (fieldPath: string) => {
      const parts = fieldPath.split(this.fieldSeparator);
      return parts[parts.length - 1].trim();
    };
    
    // For exists queries
    if (query.exists) {
      const existsField = query.exists.field;
      const existsFieldParts = existsField.split(this.fieldSeparator).map(part => part.trim());
      
      // If the exists field has nested parts, we need to build a nested query
      if (existsFieldParts.length > 1) {
        // Start with the innermost exists query
        const fieldName = existsFieldParts[existsFieldParts.length - 1];
        let currentQuery = {
          exists: {
            field: fieldName
          }
        };
        
        // Build nested queries from the inside out
        for (let i = existsFieldParts.length - 2; i >= 0; i--) {
          const path = existsFieldParts.slice(0, i + 1).join('.');
          currentQuery = buildNestedQuery(path, currentQuery, i === 0);
        }
        
        return currentQuery;
      }
      
      // For single level exists query on a nested field, we still need to wrap it in a nested query
      if (fieldPath.includes(this.fieldSeparator)) {
        return buildNestedQuery(parts[0], {
          exists: {
            field: parts[0] + '.' + existsField
          }
        }, true);
      }
      
      // Single level exists query on non-nested field
      return query;
    }
    
    // For term queries
    if (query.term) {
      const termField = Object.keys(query.term)[0];
      const termValue = query.term[termField];
      const fieldName = getFieldName(termField);
      
      // If it's a multi-level nested path (e.g., 'author->contact->email')
      if (parts.length > 1) {
        // Build the innermost query with the full field path
        const fullFieldPath = parts.join('.');
        let currentQuery = {
          term: {
            [fullFieldPath]: termValue
          }
        };
        
        // For each level of nesting (except the last one), wrap the current query in a nested query
        for (let i = parts.length - 2; i >= 0; i--) {
          const path = parts.slice(0, i + 1).join('.');
          currentQuery = buildNestedQuery(path, currentQuery, i === 0);
        }
        
        return currentQuery;
      } else {
        // Single level term query on a nested field
        return buildNestedQuery(parts[0], {
          term: {
            [parts[0] + '.' + fieldName]: termValue
          }
        }, true);
      }
    }
    
    // For match queries
    if (query.match) {
      const matchField = Object.keys(query.match)[0];
      const matchValue = query.match[matchField];
      const fieldName = getFieldName(matchField);
      
      // If it's a multi-level nested path
      if (parts.length > 1) {
        // Build the innermost query with the full field path
        const fullFieldPath = parts.join('.');
        let currentQuery = {
          match: {
            [fullFieldPath]: matchValue
          }
        };
        
        // For each level of nesting (except the last one), wrap the current query in a nested query
        for (let i = parts.length - 2; i >= 0; i--) {
          const path = parts.slice(0, i + 1).join('.');
          currentQuery = buildNestedQuery(path, currentQuery, i === 0);
        }
        
        return currentQuery;
      } else {
        // Single level match query on a nested field
        return buildNestedQuery(parts[0], {
          match: {
            [parts[0] + '.' + fieldName]: matchValue
          }
        }, true);
      }
    }
    
    // For range queries
    if (query.range) {
      const rangeField = Object.keys(query.range)[0];
      const rangeValue = query.range[rangeField];
      const fieldName = getFieldName(rangeField);
      
      // If it's a multi-level nested path
      if (parts.length > 1) {
        // Build the innermost query with the full field path
        const fullFieldPath = parts.join('.');
        let currentQuery = {
          range: {
            [fullFieldPath]: rangeValue
          }
        };
        
        // For each level of nesting (except the last one), wrap the current query in a nested query
        for (let i = parts.length - 2; i >= 0; i--) {
          const path = parts.slice(0, i + 1).join('.');
          currentQuery = buildNestedQuery(path, currentQuery, i === 0);
        }
        
        return currentQuery;
      } else {
        // Single level range query on a nested field
        return buildNestedQuery(parts[0], {
          range: {
            [parts[0] + '.' + fieldName]: rangeValue
          }
        }, true);
      }
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
   */
  processNestedFields(query: any, isMustNot: boolean = false): any {
    // Handle array of queries (e.g., in bool.must, bool.should, etc.)
    if (Array.isArray(query)) {
      return query.map(q => this.processNestedFields(q, isMustNot));
    }
    
    // Handle leaf query (term, match, range, etc.)
    if (query.term || query.match || query.range || query.exists) {
      // Find the field name in the query
      let fieldPath: string | undefined;
      
      if (query.term) {
        fieldPath = Object.keys(query.term)[0];
      } else if (query.match) {
        fieldPath = Object.keys(query.match)[0];
      } else if (query.range) {
        fieldPath = Object.keys(query.range)[0];
      } else if (query.exists) {
        fieldPath = query.exists.field;
      }
      
      // If the field path contains the separator, process it as a nested field
      if (fieldPath && fieldPath.includes(this.fieldSeparator)) {
        return this.createNestedQuery(fieldPath, query, isMustNot);
      }
      
      return query;
    }
    
    // Handle compound queries (bool, etc.)
    if (query.bool) {
      const processedBool: any = {};
      
      // Process each bool clause
      for (const clause of ['must', 'must_not', 'should', 'filter']) {
        if (query.bool[clause]) {
          processedBool[clause] = this.processNestedFields(
            query.bool[clause],
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
