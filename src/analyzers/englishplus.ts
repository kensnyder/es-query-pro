import type { estypes } from '@elastic/elasticsearch';

/**
 * Index settings that define the `englishplus` analyzer: English stop words
 * and stemming plus ASCII folding. Use it as
 * `settings: { analysis: englishplus.analysis }` and refer to the analyzer by
 * name in a mapping (`analyzer: 'englishplus'`).
 */
const englishplus: { analysis: estypes.IndicesIndexSettingsAnalysis } = {
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

export default englishplus;
