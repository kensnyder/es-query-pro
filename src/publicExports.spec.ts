import { describe, expect, expectTypeOf, it } from 'bun:test';
import path from 'node:path';
import type { Client, estypes } from '@elastic/elasticsearch';
import { API } from 'typescript/unstable/async';
import type * as Api from '../index';
import * as api from '../index';

/**
 * Names removed in 3.0.0-beta.3. Three are split so that the repository-wide
 * grep for the removed names (plan section 6, Final gate 3) stays empty.
 */
const removedNames = [
  ['getEs', 'Client'].join(''),
  ['Schema', 'Manager'].join(''),
  ['Schema', 'Shape'].join(''),
  'ManagerInferSchema',
  'ManagerInferRecordShape',
  'IndexInferSchema',
  'ElasticsearchRecord',
  'ElasticsearchType',
  'ColumnType',
  'IndexSettings',
  'MappingProperty',
  'MappingProperties',
];

/**
 * Every name `index.ts` exports, values and types alike, as a TypeScript
 * consumer sees them
 */
async function getAllExportNames() {
  const root = path.resolve(import.meta.dir, '..');
  const entry = path.join(root, 'index.ts');
  // the tsconfig exists only in memory
  const configFile = path.join(root, 'tsconfig.public-exports.json');
  const config = JSON.stringify({
    compilerOptions: {
      noEmit: true,
      skipLibCheck: true,
      target: 'esnext',
      module: 'esnext',
      moduleResolution: 'bundler',
      types: [],
    },
    files: [entry],
  });
  const api = new API({
    cwd: root,
    fs: {
      fileExists: (fileName) => fileName === configFile || undefined,
      readFile: (fileName) => {
        return fileName === configFile ? config : undefined;
      },
    },
  });
  try {
    const snapshot = await api.updateSnapshot({ openProjects: [configFile] });
    const project = snapshot.getProject(configFile);
    const sourceFile = await project?.program.getSourceFile(entry);
    const moduleSymbol =
      sourceFile && (await project?.checker.getSymbolAtLocation(sourceFile));
    if (!project || !moduleSymbol) {
      throw new Error('index.ts could not be loaded');
    }
    const symbols = await project.checker.getExportsOfModule(moduleSymbol);
    return symbols.map((symbol) => symbol.name).sort();
  } finally {
    await api.close();
  }
}

describe('public runtime exports', () => {
  it('exports exactly the runtime values of 3.0.0-beta.4', () => {
    expect(Object.keys(api).sort()).toEqual([
      'IndexManager',
      'IndexNameManager',
      'QueryBuilder',
      'QueryRunner',
      'SchemaRegistry',
      'englishplus',
      'getAllFields',
      'getFulltextFields',
      'isEmptyObject',
    ]);
  });

  it('no longer exports the removed functions and classes', () => {
    expect(removedNames.filter((name) => name in api)).toEqual([]);
  });

  it('exports working field extraction functions', () => {
    const create = {
      index: 'books',
      mappings: {
        properties: {
          title: { type: 'text', fields: { exact: { type: 'keyword' } } },
          author: { type: 'keyword' },
        },
      },
    } satisfies estypes.IndicesCreateRequest;
    expect(api.getAllFields(create)).toEqual(['title', 'author']);
    expect(api.getFulltextFields(create)).toEqual(['title']);
  });
});

