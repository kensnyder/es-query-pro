/**
 * Process a field path with '->' notation and return the nested query structure
 */
export function createNestedQuery(fieldPath: string, query: any, isMustNot: boolean = false): any {
  const parts = fieldPath.split('->').map(part => part.trim());
  
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
  const getFieldName = (fieldPath: string) => fieldPath.split('->').pop()?.trim() || '';
  
  // For exists queries
  if (query.exists) {
    const existsField = query.exists.field;
    const existsFieldParts = existsField.split('->').map(part => part.trim());
    
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
    if (fieldPath.includes('->')) {
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
  
  // For bool queries
  if (query.bool) {
    const boolQuery = { ...query.bool };
    
    const processBoolPart = (part: any): any => {
      if (Array.isArray(part)) {
        return part.map(p => processNestedFields(p, isMustNot));
      } else if (part && typeof part === 'object') {
        return processNestedFields(part, isMustNot);
      }
      return part;
    };
    
    const processedBool: any = {};
    
    if (boolQuery.must) processedBool.must = processBoolPart(boolQuery.must);
    if (boolQuery.must_not) processedBool.must_not = processBoolPart(boolQuery.must_not);
    if (boolQuery.should) processedBool.should = processBoolPart(boolQuery.should);
    if (boolQuery.filter) processedBool.filter = processBoolPart(boolQuery.filter);
    
    return { bool: processedBool };
  }
  
  // For any other query type, return as is (will be handled by processNestedFields)
  return query;
}

/**
 * Process query object to handle nested fields by converting '->' notation to nested queries
 */
export function processNestedFields(query: any, isMustNot: boolean = false): any {
  if (!query || typeof query !== 'object') {
    return query;
  }

  // Process arrays
  if (Array.isArray(query)) {
    return query.map(item => processNestedFields(item, isMustNot));
  }

  // Handle term queries with nested fields
  if (query.term) {
    const field = Object.keys(query.term)[0];
    if (field && field.includes('->')) {
      return createNestedQuery(field, { term: { [field.split('->').pop()!]: query.term[field] } }, isMustNot);
    }
  }

  // Handle match queries with nested fields
  if (query.match) {
    const field = Object.keys(query.match)[0];
    if (field && field.includes('->')) {
      return createNestedQuery(field, { match: { [field.split('->').pop()!]: query.match[field] } }, isMustNot);
    }
  }

  // Handle exists queries with nested fields
  if (query.exists && query.exists.field) {
    const field = query.exists.field;
    if (field.includes('->')) {
      // For must_not queries, we need to handle the exists query differently
      if (isMustNot) {
        return {
          bool: {
            must_not: [
              createNestedQuery(field, { exists: { field: field.split('->').pop()! } }, false)
            ]
          }
        };
      }
      return createNestedQuery(field, { exists: { field: field.split('->').pop()! } }, isMustNot);
    }
  }
  
  // Handle nested queries that are already in the correct format
  if (query.nested) {
    return {
      ...query,
      nested: {
        ...query.nested,
        query: processNestedFields(query.nested.query, isMustNot)
      }
    };
  }

  // Process bool queries recursively
  if (query.bool) {
    const boolQuery: any = {};
    
    const processBoolPart = (part: any, key?: string) => {
      if (Array.isArray(part)) {
        return part.map(p => processNestedFields(p, key === 'must_not' ? true : isMustNot));
      } else if (part && typeof part === 'object') {
        return processNestedFields(part, key === 'must_not' ? true : isMustNot);
      }
      return part;
    };
    
    // Process each part of the bool query
    if (query.bool.must) boolQuery.must = processBoolPart(query.bool.must, 'must');
    if (query.bool.must_not) boolQuery.must_not = processBoolPart(query.bool.must_not, 'must_not');
    if (query.bool.should) boolQuery.should = processBoolPart(query.bool.should, 'should');
    if (query.bool.filter) boolQuery.filter = processBoolPart(query.bool.filter, 'filter');
    
    // Only include the bool query if it has some conditions
    if (Object.keys(boolQuery).length > 0) {
      return { bool: boolQuery };
    }
  }
  
  // For any other query type, process its properties recursively
  const result: any = {};
  for (const [key, value] of Object.entries(query)) {
    if (value && typeof value === 'object') {
      result[key] = processNestedFields(value, isMustNot);
    } else {
      result[key] = value;
    }
  }
  
  return result;
}
