import { describe, expect, it } from 'bun:test';
import type { Client } from '@elastic/elasticsearch';
import {
  connectionError,
  getRecordingClient,
  responseError,
  type SentRequest,
} from '../testFixtures/recordingClient';
import IndexManager from './IndexManager';

const ALIAS = 'test~english~books';

const booksCreate = {
  index: 'books',
  mappings: {
    properties: {
      id: { type: 'keyword' },
      title: { type: 'text' },
      year: { type: 'integer' },
      embedding: { type: 'dense_vector', dims: 3 },
    },
  },
} as const;

function getBooks(client: Client) {
  return new IndexManager({ client, version: 1, prefix: 'test' }, booksCreate);
}

const envelopeKeys = ['error', 'errorKind', 'request', 'response', 'took'];
const keysOf = (value: object) => Object.keys(value).sort();
const sorted = (keys: string[]) => [...keys].sort();
const query = (req: SentRequest) =>
  Object.fromEntries(new URLSearchParams(req.querystring ?? ''));
/** The `statusCode` of an error envelope's `response` */
const statusOf = (res: { response: unknown }) =>
  (res.response as { statusCode?: number } | null)?.statusCode;

/** A bulk response answering every `index` action in the request */
function bulkReply(failIds: string[] = []) {
  return (req: SentRequest) => {
    const rows = req.body as Record<string, { _id: string }>[];
    const items = [];
    for (let i = 0; i < rows.length; i += 2) {
      const _id = rows[i].index._id;
      if (failIds.includes(_id)) {
        const error = { type: 'document_parsing_exception', reason: 'bad' };
        items.push({ index: { _id, status: 400, error } });
      } else {
        const op = { _id, status: 201, result: 'created', _version: 1 };
        items.push({ index: op });
      }
    }
    return { body: { took: 3, errors: failIds.length > 0, items } };
  };
}

describe('IndexManager.put() (CRUD)', () => {
  it('should send request params from "more" (S-014)', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).put(
      'b1',
      { id: 'b1' },
      { refresh: 'wait_for', if_seq_no: 3, if_primary_term: 1 },
    );
    expect(res.error).toBe(null);
    expect(sent[0].path).toBe(`/${ALIAS}/_doc/b1`);
    expect(query(sent[0])).toEqual({
      refresh: 'wait_for',
      if_seq_no: '3',
      if_primary_term: '1',
    });
    expect(sent[0].body).toEqual({ id: 'b1' });
  });

  it('should not let "more" replace the index, id or record', async () => {
    const { client, sent } = getRecordingClient();
    const more = { index: 'other', id: 'x', document: { id: 'x' } };
    // @ts-expect-error  index, id and document are not request params
    await getBooks(client).put('b1', { id: 'b1' }, more);
    expect(sent[0].path).toBe(`/${ALIAS}/_doc/b1`);
    expect(sent[0].body).toEqual({ id: 'b1' });
  });

  it('should return the envelope on failure', async () => {
    const { client, script } = getRecordingClient();
    script(`PUT /${ALIAS}/_doc/b1`, responseError(409, 'conflict'));
    const res = await getBooks(client).put('b1', { id: 'b1' });
    expect(res.result).toBe(null);
    expect(res.errorKind).toBe('response');
    expect(statusOf(res)).toBe(409);
    expect(keysOf(res)).toEqual(sorted([...envelopeKeys, 'result']));
  });
});

