const indexName = require('./indexName.js');

describe('indexName.build()', () => {
  it('should compose an index name', () => {
    const name = indexName.build({
      prefix: 'bw',
      language: 'englishplus',
      index: 'wild_animals',
      version: 5,
    });
    expect(name).toBe('bw-englishplus-wild_animals-v5');
  });
});

describe('indexName.parse()', () => {
  it('should decompose an index name', () => {
    const name = indexName.parse('bw-arabic-supernatural_events-v10');
    expect(name).toEqual({
      prefix: 'bw',
      language: 'arabic',
      index: 'supernatural_events',
      version: 10,
    });
  });
});
