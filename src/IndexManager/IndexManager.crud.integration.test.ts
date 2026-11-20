import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { createTestKit } from '../testFixtures/esTestKit';
import IndexManager from './IndexManager';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('im-crud');

// every index and alias below starts with kit.prefix
afterAll(async () => {
  await kit.cleanup();
});

const notesCreate = (index: string) =>
  ({
    index,
    mappings: {
      properties: {
        id: { type: 'keyword' },
        title: { type: 'text' },
        n: { type: 'integer' },
        embedding: { type: 'dense_vector', dims: 3, similarity: 'cosine' },
      },
    },
  }) as const;

/** A created, empty notes index managed through its alias */
async function getNotes(name: string) {
  const manager = new IndexManager(
    { client: kit.client, prefix: kit.prefix },
    notesCreate(name),
  );
  const created = await manager.create();
  if (!created.success) {
    throw created.error ?? new Error(`create failed: ${created.code}`);
  }
  return manager;
}

/** The number of documents, after a refresh */
async function countDocs(manager: IndexManager) {
  const index = manager.getAliasName();
  await kit.client.indices.refresh({ index });
  return (await kit.client.count({ index })).count;
}

/** The `statusCode` of an error envelope's `response` */
const statusOf = (res: { response: unknown }) =>
  (res.response as { statusCode?: number } | null)?.statusCode;

/** `if_seq_no`/`if_primary_term` from a successful write's response */
function seqOf(res: { response: unknown }) {
  const response = res.response as {
    _seq_no?: number;
    _primary_term?: number;
  } | null;
  return {
    if_seq_no: response?._seq_no ?? -1,
    if_primary_term: response?._primary_term ?? -1,
  };
}

describe('IndexManager.putBulk() - Integration', () => {
  it('should store id 0 as "0" and reject only the "" row', async () => {
    const notes = await getNotes('bulk-ids');
    const res = await notes.putBulk(
      [
        { id: 0 as unknown as string, title: 'zero' },
        { id: '', title: 'empty' },
        { id: 'a', title: 'a' },
      ],
      { refresh: true },
    );
    expect(res.success).toBe(false);
    expect(res.report.map((row) => row.id)).toEqual(['0', '', 'a']);
    expect(res.report.map((row) => row.status)).toEqual([201, 400, 201]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].reason).toContain('must not be empty');
    const zero = await notes.findById(0);
    expect(zero.found).toBe(true);
    expect(zero.record?.title).toBe('zero');
    // re-putting id 0 replaces it rather than creating a duplicate
    await notes.putBulk([{ id: 0 as unknown as string, title: 'zero!' }], {
      refresh: true,
    });
    expect(await countDocs(notes)).toBe(2);
    expect((await notes.findById('0')).record?.title).toBe('zero!');
  });

  it('should return generated ids', async () => {
    const notes = await getNotes('bulk-generated');
    const res = await notes.putBulk([{ title: 'one' }, { title: 'two' }], {
      refresh: true,
    });
    expect(res.success).toBe(true);
    expect(res.error).toBe(null);
    const [first, second] = res.report.map((row) => row.id);
    expect(first).not.toBe(second);
    expect((await notes.findById(first)).record?.title).toBe('one');
    expect((await notes.findById(second)).record?.title).toBe('two');
  });

  it('should send nothing for an empty array', async () => {
    const notes = await getNotes('bulk-empty');
    const res = await notes.putBulk([]);
    expect(res.success).toBe(true);
    expect(res.error).toBe(null);
    expect(res.report).toEqual([]);
    expect(await countDocs(notes)).toBe(0);
  });

  it('should store a batch larger than the chunk size', async () => {
    const notes = await getNotes('bulk-chunks');
    const records = Array.from({ length: 7 }, (_, i) => ({
      id: String(i + 1),
      n: i + 1,
    }));
    const res = await notes.putBulk(
      records,
      { refresh: true },
      { chunkSize: 3 },
    );
    expect(res.success).toBe(true);
    expect(res.report).toHaveLength(7);
    expect(res.report.every((row) => row.effect === 'created')).toBe(true);
    expect(res.response?.items).toHaveLength(7);
    expect(await countDocs(notes)).toBe(7);
  });

  it('should aggregate one bad document and store the good ones', async () => {
    const notes = await getNotes('bulk-bad');
    const res = await notes.putBulk(
      [
        { id: '1', n: 1 },
        { id: '2', n: 'not a number' as unknown as number },
        { id: '3', n: 3 },
      ],
      { refresh: true },
    );
    expect(res.success).toBe(false);
    expect(res.error).toBeInstanceOf(AggregateError);
    expect((res.error as AggregateError).errors).toHaveLength(1);
    expect(res.errorKind).toBe('response');
    expect(statusOf(res)).toBe(200);
    expect(res.report[1].error?.type).toBe('document_parsing_exception');
    expect(res.report.map((row) => row.effect)).toEqual([
      'created',
      null,
      'created',
    ]);
    expect(await countDocs(notes)).toBe(2);
    expect((await notes.findById('2')).found).toBe(false);
  });
});