describe('IndexManager.putBulk()', () => {
  it('should keep ids 0 and "" and generate only missing ids (B-039)', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_bulk`, bulkReply());
    const res = await getBooks(client).putBulk([
      { id: 0 as unknown as string, title: 'zero' },
      { id: '', title: 'empty' },
      { title: 'none' },
      { id: null as unknown as string, title: 'null' },
    ]);
    const rows = sent[0].body as Record<string, { _id: string }>[];
    const ids = [rows[0], rows[2], rows[4], rows[6]].map((r) => r.index._id);
    expect(ids[0]).toBe('0');
    expect(ids[1]).toBe('');
    expect(ids[2]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[3]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[2]).not.toBe(ids[3]);
    // generated ids are returned (B-039, S-015)
    expect(res.report.map((row) => row.id)).toEqual(ids);
  });

  it('should return a full envelope with error null on success (B-039)', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_bulk`, bulkReply());
    const res = await getBooks(client).putBulk([{ id: 'a' }, { id: 'b' }], {
      refresh: true,
    });
    expect(res.success).toBe(true);
    expect(res.error).toBe(null);
    expect(res.errorKind).toBe(null);
    expect(res.errors).toEqual([]);
    expect(res.response?.items).toHaveLength(2);
    expect(res.report).toEqual([
      { id: 'a', status: 201, effect: 'created', version: 1, error: null },
      { id: 'b', status: 201, effect: 'created', version: 1, error: null },
    ]);
    // request params are not copied into the result (B-039)
    expect('refresh' in res).toBe(false);
    expect(keysOf(res)).toEqual(
      sorted([...envelopeKeys, 'success', 'errors', 'report']),
    );
  });

  it('should send request params from "more" with every chunk', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_bulk`, bulkReply());
    await getBooks(client).putBulk(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      { refresh: 'wait_for' },
      { chunkSize: 2 },
    );
    expect(sent).toHaveLength(2);
    expect(sent.map(query)).toEqual([
      { refresh: 'wait_for' },
      { refresh: 'wait_for' },
    ]);
  });

  it('should send nothing for an empty array (S-015)', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).putBulk([]);
    expect(sent).toEqual([]);
    expect(res.success).toBe(true);
    expect(res.error).toBe(null);
    expect(res.report).toEqual([]);
    expect(res.response).toEqual({ errors: false, items: [], took: 0 });
    expect(keysOf(res)).toEqual(
      sorted([...envelopeKeys, 'success', 'errors', 'report']),
    );
  });

  it('should split large inputs by count (S-015)', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_bulk`, bulkReply());
    const records = ['1', '2', '3', '4', '5'].map((id) => ({ id }));
    const res = await getBooks(client).putBulk(records, undefined, {
      chunkSize: 2,
    });
    expect(sent.map((req) => (req.body as unknown[]).length)).toEqual([
      4, 4, 2,
    ]);
    expect(res.success).toBe(true);
    expect(res.report.map((row) => row.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(res.response?.items).toHaveLength(5);
    expect(res.response?.took).toBe(9);
  });

  it('should split large inputs by size (S-015)', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_bulk`, bulkReply());
    const title = 'x'.repeat(400);
    const records = ['1', '2', '3'].map((id) => ({ id, title }));
    await getBooks(client).putBulk(records, undefined, { chunkBytes: 1000 });
    expect(sent.map((req) => (req.body as unknown[]).length)).toEqual([4, 2]);
  });

  it('should send a record larger than chunkBytes on its own', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_bulk`, bulkReply());
    const records = [{ id: '1', title: 'x'.repeat(2000) }, { id: '2' }];
    const res = await getBooks(client).putBulk(records, undefined, {
      chunkBytes: 1000,
    });
    expect(sent).toHaveLength(2);
    expect(res.success).toBe(true);
  });

  it('should reject invalid chunk options without sending', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).putBulk([{ id: '1' }], undefined, {
      chunkSize: 0,
    });
    expect(sent).toEqual([]);
    expect(res.success).toBe(false);
    expect(res.error).toBeInstanceOf(RangeError);
    expect(res.errorKind).toBe('javascript');
  });

  it('should aggregate row errors into one error', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_bulk`, bulkReply(['b']));
    const res = await getBooks(client).putBulk([{ id: 'a' }, { id: 'b' }]);
    expect(res.success).toBe(false);
    expect(res.error).toBeInstanceOf(AggregateError);
    expect(res.error?.message).toContain('1 of 2');
    expect((res.error as AggregateError).errors).toHaveLength(1);
    expect(res.errorKind).toBe('response');
    expect(statusOf(res)).toBe(200);
    expect(res.errors).toEqual([
      { type: 'document_parsing_exception', reason: 'bad' },
    ]);
    expect(res.report[1]).toMatchObject({ id: 'b', status: 400 });
    expect(res.report[1].error?.type).toBe('document_parsing_exception');
  });

  it('should stop at a failed request and report unsent rows', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_bulk`, bulkReply(), connectionError(), bulkReply());
    const records = ['1', '2', '3', '4', '5'].map((id) => ({ id }));
    const res = await getBooks(client).putBulk(records, undefined, {
      chunkSize: 2,
    });
    expect(sent).toHaveLength(2);
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe('connection');
    expect(res.report.map((row) => row.status)).toEqual([
      201,
      201,
      null,
      null,
      null,
    ]);
    expect(res.report.map((row) => row.id)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('should catch a request failure on the first chunk', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_bulk`, responseError(413, 'too_large'));
    const res = await getBooks(client).putBulk([{ id: 'a' }]);
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe('response');
    expect(statusOf(res)).toBe(413);
    expect(res.report).toEqual([
      { id: 'a', status: null, effect: null, version: null, error: null },
    ]);
  });

  it('should type its options', async () => {
    const { client } = getRecordingClient();
    const books = getBooks(client);
    // @ts-expect-error  operations are built from the records
    await books.putBulk([], { operations: [] });
    // @ts-expect-error  unknown option
    await books.putBulk([], {}, { chunks: 2 });
    expect(true).toBe(true);
  });
});

describe('IndexManager.patch() (CRUD)', () => {
  it('should report the result Elasticsearch gives (B-085)', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_update/b1`, { body: { result: 'noop' } });
    script(`POST /${ALIAS}/_update/b2`, { body: { result: 'created' } });
    const books = getBooks(client);
    expect((await books.patch('b1', { year: 1 })).result).toBe('noop');
    expect((await books.patch('b2', { year: 1 })).result).toBe('created');
  });

  it('should retry on conflict by default (S-014)', async () => {
    const { client, sent } = getRecordingClient();
    await getBooks(client).patch(7, { year: 1 });
    expect(sent[0].path).toBe(`/${ALIAS}/_update/7`);
    expect(query(sent[0])).toEqual({ retry_on_conflict: '3' });
  });

  it('should let "more" set retry_on_conflict', async () => {
    const { client, sent } = getRecordingClient();
    await getBooks(client).patch('b1', { year: 1 }, { retry_on_conflict: 0 });
    expect(query(sent[0])).toEqual({ retry_on_conflict: '0' });
  });

  it('should not retry when given if_seq_no (ES rejects both)', async () => {
    const { client, sent } = getRecordingClient();
    await getBooks(client).patch(
      'b1',
      { year: 1 },
      { if_seq_no: 4, if_primary_term: 1 },
    );
    expect(query(sent[0])).toEqual({ if_seq_no: '4', if_primary_term: '1' });
  });

  it('should not let "more" replace the index, id or doc', async () => {
    const { client, sent } = getRecordingClient();
    const more = { index: 'other', id: 'x', doc: { year: 2 } };
    // @ts-expect-error  index, id and doc are not request params
    await getBooks(client).patch('b1', { year: 1 }, more);
    expect(sent[0].path).toBe(`/${ALIAS}/_update/b1`);
    expect(sent[0].body).toEqual({ doc: { year: 1 } });
  });

  it('should return result null and the envelope on failure', async () => {
    const { client, script } = getRecordingClient();
    script(`POST /${ALIAS}/_update/b1`, responseError(404, 'document_missing'));
    const res = await getBooks(client).patch('b1', { year: 1 });
    expect(res.success).toBe(false);
    expect(res.result).toBe(null);
    expect(res.errorKind).toBe('response');
    expect(keysOf(res)).toEqual(sorted([...envelopeKeys, 'success', 'result']));
  });
});

