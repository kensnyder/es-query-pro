const withEsClient = require('../withEsClient/withEsClient.js');
const updateRecord = require('./updateRecord.js');

describe('updateRecord', () => {
  const index = `test_index_${+new Date()}`;
  beforeEach(async () => {
    const { error } = await withEsClient(client =>
      client.indices.create({
        index,
        body: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              name: { type: 'keyword' },
              modified_at: { type: 'date', format: 'epoch_second' },
            },
          },
        },
      })
    );
    if (error) {
      throw error;
    }
  });
  afterEach(async () => {
    const { error } = await withEsClient(client =>
      client.indices.delete({ index })
    );
    if (error) {
      throw error;
    }
  });
  it('should error on non-existent record', async () => {
    const id = `myId${+new Date()}`;
    const { error } = await updateRecord(index, id, {
      modified_at: 1640688402,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('document_missing_exception');
  });
  it('should modify existing record', async () => {
    const id = `myId${+new Date()}`;
    const data = { name: 'lovely', modified_at: 1640688402 };
    await withEsClient(client => client.index({ index, id, body: data }));
    const { result, error } = await updateRecord(index, id, {
      modified_at: 1640767602,
    });
    expect(result).toBe(true);
    expect(error).toBe(null);
  });
});
