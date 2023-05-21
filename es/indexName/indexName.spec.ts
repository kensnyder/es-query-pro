// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'indexName'... Remove this comment to see the full error message
const indexName = require('./indexName.js');

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('indexName.build()', () => {
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should compose an index name', () => {
    const name = indexName.build({
      prefix: 'bw',
      language: 'englishplus',
      index: 'wild_animals',
      version: 5,
    });
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(name).toBe('bw-englishplus-wild_animals-v5');
  });
});

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('indexName.parse()', () => {
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should decompose an index name', () => {
    const name = indexName.parse('bw-arabic-supernatural_events-v10');
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(name).toEqual({
      prefix: 'bw',
      language: 'arabic',
      index: 'supernatural_events',
      version: 10,
    });
  });
});