describe('IndexManager.findById()', () => {
  const hit = {
    _index: 'test~english~books~v1',
    _id: 'b1',
    found: true,
    _source: { id: 'b1', title: 'Dune' },
  };

  it('should return the record, found and request (B-086)', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`GET /${ALIAS}/_doc/b1`, { body: hit });
    const res = await getBooks(client).findById('b1');
    expect(res.record).toEqual({ id: 'b1', title: 'Dune' });
    expect(res.found).toBe(true);
    expect(res.error).toBe(null);
    expect(res.request).toEqual({
      method: 'GET',
      endpoint: `/${ALIAS}/_doc/b1`,
      body: { index: ALIAS, id: 'b1' },
    });
    expect(sent).toHaveLength(1);
    expect(keysOf(res)).toEqual(sorted([...envelopeKeys, 'record', 'found']));
  });

  it('should report a missing document without an error (B-086)', async () => {
    const { client, script } = getRecordingClient();
    const miss = { _index: 'test~english~books~v1', _id: 'b9', found: false };
    script(`GET /${ALIAS}/_doc/b9`, { status: 404, body: miss });
    const res = await getBooks(client).findById('b9');
    expect(res.record).toBe(null);
    expect(res.found).toBe(false);
    expect(res.error).toBe(null);
    expect(res.errorKind).toBe(null);
    expect(res.response).toEqual(miss);
    expect(res.request.endpoint).toBe(`/${ALIAS}/_doc/b9`);
    expect(keysOf(res)).toEqual(sorted([...envelopeKeys, 'record', 'found']));
  });

  it('should report a missing index as an error', async () => {
    const { client, script } = getRecordingClient();
    script(`GET /${ALIAS}/_doc/b1`, responseError(404, 'index_not_found'));
    const res = await getBooks(client).findById('b1');
    expect(res.record).toBe(null);
    expect(res.found).toBe(false);
    expect(res.errorKind).toBe('response');
    expect(res.request.endpoint).toBe(`/${ALIAS}/_doc/b1`);
    expect(keysOf(res)).toEqual(sorted([...envelopeKeys, 'record', 'found']));
  });

  it('should report a connection failure as an error', async () => {
    const { client, script } = getRecordingClient();
    script(`GET /${ALIAS}/_doc/b1`, connectionError());
    const res = await getBooks(client).findById('b1');
    expect(res.errorKind).toBe('connection');
    expect(res.found).toBe(false);
  });

  it('should accept numeric ids and params (S-014)', async () => {
    const { client, sent } = getRecordingClient();
    await getBooks(client).findById(5, { realtime: false });
    expect(sent[0].path).toBe(`/${ALIAS}/_doc/5`);
    expect(query(sent[0])).toEqual({ realtime: 'false' });
  });

  it('should not let "more" replace the index or id (B-086)', async () => {
    const { client, sent } = getRecordingClient();
    // @ts-expect-error  index and id are not request params
    await getBooks(client).findById('b1', { index: 'other', id: 'x' });
    expect(sent[0].path).toBe(`/${ALIAS}/_doc/b1`);
  });
});

