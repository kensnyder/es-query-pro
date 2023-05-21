// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'withEsClie... Remove this comment to see the full error message
const withEsClient = require('./withEsClient.js');

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('withEsClient', () => {
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should get server info', async () => {
    const { result, error } = await withEsClient((client: any) => {
      return client.info();
    });
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(typeof result).toBe('object');
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(typeof result.body.name).toBe('string');
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(error).toBeNull();
  });
});
