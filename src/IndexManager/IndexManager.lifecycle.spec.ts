import { describe, expect, it } from 'bun:test';
import type { Client } from '@elastic/elasticsearch';
import {
  connectionError,
  getRecordingClient,
  responseError,
} from '../testFixtures/recordingClient';
import IndexManager from './IndexManager';

const V1 = 'test~english~books~v1';
const V2 = 'test~english~books~v2';
const V3 = 'test~english~books~v3';
const ALIAS = 'test~english~books';

const booksCreate = {
  index: 'books',
  mappings: { properties: { id: { type: 'keyword' } } },
} as const;

/** A books manager at `version` (default 2) */
function getBooks(client: Client, version = 2) {
  // serverless: false so flush() sends its request regardless of .env
  return new IndexManager(
    { client, version, prefix: 'test', serverless: false },
    booksCreate,
  );
}

/** The 404 Elasticsearch sends for `GET /_alias/<name>` with no such alias */
const aliasMissing = {
  status: 404,
  body: { error: `alias [${ALIAS}] missing`, status: 404 },
};

/** The `GET /_alias/<name>` response for an alias on the given indexes */
function aliasOn(...indexes: string[]) {
  const body: Record<string, unknown> = {};
  for (const index of indexes) {
    body[index] = { aliases: { [ALIAS]: {} } };
  }
  return { body };
}

const created = (index: string) => ({
  body: { acknowledged: true, shards_acknowledged: true, index },
});
const acknowledged = { body: { acknowledged: true } };

/** A recording client scripted for the usual happy path of version 2 */
function getScriptedClient() {
  const recording = getRecordingClient();
  const { script } = recording;
  script(`GET /_alias/${ALIAS}`, aliasMissing);
  script(`HEAD /${V2}`, { status: 404 });
  script(`PUT /${V2}`, created(V2));
  script(`PUT /${V2}/_alias/${ALIAS}`, acknowledged);
  script(`DELETE /${V2}`, acknowledged);
  script(`/${V2}/_flush`, {
    body: { _shards: { total: 1, successful: 1, failed: 0 } },
  });
  return recording;
}

const sentLines = (sent: { method: string; path: string }[]) =>
  sent.map((req) => `${req.method} ${decodeURIComponent(req.path)}`);

const envelopeKeys = ['error', 'errorKind', 'request', 'response', 'took'];
const createKeys = [
  ...envelopeKeys,
  'success',
  'code',
  'aliasIndexes',
  'indexResponse',
  'aliasResponse',
].sort();
const recreateKeys = [...createKeys, 'dropResponse', 'flushResponse'].sort();
const aliasIfNeededKeys = [
  ...envelopeKeys,
  'success',
  'code',
  'aliasIndexes',
  'aliasResponse',
].sort();

describe('IndexManager.getCreateRequest() endpoint (S-040)', () => {
  it('should describe an overridden index in request.endpoint', () => {
    const index = getBooks({} as Client);
    const request = index.getCreateRequest({ index: 'other' });
    expect(request.endpoint).toBe('/other');
    expect(request.body.index).toBe('other');
  });
});

describe('IndexManager.drop() (B-006)', () => {
  it('should report success when the alias existed', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`GET /_alias/${ALIAS}`, aliasOn(V2));
    // Elasticsearch removes the alias with the index
    script(
      `DELETE /${V2}/_alias/${ALIAS}`,
      responseError(404, 'index_not_found_exception'),
    );
    const res = await getBooks(client).drop();
    expect(res.acknowledged).toBe(true);
    expect(res.error).toBe(null);
    expect(res.errorKind).toBe(null);
    expect(sentLines(sent)).toEqual([`DELETE /${V2}`]);
  });

  it('should report a failed delete', async () => {
    const { client, script } = getScriptedClient();
    script(`DELETE /${V2}`, responseError(403, 'security_exception'));
    const res = await getBooks(client).drop();
    expect(res.acknowledged).toBe(false);
    expect(res.errorKind).toBe('response');
    expect(res.response).toMatchObject({ statusCode: 403 });
  });

  it('should describe an overridden index in request.endpoint (S-040)', async () => {
    const { client, sent } = getScriptedClient();
    const res = await getBooks(client).drop({ index: ['a', 'b'] });
    expect(res.request.endpoint).toBe('/a,b');
    expect(sent[0].path).toBe('/a%2Cb');
  });

  it('should return the same keys on success and failure', async () => {
    const ok = await getBooks(getScriptedClient().client).drop();
    const { client, script } = getScriptedClient();
    script(/.*/, connectionError());
    const failed = await getBooks(client).drop();
    expect(failed.errorKind).toBe('connection');
    expect(Object.keys(failed).sort()).toEqual(Object.keys(ok).sort());
  });
});

