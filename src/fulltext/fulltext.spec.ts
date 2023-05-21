// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'fulltext'.
import fulltext from './fulltext.js';

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('fulltext', () => {
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe('processText()', () => {
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should process ampersands', () => {
      const text = 'AT&T had deals & savings';
      const processed = fulltext.processText(text);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(processed).toBe('ATεT had deals & savings');
    });
  });
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe('unProcessText()', () => {
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should process ampersands', () => {
      const processed = 'ATεT had deals & savings';
      const text = fulltext.unProcessText(processed);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(text).toBe('AT&T had deals & savings');
    });
  });
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe('processRecord()', () => {
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should process ampersands only for content_* fields', () => {
      const record = {
        title: 'AT&T deals',
        content_title: 'AT&T deals',
      };
      fulltext.processRecord(record);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(record).toEqual({
        title: 'AT&T deals',
        content_title: 'ATεT deals',
      });
    });
  });
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe('unProcessRecord()', () => {
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should process ampersands only for content_* fields', () => {
      const record = {
        title: 'AT&T deals',
        content_title: 'ATεT deals',
      };
      fulltext.unProcessRecord(record);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(record).toEqual({
        title: 'AT&T deals',
        content_title: 'AT&T deals',
      });
    });
  });
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe('joinArray()', () => {
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should join with phi', () => {
      const arr = ['mobile', 'phone'];
      const joined = fulltext.joinArray(arr);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(joined).toBe('mobile ψ phone');
    });
  });
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe('splitToArray()', () => {
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should split on phi', () => {
      const joined = 'politics ψ news';
      const arr = fulltext.splitToArray(joined);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(arr).toEqual(['politics', 'news']);
    });
  });
});
