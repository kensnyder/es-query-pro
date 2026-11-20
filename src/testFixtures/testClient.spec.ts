import { describe, expect, it } from 'bun:test';
import { Client } from '@elastic/elasticsearch';
import { getTestClient, getTestClientOptions } from './testClient';

function getAuthorizationHeader(client: Client) {
  const pool = client.connectionPool as unknown as {
    connections: { headers: Record<string, string> }[];
  };
  return pool.connections[0].headers.authorization;
}

describe('getTestClientOptions()', () => {
  it('should use the API key when ES_API_KEY is set', () => {
    const options = getTestClientOptions({
      ES_ENDPOINT: 'https://es.example.com:9243',
      ES_API_KEY: 'my-key',
      ES_USERNAME: 'elastic',
      ES_PASSWORD: 'secret',
    });
    expect(options.node).toBe('https://es.example.com:9243');
    expect(options.auth).toEqual({ apiKey: 'my-key' });
  });

  it('should use basic auth when ES_API_KEY is not set', () => {
    const options = getTestClientOptions({
      ES_ENDPOINT: 'https://es.example.com:9243',
      ES_USERNAME: 'elastic',
      ES_PASSWORD: 'secret',
    });
    expect(options.auth).toEqual({ username: 'elastic', password: 'secret' });
  });

  it('should use basic auth when ES_API_KEY is empty', () => {
    const options = getTestClientOptions({
      ES_API_KEY: '',
      ES_USERNAME: 'elastic',
      ES_PASSWORD: 'secret',
    });
    expect(options.auth).toEqual({ username: 'elastic', password: 'secret' });
  });

  it('should default to localhost and empty credentials', () => {
    const options = getTestClientOptions({});
    expect(options.node).toBe('http://localhost:9200');
    expect(options.auth).toEqual({ username: '', password: '' });
  });

  it('should not override the Accept header or read ES_VERSION', () => {
    const options = getTestClientOptions({ ES_VERSION: '8' });
    expect(options.headers).toBeUndefined();
  });

  it('should send the API key as an ApiKey authorization header', () => {
    const client = new Client(getTestClientOptions({ ES_API_KEY: 'abc' }));
    expect(getAuthorizationHeader(client)).toBe('ApiKey abc');
  });

  it('should send basic auth as a Basic authorization header', () => {
    const client = new Client(
      getTestClientOptions({ ES_USERNAME: 'u', ES_PASSWORD: 'p' }),
    );
    const expected = `Basic ${Buffer.from('u:p').toString('base64')}`;
    expect(getAuthorizationHeader(client)).toBe(expected);
  });
});

describe('getTestClient()', () => {
  it('should return the same client on every call', () => {
    const first = getTestClient();
    expect(first).toBeInstanceOf(Client);
    expect(getTestClient()).toBe(first);
  });

  it('should build the client from process.env', () => {
    const fromEnv = new Client(getTestClientOptions(process.env));
    expect(getAuthorizationHeader(getTestClient())).toBe(
      getAuthorizationHeader(fromEnv),
    );
  });
});