describe('IndexManager.createAlias() and dropAlias() endpoints (S-040)', () => {
  it('should describe overridden names in request.endpoint', async () => {
    const { client, sent } = getScriptedClient();
    const index = getBooks(client);
    const put = await index.createAlias({ index: 'i', name: 'a' });
    expect(put.request.endpoint).toBe('/i/_alias/a');
    const del = await index.dropAlias({ index: ['i', 'j'], name: 'a' });
    expect(del.request.endpoint).toBe('/i,j/_alias/a');
    expect(sentLines(sent)).toEqual([
      'PUT /i/_alias/a',
      'DELETE /i,j/_alias/a',
    ]);
  });

  it('should default to this index and alias', async () => {
    const { client } = getScriptedClient();
    const index = getBooks(client);
    const put = await index.createAlias();
    expect(put.acknowledged).toBe(true);
    expect(put.request.endpoint).toBe(`/${V2}/_alias/${ALIAS}`);
  });
});

describe('IndexManager.create() (B-031, B-029)', () => {
  it('should return the full envelope on success', async () => {
    const { client, sent } = getScriptedClient();
    const res = await getBooks(client).create();
    expect(res.success).toBe(true);
    expect(res.code).toBe('CREATED');
    expect(res.error).toBe(null);
    expect(res.errorKind).toBe(null);
    expect(res.request.endpoint).toBe(`/${V2}`);
    expect(res.indexResponse?.index).toBe(V2);
    expect(res.aliasResponse?.acknowledged).toBe(true);
    expect(Object.keys(res).sort()).toEqual(createKeys);
    expect(sentLines(sent)).toEqual([
      `GET /_alias/${ALIAS}`,
      `PUT /${V2}`,
      `PUT /${V2}/_alias/${ALIAS}`,
    ]);
  });

  it('should pass "more" to the create-index request', async () => {
    const { client, sent } = getScriptedClient();
    const res = await getBooks(client).create({ timeout: '5s' });
    expect(res.request.body.timeout).toBe('5s');
    const put = sent.find((req) => req.path === `/${V2}`);
    expect(put?.querystring).toBe('timeout=5s');
  });

  it('should skip the alias when the index cannot be created', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`PUT /${V2}`, responseError(400, 'mapper_parsing_exception'));
    const res = await getBooks(client).create();
    expect(res.success).toBe(false);
    expect(res.code).toBe('CREATE_ERROR');
    expect(res.errorKind).toBe('response');
    expect(res.response?.statusCode).toBe(400);
    expect(res.aliasResponse).toBe(null);
    expect(Object.keys(res).sort()).toEqual(createKeys);
    expect(sentLines(sent)).not.toContain(`PUT /${V2}/_alias/${ALIAS}`);
  });

  it('should report a failed alias request', async () => {
    const { client, script } = getScriptedClient();
    script(`PUT /${V2}/_alias/${ALIAS}`, responseError(400, 'invalid_alias'));
    const res = await getBooks(client).create();
    expect(res.success).toBe(false);
    expect(res.code).toBe('ALIAS_ERROR');
    expect(res.errorKind).toBe('response');
    expect(res.indexResponse?.index).toBe(V2);
    expect(res.aliasResponse?.acknowledged).toBe(false);
    expect(Object.keys(res).sort()).toEqual(createKeys);
  });

  it('should not create anything when the alias check fails', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`GET /_alias/${ALIAS}`, connectionError());
    const res = await getBooks(client).create();
    expect(res.success).toBe(false);
    expect(res.code).toBe('EXISTS_CHECK_ERROR');
    expect(res.errorKind).toBe('connection');
    expect(Object.keys(res).sort()).toEqual(createKeys);
    expect(sent).toHaveLength(1);
  });

  it('should create the index but leave an alias on an older version alone', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`GET /_alias/${ALIAS}`, aliasOn(V1));
    const res = await getBooks(client).create();
    expect(res.success).toBe(false);
    expect(res.code).toBe('NEEDS_MIGRATION');
    expect(res.error).toBe(null);
    expect(res.aliasIndexes).toEqual([V1]);
    expect(res.indexResponse?.index).toBe(V2);
    expect(res.aliasResponse).toBe(null);
    expect(Object.keys(res).sort()).toEqual(createKeys);
    expect(sentLines(sent)).toEqual([`GET /_alias/${ALIAS}`, `PUT /${V2}`]);
  });
});