describe('IndexManager.patch() - Integration', () => {
  it('should report noop and created', async () => {
    const notes = await getNotes('patch');
    await notes.put('1', { id: '1', n: 1 }, { refresh: true });
    const same = await notes.patch('1', { n: 1 });
    expect(same.error).toBe(null);
    expect(same.result).toBe('noop');
    const changed = await notes.patch('1', { n: 2 });
    expect(changed.result).toBe('updated');
    const upserted = await notes.patch(
      '2',
      { id: '2', n: 5 },
      { doc_as_upsert: true },
    );
    expect(upserted.result).toBe('created');
    expect((await notes.findById('2')).record?.n).toBe(5);
  });

  it('should honor if_seq_no instead of retrying', async () => {
    const notes = await getNotes('patch-seq');
    const put = await notes.put('1', { id: '1', n: 1 });
    const seq = seqOf(put);
    const first = await notes.patch('1', { n: 2 }, seq);
    expect(first.result).toBe('updated');
    const stale = await notes.patch('1', { n: 3 }, seq);
    expect(stale.success).toBe(false);
    expect(statusOf(stale)).toBe(409);
  });
});

describe('IndexManager.findById() - Integration', () => {
  it('should find a hit and report a miss without an error', async () => {
    const notes = await getNotes('find');
    await notes.put(1, { id: '1', title: 'hello' });
    const hit = await notes.findById(1);
    expect(hit.found).toBe(true);
    expect(hit.error).toBe(null);
    expect(hit.record).toEqual({ id: '1', title: 'hello' });
    expect(hit.request.endpoint).toBe(`/${notes.getAliasName()}/_doc/1`);
    const miss = await notes.findById('nope');
    expect(miss.found).toBe(false);
    expect(miss.record).toBe(null);
    expect(miss.error).toBe(null);
    expect(miss.errorKind).toBe(null);
    expect(miss.request.endpoint).toBe(`/${notes.getAliasName()}/_doc/nope`);
  });

  it('should report a missing index as an error', async () => {
    const missing = new IndexManager(
      { client: kit.client, prefix: kit.prefix },
      notesCreate('never-created'),
    );
    const res = await missing.findById('1');
    expect(res.found).toBe(false);
    expect(res.errorKind).toBe('response');
    expect(statusOf(res)).toBe(404);
  });
});

describe('IndexManager.put() and deleteById() - Integration', () => {
  it('should honor refresh', async () => {
    const notes = await getNotes('refresh');
    const put = await notes.put('1', { id: '1' }, { refresh: true });
    expect(put.result).toBe('created');
    // visible to search without an explicit refresh
    const index = notes.getAliasName();
    expect((await kit.client.count({ index })).count).toBe(1);
    const deleted = await notes.deleteById('1', { refresh: true });
    expect(deleted.success).toBe(true);
    expect(deleted.result).toBe('deleted');
    expect((await kit.client.count({ index })).count).toBe(0);
  });

  it('should honor if_seq_no and if_primary_term', async () => {
    const notes = await getNotes('seq-no');
    const first = await notes.put('1', { id: '1', n: 1 });
    const stale = seqOf(first);
    const update = await notes.put('1', { id: '1', n: 2 }, stale);
    expect(update.result).toBe('updated');
    const stalePut = await notes.put('1', { id: '1', n: 3 }, stale);
    expect(stalePut.result).toBe(null);
    expect(statusOf(stalePut)).toBe(409);
    const staleDelete = await notes.deleteById('1', stale);
    expect(staleDelete.success).toBe(false);
    expect(statusOf(staleDelete)).toBe(409);
    expect((await notes.findById('1')).record?.n).toBe(2);
    const deleted = await notes.deleteById('1', seqOf(update));
    expect(deleted.success).toBe(true);
    expect(deleted.result).toBe('deleted');
  });

  it('should accept op_type create once', async () => {
    const notes = await getNotes('op-type');
    const first = await notes.put('1', { id: '1' }, { op_type: 'create' });
    expect(first.result).toBe('created');
    const second = await notes.put('1', { id: '1' }, { op_type: 'create' });
    expect(second.result).toBe(null);
    expect(statusOf(second)).toBe(409);
  });
});

