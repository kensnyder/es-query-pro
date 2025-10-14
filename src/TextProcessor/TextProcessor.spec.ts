import { describe, expect, it } from 'bun:test';
import TextProcessor from './TextProcessor';

describe('TextProcessor', () => {
  it('should process text', () => {
    const proc = new TextProcessor();
    proc.registerPattern(
      { find: /([a-z])&([a-z0-9])/gi, replace: '$1ε$2' },
      { find: /([a-z])ε([a-z0-9])/gi, replace: '$1&$2' },
    );
    proc.registerPattern({ find: /\b(Conning)\b/g, replace: '$1ω' }, { find: /ω/g, replace: '' });
    expect(proc.processText('AT&T Conning')).toBe('ATεT Conningω');
    expect(proc.unProcessText('ATεT Conningω')).toBe('AT&T Conning');
    // arrays
    expect(proc.processText(['AT&T', 'Conning'])).toEqual(['ATεT', 'Conningω']);
    expect(proc.unProcessText(['ATεT', 'Conningω'])).toEqual(['AT&T', 'Conning']);
  });
  it('should process records', () => {
    const proc = new TextProcessor();
    proc.registerPattern(
      { find: /([a-z])&([a-z0-9])/gi, replace: '$1ε$2' },
      { find: /([a-z])ε([a-z0-9])/gi, replace: '$1&$2' },
    );
    proc.registerField('fulltext_body');
    proc.registerField('brand');
    const records = [
      {
        brand: 'AT&T',
        fulltext_body: 'AT&T launches new ad',
        type: 'AT&T Press Release',
      },
    ];
    const expectedProcRecords = [
      {
        brand: 'ATεT',
        fulltext_body: 'ATεT launches new ad',
        type: 'AT&T Press Release',
      },
    ];
    const actualProcRecords = proc.prepareInsertions(records);
    expect(actualProcRecords).toEqual(expectedProcRecords);
    const unProcRecords = proc.prepareResult(actualProcRecords);
    expect(unProcRecords).toEqual(records);
  });
});
