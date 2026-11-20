import type { estypes } from '@elastic/elasticsearch';

/**
 * Index settings that define the `englishplus` analyzer: the built-in
 * `english` analyzer (possessive stripping, English stop words and stemming)
 * plus ASCII folding. Use it as `settings: { analysis: englishplus.analysis }`
 * and refer to the analyzer by name in a mapping (`analyzer: 'englishplus'`).
 *
 * Folding runs before stop-word removal and stemming, so `résumés` and
 * `resumes` produce the same token, and accented stop words are removed.
 */
const englishplus: { analysis: estypes.IndicesIndexSettingsAnalysis } = {
  analysis: {
    filter: {
      english_possessive_stemmer: {
        type: 'stemmer',
        language: 'possessive_english',
      },
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
          'english_possessive_stemmer',
          'lowercase',
          'asciifolding',
          'english_stop',
          'english_stemmer',
        ],
      },
    },
  },
};

export default englishplus;
