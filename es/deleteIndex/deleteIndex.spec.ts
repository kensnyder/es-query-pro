const deleteIndex = require('./deleteIndex.js');
const withEsClient = require('../withEsClient/withEsClient.js');

describe('deleteIndex', () => {
  it('should error on non-existent index', async () => {
    const index = `non_existent_${+new Date()}`;
    const { result, error, details } = await deleteIndex(index);
    expect(result).toBe(false);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('index_not_found_exception');
    expect(typeof details).toBe('object');
  });
  it('should properly delete', async () => {
    const index = `test_index_${+new Date()}`;
    await withEsClient(client => client.indices.create({ index }));
    const { result, error, details } = await deleteIndex(index);
    expect(result).toBe(true);
    expect(error).toBe(null);
    expect(typeof details).toBe('object');
  });
});
