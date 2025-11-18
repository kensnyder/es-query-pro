export type Body = {
  [key: string]: string;
};
export class EsFetchClient {
  constructor(
    public host: string,
    public apiKey: string,
  ) {
    this.indices = {
      get: (body: Body) => this.req('GET', `/${body.index}`, body),
      exists: (body: Body) => this.req('GET', `/${body.index}`, body),
      existsAlias: (body: Body) =>
        this.req('GET', `/_alias/${body.name}`, body),
      flush: (body: Body) => this.req('GET', `/${body.index}/_flush`, body),
      create: (body: Body) => this.req('PUT', `/${body.index}`, body),
      createAlias: (body: Body) =>
        this.req('PUT', `/${body.index}/_alias/${body.name}`, body),
      delete: (body: Body) => this.req('DELETE', `/${body.index}`, body),
      deleteAlias: (body: Body) =>
        this.req('DELETE', `/${body.index}/_alias/${body.name}`, body),
      // updateAliases: (body: Body) => this.req(TODO),
    };
    this.tasks = {
      // get: (body: Body) => this.req(/*TODO*/),
    };
  }
  get(body: Body) {
    return this.req('GET', `/${body.index}/_doc/${body.id}`, body);
  }
  search(body: Body) {
    // return this.req('GET', TODO);
  }
  index(body: Body) {
    return this.req('PUT', `/${body.index}/_doc/${body.id}`, body);
  }
  bulk(body: Body) {
    return this.req('PUT', '/_bulk', body);
  }
  update(body: Body) {
    return this.req('POST', `/${body.index}/_update/${body.id}`, body);
  }
  delete(body: Body) {
    return this.req('DELETE', `/${body.index}/_update/${body.id}`, body);
  }
  deleteByQuery(body: Body) {
    // return this.req('DELETE', TODO);
  }
  updateByQuery(body: Body) {
    // return this.req('POST', TODO);
  }
  reindex(body: Body) {
    // return this.req(TODO);
  }
  count(body: Body) {
    // return this.req(TODO);
  }
  mget(body: Body) {
    // return this.req(TODO);
  }
  async req(method: string, endpoint: string, body: any) {
    const response = await fetch(`${this.host}/${endpoint}`, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `ApiKey ${this.apiKey}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return await response.json();
  }
}
