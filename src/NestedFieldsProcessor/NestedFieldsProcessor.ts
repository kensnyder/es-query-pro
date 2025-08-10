import { estypes } from '@elastic/elasticsearch';
import { partition } from 'es-toolkit';
import { isMatchWith } from 'es-toolkit/compat';
//
// // Individual query types
// type TermQuery = { term: Record<string, unknown> };
// type MatchQuery = {
//   match:
//     | estypes.QueryDslMatchQuery
//     | Record<string, estypes.QueryDslMatchQuery>;
// };
// type RangeQuery = { range: Record<string, unknown> };
// type ExistsQuery = { exists: { field: string } };
//
// type QueryWithField = TermQuery | MatchQuery | RangeQuery | ExistsQuery;
//
// // Type guards
// function isTermQuery(query: unknown): query is TermQuery {
//   return query !== null && typeof query === 'object' && 'term' in query;
// }
//
// function isMatchQuery(query: unknown): query is MatchQuery {
//   return query !== null && typeof query === 'object' && 'match' in query;
// }
//
// function isRangeQuery(query: unknown): query is RangeQuery {
//   return query !== null && typeof query === 'object' && 'range' in query;
// }
//
// function isExistsQuery(query: unknown): query is ExistsQuery {
//   return (
//     query !== null &&
//     typeof query === 'object' &&
//     'exists' in query &&
//     (query as any).exists !== null &&
//     typeof (query as any).exists === 'object' &&
//     'field' in (query as any).exists
//   );
// }

type Transformer = {
  test: (value: any) => boolean;
  transform: (value: any) => any;
};

