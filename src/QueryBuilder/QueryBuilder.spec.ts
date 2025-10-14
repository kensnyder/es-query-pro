import { describe, expect, it } from 'bun:test';
import QueryBuilder from './QueryBuilder';

describe('QueryBuilder', () => {
  it('should start empty', () => {
    const query = new QueryBuilder();
    expect(query.getQuery()).toEqual({
      _source: ['*'],
      retriever: {
        standard: {
          query: {
            match_all: {},
          },
        },
      },
    });
  });
  it('should build fields', () => {
    const query = new QueryBuilder();
    query.fields(['title', 'body']);
    expect(query.getQuery()).toEqual({
      _source: ['title', 'body'],
      retriever: {
        standard: {
          query: {
            match_all: {},
          },
        },
      },
    });
  });
  it('should fulltext match single value', () => {
    const query = new QueryBuilder();
    query.match('headline', 'News');
    expect(query.getBody().retriever.standard.query).toEqual({
      match: {
        headline: 'News',
      },
    });
  });
  it('should fulltext match array of values with OR', () => {
    const query = new QueryBuilder();
    query.match('headline', ['Tech', 'Sports']);
    expect(query.getBody().retriever.standard.query).toEqual({
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
    expect(query.getBody().retriever.standard.query).toEqual({
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
    expect(query.getBody().retriever.standard.query).toEqual({
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
    expect(query.getBody().retriever.standard.query).toEqual({
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
    expect(query.getBody().retriever.standard.query).toEqual({
      match_phrase_prefix: {
        headline: 'ElasticSearch builder',
      },
    });
  });
  it('should fulltext match single phrasePrefix against multiple fields', () => {
    const query = new QueryBuilder();
    query.matchPhrasePrefix(['headline', 'body'], 'ElasticSearch builder');
    expect(query.getBody().retriever.standard.query).toEqual({
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
    expect(query.getBody().retriever.standard.query).toEqual({
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
    expect(query.getBody().retriever.standard.query).toEqual({
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
    expect(query.getBody().retriever.standard.query).toEqual({
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
    expect(query.getBody().retriever.standard.query).toEqual({
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
    expect(query.getBody().retriever.standard.query).toEqual({
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
    expect(query.getBody().retriever.standard.query).toEqual({
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
    expect(query.getBody().retriever.standard.query).toEqual({
      multi_match: {
        fields: ['category', 'tag'],
        query: 'Sports',
      },
    });
  });
  it('should fulltext NOT match single value', () => {
    const query = new QueryBuilder();
    query.notMatch('headline', 'News');
    expect(query.getBody().retriever.standard.query).toEqual({
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
    expect(query.getBody().retriever.standard.query).toEqual({
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
    expect(query.getBody().retriever.standard.query).toEqual({
      term: {
        tag: 'News',
      },
    });
  });
  it('should exact match multiple values ANY', () => {
    const query = new QueryBuilder();
    query.term('tag', ['News', 'Entertainment']);
    expect(query.getBody().retriever.standard.query).toEqual({
      terms: {
        tag: ['News', 'Entertainment'],
      },
    });
  });
  it('should exact match multiple values ALL', () => {
    const query = new QueryBuilder();
    query.term('tag', ['News', 'Entertainment'], 'ALL');
    expect(query.getBody().retriever.standard.query).toEqual({
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
      expect(body.retriever.standard.query).toEqual({
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
      expect(body.retriever.standard.query).toEqual({
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
      expect(body.retriever.standard.query).toEqual({
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
      expect(body.retriever.standard.query).toEqual({
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

  describe('QueryBuilder retrievers', () => {
    it('semantic() should add a semantic retriever with weight and normalizer', () => {
      const qb = new QueryBuilder();
      qb.semantic('title-embed', 'harry potter', 2);
      const body = qb.getBody();

      expect(body).toHaveProperty('retriever.linear');
      const linear: any = (body as any).retriever.linear;

      expect(linear.normalizer).toBe('minmax');
      expect(Array.isArray(linear.retrievers)).toBe(true);
      expect(linear.retrievers.length).toBe(1);

      const entry = linear.retrievers[0];
      expect(entry.weight).toBe(2);
      expect(entry.normalizer).toBe('minmax');
      expect(entry.retriever).toEqual({
        standard: {
          query: {
            semantic: {
              field: 'title-embed',
              query: 'harry potter',
            },
          },
        },
      });
    });

    it('rrf() should add an rrf retriever combining lexical and semantic', () => {
      const qb = new QueryBuilder();
      qb.rankWindowSize(100).rankConstant(60);
      qb.rrf({ semanticField: 'content-vector', standardField: 'content', phrase: 'magic castle', weight: 3 });
      const body = qb.getBody();

      expect(body).toHaveProperty('retriever.linear');
      const linear: any = (body as any).retriever.linear;
      expect(linear.normalizer).toBe('minmax');
      expect(linear.retrievers.length).toBe(1);

      const entry = linear.retrievers[0];
      expect(entry.weight).toBe(3);
      expect(entry.normalizer).toBe('minmax');
      expect(entry.retriever).toEqual({
        rrf: {
          retrievers: [
            {
              standard: {
                query: {
                  match: {
                    content: 'magic castle',
                  },
                },
              },
            },
            {
              standard: {
                query: {
                  semantic: {
                    field: 'content-vector',
                    query: 'magic castle',
                  },
                },
              },
            },
          ],
          rank_window_size: 100,
          rank_constant: 60,
        },
      });
    });
  });
});


// Added tests for highlightField()
describe('QueryBuilder highlighting', () => {
  it('highlightField() should add styled FVH highlighting for a single field', () => {
    const qb = new QueryBuilder();
    qb.highlightField('content_*.fulltext', 100, 3);
    const body: any = qb.getBody();

    expect(body.highlight).toBeDefined();
    expect(body.highlight.tags_schema).toBe('styled');
    expect(body.highlight.fields).toEqual({
      'content_*.fulltext': {
        type: 'fvh',
        fragment_size: 100,
        number_of_fragments: 3,
      },
    });
  });

  it('highlightField() should support multiple fields and merge with existing highlighter', () => {
    const qb = new QueryBuilder();

    // Start with a custom highlighter option to ensure it is preserved
    qb.useHighlighter({ order: 'score', fields: { title: { type: 'fvh', fragment_size: 50, number_of_fragments: 1 } }, tags_schema: 'styled' } as any);

    qb.highlightField(['body', 'summary'], 120, 5);

    const body: any = qb.getBody();
    expect(body.highlight.tags_schema).toBe('styled');
    expect(body.highlight.order).toBe('score');

    // Existing field should remain and new fields should be added with requested settings
    expect(body.highlight.fields).toEqual({
      title: { type: 'fvh', fragment_size: 50, number_of_fragments: 1 },
      body: { type: 'fvh', fragment_size: 120, number_of_fragments: 5 },
      summary: { type: 'fvh', fragment_size: 120, number_of_fragments: 5 },
    });
  });

  it('highlightField() should override fragment settings for an existing field when called again', () => {
    const qb = new QueryBuilder();
    qb.highlightField('body', 80, 2);

    // Call again with different values (should update the field config)
    qb.highlightField('body', 200, 10);

    const body: any = qb.getBody();
    expect(body.highlight.fields).toEqual({
      body: { type: 'fvh', fragment_size: 200, number_of_fragments: 10 },
    });
  });
});


// Added tests for knn(), rescore(), minScore(), termsSet()
describe('QueryBuilder advanced features', () => {
  it('knn() should add a KNN retriever with weight and parameters', () => {
    const qb = new QueryBuilder();
    qb.knn('embedding', [0.1, 0.2, 0.3], 10, 100, 2);
    const body: any = qb.getBody();

    expect(body).toHaveProperty('retriever.linear');
    const linear: any = body.retriever.linear;
    expect(linear.normalizer).toBe('minmax');
    expect(linear.retrievers.length).toBe(1);

    const entry = linear.retrievers[0];
    expect(entry.weight).toBe(2);
    expect(entry.normalizer).toBe('minmax');
    expect(entry.retriever).toEqual({
      knn: {
        field: 'embedding',
        query_vector: [0.1, 0.2, 0.3],
        k: 10,
        num_candidates: 100,
      },
    });
  });

  it('rescore() should set a rescore phase on the request', () => {
    const qb = new QueryBuilder();
    qb.match('title', 'harry');
    qb.rescore(50, { match_phrase: { title: { query: 'harry potter', slop: 1 } } } as any);

    const full: any = qb.getQuery();
    expect(full.rescore).toEqual([
      {
        window_size: 50,
        query: {
          rescore_query: {
            match_phrase: { title: { query: 'harry potter', slop: 1 } },
          },
        },
      },
    ]);
  });

  it('minScore() should set top-level min_score', () => {
    const qb = new QueryBuilder();
    qb.minScore(0.7);
    const full: any = qb.getQuery();
    expect(full.min_score).toBe(0.7);
  });

  it('termsSet() should add a terms_set must clause with optional script', () => {
    const qb = new QueryBuilder();
    qb.termsSet('tags', ['a', 'b', 'c'], 'Math.min(params.num_terms, 2)');

    const body: any = qb.getBody();
    expect(body.retriever.standard.query).toEqual({
      terms_set: {
        tags: {
          terms: ['a', 'b', 'c'],
          minimum_should_match_script: { source: 'Math.min(params.num_terms, 2)' },
        },
      },
    });
  });
});
