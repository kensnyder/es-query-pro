const fulltext = require('./fulltext.js');

describe('fulltext', () => {
  describe('processText()', () => {
    it('should process ampersands', () => {
      const text = 'AT&T had deals & savings';
      const processed = fulltext.processText(text);
      expect(processed).toBe('ATεT had deals & savings');
    });
  });
  describe('unProcessText()', () => {
    it('should process ampersands', () => {
      const processed = 'ATεT had deals & savings';
      const text = fulltext.unProcessText(processed);
      expect(text).toBe('AT&T had deals & savings');
    });
  });
  describe('processRecord()', () => {
    it('should process ampersands only for content_* fields', () => {
      const record = {
        title: 'AT&T deals',
        content_title: 'AT&T deals',
      };
      fulltext.processRecord(record);
      expect(record).toEqual({
        title: 'AT&T deals',
        content_title: 'ATεT deals',
      });
    });
  });
  describe('unProcessRecord()', () => {
    it('should process ampersands only for content_* fields', () => {
      const record = {
        title: 'AT&T deals',
        content_title: 'ATεT deals',
      };
      fulltext.unProcessRecord(record);
      expect(record).toEqual({
        title: 'AT&T deals',
        content_title: 'AT&T deals',
      });
    });
  });
  describe('joinArray()', () => {
    it('should join with phi', () => {
      const arr = ['mobile', 'phone'];
      const joined = fulltext.joinArray(arr);
      expect(joined).toBe('mobile ψ phone');
    });
  });
  describe('splitToArray()', () => {
    it('should split on phi', () => {
      const joined = 'politics ψ news';
      const arr = fulltext.splitToArray(joined);
      expect(arr).toEqual(['politics', 'news']);
    });
  });
});
