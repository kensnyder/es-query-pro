import { describe, expect, it } from 'bun:test';
import QueryBuilder from './QueryBuilder';

describe('QueryBuilder', () => {
  it('should start empty', () => {
    const query = new QueryBuilder();
    expect(query.getQuery()).toEqual({
      _source: ['*'],
    });
  });
  it('should build fields', () => {
    const query = new QueryBuilder();
    query.fields(['title', 'body']);
    expect(query.getQuery()).toEqual({
      _source: ['title', 'body'],
    });
  });
  it('should fulltext match single value', () => {
    const query = new QueryBuilder();
    query.match('headline', 'News');
    expect(query.getBody().query).toEqual({
      match: {
        headline: 'News',
      },
    });
  });
  it('should fulltext match array of values with OR', () => {
    const query = new QueryBuilder();
    query.match('headline', ['Tech', 'Sports']);
    expect(query.getBody().query).toEqual({
      bool: {
        should: [
          {
            match: {
              headline: 'Tech',
            },
          },
          {
            match: {
              headline: 'Sports',
            },
          },
        ],
      },
    });
  });
  it('should fulltext match array of values with AND', () => {
    const query = new QueryBuilder();
    query.match('headline', ['Tech', 'Sports'], 'ALL');
    expect(query.getBody().query).toEqual({
      bool: {
        must: [
          {
            match: {
              headline: 'Tech',
            },
          },
          {
            match: {
              headline: 'Sports',
            },
          },
        ],
      },
    });
  });
  it('should fulltext match single phrase', () => {
    const query = new QueryBuilder();
    query.matchPhrase('headline', 'Sports medicine');
    expect(query.getBody().query).toEqual({
      match_phrase: {
        headline: {
          query: 'Sports medicine',
          slop: 0,
        },
      },
    });
  });
  it('should fulltext match array of phrases', () => {
    const query = new QueryBuilder();
    query.matchPhrase('headline', [
      'Sports medicine',
      'technology breakthrough',
    ]);
    expect(query.getBody().query).toEqual({
      bool: {
        should: [
          {
            match_phrase: {
              headline: {
                query: 'Sports medicine',
                slop: 0,
              },
            },
          },
          {
            match_phrase: {
              headline: {
                query: 'technology breakthrough',
                slop: 0,
              },
            },
          },
        ],
      },
    });
  });
  it('should fulltext match single phrasePrefix against single field', () => {
    const query = new QueryBuilder();
    query.matchPhrasePrefix('headline', 'ElasticSearch builder');
    expect(query.getBody().query).toEqual({
      match_phrase_prefix: {
        headline: 'ElasticSearch builder',
      },
    });
  });
  it('should fulltext match single phrasePrefix against multiple fields', () => {
    const query = new QueryBuilder();
    query.matchPhrasePrefix(['headline', 'body'], 'ElasticSearch builder');
    expect(query.getBody().query).toEqual({
      multi_match: {
        fields: ['headline', 'body'],
        type: 'phrase_prefix',
        query: 'ElasticSearch builder',
      },
    });
  });
  it('should fulltext match multiple phrasePrefix against multiple fields', () => {
    const query = new QueryBuilder();
    query.matchPhrasePrefix(
      ['headline', 'body'],
      ['ElasticSearch builder', 'ElasticSearch tool']
    );
    expect(query.getBody().query).toEqual({
      bool: {
        should: [
          {
            multi_match: {
              fields: ['headline', 'body'],
              type: 'phrase_prefix',
              query: 'ElasticSearch builder',
            },
          },
          {
            multi_match: {
              fields: ['headline', 'body'],
              type: 'phrase_prefix',
              query: 'ElasticSearch tool',
            },
          },
        ],
      },
    });
  });
  it('should fulltext match multiple phrasePrefix against single field', () => {
    const query = new QueryBuilder();
    query.matchPhrasePrefix('headline', [
      'ElasticSearch builder',
      'ElasticSearch tool',
    ]);
    expect(query.getBody().query).toEqual({
      bool: {
        should: [
          {
            match_phrase_prefix: {
              headline: 'ElasticSearch builder',
            },
          },
          {
            match_phrase_prefix: {
              headline: 'ElasticSearch tool',
            },
          },
        ],
      },
    });
  });
  it('should fulltext match single boostedPhrase against single field', () => {
    const query = new QueryBuilder();
    query.matchBoostedPhrase('body', 'Sports medicine doctor', {
      expand: true,
      boosts: [2, 4, 7],
    });
    expect(query.getBody().query).toEqual({
      bool: {
        should: [
          {
            match: {
              body: {
                boost: 2,
                operator: 'or',
                query: 'Sports medicine doctor',
              },
            },
          },
          {
            match: {
              body: {
                boost: 4,
                operator: 'and',
                query: 'Sports medicine doctor',
              },
            },
          },
          {
            match: {
              body: {
                boost: 7,
                query: 'Sports medicine doctor',
              },
            },
          },
        ],
      },
    });
  });
  it('should fulltext match single boostedPhrase against nested field', () => {
    const query = new QueryBuilder();
    query.matchBoostedPhrase('categories/value', 'Sports medicine doctor', {
      expand: true,
      boosts: [2, 4, 7],
    });
    expect(query.getBody().query).toEqual({
      bool: {
        should: [
          {
            nested: {
              path: 'categories',
              ignore_unmapped: true,
              query: {
                match: {
                  'categories.value': {
                    query: 'Sports medicine doctor',
                    operator: 'or',
                    boost: 2,
                  },
                },
              },
            },
          },
          {
            nested: {
              path: 'categories',
              ignore_unmapped: true,
              query: {
                match: {
                  'categories.value': {
                    query: 'Sports medicine doctor',
                    operator: 'and',
                    boost: 4,
                  },
                },
              },
            },
          },
          {
            nested: {
              path: 'categories',
              ignore_unmapped: true,
              query: {
                match: {
                  'categories.value': {
                    query: 'Sports medicine doctor',
                    boost: 7,
                  },
                },
              },
            },
          },
        ],
      },
    });
  });
  it('should fulltext match single boostedPhrase against multiple fields', () => {
    const query = new QueryBuilder();
    query.matchBoostedPhrase(['headline', 'body'], 'Sports medicine doctor', {
      expand: false,
    });
    expect(query.getBody().query).toEqual({
      bool: {
        should: [
          {
            multi_match: {
              fields: ['headline', 'body'],
              operator: 'and',
              query: 'Sports medicine doctor',
              boost: 3,
            },
          },
          {
            multi_match: {
              fields: ['headline', 'body'],
              query: 'Sports medicine doctor',
              boost: 5,
            },
          },
        ],
      },
    });
  });
  it('should fulltext multi match with phrase using OR', () => {
    const query = new QueryBuilder();
    query.multiTerm(['category', 'tag'], 'Sports');
    expect(query.getBody().query).toEqual({
      bool: {
        should: [
          {
            term: {
              category: 'Sports',
            },
          },
          {
            term: {
              tag: 'Sports',
            },
          },
        ],
      },
    });
  });
  it('should fulltext multi match with phrase using AND', () => {
    const query = new QueryBuilder();
    query.multiMatch(['category', 'tag'], 'Sports', 'ALL');
    expect(query.getBody().query).toEqual({
      multi_match: {
        fields: ['category', 'tag'],
        query: 'Sports',
      },
    });
  });
  it('should fulltext NOT match single value', () => {
    const query = new QueryBuilder();
    query.notMatch('headline', 'News');
    expect(query.getBody().query).toEqual({
      bool: {
        must_not: [
          {
            match: {
              headline: 'News',
            },
          },
        ],
      },
    });
  });
  it('should fulltext NOT multi match with phrase using AND', () => {
    const query = new QueryBuilder();
    query.notMultiMatch(['category', 'tag'], 'Sports');
    expect(query.getBody().query).toEqual({
      bool: {
        must_not: [
          {
            multi_match: {
              fields: ['category', 'tag'],
              query: 'Sports',
            },
          },
        ],
      },
    });
  });
  it('should exact match single value', () => {
    const query = new QueryBuilder();
    query.term('tag', 'News');
    expect(query.getBody().query).toEqual({
      term: {
        tag: 'News',
      },
    });
  });
  it('should exact match multiple values ANY', () => {
    const query = new QueryBuilder();
    query.term('tag', ['News', 'Entertainment']);
    expect(query.getBody().query).toEqual({
      terms: {
        tag: ['News', 'Entertainment'],
      },
    });
  });
  it('should exact match multiple values ALL', () => {
    const query = new QueryBuilder();
    query.term('tag', ['News', 'Entertainment'], 'ALL');
    expect(query.getBody().query).toEqual({
      bool: {
        must: [
          {
            term: {
              tag: 'News',
            },
          },
          {
            term: {
              tag: 'Entertainment',
            },
          },
        ],
      },
    });
  });

  describe('nested field support', () => {
    it('should handle nested term queries', () => {
      const query = new QueryBuilder();
      query.term('category/id', '123');
      const body = query.getBody();
      expect(body.query).toEqual({
        nested: {
          path: 'category',
          ignore_unmapped: true,
          query: {
            term: {
              'category.id': '123',
            },
          },
        },
      });
    });

    it('should handle nested exists queries', () => {
      const query = new QueryBuilder();
      query.exists('author/name');
      const body = query.getBody();
      expect(body.query).toEqual({
        nested: {
          path: 'author',
          ignore_unmapped: true,
          query: {
            exists: {
              field: 'author.name',
            },
          },
        },
      });
    });

    it('should handle multiple levels of nesting', () => {
      const query = new QueryBuilder();
      query.term('author/contact/email', 'test@example.com');
      const body = query.getBody();
      expect(body.query).toEqual({
        nested: {
          path: 'author',
          ignore_unmapped: true,
          query: {
            nested: {
              path: 'author.contact',
              ignore_unmapped: true,
              query: {
                term: {
                  'author.contact.email': 'test@example.com',
                },
              },
            },
          },
        },
      });
    });

    it('should handle nested fields in must_not with custom separator', () => {
      const query = new QueryBuilder({
        nestedSeparator: '->',
      });
      query.notExists('metadata->tags');
      const body = query.getBody();
      expect(body.query).toEqual({
        bool: {
          must_not: [
            {
              nested: {
                path: 'metadata',
                ignore_unmapped: true,
                query: {
                  exists: {
                    field: 'metadata.tags',
                  },
                },
              },
            },
          ],
        },
      });
    });
  });
});