describe('IndexManager.createIfNeeded() (B-029, B-030)', () => {
  it('should create the index and its alias', async () => {
    const { client, sent } = getScriptedClient();
    const res = await getBooks(client).createIfNeeded();
    expect(res.success).toBe(true);
    expect(res.code).toBe('CREATED');
    expect(res.error).toBe(null);
    expect(Object.keys(res).sort()).toEqual(createKeys);
    expect(sentLines(sent)).toEqual([
      `GET /_alias/${ALIAS}`,
      `PUT /${V2}`,
      `PUT /${V2}/_alias/${ALIAS}`,
    ]);
  });

  it('should do nothing when the alias is on this index', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`GET /_alias/${ALIAS}`, aliasOn(V2));
    const res = await getBooks(client).createIfNeeded();
    expect(res.success).toBe(true);
    expect(res.code).toBe('ALREADY_EXISTS');
    expect(res.aliasIndexes).toEqual([V2]);
    expect(Object.keys(res).sort()).toEqual(createKeys);
    expect(sentLines(sent)).toEqual([`GET /_alias/${ALIAS}`]);
  });

  it('should attach a missing alias to an existing index (B-030a)', async () => {
    const { client, script, sent } = getScriptedClient();
    script(
      `PUT /${V2}`,
      responseError(400, 'resource_already_exists_exception'),
    );
    const res = await getBooks(client).createIfNeeded();
    expect(res.success).toBe(true);
    expect(res.code).toBe('ALIAS_CREATED');
    expect(res.error).toBe(null);
    expect(res.indexResponse?.errorKind).toBe('response');
    expect(res.aliasResponse?.acknowledged).toBe(true);
    expect(Object.keys(res).sort()).toEqual(createKeys);
    expect(sentLines(sent)).toEqual([
      `GET /_alias/${ALIAS}`,
      `PUT /${V2}`,
      `PUT /${V2}/_alias/${ALIAS}`,
    ]);
  });

  it('should succeed when another process created the index first (B-030b)', async () => {
    const { client, script } = getScriptedClient();
    // the existence check would have said "missing"; the create then loses
    script(
      `PUT /${V2}`,
      responseError(400, 'resource_already_exists_exception'),
    );
    const [first, second] = await Promise.all([
      getBooks(client).createIfNeeded(),
      getBooks(client).createIfNeeded(),
    ]);
    expect([first.success, second.success]).toEqual([true, true]);
    expect([first.error, second.error]).toEqual([null, null]);
  });

  it('should leave an alias on an older version alone (B-029)', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`GET /_alias/${ALIAS}`, aliasOn(V1));
    const res = await getBooks(client).createIfNeeded();
    expect(res.success).toBe(false);
    expect(res.code).toBe('NEEDS_MIGRATION');
    expect(res.error).toBe(null);
    expect(res.errorKind).toBe(null);
    expect(res.aliasIndexes).toEqual([V1]);
    expect(Object.keys(res).sort()).toEqual(createKeys);
    expect(sentLines(sent)).toEqual([`GET /_alias/${ALIAS}`]);
  });

  it('should report migration when the alias is on this and an older index', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`GET /_alias/${ALIAS}`, aliasOn(V1, V2));
    const res = await getBooks(client).createIfNeeded();
    expect(res.code).toBe('NEEDS_MIGRATION');
    expect(res.aliasIndexes).toEqual([V1, V2]);
    expect(sent).toHaveLength(1);
  });

  it('should leave an alias on a newer version alone', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`GET /_alias/${ALIAS}`, aliasOn(V3));
    const res = await getBooks(client).createIfNeeded();
    expect(res.success).toBe(false);
    expect(res.code).toBe('NEWER_VERSION_PRESENT');
    expect(res.error).toBe(null);
    expect(sent).toHaveLength(1);
  });

  it('should leave an alias on an unrelated index alone', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`GET /_alias/${ALIAS}`, aliasOn('some-other-index'));
    const res = await getBooks(client).createIfNeeded();
    expect(res.success).toBe(false);
    expect(res.code).toBe('ALIAS_CONFLICT');
    expect(res.aliasIndexes).toEqual(['some-other-index']);
    expect(sent).toHaveLength(1);
  });

  it('should report a failed check without creating anything', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`GET /_alias/${ALIAS}`, responseError(500, 'internal_error'));
    const res = await getBooks(client).createIfNeeded();
    expect(res.success).toBe(false);
    expect(res.code).toBe('EXISTS_CHECK_ERROR');
    expect(res.errorKind).toBe('response');
    expect(Object.keys(res).sort()).toEqual(createKeys);
    expect(sent).toHaveLength(1);
  });

  it('should report a failed create', async () => {
    const { client, script } = getScriptedClient();
    script(`PUT /${V2}`, responseError(400, 'mapper_parsing_exception'));
    const res = await getBooks(client).createIfNeeded();
    expect(res.success).toBe(false);
    expect(res.code).toBe('CREATE_ERROR');
    expect(res.errorKind).toBe('response');
    expect(Object.keys(res).sort()).toEqual(createKeys);
  });

  it('should report a failed alias request', async () => {
    const { client, script } = getScriptedClient();
    script(`PUT /${V2}/_alias/${ALIAS}`, connectionError());
    const res = await getBooks(client).createIfNeeded();
    expect(res.success).toBe(false);
    expect(res.code).toBe('ALIAS_ERROR');
    expect(res.errorKind).toBe('connection');
    expect(Object.keys(res).sort()).toEqual(createKeys);
  });
});

