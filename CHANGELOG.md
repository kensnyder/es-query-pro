## Change Log

### v3.0.0-beta.3 on 2026-11-20

Breaking changes:

1. `new IndexManager({ index, schema, … })` → `new IndexManager(options, create)`:
   `options` is `ManageOptions` (`client`, `separator`, `version`, `prefix`,
   `language`, `serverless`) and `create` is an Elasticsearch
   `estypes.IndicesCreateRequest` whose `index` is the logical name. Everything
   else in `create` (`settings`, `mappings`, `aliases`, …) is sent unchanged.
   The constructor options `index` (object), `schema`, `properties`,
   `settings` and `analyzer` are gone.
2. `client` is required; `getEsClient()` is removed and `ES_ENDPOINT` /
   `ES_API_KEY` / `ES_USERNAME` / `ES_PASSWORD` / `ES_VERSION` are no longer
   read by the library (`ES_SERVERLESS` still is). The library imports
   `@elastic/elasticsearch` for types only.
3. String schemas (`SchemaShape`) are gone, along with `SchemaManager`,
   `ManagerInferSchema`, `ManagerInferRecordShape`, `IndexInferSchema`,
   `ElasticsearchRecord`, `ElasticsearchType`, `ColumnType` (and the unused
   `IndexSettings`, `MappingProperty`, `MappingProperties` aliases). Use
   `MappingRecord`, `IndexInferRecordShape` and `estypes` instead.
4. `text` fields no longer get `.exact` / `.fulltext` sub-fields or
   `term_vector` automatically; sub-objects are no longer mapped as `nested`
   automatically; the `analyzer` option is gone. Declare all of these in the
   mapping (the README shows the hand-written equivalent).
5. `IndexManager.schema`, `.settings`, `.analyzer` are removed; `.createSpec`
   (the creation request as passed) is added.
6. `allFields` now contains full dotted paths (`categories.name`, not `name`);
   `fulltextFields` no longer includes `completion` or `token_count` fields.
7. Field names passed to query callbacks from an `IndexManager` (`findMany`,
   `findFirst`, `count`, `deleteMany`, `run`) are type-checked against the
   mapping (compile-time only), as are records passed to `put`, `putBulk` and
   `patch`. Requires TypeScript 5.0+. Opt out per manager with
   `new IndexManager<estypes.IndicesCreateRequest>(…)`.
8. Error `errorKind` is decided by the error's `name`, not `instanceof`.

Added:

- `getAllFields(create, { subFields, containers })` and
  `getFulltextFields(create, { subFields })`.
- Types `ManageOptions`, `IndexInferCreate`, `IndexInferFields`,
  `MappingFieldPath`, `MappingFulltextPath`, `MappingRecord`,
  `QueryBuilderProvider`, `IndexErrorKind`, `QueryRecord`.
- `QueryBuilder<Field extends string = string>`; `new QueryBuilder()` behaves
  as before.

Fixed:

- `getIndexMetadata()` no longer always returns an error with client v9.
- `StatusReport.indexExists` / `aliasExists` are typed `boolean | null`.
- Errors from a second copy of the client package are classified correctly.
- `SchemaRegistry.listIndexes()` returns each index's version.
- `englishplus` is typed `{ analysis: IndicesIndexSettingsAnalysis }`, so
  `settings: { analysis: englishplus.analysis }` type-checks.

### v2.0.0-beta.1 on 2025-08-14

- Initial release with IndexManager and nested field support

### v1.0.0-beta.1 on 2022

- Test release of Query Builder
