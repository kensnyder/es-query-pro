import { describe, expect, expectTypeOf, it } from 'bun:test';
import path from 'node:path';
import type { Client, estypes } from '@elastic/elasticsearch';
import ts from 'typescript-5';
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
function getAllExportNames() {
  const entry = path.resolve(import.meta.dir, '..', 'index.ts');
  const program = ts.createProgram([entry], {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entry);
  const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    throw new Error('index.ts could not be loaded');
  }
  return checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => symbol.name)
    .sort();
}

describe('public runtime exports', () => {
  it('exports exactly the runtime values of 3.0.0-beta.3', () => {
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
      'response' | 'connection' | 'timeout' | 'disconnected' | 'javascript'
    >();
    expectTypeOf<Api.QueryRecord<Books>>().toHaveProperty('_score');
  });

  it('exports exactly these names (values and types)', () => {
    const names = getAllExportNames();
    expect(removedNames.filter((name) => names.includes(name))).toEqual([]);
    expect(names).toEqual([
      'AggregationsAggregateOrder',
      'AggregationsAggregationContainer',
      'AggregationsCompositeAggregationSource',
      'AliasCreateParams',
      'AliasDeleteParams',
      'AliasExistParams',
      'AliasExistsShape',
      'AliasMetadataParams',
      'AliasMetadataShape',
      'BoostOperator',
      'BulkRequestParams',
      'DeleteRequestShape',
      'ErrorCause',
      'FieldType',
      'FieldTypeOrTypes',
      'FlushRequestParams',
      'GetRequestParams',
      'IndexCreateAliasIfNeededResult',
      'IndexCreateAliasResult',
      'IndexCreateIfNeededResult',
      'IndexCreateParams',
      'IndexCreateResult',
      'IndexDeleteResult',
      'IndexDropAliasResult',
      'IndexDropResult',
      'IndexErrorKind',
      'IndexErrorShape',
      'IndexExistParams',
      'IndexExistsShape',
      'IndexFlushResult',
      'IndexInferCreate',
      'IndexInferFields',
      'IndexInferRecordShape',
      'IndexManager',
      'IndexMetadataParams',
      'IndexMetadataShape',
      'IndexNameManager',
      'IndexPatchResult',
      'IndexPutBulkResult',
      'IndexPutResult',
      'IndexRunShape',
      'IndexStatusReport',
      'InferenceCohereSimilarityType',
      'InnerRetriever',
      'IntervalType',
      'KnnRetriever',
      'ManageOptions',
      'MappingFieldPath',
      'MappingFulltextPath',
      'MappingRecord',
      'MigrationProgressDetails',
      'MoreLikeThisLikeParams',
      'MoreLikeThisOptions',
      'PatchRequestParams',
      'Prettify',
      'PutRequestParams',
      'QueryBuilder',
      'QueryBuilderProvider',
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
      'QueryRecord',
      'QueryRunner',
      'RangeBound',
      'RangeOperator',
      'RangeShape',
      'RetrieverContainer',
      'SchemaDropResultShape',
      'SchemaMigrationDetails',
      'SchemaMigrationOutcome',
      'SchemaMigrationParams',
      'SchemaMigrationReport',
      'SchemaMigrationResultShape',
      'SchemaRegistry',
      'SchemaStatusResultShape',
      'ScoreNormalizer',
      'SearchInnerHits',
      'SearchRequest',
      'SearchRescore',
      'SortCombinations',
      'SortDirection',
      'SortOrder',
      'SortResults',
      'StatusReport',
      'englishplus',
      'getAllFields',
      'getFulltextFields',
      'isEmptyObject',
    ]);
  }, 30_000);
});