describe('IndexManager.createAliasIfNeeded() (B-078, B-029)', () => {
  it('should create a missing alias and report took', async () => {
    const { client, sent } = getScriptedClient();
    const res = await getBooks(client).createAliasIfNeeded();
    expect(res.success).toBe(true);
    expect(res.code).toBe('CREATED');
    expect(typeof res.took).toBe('number');
    expect(res.error).toBe(null);
    expect(res.request.endpoint).toBe(`/${V2}/_alias/${ALIAS}`);
    expect(Object.keys(res).sort()).toEqual(aliasIfNeededKeys);
    expect(sentLines(sent)).toEqual([
      `GET /_alias/${ALIAS}`,
      `PUT /${V2}/_alias/${ALIAS}`,
    ]);
  });

  it('should do nothing when the alias is on this index', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`GET /_alias/${ALIAS}`, aliasOn(V2));
    const res = await getBooks(client).createAliasIfNeeded();
    expect(res.success).toBe(true);
    expect(res.code).toBe('ALREADY_EXISTS');
    expect(Object.keys(res).sort()).toEqual(aliasIfNeededKeys);
    expect(sent).toHaveLength(1);
  });

  it('should not add the alias to a second index (B-029)', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`GET /_alias/${ALIAS}`, aliasOn(V1));
    const res = await getBooks(client).createAliasIfNeeded();
    expect(res.success).toBe(false);
    expect(res.code).toBe('NEEDS_MIGRATION');
    expect(res.aliasIndexes).toEqual([V1]);
    expect(Object.keys(res).sort()).toEqual(aliasIfNeededKeys);
    expect(sent).toHaveLength(1);
  });

  it('should report a failed check', async () => {
    const { client, script } = getScriptedClient();
    script(`GET /_alias/${ALIAS}`, connectionError());
    const res = await getBooks(client).createAliasIfNeeded();
    expect(res.success).toBe(false);
    expect(res.code).toBe('EXISTS_CHECK_ERROR');
    expect(res.errorKind).toBe('connection');
    expect(Object.keys(res).sort()).toEqual(aliasIfNeededKeys);
  });

  it('should report a failed alias request', async () => {
    const { client, script } = getScriptedClient();
    script(
      `PUT /${V2}/_alias/${ALIAS}`,
      responseError(404, 'index_not_found_exception'),
    );
    const res = await getBooks(client).createAliasIfNeeded();
    expect(res.success).toBe(false);
    expect(res.code).toBe('ALIAS_ERROR');
    expect(res.errorKind).toBe('response');
    expect(res.aliasResponse?.acknowledged).toBe(false);
    expect(Object.keys(res).sort()).toEqual(aliasIfNeededKeys);
  });
});

