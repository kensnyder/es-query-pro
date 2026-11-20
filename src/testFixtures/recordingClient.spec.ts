import { describe, expect, it } from 'bun:test';
import {
  connectionError,
  getRecordingClient,
  responseError,
  thrownError,
  timeoutError,
} from './recordingClient';

async function catchError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return e as {
      name: string;
      message: string;
      meta?: { statusCode?: number; body?: any };
    };
  }
  throw new Error('expected the request to fail');
}

describe('getRecordingClient() default behavior', () => {
  it('should answer every request with 200 { result: "updated" }', async () => {
    const { client, sent } = getRecordingClient();
    const res = await client.index({ index: 'a', id: '1', document: { x: 1 } });
    expect(res).toEqual({ result: 'updated' } as any);
    expect(sent).toEqual([
      { method: 'PUT', path: '/a/_doc/1', body: { x: 1 } },
    ]);
  });

  it('should record the query string when there is one', async () => {
    const { client, sent } = getRecordingClient();
    await client.index({ index: 'a', id: '1', document: {}, refresh: true });
    expect(sent[0].querystring).toBe('refresh=true');
  });

  it('should record a bulk body as an array of rows', async () => {
    const { client, sent } = getRecordingClient();
    await client.bulk({
      operations: [{ index: { _index: 'a', _id: '1' } }, { x: 1 }],
    });
    expect(sent[0].path).toBe('/_bulk');
    expect(sent[0].body).toEqual([
      { index: { _index: 'a', _id: '1' } },
      { x: 1 },
    ]);
  });
});

describe('getRecordingClient().script()', () => {
  it('should answer a matching route with the scripted body', async () => {
    const { client, script } = getRecordingClient();
    script('GET /_tasks/*', { body: { completed: true, task: {} } });
    const task = await client.tasks.get({ task_id: 'n1:7' });
    expect(task.completed).toBe(true);
    // other routes keep the default
    expect(await client.index({ index: 'a', document: {} })).toEqual({
      result: 'updated',
    } as any);
  });

  it('should match the method, and any method when it is omitted', async () => {
    const { client, script } = getRecordingClient();
    script('POST /a/_search', { body: { hits: { hits: [] } } });
    script('/a/_count', { body: { count: 5 } });
    expect((await client.count({ index: 'a' })).count).toBe(5);
    const query = { match_all: {} };
    expect(await client.search({ index: 'a', query })).toEqual({
      hits: { hits: [] },
    } as any);
    // the same path with another method falls through to the default
    expect(await client.search({ index: 'a' })).toEqual({
      result: 'updated',
    } as any);
  });

  it('should match a RegExp against "METHOD /path"', async () => {
    const { client, script } = getRecordingClient();
    script(/^DELETE \/old~/, { body: { acknowledged: true } });
    const res = await client.indices.delete({ index: 'old~v1' });
    expect(res.acknowledged).toBe(true);
  });

  it('should match a predicate on the recorded request', async () => {
    const { client, script } = getRecordingClient();
    script((req) => req.querystring?.includes('wait_for_completion') ?? false, {
      body: { task: 'n1:9' },
    });
    const res = await client.reindex({
      source: { index: 'a' },
      dest: { index: 'b' },
      wait_for_completion: false,
    });
    expect(res.task).toBe('n1:9');
  });

  it('should play replies in order and then repeat the last one', async () => {
    const { client, script } = getRecordingClient();
    script(
      'GET /_tasks/*',
      connectionError(),
      { body: { completed: false } },
      {
        body: { completed: true },
      },
    );
    const first = await catchError(client.tasks.get({ task_id: 'n:1' }));
    expect(first.name).toBe('ConnectionError');
    expect((await client.tasks.get({ task_id: 'n:1' })).completed).toBe(false);
    expect((await client.tasks.get({ task_id: 'n:1' })).completed).toBe(true);
    expect((await client.tasks.get({ task_id: 'n:1' })).completed).toBe(true);
  });

  it('should prefer the most recently scripted route', async () => {
    const { client, script } = getRecordingClient();
    script('/a/_count', { body: { count: 1 } });
    script('/a/_count', { body: { count: 2 } });
    expect((await client.count({ index: 'a' })).count).toBe(2);
  });

  it('should compute a reply with a function', async () => {
    const { client, script } = getRecordingClient();
    script('/*/_count', (req) => ({ body: { count: req.path.length } }));
    expect((await client.count({ index: 'abc' })).count).toBe(11);
  });

  it('should still record requests that were answered with an error', async () => {
    const { client, sent, script } = getRecordingClient();
    script('/a/_count', timeoutError());
    await catchError(client.count({ index: 'a' }));
    expect(sent).toHaveLength(1);
  });

  it('should match an index name with special characters by its decoded path', async () => {
    const { client, script } = getRecordingClient();
    script('GET /a,b/_count', { body: { count: 3 } });
    expect((await client.count({ index: 'a,b' })).count).toBe(3);
  });
});

describe('scripted errors', () => {
  it('should throw a real ResponseError with status and type', async () => {
    const { client, script } = getRecordingClient();
    script(
      'PUT /books',
      responseError(400, 'resource_already_exists_exception', 'exists'),
    );
    const e = await catchError(client.indices.create({ index: 'books' }));
    expect(e.name).toBe('ResponseError');
    expect(e.meta?.statusCode).toBe(400);
    expect(e.meta?.body.error.type).toBe('resource_already_exists_exception');
    expect(e.meta?.body.error.reason).toBe('exists');
    expect(e.message).toContain('resource_already_exists_exception');
  });

  it('should make HEAD 404 resolve to false, like a real server', async () => {
    const { client, script } = getRecordingClient();
    script('HEAD /books', { status: 404 });
    expect(await client.indices.exists({ index: 'books' })).toBe(false);
  });

  it('should throw a ConnectionError without retrying', async () => {
    const { client, sent, script } = getRecordingClient();
    script('/a/_count', connectionError('connect ECONNREFUSED'));
    const e = await catchError(client.count({ index: 'a' }));
    expect(e.name).toBe('ConnectionError');
    expect(e.message).toContain('ECONNREFUSED');
    expect(sent).toHaveLength(1);
  });

  it('should throw a TimeoutError', async () => {
    const { client, script } = getRecordingClient();
    script('/a/_count', timeoutError());
    const e = await catchError(client.count({ index: 'a' }));
    expect(e.name).toBe('TimeoutError');
  });

  it('should throw a 5xx as a ResponseError without retrying', async () => {
    const { client, sent, script } = getRecordingClient();
    script('/a/_count', responseError(503, 'unavailable_shards_exception'));
    const e = await catchError(client.count({ index: 'a' }));
    expect(e.name).toBe('ResponseError');
    expect(e.meta?.statusCode).toBe(503);
    expect(sent).toHaveLength(1);
  });

  it('should throw any other named error', async () => {
    const { client, script } = getRecordingClient();
    script('/a/_count', thrownError('DeserializationError', 'bad json'));
    const e = await catchError(client.count({ index: 'a' }));
    expect(e.name).toBe('DeserializationError');
    expect(e.message).toBe('bad json');
  });
});
