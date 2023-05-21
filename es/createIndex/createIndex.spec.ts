// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'createInde... Remove this comment to see the full error message
const createIndex = require('./createIndex.js');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'withEsClie... Remove this comment to see the full error message
const withEsClient = require('../withEsClient/withEsClient.js');

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('createIndex', () => {
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should create new index', async () => {
    const index = `test1_at_${+new Date()}`;
    const { result, error, details } = await createIndex(index);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(result).toBe(true);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(error).toBe(null);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(typeof details).toBe('object');
    await withEsClient((client: any) => client.indices.delete({ index }));
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
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
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(result).toBe(true);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(error).toBe(null);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(typeof details).toBe('object');
    await withEsClient((client: any) => client.indices.delete({ index }));
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should fail on invalid name', async () => {
    const { result, error, details } = await createIndex('< invalid name >');
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(result).toBe(false);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(error).toBeInstanceOf(Error);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(error.message).toContain('invalid_index_name_exception');
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(typeof details).toBe('object');
  });
});