describe('IndexManager.recreate() (B-080)', () => {
  it('should drop, create and flush', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`HEAD /${V2}`, { status: 200 });
    script(`GET /_alias/${ALIAS}`, aliasMissing);
    const res = await getBooks(client).recreate();
    expect(res.success).toBe(true);
    expect(res.code).toBe('CREATED');
    expect(res.error).toBe(null);
    expect(res.dropResponse?.acknowledged).toBe(true);
    expect(res.flushResponse?.success).toBe(true);
    expect(res.took).toBeGreaterThanOrEqual(res.dropResponse?.took ?? 0);
    expect(Object.keys(res).sort()).toEqual(recreateKeys);
    expect(sentLines(sent)).toEqual([
      `HEAD /${V2}`,
      `DELETE /${V2}`,
      `GET /_alias/${ALIAS}`,
      `PUT /${V2}`,
      `PUT /${V2}/_alias/${ALIAS}`,
      `GET /${V2}/_flush`,
    ]);
  });

  it('should skip the drop when the index does not exist', async () => {
    const { client, sent } = getScriptedClient();
    const res = await getBooks(client).recreate();
    expect(res.success).toBe(true);
    expect(res.dropResponse).toBe(null);
    expect(sentLines(sent)).not.toContain(`DELETE /${V2}`);
  });

  it('should stop when the existence check fails', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`HEAD /${V2}`, connectionError());
    const res = await getBooks(client).recreate();
    expect(res.success).toBe(false);
    expect(res.code).toBe('EXISTS_CHECK_ERROR');
    expect(res.errorKind).toBe('connection');
    expect(Object.keys(res).sort()).toEqual(recreateKeys);
    expect(sent).toHaveLength(1);
  });

  it('should stop when the drop fails', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`HEAD /${V2}`, { status: 200 });
    script(`DELETE /${V2}`, responseError(403, 'security_exception'));
    const res = await getBooks(client).recreate();
    expect(res.success).toBe(false);
    expect(res.code).toBe('DROP_ERROR');
    expect(res.errorKind).toBe('response');
    expect(res.response?.statusCode).toBe(403);
    expect(res.dropResponse?.acknowledged).toBe(false);
    expect(Object.keys(res).sort()).toEqual(recreateKeys);
    expect(sentLines(sent)).toEqual([`HEAD /${V2}`, `DELETE /${V2}`]);
  });

  it('should not flush when the create fails', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`PUT /${V2}`, responseError(400, 'mapper_parsing_exception'));
    const res = await getBooks(client).recreate();
    expect(res.success).toBe(false);
    expect(res.code).toBe('CREATE_ERROR');
    expect(res.flushResponse).toBe(null);
    expect(Object.keys(res).sort()).toEqual(recreateKeys);
    expect(sentLines(sent)).not.toContain(`GET /${V2}/_flush`);
  });

  it('should report a failed flush', async () => {
    const { client, script } = getScriptedClient();
    script(`/${V2}/_flush`, responseError(500, 'flush_failed'));
    const res = await getBooks(client).recreate();
    expect(res.success).toBe(false);
    expect(res.code).toBe('FLUSH_ERROR');
    expect(res.errorKind).toBe('response');
    expect(res.flushResponse?.success).toBe(false);
    expect(Object.keys(res).sort()).toEqual(recreateKeys);
  });

  it('should leave an alias on an older version alone (B-029)', async () => {
    const { client, script, sent } = getScriptedClient();
    script(`GET /_alias/${ALIAS}`, aliasOn(V1));
    const res = await getBooks(client).recreate();
    expect(res.success).toBe(false);
    expect(res.code).toBe('NEEDS_MIGRATION');
    expect(res.flushResponse).toBe(null);
    expect(sentLines(sent)).not.toContain(`PUT /${V2}/_alias/${ALIAS}`);
  });
});