describe('IndexManager.deleteById()', () => {
  it('should send request params from "more" (S-014)', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`DELETE /${ALIAS}/_doc/3`, { body: { result: 'deleted' } });
    const res = await getBooks(client).deleteById(3, {
      refresh: true,
      if_seq_no: 2,
      if_primary_term: 1,
    });
    expect(res.success).toBe(true);
    expect(res.result).toBe('deleted');
    expect(sent[0].path).toBe(`/${ALIAS}/_doc/3`);
    expect(query(sent[0])).toEqual({
      refresh: 'true',
      if_seq_no: '2',
      if_primary_term: '1',
    });
    expect(keysOf(res)).toEqual(sorted([...envelopeKeys, 'success', 'result']));
  });

  it('should return the envelope on failure', async () => {
    const { client, script } = getRecordingClient();
    script(`DELETE /${ALIAS}/_doc/3`, responseError(409, 'conflict'));
    const res = await getBooks(client).deleteById('3');
    expect(res.success).toBe(false);
    expect(res.result).toBe(null);
    expect(res.errorKind).toBe('response');
    expect(keysOf(res)).toEqual(sorted([...envelopeKeys, 'success', 'result']));
  });
});

describe('IndexManager.deleteMany()', () => {
  const deleteManyKeys = sorted([
    ...envelopeKeys,
    'success',
    'deleted',
    'versionConflicts',
    'failures',
  ]);
  const path = `/${ALIAS}/_delete_by_query`;

  it('should send "more" as request params (B-033)', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST ${path}`, { body: { deleted: 2, version_conflicts: 1 } });
    const res = await getBooks(client).deleteMany((qb) => qb.term('id', '1'), {
      conflicts: 'proceed',
      refresh: true,
    });
    expect(query(sent[0])).toEqual({ conflicts: 'proceed', refresh: 'true' });
    expect(sent[0].body).toEqual({ query: { term: { id: '1' } } });
    expect(res.success).toBe(true);
    expect(res.deleted).toBe(2);
    expect(res.versionConflicts).toBe(1);
    expect(res.failures).toEqual([]);
  });

  it('should use the { method, endpoint, body } request shape (S-016)', async () => {
    const { client } = getRecordingClient();
    const res = await getBooks(client).deleteMany((qb) => qb.term('id', '1'), {
      refresh: true,
    });
    expect(res.request).toEqual({
      method: 'POST',
      endpoint: path,
      body: { index: ALIAS, query: { term: { id: '1' } }, refresh: true },
    });
    expect(keysOf(res)).toEqual(deleteManyKeys);
  });

  it('should delete every document without a callback (D6)', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).deleteMany();
    expect(sent[0].path).toBe(path);
    expect(sent[0].body).toEqual({ query: { match_all: {} } });
    expect(res.error).toBe(null);
  });

  it('should refuse a builder that produces no query (B-034)', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).deleteMany((qb) =>
      qb.knn({ field: 'embedding', vector: [1, 0, 0], k: 1, weight: 1 }),
    );
    expect(sent).toEqual([]);
    expect(res.success).toBe(false);
    expect(res.error?.message).toContain('query');
    expect(res.errorKind).toBe('javascript');
    expect(res.deleted).toBe(null);
    expect(keysOf(res)).toEqual(deleteManyKeys);
  });

  it('should catch an error thrown by the callback (B-087)', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).deleteMany(() => {
      throw new RangeError('bad builder');
    });
    expect(sent).toEqual([]);
    expect(res.success).toBe(false);
    expect(res.error).toBeInstanceOf(RangeError);
    expect(res.errorKind).toBe('javascript');
    expect(keysOf(res)).toEqual(deleteManyKeys);
  });

  it('should catch a rejection from an async callback (B-087)', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).deleteMany(async () => {
      throw new Error('async');
    });
    expect(sent).toEqual([]);
    expect(res.error?.message).toBe('async');
  });

  it('should fail when the response lists failures (S-016)', async () => {
    const { client, script } = getRecordingClient();
    const failure = {
      index: 'test~english~books~v1',
      id: '1',
      status: 500,
      cause: { type: 'exception', reason: 'shard down' },
    };
    script(`POST ${path}`, { body: { deleted: 1, failures: [failure] } });
    const res = await getBooks(client).deleteMany();
    expect(res.success).toBe(false);
    expect(res.deleted).toBe(1);
    expect(res.failures).toEqual([failure]);
    expect(res.error).toBeInstanceOf(AggregateError);
    expect(res.errorKind).toBe('response');
    expect(statusOf(res)).toBe(200);
  });

  it('should fail when the request timed out (S-016)', async () => {
    const { client, script } = getRecordingClient();
    script(`POST ${path}`, { body: { deleted: 0, timed_out: true } });
    const res = await getBooks(client).deleteMany();
    expect(res.success).toBe(false);
    expect(res.error?.message).toContain('timed out');
  });

  it('should return the envelope when the request fails', async () => {
    const { client, script } = getRecordingClient();
    script(`POST ${path}`, responseError(409, 'version_conflict'));
    const res = await getBooks(client).deleteMany();
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe('response');
    expect(res.deleted).toBe(null);
    expect(keysOf(res)).toEqual(deleteManyKeys);
  });

  it('should type "more" as delete-by-query params (B-033)', async () => {
    const { client } = getRecordingClient();
    // @ts-expect-error  size is a search param
    await getBooks(client).deleteMany(undefined, { size: 1 });
    await getBooks(client).deleteMany(undefined, { max_docs: 1 });
    expect(true).toBe(true);
  });
});

describe('IndexManager query methods with a throwing callback (B-087)', () => {
  const thrower = () => {
    throw new TypeError('bad builder');
  };

  it('should return an envelope from findMany()', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).findMany(thrower);
    expect(sent).toEqual([]);
    expect(res.records).toEqual([]);
    expect(res.total).toBe(null);
    expect(res.error).toBeInstanceOf(TypeError);
    expect('errorKind' in res && res.errorKind).toBe('javascript');
  });

  it('should return an envelope from findFirst()', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).findFirst(async () => {
      throw new Error('async');
    });
    expect(sent).toEqual([]);
    expect(res.record).toBe(undefined);
    expect(res.error?.message).toBe('async');
  });

  it('should return an envelope from count()', async () => {
    const { client, sent } = getRecordingClient();
    const res = await getBooks(client).count(thrower);
    expect(sent).toEqual([]);
    expect(res.total).toBe(null);
    expect(res.error).toBeInstanceOf(TypeError);
  });

  it('should still run a valid callback', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_count`, { body: { count: 4 } });
    const res = await getBooks(client).count((qb) => qb.term('id', '1'));
    expect(res.total).toBe(4);
    expect(sent[0].body).toEqual({ query: { term: { id: '1' } } });
  });
});

describe('IndexManager.count() params (B-017)', () => {
  it('should send count params', async () => {
    const { client, sent, script } = getRecordingClient();
    script(`POST /${ALIAS}/_count`, { body: { count: 1 } });
    await getBooks(client).count(undefined, { min_score: 2 });
    expect(query(sent[0])).toEqual({ min_score: '2' });
  });

  it('should not accept search-only params', async () => {
    const { client } = getRecordingClient();
    // @ts-expect-error  size is a search param, not a count param
    await getBooks(client).count(undefined, { size: 1 });
    // @ts-expect-error  sort is a search param, not a count param
    await getBooks(client).count(undefined, { sort: ['id'] });
    expect(true).toBe(true);
  });
});
