import { describe, expect, it } from 'bun:test';
import englishplus from './englishplus';

describe('englishplus', () => {
  const analyzer = englishplus.analysis.analyzer?.englishplus;
  const filters = englishplus.analysis.filter ?? {};

  it('should define a custom analyzer on the standard tokenizer', () => {
    expect(analyzer).toMatchObject({ type: 'custom', tokenizer: 'standard' });
  });

  it('should strip possessives, then lowercase and fold before stop words and stemming', () => {
    expect(analyzer).toHaveProperty('filter', [
      'english_possessive_stemmer',
      'lowercase',
      'asciifolding',
      'english_stop',
      'english_stemmer',
    ]);
  });

  it('should define every custom filter the analyzer refers to', () => {
    const builtIn = ['lowercase', 'asciifolding'];
    const chain = (analyzer as { filter: string[] }).filter;
    for (const name of chain) {
      if (!builtIn.includes(name)) {
        expect(filters).toHaveProperty(name);
      }
    }
  });

  it('should define the filters like the built-in english analyzer', () => {
    expect(filters).toEqual({
      english_possessive_stemmer: {
        type: 'stemmer',
        language: 'possessive_english',
      },
      english_stop: { type: 'stop', stopwords: '_english_' },
      english_stemmer: { type: 'stemmer', language: 'english' },
    });
  });
});