describe('IndexManager.deleteMany() - Integration', () => {
  const docs = ['1', '2', '3', '4'].map((id) => ({
    id,
    n: Number(id),
    embedding: [1, 0, Number(id)],
  }));

  it('should honor refresh and other params', async () => {
    const notes = await getNotes('dbq-params');
    await notes.putBulk(docs, { refresh: true });
    const res = await notes.deleteMany((qb) => qb.range('n', 'gte', 2), {
      refresh: true,
      max_docs: 1,
    });
    expect(res.success).toBe(true);
    expect(res.deleted).toBe(1);
    // refresh: true makes the delete visible without another refresh
    const index = notes.getAliasName();
    expect((await kit.client.count({ index })).count).toBe(3);
  });

  it('should skip version conflicts with conflicts: proceed', async () => {
    const notes = await getNotes('dbq-conflicts');
    const ids = ['1', '2', '3'];
    await notes.putBulk(
      ids.map((id) => ({ id })),
      { refresh: true },
    );
    // one document per batch, two seconds apart, so the documents can be
    // changed after the snapshot is taken and before they are deleted
    const running = notes.deleteMany(undefined, {
      conflicts: 'proceed',
      refresh: true,
      scroll_size: 1,
      requests_per_second: 0.5,
    });
    const firstGone = await kit.waitFor(
      async () => {
        for (const id of ids) {
          if (!(await notes.findById(id)).found) {
            return id;
          }
        }
        return null;
      },
      { timeout: 20_000, interval: 50, message: 'first delete' },
    );
    const kept = ids.filter((id) => id !== firstGone);
    for (const id of kept) {
      await notes.put(id, { id, title: 'changed' });
    }
    const res = await running;
    expect(res.error).toBe(null);
    expect(res.success).toBe(true);
    expect(res.versionConflicts).toBe(2);
    expect(res.deleted).toBe(1);
    expect(await countDocs(notes)).toBe(2);
  });

  it('should delete every document with no callback', async () => {
    const notes = await getNotes('dbq-all');
    await notes.putBulk(docs, { refresh: true });
    const res = await notes.deleteMany(undefined, { refresh: true });
    expect(res.success).toBe(true);
    expect(res.deleted).toBe(4);
    expect(res.failures).toEqual([]);
    expect(await countDocs(notes)).toBe(0);
  });

  it('should return an error and delete nothing for a retriever-only builder', async () => {
    const notes = await getNotes('dbq-retriever');
    await notes.putBulk(docs, { refresh: true });
    const res = await notes.deleteMany((qb) =>
      qb.knn({ field: 'embedding', vector: [1, 0, 0], k: 2, weight: 1 }),
    );
    expect(res.success).toBe(false);
    expect(res.error?.message).toContain('no "query"');
    expect(res.deleted).toBe(null);
    expect(await countDocs(notes)).toBe(4);
  });

  it('should return an envelope for a throwing callback', async () => {
    const notes = await getNotes('dbq-throw');
    await notes.putBulk(docs, { refresh: true });
    const res = await notes.deleteMany(() => {
      throw new RangeError('bad builder');
    });
    expect(res.success).toBe(false);
    expect(res.error).toBeInstanceOf(RangeError);
    expect(res.errorKind).toBe('javascript');
    expect(await countDocs(notes)).toBe(4);
  });
});

describe('IndexManager query methods - Integration', () => {
  it('should return an envelope when the builder callback throws', async () => {
    const notes = await getNotes('query-throw');
    await notes.putBulk([{ id: '1' }], { refresh: true });
    const thrower = () => {
      throw new TypeError('bad builder');
    };
    const many = await notes.findMany(thrower);
    expect(many.error).toBeInstanceOf(TypeError);
    expect(many.records).toEqual([]);
    const first = await notes.findFirst(thrower);
    expect(first.error).toBeInstanceOf(TypeError);
    expect(first.record).toBe(undefined);
    const counted = await notes.count(thrower);
    expect(counted.error).toBeInstanceOf(TypeError);
    expect(counted.total).toBe(null);
    // the same calls work with a valid callback
    expect((await notes.count((qb) => qb.term('id', '1'))).total).toBe(1);
  });
});
