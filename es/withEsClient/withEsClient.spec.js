const withEsClient = require('./withEsClient.js');

describe('withEsClient', () => {
  it('should get server info', async () => {
    const { result, error } = await withEsClient(client => {
      return client.info();
    });
    expect(typeof result).toBe('object');
    expect(typeof result.body.name).toBe('string');
    expect(error).toBeNull();
  });
});
