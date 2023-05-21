import {
  dateToNumber,
  processRecord,
  unixToDate,
  unProcessRecord,
} from './dates.js';

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('dateToNumber', () => {
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should pass through numbers', () => {
    const date = 1640712193000;
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(dateToNumber(date)).toBe(date);
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should parse strings', () => {
    const date = '2021-12-28T10:46:42';
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(dateToNumber(date)).toBe(1640688402000);
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should handle Date objects', () => {
    const date = new Date(1640688402000);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(dateToNumber(date)).toBe(1640688402000);
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should convert other values to null', () => {
    const date = 'foobar';
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(dateToNumber(date)).toBe(null);
  });
});

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('processRecord', () => {
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should leave other values alone', () => {
    const record = { foo: 'bar', ticks: 300 };
    processRecord(record);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(record.foo).toBe('bar');
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(record.ticks).toBe(300);
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should process "date" fields', () => {
    const record = { date: '2021-12-28T10:46:42' };
    processRecord(record);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(record.date).toBe(1640688402000);
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should process "date_*" fields', () => {
    const record = { date_before: '2021-12-28T10:46:42' };
    processRecord(record);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(record.date_before).toBe(1640688402000);
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should process "*_date" fields', () => {
    const record = { after_date: '2021-12-28T10:46:42' };
    processRecord(record);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(record.after_date).toBe(1640688402000);
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should process "*_at" fields', () => {
    const record = { created_at: '2021-12-28T10:46:42' };
    processRecord(record);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(record.created_at).toBe(1640688402000);
  });
});

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('unixToDate', () => {
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should pass through null', () => {
    const date = null;
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(unixToDate(date)).toBe(null);
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should convert to date', () => {
    const date = 1640712193000;
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(unixToDate(date)).toEqual(new Date(date));
  });
});

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('unProcessRecord', () => {
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should pass through null', () => {
    const record = { created_at: null };
    unProcessRecord(record);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(record.created_at).toBe(null);
  });
  // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
  it('should convert to date', () => {
    const record = { created_at: 1640688402000 };
    unProcessRecord(record);
    // @ts-expect-error TS(2304): Cannot find name 'expect'.
    expect(record.created_at).toEqual(new Date(1640688402000));
  });
});