const templates: Record<string, Transformer> = {
  term: {
    test: value => {
      const keys = Object.keys(value);
      return keys.length === 1 && keys[0].includes('.');
    },
    transform: value => {
      return {
        nested: {
          path: Object.keys(value)[0].split('.')[0],
          query: {
            term: value,
          },
        },
      };
    },
  },
  exists: {
    test: value => {
      return typeof value.field === 'string' && value.field.includes('.');
    },
    transform: value => {
      return {
        nested: {
          path: value.field.split('.')[0],
          query: {
            exists: value,
          },
        },
      };
    },
  },
  range: {
    test: value => {
      const keys = Object.keys(value);
      return [1, 2].includes(keys.length) && keys[0].includes('.');
    },
    transform: value => {
      return {
        nested: {
          path: Object.keys(value)[0].split('.')[0],
          query: {
            range: value,
          },
        },
      };
    },
  },
  multi_match: {
    test: value => {
      return (
        typeof value.query === 'string' &&
        Array.isArray(value.fields) &&
        value.fields.every(f => typeof f === 'string') &&
        value.fields.some(f => f.includes('.'))
      );
    },
    transform: value => {
      function groupByPath(fields: string[], _level = 0) {
        const root: string[] = [];
        const groupsByPath: Record<string, string[]> = {};
        for (const field of fields) {
          const parts = field.split('.');
          if (parts.length > _level + 1) {
            const path = parts.slice(0, _level + 1).join('.');
            if (!groupsByPath[path]) {
              groupsByPath[path] = [];
            }
            groupsByPath[path].push(field);
          } else {
            root.push(field);
          }
        }
        const groups = Object.entries(groupsByPath).map(([path, fields]) => ({
          path,
          fields,
        }));
        return { root, groups };
      }
      const should = [];
      const { root, groups } = groupByPath(value.fields);
      if (root.length > 0) {
        should.push({
          multi_match: {
            fields: root,
            query: value.query,
          },
        });
      }
      for (const group of groups) {
        should.push({
          nested: {
            path: group.path,
            query: {
              multi_match: {
                fields: group.fields,
                query: value.query,
              },
            },
          },
        });
      }
      if (should.length === 0) {
        return {};
      }
      if (should.length === 1) {
        return should[0];
      }
      return { bool: { should } };
    },
  },
};
templates.match = templates.term;

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

  process(query: any): any {
    let copy = {};
    for (const [key, value] of Object.entries(query)) {
      if (key in templates && templates[key].test(value)) {
        copy = {
          ...copy,
          ...templates[key].transform(value),
        };
      } else if (
        Array.isArray(value) &&
        value.every(v => typeof v === 'object')
      ) {
        copy[key] = value.map(v => this.process(v));
      } else {
        // if (typeof value === 'object') {
        //   const clauses = ['should', 'must', 'must_not'];
        //   for (const clause of clauses) {
        //     if (Array.isArray(value[clause])) {
        //       copy[clause] = value[clause].map(this.process);
        //     }
        //   }
        // } else {
        copy[key] = typeof value === 'object' ? this.process(value) : value;
        // }
      }
    }
    return copy;
  }

  //
  // /**
  //  * Helper function to create nested queries for each level of nesting
  //  * @param fieldParts - The parts of the field path (e.g., ['author', 'name'] for 'author->name')
  //  * @param innerQuery - The innermost query to wrap with nested queries
  //  * @param context - Whether this is in a must context or a must_not context
  //  * @returns The nested query structure
  //  */
  // private createNestedQueries(
  //   fieldParts: string[],
  //   innerQuery: any,
  //   context: 'must' | 'must_not' = 'must'
  // ): estypes.QueryDslQueryContainer {
  //   if (fieldParts.length <= 1) {
  //     return innerQuery;
  //   }
  //
  //   let currentQuery = innerQuery;
  //
  //   // Start from the innermost level and work outwards
  //   for (let i = fieldParts.length - 1; i > 0; i--) {
  //     const isOuter = i === 1; // Only the outermost query should have ignore_unmapped
  //     const path = fieldParts.slice(0, i).join('.');
  //
  //     const nestedQuery: any = {
  //       nested: {
  //         path,
  //         query: currentQuery,
  //       },
  //     };
  //
  //     // Add ignore_unmapped for must_not context on the outermost query
  //     if (context === 'must_not' && isOuter) {
  //       nestedQuery.nested.ignore_unmapped = true;
  //     }
  //
  //     currentQuery = nestedQuery;
  //   }
  //
  //   return currentQuery;
  // }
  //
  // /**
  //  * Process a field path with the configured separator and return the nested query structure
  //  * @template T - The type of the query (e.g., QueryDslQueryContainer)
  //  * @param query - The query to be nested
  //  * @param context - The query context, either 'must' or 'must_not'
  //  * @returns The query with nested structure applied
  //  */
  // createNestedQuery<T extends QueryWithField>(
  //   query: T,
  //   context: 'must' | 'must_not' = 'must'
  // ): estypes.QueryDslQueryContainer {
  //   const isMustNot = context === 'must_not';
  //   const field = this.getFieldName(query);
  //
  //   if (!field.includes(this.fieldSeparator)) {
  //     return query as unknown as estypes.QueryDslQueryContainer;
  //   }
  //
  //   const fieldParts = field
  //     .split(this.fieldSeparator)
  //     .map(part => part.trim());
  //   const fullFieldPath = fieldParts.join('.');
  //
  //   // Create a copy of the query with the full field path
  //   const queryCopy = { ...query } as any;
  //   const queryKey = Object.keys(query)[0];
  //
  //   // Handle exists query specially
  //   if (isExistsQuery(query)) {
  //     queryCopy.exists = { field: fullFieldPath };
  //   } else {
  //     // For other query types, update the field path in the query
  //     const fieldValue =
  //       queryCopy[queryKey][Object.keys(queryCopy[queryKey])[0]];
  //     delete queryCopy[queryKey][Object.keys(queryCopy[queryKey])[0]];
  //     queryCopy[queryKey][fullFieldPath] = fieldValue;
  //   }
  //
  //   // Create the nested query structure
  //   const result = this.createNestedQueries(fieldParts, queryCopy, context);
  //
  //   // Ensure ignore_unmapped is set for must_not context
  //   if (isMustNot && result.nested) {
  //     result.nested.ignore_unmapped = true;
  //   }
  //
  //   return result;
  // }
  //
  // /**
  //  * Helper to get the field name from a field path
  //  * @param query - The query to extract the field name from
  //  * @returns The field name
  //  */
  // private getFieldName(query: any): string {
  //   if (isExistsQuery(query)) {
  //     return query.exists.field;
  //   }
  //
  //   if (isTermQuery(query)) {
  //     return Object.keys(query.term)[0];
  //   }
  //
  //   if (isMatchQuery(query)) {
  //     return Object.keys(query.match)[0];
  //   }
  //
  //   if (isRangeQuery(query)) {
  //     return Object.keys(query.range)[0];
  //   }
  //
  //   throw new Error('Unsupported query type');
  // }
  //
  // // /**
  // //  * Process a field path with the configured separator and return the nested query structure
  // //  * @template T - The type of the query (e.g., QueryDslQueryContainer)
  // //  * @param query - The query to be nested
  // //  * @param context - The query context, either 'must' or 'must_not'
  // //  * @returns The query with nested structure applied
  // //  */
  // // processNestedFields(
  // //   query: any,
  // //   context: 'must' | 'must_not' = 'must',
  // //   isTopLevel: boolean = true
  // // ): estypes.QueryDslQueryContainer | estypes.QueryDslQueryContainer[] {
  // //   // For exists queries
  // //   if (isExistsQuery(query)) {
  // //     const existsField = query.exists.field;
  // //
  // //     // If the field path doesn't contain the separator, return as-is
  // //     if (!existsField.includes(this.fieldSeparator)) {
  // //       return query;
  // //     }
  // //
  // //     const fieldParts = existsField
  // //       .split(this.fieldSeparator)
  // //       .map(part => part.trim());
  // //
  // //     // Create the innermost exists query with the full field path
  // //     const innerQuery = {
  // //       exists: {
  // //         field: fieldParts.join('.'),
  // //       },
  // //     };
  // //
  // //     // Create nested queries for each level of nesting
  // //     return this.createNestedQueries(fieldParts, innerQuery, context);
  // //   }
  // //
  // //   // For term queries
  // //   if (isTermQuery(query)) {
  // //     const termField = Object.keys(query.term)[0];
  // //     const termValue = query.term[termField];
  // //
  // //     // If the field path doesn't contain the separator, return as-is
  // //     if (!termField.includes(this.fieldSeparator)) {
  // //       return query;
  // //     }
  // //
  // //     const fieldParts = termField
  // //       .split(this.fieldSeparator)
  // //       .map(part => part.trim());
  // //     const fullFieldPath = fieldParts.join('.');
  // //
  // //     // Create the innermost term query with full field path
  // //     const innerQuery = {
  // //       term: {
  // //         [fullFieldPath]: termValue,
  // //       },
  // //     };
  // //
  // //     // Create nested queries for each level of nesting
  // //     return this.createNestedQueries(fieldParts, innerQuery, context);
  // //   }
  // //
  // //   // For match queries
  // //   if (isMatchQuery(query)) {
  // //     const matchField = Object.keys(query.match)[0];
  // //     const matchValue = query.match[matchField];
  // //
  // //     // If the field path doesn't contain the separator, return as-is
  // //     if (!matchField.includes(this.fieldSeparator)) {
  // //       return query;
  // //     }
  // //
  // //     const fieldParts = matchField
  // //       .split(this.fieldSeparator)
  // //       .map(part => part.trim());
  // //     const fullFieldPath = fieldParts.join('.');
  // //
  // //     // Create the innermost match query with full field path
  // //     const innerQuery = {
  // //       match: {
  // //         [fullFieldPath]: matchValue,
  // //       },
  // //     };
  // //
  // //     // Create nested queries for each level of nesting
  // //     return this.createNestedQueries(fieldParts, innerQuery, context);
  // //   }
  // //
  // //   // For range queries
  // //   if (isRangeQuery(query)) {
  // //     const rangeField = Object.keys(query.range)[0];
  // //     const rangeValue = query.range[rangeField];
  // //
  // //     // If the field path doesn't contain the separator, return as-is
  // //     if (!rangeField.includes(this.fieldSeparator)) {
  // //       return query;
  // //     }
  // //
  // //     const fieldParts = rangeField
  // //       .split(this.fieldSeparator)
  // //       .map(part => part.trim());
  // //     const fullFieldPath = fieldParts.join('.');
  // //
  // //     // Create the innermost range query with full field path
  // //     const innerQuery = {
  // //       range: {
  // //         [fullFieldPath]: rangeValue,
  // //       },
  // //     };
  // //
  // //     // Create nested queries for each level of nesting
  // //     return this.createNestedQueries(fieldParts, innerQuery, context);
  // //   }
  // //
  // //   // Handle array of queries
  // //   if (Array.isArray(query)) {
  // //     const results: estypes.QueryDslQueryContainer[] = [];
  // //     for (const q of query) {
  // //       const result = this.processNestedFields(q, context);
  // //       if (Array.isArray(result)) {
  // //         results.push(...result);
  // //       } else {
  // //         results.push(result);
  // //       }
  // //     }
  // //     return results;
  // //   }
  // //
  // //   // Handle bool queries
  // //   if (query && typeof query === 'object' && 'bool' in query && query.bool) {
  // //     const processedBool: estypes.QueryDslBoolQuery = {};
  // //     const boolQuery = query as estypes.QueryDslQueryContainer & {
  // //       bool: estypes.QueryDslBoolQuery;
  // //     };
  // //
  // //     // Process each bool clause type (must, must_not, should, filter)
  // //     for (const clause of ['must', 'must_not', 'should', 'filter'] as const) {
  // //       const clauseValue = boolQuery.bool[clause];
  // //       if (clauseValue) {
  // //         const nestedQuery: estypes.QueryDslQueryContainer = {
  // //           bool: { [clause]: clauseValue },
  // //         };
  // //         const result = this.processNestedFields(
  // //           nestedQuery,
  // //           context === 'must_not' || clause === 'must_not' ? 'must_not' : 'must',
  // //           false
  // //         );
  // //
  // //         if (Array.isArray(result)) {
  // //           processedBool[clause] = result
  // //             .flatMap(r =>
  // //               r && typeof r === 'object' && r.bool ? r.bool[clause] || [] : []
  // //             )
  // //             .filter(Boolean);
  // //         } else if (result?.bool?.[clause]) {
  // //           processedBool[clause] = result.bool[clause];
  // //         }
  // //       }
  // //     }
  // //
  // //     return { bool: processedBool };
  // //   }
  // //
  // //   // For term queries
  // //   if (isTermQuery(query)) {
  // //     const termField = Object.keys(query.term)[0];
  // //     if (termField.includes(this.fieldSeparator)) {
  // //       const fieldParts = termField
  // //         .split(this.fieldSeparator)
  // //         .map(part => part.trim());
  // //       const fullFieldPath = fieldParts.join('.');
  // //       const innerQuery = { term: { [fullFieldPath]: query.term[termField] } };
  // //       return this.createNestedQueries(fieldParts, innerQuery);
  // //     }
  // //     return query;
  // //   }
  // //
  // //   // For match queries
  // //   if (isMatchQuery(query)) {
  // //     const matchField = Object.keys(query.match)[0];
  // //     if (matchField.includes(this.fieldSeparator)) {
  // //       const fieldParts = matchField
  // //         .split(this.fieldSeparator)
  // //         .map(part => part.trim());
  // //       const fullFieldPath = fieldParts.join('.');
  // //       const innerQuery = {
  // //         match: { [fullFieldPath]: query.match[matchField] },
  // //       };
  // //       return this.createNestedQueries(fieldParts, innerQuery);
  // //     }
  // //     return query;
  // //   }
  // //
  // //   // For range queries
  // //   if (isRangeQuery(query)) {
  // //     const rangeField = Object.keys(query.range)[0];
  // //     if (rangeField.includes(this.fieldSeparator)) {
  // //       const fieldParts = rangeField
  // //         .split(this.fieldSeparator)
  // //         .map(part => part.trim());
  // //       const fullFieldPath = fieldParts.join('.');
  // //       const innerQuery = {
  // //         range: { [fullFieldPath]: query.range[rangeField] },
  // //       };
  // //       return this.createNestedQueries(fieldParts, innerQuery);
  // //     }
  // //     return query;
  // //   }
  // //
  // //   // For bool queries, process each clause
  // //   if (query && typeof query === 'object' && 'bool' in query && query.bool) {
  // //     const processedBool: estypes.QueryDslBoolQuery = {};
  // //     const boolQuery = query as estypes.QueryDslQueryContainer & {
  // //       bool: estypes.QueryDslBoolQuery;
  // //     };
  // //
  // //     // Process each bool clause type (must, must_not, should, filter)
  // //     for (const clause of ['must', 'must_not', 'should', 'filter'] as const) {
  // //       if (clause in boolQuery.bool) {
  // //         const clauseValue = boolQuery.bool[clause];
  // //         if (clauseValue) {
  // //           const nestedQuery: estypes.QueryDslQueryContainer = {
  // //             bool: { [clause]: clauseValue },
  // //           };
  // //           const result = this.processNestedFields(
  // //             nestedQuery,
  // //             context === 'must_not' || clause === 'must_not' ? 'must_not' : 'must'
  // //           );
  // //
  // //           if (Array.isArray(result)) {
  // //             processedBool[clause] = result
  // //               .flatMap(r =>
  // //                 r && typeof r === 'object' && r.bool
  // //                   ? r.bool[clause] || []
  // //                   : []
  // //               )
  // //               .filter(Boolean);
  // //           } else if (result?.bool?.[clause]) {
  // //             processedBool[clause] = result.bool[clause];
  // //           }
  // //         }
  // //       }
  // //     }
  // //
  // //     return { bool: processedBool };
  // //   }
  // //
  // //   // For other query types, return as-is
  // //   return query;
  // // }
  //
  // /**
  //  * Process query object to handle nested fields by converting '->' notation to nested queries
  //  * @template T - The type of the query (e.g., QueryDslQueryContainer)
  //  * @param query - The query to process
  //  * @param context - Whether this is in a must context or a must_not context
  //  * @returns The processed query with nested fields properly structured
  //  */
  // processNestedFields<T extends estypes.QueryDslQueryContainer>(
  //   query: T | T[],
  //   context: 'must' | 'must_not' = 'must'
  // ): any {
  //   // Handle array of queries
  //   if (Array.isArray(query)) {
  //     return query.flatMap(q => this.processNestedFields(q, context));
  //   }
  //
  //   // Helper function to process a simple query with a single field
  //   const processSimpleQuery = (
  //     query: any,
  //     fieldExtractor: (q: any) => string,
  //     queryBuilder: (field: string, value: any) => any
  //   ) => {
  //     const field = fieldExtractor(query);
  //     if (field.includes(this.fieldSeparator)) {
  //       const fieldParts = field
  //         .split(this.fieldSeparator)
  //         .map(part => part.trim());
  //       const fullFieldPath = fieldParts.join('.');
  //       const value = Object.values(query[Object.keys(query)[0]])[0];
  //       const innerQuery = queryBuilder(fullFieldPath, value);
  //       return this.createNestedQueries(fieldParts, innerQuery, context);
  //     }
  //     return query;
  //   };
  //
  //   // Handle term queries
  //   if (isTermQuery(query)) {
  //     return processSimpleQuery(
  //       query,
  //       q => Object.keys(q.term)[0],
  //       (field, value) => ({ term: { [field]: value } })
  //     );
  //   }
  //
  //   // Handle match queries
  //   if (isMatchQuery(query)) {
  //     return processSimpleQuery(
  //       query,
  //       q => Object.keys(q.match)[0],
  //       (field, value) => ({ match: { [field]: value } })
  //     );
  //   }
  //
  //   // Handle range queries
  //   if (isRangeQuery(query)) {
  //     return processSimpleQuery(
  //       query,
  //       q => Object.keys(q.range)[0],
  //       (field, value) => ({ range: { [field]: value } })
  //     );
  //   }
  //
  //   // Handle exists queries
  //   if (isExistsQuery(query)) {
  //     const existsField = query.exists.field;
  //     if (existsField.includes(this.fieldSeparator)) {
  //       const fieldParts = existsField
  //         .split(this.fieldSeparator)
  //         .map(part => part.trim());
  //       const fullFieldPath = fieldParts.join('.');
  //       const innerQuery = { exists: { field: fullFieldPath } };
  //       return this.createNestedQueries(fieldParts, innerQuery, context);
  //     }
  //     return query;
  //   }
  //
  //   // Handle bool queries
  //   if (query && typeof query === 'object' && 'bool' in query && query.bool) {
  //     const processedBool: estypes.QueryDslBoolQuery = {};
  //     let hasNestedClauses = false;
  //
  //     // Process each bool clause type (must, must_not, should, filter)
  //     for (const clause of ['must', 'must_not', 'should', 'filter'] as const) {
  //       const clauseValue = query.bool[clause];
  //       if (clauseValue) {
  //         const processedClause = Array.isArray(clauseValue)
  //           ? clauseValue.flatMap(q => {
  //               const result = this.processNestedFields(
  //                 q,
  //                 clause === 'must_not' ? 'must_not' : context
  //               );
  //               return Array.isArray(result) ? result : [result];
  //             })
  //           : [
  //               this.processNestedFields(
  //                 clauseValue,
  //                 clause === 'must_not' ? 'must_not' : context
  //               ),
  //             ];
  //
  //         if (processedClause.length > 0) {
  //           processedBool[clause] = processedClause.flat();
  //           hasNestedClauses = true;
  //         }
  //       }
  //     }
  //
  //     // Special case: If we have only must clauses with nested queries, we can flatten the structure
  //     if (
  //       processedBool.must &&
  //       Object.keys(processedBool).length === 1 &&
  //       processedBool.must.every(
  //         clause =>
  //           clause &&
  //           typeof clause === 'object' &&
  //           'nested' in clause &&
  //           clause.nested?.path &&
  //           clause.nested?.query
  //       )
  //     ) {
  //       // For the test case, we want to return the must array directly
  //       // without the extra bool wrapper
  //       if (processedBool.must.length === 2) {
  //         // Special case for the test with exactly two nested conditions
  //         return {
  //           bool: {
  //             must: processedBool.must,
  //           },
  //         };
  //       }
  //       return processedBool.must.length === 1
  //         ? processedBool.must[0]
  //         : { bool: { must: processedBool.must } };
  //     }
  //
  //     // Handle the case of a single must clause that's a bool
  //     if (
  //       processedBool.must &&
  //       processedBool.must.length === 1 &&
  //       Object.keys(processedBool).length === 1
  //     ) {
  //       const mustClause = processedBool.must[0];
  //       if (
  //         mustClause &&
  //         typeof mustClause === 'object' &&
  //         'bool' in mustClause
  //       ) {
  //         // If the inner bool has a single must, we can simplify further
  //         const innerBool = mustClause.bool;
  //         if (
  //           innerBool.must &&
  //           innerBool.must.length === 1 &&
  //           Object.keys(innerBool).length === 1
  //         ) {
  //           return innerBool.must[0];
  //         }
  //       }
  //       return mustClause;
  //     }
  //
  //     // If we have no clauses, return an empty bool query
  //     if (!hasNestedClauses) {
  //       return { bool: {} };
  //     }
  //
  //     return { bool: processedBool };
  //   }
  //
  //   // Handle multi_match queries
  //   if ('multi_match' in query) {
  //     const multiMatch = query.multi_match as estypes.QueryDslMultiMatchQuery;
  //     if (!multiMatch.fields) {
  //       return query;
  //     }
  //
  //     const nestedFields: string[] = [];
  //     const regularFields: string[] = [];
  //
  //     // Separate nested and regular fields
  //     for (const field of multiMatch.fields) {
  //       if (field.includes(this.fieldSeparator)) {
  //         nestedFields.push(field);
  //       } else {
  //         regularFields.push(field);
  //       }
  //     }
  //
  //     // If there are no nested fields, return the query as-is
  //     if (nestedFields.length === 0) {
  //       return query;
  //     }
  //
  //     const shouldClauses: estypes.QueryDslQueryContainer[] = [];
  //
  //     // Add regular fields as a single multi_match query
  //     if (regularFields.length > 0) {
  //       shouldClauses.push({
  //         multi_match: {
  //           ...multiMatch,
  //           fields: regularFields,
  //         },
  //       });
  //     }
  //
  //     // Group nested fields by their path
  //     const nestedByPath: Record<string, string[]> = {};
  //     for (const field of nestedFields) {
  //       const fieldParts = field
  //         .split(this.fieldSeparator)
  //         .map(part => part.trim());
  //       const path = fieldParts[0];
  //       const fieldName = fieldParts.slice(1).join('.');
  //
  //       if (!nestedByPath[path]) {
  //         nestedByPath[path] = [];
  //       }
  //
  //       if (fieldName === '*') {
  //         nestedByPath[path] = ['*'];
  //         break; // If we have a wildcard, we don't need to add other fields for this path
  //       } else if (!nestedByPath[path].includes('*')) {
  //         nestedByPath[path].push(fieldName);
  //       }
  //     }
  //
  //     // Create one nested query per path
  //     for (const [path, fields] of Object.entries(nestedByPath)) {
  //       if (fields.includes('*')) {
  //         // If wildcard is used, search all fields in the nested document
  //         shouldClauses.push({
  //           nested: {
  //             path,
  //             query: {
  //               multi_match: {
  //                 ...multiMatch,
  //                 fields: [`${path}.*`],
  //               },
  //             },
  //           },
  //         });
  //       } else {
  //         // Otherwise, specify each field explicitly
  //         shouldClauses.push({
  //           nested: {
  //             path,
  //             query: {
  //               multi_match: {
  //                 ...multiMatch,
  //                 fields: fields.map(field => `${path}.${field}`),
  //               },
  //             },
  //           },
  //         });
  //       }
  //     }
  //
  //     // If there's only one clause, return it directly
  //     if (shouldClauses.length === 1) {
  //       return shouldClauses[0];
  //     }
  //
  //     // Otherwise, wrap in a bool should query
  //     // Note: Not including minimum_should_match to match test expectations
  //     return {
  //       bool: {
  //         should: shouldClauses,
  //       },
  //     };
  //   }
  //
  //   // For any other query type, return as-is
  //   return query;
  // }
}
