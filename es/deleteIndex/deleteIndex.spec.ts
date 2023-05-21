// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'deleteInde... Remove this comment to see the full error message
const deleteIndex = require('./deleteIndex.js');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'withEsClie... Remove this comment to see the full error message
const withEsClient = require('../withEsClient/withEsClient.js');

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('deleteIndex', () => {
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should error on non-existent index', async () => {
    const index = `non_existent_${+new Date()}`;
    const { result, error, details } = await deleteIndex(index);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(result).toBe(false);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(error).toBeInstanceOf(Error);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(error.message).toContain('index_not_found_exception');
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(typeof details).toBe('object');
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should properly delete', async () => {
    const index = `test_index_${+new Date()}`;
    await withEsClient((client: any) => client.indices.create({ index }));
    const { result, error, details } = await deleteIndex(index);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(result).toBe(true);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(error).toBe(null);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(typeof details).toBe('object');
  });
});