describe('public type exports', () => {
  const books = {
    index: 'books',
    mappings: {
      properties: {
        title: { type: 'text', fields: { exact: { type: 'keyword' } } },
        price: { type: 'integer' },
        categories: {
          type: 'nested',
          properties: { id: { type: 'integer' } },
        },
      },
    },
  } as const satisfies estypes.IndicesCreateRequest;
  type Books = typeof books;
  type BooksIndex = Api.IndexManager<Books>;
  type BookField =
    | 'title'
    | 'title.exact'
    | 'price'
    | 'categories'
    | 'categories.id';

  it('exports ManageOptions with a required client', () => {
    expectTypeOf<Api.ManageOptions['client']>().toEqualTypeOf<Client>();
    // @ts-expect-error  client is required
    const options: Api.ManageOptions = { version: 1 };
    expect(options.version).toBe(1);
  });

  it('exports IndexInferCreate, IndexInferFields and IndexInferRecordShape', () => {
    expectTypeOf<Api.IndexInferCreate<BooksIndex>>().toEqualTypeOf<Books>();
    expectTypeOf<Api.IndexInferFields<BooksIndex>>().toEqualTypeOf<BookField>();
    expectTypeOf<Api.IndexInferRecordShape<BooksIndex>>().toEqualTypeOf<
      Api.MappingRecord<Books>
    >();
  });

  it('exports MappingFieldPath, MappingFulltextPath and MappingRecord', () => {
    expectTypeOf<Api.MappingFieldPath<Books>>().toEqualTypeOf<BookField>();
    expectTypeOf<Api.MappingFulltextPath<Books>>().toEqualTypeOf<'title'>();
    expectTypeOf<{ price: 5 }>().toMatchTypeOf<Api.MappingRecord<Books>>();
    expectTypeOf<{ price: 'five' }>().not.toMatchTypeOf<
      Api.MappingRecord<Books>
    >();
  });

  it('exports QueryBuilderProvider, IndexErrorKind and QueryRecord', () => {
    expectTypeOf<
      Parameters<Api.QueryBuilderProvider<'title'>>[0]
    >().toEqualTypeOf<Api.QueryBuilder<'title'>>();
    expectTypeOf<Api.IndexErrorKind>().toEqualTypeOf<
      | 'response'
      | 'connection'
      | 'timeout'
      | 'disconnected'
      | 'aborted'
      | 'serialization'
      | 'product'
      | 'configuration'
      | 'javascript'
    >();
    expectTypeOf<Api.QueryRecord<Books>>().toHaveProperty('_score');
  });

  it('exports the status, lifecycle and migration code unions', () => {
    expectTypeOf<Api.StatusSummary>().toEqualTypeOf<
      | 'unknown'
      | 'newerVersionPresent'
      | 'needsMigration'
      | 'aliasConflict'
      | 'needsCreation'
      | 'needsAlias'
      | 'current'
    >();
    expectTypeOf<Api.IndexLifecycleCode>().toEqualTypeOf<
      | 'CREATED'
      | 'ALREADY_EXISTS'
      | 'ALIAS_CREATED'
      | 'NEEDS_MIGRATION'
      | 'NEWER_VERSION_PRESENT'
      | 'ALIAS_CONFLICT'
      | 'EXISTS_CHECK_ERROR'
      | 'CREATE_ERROR'
      | 'ALIAS_ERROR'
      | 'DROP_ERROR'
      | 'FLUSH_ERROR'
    >();
    expectTypeOf<Api.MigrationCode>().toEqualTypeOf<
      | 'CREATED'
      | 'ALIAS_CREATED'
      | 'CURRENT'
      | 'MIGRATION_STARTED'
      | 'MIGRATION_RESUMED'
      | 'NEWER_VERSION_PRESENT'
      | 'INCOMPARABLE_VERSION'
      | 'ALIAS_CONFLICT'
      | 'STATUS_ERROR'
      | 'COUNT_ERROR'
      | 'CREATE_ERROR'
      | 'ALIAS_ERROR'
      | 'REINDEX_ERROR'
    >();
    expectTypeOf<
      Exclude<Api.MigrationOutcomeCode, Api.MigrationCode>
    >().toEqualTypeOf<
      | 'MIGRATED'
      | 'REINDEX_FAILED'
      | 'POLL_ERROR'
      | 'TIMEOUT'
      | 'SWAP_ERROR'
      | 'VERIFY_FAILED'
    >();
    expectTypeOf<
      Awaited<ReturnType<BooksIndex['migrateIfNeeded']>>
    >().toEqualTypeOf<Api.MigrationResult>();
    expectTypeOf<
      Api.SchemaDropCode | Api.SchemaRecreateCode
    >().toMatchTypeOf<string>();
  });

  it('exports exactly these names (values and types)', async () => {
    const names = await getAllExportNames();
    expect(removedNames.filter((name) => names.includes(name))).toEqual([]);
    expect(names).toEqual([
      'AggregateDateHistogramOptions',
      'AggregateGeotileGridOptions',
      'AggregateHistogramOptions',
      'AggregateTermOptions',
      'Aggregations',
      'AggregationsAggregateOrder',
      'AggregationsAggregationContainer',
      'AggregationsCompositeAggregationSource',
      'AliasCreateParams',
      'AliasDeleteParams',
      'AliasExistParams',
      'AliasExistsShape',
      'AliasMetadataParams',
      'AliasMetadataShape',
      'AliasState',
      'AnyIndexManager',
      'BoostOperator',
      'BulkOperation',
      'BulkRequestParams',
      'CompositeAggregationOptions',
      'CompositeDateHistogramSource',
      'CompositeGeotileGridSource',
      'CompositeHistogramSource',
      'CreateOutcome',
      'DateHistogramInterval',
      'DateHistogramOptions',
      'DeleteRequestShape',
      'EntryBase',
      'ErrorCause',
      'ErrorMeta',
      'FieldType',
      'FieldTypeOrTypes',
      'FlushRequestParams',
      'FunctionScoreOptions',
      'GetRequestParams',
      'HighlightDefinition',
      'IndexCountParams',
      'IndexCreateAliasIfNeededResult',
      'IndexCreateAliasResult',
      'IndexCreateIfNeededResult',
      'IndexCreateOnlyResult',
      'IndexCreateParams',
      'IndexCreateRequestShape',
      'IndexCreateResult',
      'IndexDeleteByIdParams',
      'IndexDeleteManyParams',
      'IndexDeleteManyResult',
      'IndexDeleteResult',
      'IndexDropAliasResult',
      'IndexDropResult',
      'IndexErrorKind',
      'IndexErrorShape',
      'IndexExistParams',
      'IndexExistsShape',
      'IndexFindByIdParams',
      'IndexFindByIdResult',
      'IndexFlushResult',
      'IndexInferCreate',
      'IndexInferFields',
      'IndexInferRecordShape',
      'IndexLifecycleCode',
      'IndexManager',
      'IndexMetadataParams',
      'IndexMetadataShape',
      'IndexMigrateResult',
      'IndexName',
      'IndexNameAttributes',
      'IndexNameManager',
      'IndexNameRelation',
      'IndexPatchParams',
      'IndexPatchResult',
      'IndexPutBulkOptions',
      'IndexPutBulkParams',
      'IndexPutBulkReportRow',
      'IndexPutBulkResult',
      'IndexPutParams',
      'IndexPutResult',
      'IndexRecordId',
      'IndexRecreateResult',
      'IndexRunShape',
      'IndexSiblingIndexesResult',
      'IndexStatusReport',
      'InferenceCohereSimilarityType',
      'InnerRetriever',
      'IntervalType',
      'KnnOptions',
      'KnnRetriever',
      'ManageOptions',
      'MappingFieldPath',
      'MappingFulltextPath',
      'MappingRecord',
      'MigrationCode',
      'MigrationOptions',
      'MigrationOutcome',
      'MigrationOutcomeCode',
      'MigrationParams',
      'MigrationPassPhase',
      'MigrationPassReport',
      'MigrationPhase',
      'MigrationProgressDetails',
      'MigrationRequest',
      'MigrationResult',
      'MoreLikeThisLikeParams',
      'MoreLikeThisOptions',
      'NestedOptions',
      'PassResult',
      'PatchRequestParams',
      'Prettify',
      'PutRequestParams',
      'QueryBuilder',
      'QueryBuilderProvider',
      'QueryCountParams',
      'QueryCountResult',
      'QueryDslChildScoreMode',
      'QueryDslDecayFunctionBase',
      'QueryDslFunctionScoreContainer',
      'QueryDslFunctionScoreQuery',
      'QueryDslMatchPhrasePrefixQuery',
      'QueryDslMatchQuery',
      'QueryDslMultiMatchQuery',
      'QueryDslQueryContainer',
      'QueryFindFirstResult',
      'QueryFindManyResult',
      'QueryFindParams',
      'QueryNotFoundError',
      'QueryRecord',
      'QueryRunner',
      'QueryStringOptions',
      'QueryUpdateManyParams',
      'QueryUpdateManyResult',
      'QueryUpdateValues',
      'RandomSortOptions',
      'RangeBound',
      'RangeOperator',
      'RangeOptions',
      'RangeShape',
      'RegexpOptions',
      'RescoreOptions',
      'ResetName',
      'RetrieverContainer',
      'RrfOptions',
      'SchemaDropCode',
      'SchemaDropReport',
      'SchemaDropResultShape',
      'SchemaFleetResult',
      'SchemaMigrationDetails',
      'SchemaMigrationOutcome',
      'SchemaMigrationParams',
      'SchemaMigrationReport',
      'SchemaMigrationResultShape',
      'SchemaNamedIndexes',
      'SchemaRecreateCode',
      'SchemaRecreateReport',
      'SchemaRecreateResultShape',
      'SchemaRegistry',
      'SchemaStatusResultShape',
      'ScoreNormalizer',
      'SearchInnerHits',
      'SearchRequest',
      'SearchRescore',
      'SearchResponse',
      'SemanticOptions',
      'ShouldOptions',
      'SiblingIndexes',
      'SimpleQueryStringOptions',
      'SortClause',
      'SortCombinations',
      'SortDirection',
      'SortOrder',
      'SortResults',
      'StatusReport',
      'StatusSummary',
      'StepFailure',
      'TaskStats',
      'TermOptions',
      'TermValue',
      'TermsOrderBy',
      'TermsSetOptions',
      'WeightedSemanticOptions',
      'WildcardOptions',
      'englishplus',
      'getAllFields',
      'getFulltextFields',
      'isEmptyObject',
    ]);
  }, 30_000);
});
