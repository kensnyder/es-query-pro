module.exports = {
  analysis: {
    filter: {
      english_stop: {
        type: 'stop',
        stopwords: '_english_',
      },
      english_stemmer: {
        type: 'stemmer',
        language: 'english',
      },
    },
    analyzer: {
      englishplus: {
        type: 'custom',
        tokenizer: 'standard',
        filter: [
          'lowercase',
          'english_stop',
          'english_stemmer',
          'asciifolding',
        ],
      },
    },
  },
};
