// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
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
