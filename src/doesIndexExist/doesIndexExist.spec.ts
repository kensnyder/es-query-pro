// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'doesIndexE... Remove this comment to see the full error message
import doesIndexExist from './doesIndexExist.js';

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('doesIndexExist', () => {
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should return false for missing tables', async () => {
    const { result, error, details } = await doesIndexExist('nothing_at_all');
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(result).toBe(false);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(error).toBe(null);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(typeof details).toBe('object');
  });
});
