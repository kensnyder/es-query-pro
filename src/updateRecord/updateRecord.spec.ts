// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'withEsClie... Remove this comment to see the full error message
import withEsClient from '../withEsClient/withEsClient.js';
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'updateReco... Remove this comment to see the full error message
import updateRecord from './updateRecord.js';

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('updateRecord', () => {
  const index = `test_index_${+new Date()}`;
  // @ts-expect-error TS(2304): Cannot find name 'beforeEach'.
  beforeEach(async () => {
    const { error } = await withEsClient((client: any) => client.indices.create({
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
  // @ts-expect-error TS(2304): Cannot find name 'afterEach'.
  afterEach(async () => {
    const { error } = await withEsClient((client: any) => client.indices.delete({ index })
    );
    if (error) {
      throw error;
    }
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should error on non-existent record', async () => {
    const id = `myId${+new Date()}`;
    const { error } = await updateRecord(index, id, {
      modified_at: 1640688402,
    });
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(error).toBeInstanceOf(Error);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(error.message).toContain('document_missing_exception');
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should modify existing record', async () => {
    const id = `myId${+new Date()}`;
    const data = { name: 'lovely', modified_at: 1640688402 };
    await withEsClient((client: any) => client.index({ index, id, body: data }));
    const { result, error } = await updateRecord(index, id, {
      modified_at: 1640767602,
    });
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(result).toBe(true);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(error).toBe(null);
  });
});
