import { Client } from '@elastic/elasticsearch';
import {
  BaseConnection,
  type ConnectionRequestOptions,
  type ConnectionRequestParams,
} from '@elastic/transport';

export type SentRequest = {
  method: string;
  path: string;
  /** Parsed JSON body; a bulk (NDJSON) body is an array of rows */
  body: unknown;
  /** Raw query string, e.g. `refresh=true`; absent when there is none */
  querystring?: string;
};

/** A scripted HTTP response. `status` defaults to 200. */
export type ScriptedResponse = {
  status?: number;
  /** JSON-serialized unless a string; defaults to `{}` (`''` for HEAD) */
  body?: unknown;
  headers?: Record<string, string>;
};

/** Thrown from the connection; the transport wraps it by its `name`. */
export type ScriptedThrow = { throws: unknown };

export type ScriptedReply =
  | ScriptedResponse
  | ScriptedThrow
  | ((request: SentRequest) => ScriptedResponse | ScriptedThrow);

/**
 * Which requests a script applies to:
 * - string `'GET /_tasks/*'` or `'/_tasks/*'` (any method): the decoded path,
 *   without query string, where `*` matches any characters, `/` included
 * - RegExp: tested against `'<METHOD> <decoded path>'`
 * - function: a predicate on the recorded request
 */
export type RouteMatcher =
  | string
  | RegExp
  | ((request: SentRequest) => boolean);

const productHeaders = {
  'content-type': 'application/json',
  'x-elastic-product': 'Elasticsearch',
};

/**
 * A response that the client turns into a real `ResponseError` with
 * `meta.statusCode === status` and `meta.body.error.type === type`. A 502,
 * 503 or 504 is not retried (the recording client sets `maxRetries: 0`).
 */
export function responseError(
  status: number,
  type: string,
  reason = type,
): ScriptedResponse {
  const cause = { type, reason };
  return {
    status,
    body: { error: { ...cause, root_cause: [cause] }, status },
  };
}

/**
 * Throw an `Error` with the given `name` from the connection. The transport
 * rethrows `ConnectionError`, `TimeoutError` and `RequestAbortedError` as its
 * own classes and any other name as is (e.g. `DeserializationError`).
 */
export function thrownError(name: string, message: string): ScriptedThrow {
  const error = new Error(message);
  error.name = name;
  return { throws: error };
}

/** The client rejects with a real `ConnectionError` (no retries). */
export function connectionError(
  message = 'connect ECONNREFUSED 127.0.0.1:9200',
): ScriptedThrow {
  return thrownError('ConnectionError', message);
}

/** The client rejects with a real `TimeoutError`. */
export function timeoutError(message = 'Request timed out'): ScriptedThrow {
  return thrownError('TimeoutError', message);
}

function parseBody(body: ConnectionRequestParams['body']): unknown {
  if (typeof body !== 'string') {
    return body;
  }
  try {
    return JSON.parse(body);
  } catch {
    // NDJSON (bulk, msearch): one JSON value per line
    return body
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
  }
}

function safeDecode(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function toPredicate(route: RouteMatcher): (req: SentRequest) => boolean {
  if (typeof route === 'function') {
    return route;
  }
  if (route instanceof RegExp) {
    return (req) => route.test(`${req.method} ${safeDecode(req.path)}`);
  }
  const match = /^([A-Z]+)\s+(.*)$/.exec(route.trim());
  const method = match ? match[1] : null;
  const pattern = match ? match[2] : route.trim();
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  const regex = new RegExp(`^${escaped}$`);
  return (req) => {
    if (method && method !== req.method) {
      return false;
    }
    return regex.test(safeDecode(req.path));
  };
}

type Script = {
  matches: (req: SentRequest) => boolean;
  replies: ScriptedReply[];
};

/**
 * A client that sends nothing and records what would have gone over the wire,
 * so these tests check the request Elasticsearch receives, not only the
 * arguments passed to the client.
 *
 * Every request is answered `200 { result: 'updated' }` unless a `script()`
 * matches it. `script(route, ...replies)` answers matching requests with the
 * replies in order, then repeats the last one; later scripts take precedence.
 * Retries are off (`maxRetries: 0`), so each call is one recorded request.
 *
 * @example
 * const { client, sent, script } = getRecordingClient();
 * script('GET /_tasks/*', timeoutError(), { body: { completed: true } });
 * script('HEAD /books', { status: 404 });
 * script('PUT /books', responseError(400, 'resource_already_exists_exception'));
 */
export function getRecordingClient() {
  const sent: SentRequest[] = [];
  const scripts: Script[] = [];

  function script(route: RouteMatcher, ...replies: ScriptedReply[]) {
    if (replies.length === 0) {
      throw new TypeError('script() needs at least one reply');
    }
    scripts.unshift({ matches: toPredicate(route), replies: [...replies] });
  }

  function nextReply(req: SentRequest): ScriptedResponse | ScriptedThrow {
    const found = scripts.find((s) => s.matches(req));
    if (!found) {
      return { body: { result: 'updated' } };
    }
    const reply =
      found.replies.length > 1 ? found.replies.shift() : found.replies[0];
    if (typeof reply === 'function') {
      return reply(req);
    }
    return reply as ScriptedResponse | ScriptedThrow;
  }

  class RecordingConnection extends BaseConnection {
    async request(
      params: ConnectionRequestParams,
      _options: ConnectionRequestOptions,
    ): Promise<any> {
      const req: SentRequest = {
        method: params.method,
        path: params.path,
        body: parseBody(params.body),
      };
      if (params.querystring) {
        req.querystring = params.querystring;
      }
      sent.push(req);
      const reply = nextReply(req);
      if ('throws' in reply) {
        throw reply.throws;
      }
      let body = reply.body;
      if (body === undefined) {
        body = req.method === 'HEAD' ? '' : {};
      }
      return {
        statusCode: reply.status ?? 200,
        headers: { ...productHeaders, ...reply.headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      };
    }
  }
  const client = new Client({
    node: 'http://localhost:9200',
    Connection: RecordingConnection,
    maxRetries: 0,
  });
  return { client, sent, script };
}
