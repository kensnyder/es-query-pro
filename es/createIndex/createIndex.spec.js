const createIndex = require('./createIndex.js');
const withEsClient = require('../withEsClient/withEsClient.js');

describe('createIndex', () => {
  it('should create new index', async () => {
    const index = `test1_at_${+new Date()}`;
    const { result, error, details } = await createIndex(index);
    expect(result).toBe(true);
    expect(error).toBe(null);
    expect(typeof details).toBe('object');
    await withEsClient(client => client.indices.delete({ index }));
  });
  it('should create new index with mappings', async () => {
    const index = `test2_at_${+new Date()}`;
    const { result, error, details } = await createIndex(index, {
      mappings: {
        properties: {
          source_code: { type: 'keyword', index: false },
          created_at: { type: 'date', format: 'epoch_millis' },
        },
      },
    });
    expect(result).toBe(true);
    expect(error).toBe(null);
    expect(typeof details).toBe('object');
    await withEsClient(client => client.indices.delete({ index }));
  });
  it('should fail on invalid name', async () => {
    const { result, error, details } = await createIndex('< invalid name >');
    expect(result).toBe(false);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('invalid_index_name_exception');
    expect(typeof details).toBe('object');
  });
});
