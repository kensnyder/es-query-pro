export { default as englishplus } from './src/analyzers/englishplus';
export {
  default as IndexManager,
  type AliasExistsShape,
  type AliasMetadataShape,
  type IndexCreateAliasIfNeededResult,
  type IndexCreateAliasResult,
  type IndexCreateIfNeededResult,
  type IndexCreateResult,
  type IndexDeleteResult,
  type IndexDropAliasResult,
  type IndexDropResult,
  type IndexErrorKind,
  type IndexErrorShape,
  type IndexExistsShape,
  type IndexFlushResult,
  type IndexInferCreate,
  type IndexInferFields,
  type IndexInferRecordShape,
  type IndexMetadataShape,
  type IndexPatchResult,
  type IndexPutBulkResult,
  type IndexPutResult,
  type IndexRunShape,
  type IndexStatusReport,
  type ManageOptions,
  type MigrationProgressDetails,
  type QueryBuilderProvider,
  type StatusReport,
} from './src/IndexManager/IndexManager';
export { default as IndexNameManager } from './src/IndexNameManager/IndexNameManager';
export { default as isEmptyObject } from './src/isEmptyObject/isEmptyObject';
export {
  getAllFields,
  getFulltextFields,
} from './src/mappingFields/mappingFields';
export type {
  MappingFieldPath,
  MappingFulltextPath,
  MappingRecord,
} from './src/mappingFields/mappingTypes';
export { default as QueryBuilder } from './src/QueryBuilder/QueryBuilder';
export {
  default as QueryRunner,
  type QueryCountResult,
  type QueryFindFirstResult,
  type QueryFindManyResult,
  type QueryRecord,
} from './src/QueryRunner/QueryRunner';
export {
  default as SchemaRegistry,
  type SchemaDropResultShape,
  type SchemaMigrationDetails,
  type SchemaMigrationOutcome,
  type SchemaMigrationParams,
  type SchemaMigrationReport,
  type SchemaMigrationResultShape,
  type SchemaStatusResultShape,
} from './src/SchemaRegistry/SchemaRegistry';
export * from './src/types';
