export type Body = Record<string, unknown>;

type Headers = Record<string, string>;
export class EsFetchClient {
  private indices: {
    get: (body: Body) => Promise<any>;
    exists: (body: Body) => Promise<any>;
    existsAlias: (body: Body) => Promise<any>;
    flush: (body: Body) => Promise<any>;
    create: (body: Body) => Promise<any>;
    createAlias: (body: Body) => Promise<any>;
    delete: (body: Body) => Promise<any>;
    deleteAlias: (body: Body) => Promise<any>;
    updateAliases: (body: Body) => Promise<any>;
  };
  private tasks: { get: (body: Body) => Promise<any> };
  constructor(
    public host: string,
    public apiKey: string,
    public versionCompat = 9,
  ) {
    this.indices = {
      get: (body: Body) => this._req('GET', `/${body.index}`, body),
      exists: (body: Body) => this._req('GET', `/${body.index}`, body),
      existsAlias: (body: Body) =>
        this._req('GET', `/_alias/${body.name}`, body),
      flush: (body: Body) => this._req('GET', `/${body.index}/_flush`, body),
      create: (body: Body) => this._req('PUT', `/${body.index}`, body),
      createAlias: (body: Body) =>
        this._req('PUT', `/${body.index}/_alias/${body.name}`, body),
      delete: (body: Body) => this._req('DELETE', `/${body.index}`, body),
      deleteAlias: (body: Body) =>
        this._req('DELETE', `/${body.index}/_alias/${body.name}`, body),
      updateAliases: (body: Body) => this._req('POST', `/_aliases`, body),
    };
    this.tasks = {
      get: (body: Body) =>
        this._req(
          'GET',
          `/_tasks/${String((body as { taskId?: unknown }).taskId)}`,
          body,
        ),
    };
  }
  get(body: Body) {
    return this._req('GET', `/${body.index}/_doc/${String(body.id)}`, body);
  }
  search(body: Body) {
    const index = body.index ? `/${body.index}` : '';
    return this._req('POST', `${index}/_search`, body);
  }
  index(body: Body) {
    return this._req('PUT', `/${body.index}/_doc/${String(body.id)}`, body);
  }
  bulk(body: Body) {
    const payload: unknown = body;
    const maybeArray = (body as { body?: unknown }).body;
    if (Array.isArray(maybeArray)) {
      const ndjson = this._toNdjson(maybeArray as unknown[]);
      return this._req('POST', '/_bulk', ndjson, {
        'Content-Type': 'application/x-ndjson',
      });
    }
    return this._req('POST', '/_bulk', payload, {
      'Content-Type': 'application/x-ndjson',
    });
  }
  update(body: Body) {
    return this._req('POST', `/${body.index}/_update/${String(body.id)}`, body);
  }
  delete(body: Body) {
    return this._req('DELETE', `/${body.index}/_doc/${String(body.id)}`, body);
  }
  deleteByQuery(body: Body) {
    return this._req('POST', `/${body.index}/_delete_by_query`, body);
  }
  updateByQuery(body: Body) {
    return this._req('POST', `/${body.index}/_update_by_query`, body);
  }
  reindex(body: Body) {
    return this._req('POST', '/_reindex', body);
  }
  count(body: Body) {
    const index = body.index ? `/${body.index}` : '';
    return this._req('POST', `${index}/_count`, body);
  }
  mget(body: Body) {
    const index = body.index ? `/${body.index}` : '';
    return this._req('POST', `${index}/_mget`, body);
  }
  private _toNdjson(items: unknown[]) {
    const lines: string[] = [];
    for (const item of items) {
      lines.push(JSON.stringify(item));
    }
    lines.push('');
    return lines.join('\n');
  }
  private async _req(
    method: string,
    endpoint: string,
    body?: unknown,
    headers?: Headers,
  ) {
    const defaultHeaders: Headers = {
      'Content-Type': 'application/json',
      Accept: `application/vnd.elasticsearch+json; compatible-with=${this.versionCompat}`,
      Authorization: `ApiKey ${this.apiKey}`,
    };
    const finalHeaders: Headers = { ...defaultHeaders, ...(headers || {}) };
    let requestBody: string | undefined;
    if (typeof body === 'string') {
      requestBody = body;
    } else if (body !== undefined) {
      requestBody = JSON.stringify(body);
    } else {
      requestBody = undefined;
    }
    const response = await fetch(`${this.host}${endpoint}`, {
      method: method,
      headers: finalHeaders,
      body: requestBody,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Elasticsearch request failed: ${response.status} ${response.statusText} - ${text}`,
      );
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
  }
}
