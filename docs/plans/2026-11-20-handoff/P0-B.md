# P0-B handoff — integration harness (`esTestKit`) and fixtures

## Findings
- **B-076** fixed: books `price` is `scaled_float` (`scaling_factor: 100`; aggs return e.g. `24.990000000000002`, use `toBeCloseTo`); `insertBooksData(index, client = getTestClient())` sends `operations:` and throws on row errors. `createBooksIndex`/`deleteBooksIndex` removed (use the kit). `getBooksData()` is now typed `BookRecord[]`.

## Kit — `src/testFixtures/esTestKit.ts` (one kit per test file)
```ts
import { createTestKit } from '../testFixtures/esTestKit';
import { getBooksCreateRequest, getBooksData } from '../testFixtures/books';
setDefaultTimeout(30_000);
const kit = await createTestKit('qb-sort');          // top-level await: caps known at describe time
afterAll(() => kit.cleanup());
const books = new IndexManager({ client: kit.client, prefix: kit.prefix }, getBooksCreateRequest('books'));
it('raw search', async () => {
  const index = await kit.makeIndex(getBooksCreateRequest('books'), getBooksData()); // created + bulk, refresh: true
  expect((await kit.client.count({ index })).count).toBe(3);
});
kit.testIf('retrievers')('rrf', async () => { /* ... */ });   kit.testIf('serverless', false)('flush', ...);
await kit.waitFor(async () => (await kit.client.count({ index })).count === 3, { timeout: 10_000, message: 'docs visible' });
```
- `createTestKit(label, { client? }): Promise<EsTestKit>` → `{ client, prefix, caps, indexName(label?), makeIndex(create?, docs?), waitFor, cleanup(), sweep(opts?), testIf(cap, expected = true) }`.
- `prefix` = `esqpt_<Date.now() base36>_<label [a-z0-9]>_<6 random>`. `indexName('x')` → `<prefix>_x_<n>` (tracked). `makeIndex` uses `create.index` as the label and `doc.id` as `_id`; throws on failure; returns the real name.
- `cleanup()` lists `<prefix>*` (cat) plus tracked names and deletes them **by exact name** (aliases go with them); never a wildcard delete. Returns the deleted names.
- `sweep(client, { maxAgeMs = 3h, now })` deletes only names matching a run prefix whose encoded time is older than `maxAgeMs` (min 1h, else `RangeError`). `createTestKit` runs it once per process (errors ignored).
- `waitFor(probe, { timeout = 10000, interval = 100, message })`: resolves with the first truthy value; a throwing probe counts as not ready.
- Also exported: `detectCapabilities(client, env)`, `makeRunPrefix`, `parseRunPrefixTime`, `KIT_INDEX_PREFIX`, `DEFAULT_SWEEP_AGE_MS`, types `EsCapabilities`, `CapabilityName`, `EsTestKit`, `KitCreateRequest`.

## Capability flags (detected once per client per process)
| flag | detection | serverless (observed) | Docker 9.1 trial (expected) |
|---|---|---|---|
| `serverless` | `GET /` `version.build_flavor === 'serverless'` | true | false |
| `tasksApi` | `GET _tasks` (list) succeeds | false (410 `api_not_available_exception`) | true |
| `retrievers` | probe index `<runprefix>_probe`: an `rrf` and a `linear` search both succeed; probe deleted | true | true (trial) |
| `inference` / `inferenceId` | first of up to 2 `service: 'elastic'` (EIS) sparse/text embedding endpoints that answers a test inference; `ES_TEST_INFERENCE_ID=<id>` tries only that one, `=none` turns it off | true, `.elser-2-elastic` | false (no EIS; local `.elser-2-elasticsearch` is not probed because it starts a model deployment, ~60 s) |
Also `caps.version`. Note for IM5: on serverless `GET _tasks/<id>` **works** (unknown id → 404 `resource_not_found_exception`); only list/cancel are unavailable.

## Fixtures (creation requests; `index` is the label)
- `books.ts` `getBooksCreateRequest(i)`, `getBooksData()`: ids '1','2' (UK), '3' (US, has unmapped `extra`). `id` keyword, `title` text english + `title.fvh` (term vectors), `premise` text, `country`/`author`/`heroes` keyword, `categories` nested {id integer, name text}, `publishing` nested {author keyword, organization/series text, year/movieYear integer}, `price` scaled_float, `published_at` date.
- `places.ts` `getPlacesCreateRequest(i)`, `getPlacesData()`, `PLACES_VECTOR_DIMS = 3`: `id` keyword, `name` text + `name.raw` keyword, `category` keyword (museum '1','2' / park '3','4' / market '5','6'), `description` text english, `location` geo_point (6 distinct geotiles at precision 4), `embedding` dense_vector 3 dims cosine (knn `[1,0,0]` → '1','2'), `rating` float, `visited_at` date, `reviews` nested {author keyword, stars integer, comment text} ('6' has none; author 'bo' + 5 stars only on '3').
- `articles.ts` `getArticlesCreateRequest(i, kit.caps.inferenceId)`, `getArticlesData()` (behind `caps.inference`): `id` keyword, `title` text + `title.raw`, `body` text english + `body.raw` keyword, `body_semantic` semantic_text. '1','4' bread, '2' space, '3' garden.

## Recording client — `getRecordingClient()` now returns `{ client, sent, script }`
- `script(route, ...replies)`: route `'GET /_tasks/*'`, `'/path'` (any method), RegExp on `'METHOD /decoded/path'`, or predicate. Replies play in order, the last repeats; newer scripts win. Reply = `{ status?, body?, headers? }`, `{ throws }` or `(req) => reply`.
- Helpers: `responseError(status, type, reason?)` (real `ResponseError`, HEAD 404 → `false`), `connectionError()`, `timeoutError()`, `thrownError(name, message)`. `maxRetries: 0`, so 5xx/connection errors are not retried.
- `sent[i]` gains `querystring` (only when non-empty); bulk/NDJSON bodies are recorded as arrays of rows.

## Ported tests
Both existing integration files use one kit each; the `afterAll` deleting `test~english~books_*` is gone; the IndexManager file's first `describe` is renamed `IndexManager - Integration`. Assertions unchanged.

## Docker target (not run: Docker daemon unavailable here)
`docker compose up -d --wait` (ES 9.1.10, trial license), then `ES_ENDPOINT=http://localhost:9200 ES_API_KEY= ES_SERVERLESS=false bun test .integration.test.ts` (the empty/false values override `.env`; verified Bun keeps them). CI service now sets `xpack.license.self_generated.type: trial`; matrix unchanged.

## Gate (serverless target)
Unit specs 355 pass; owned integration files + kit self-test 92 pass; biome clean on owned files; typecheck 11 errors (baseline, none in owned files). No `esqpt_*` or `test*` indexes left on the cluster.
