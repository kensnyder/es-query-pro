import { describe, expect, it } from 'bun:test';
import QueryBuilder from './QueryBuilder';

// fields()
describe('QueryBuilder.fields()', () => {
  it('should add fields', () => {
    const query = new QueryBuilder();
    query.fields(['title', 'body']);
    expect(query.getQuery()).toEqual({
      _source: ['title', 'body'],
      query: {
        match_all: {},
      },
    });
  });
  it('should use asterisk when no fields are specified', () => {
    const query = new QueryBuilder();
    expect(query.getQuery()).toEqual({
      _source: ['*'],
      query: {
        match_all: {},
      },
    });
  });
});
describe('QueryBuilder.getQuery()', () => {
  it('should add fields', () => {
    const query = new QueryBuilder();
    query.fields(['title', 'body']);
    const result = {
      _source: ['title', 'body'],
      query: {
        match_all: {},
      },
    };
    expect(query.getQuery()).toEqual(result);
    expect(query.toJSON()).toEqual(result);
    expect(query.valueOf()).toEqual(result);
  });
  it('should use asterisk when no fields are specified', () => {
    const query = new QueryBuilder();
    expect(query.getQuery()).toEqual({
      _source: ['*'],
      query: {
        match_all: {},
      },
    });
  });
});

// range()
describe('QueryBuilder.range()', () => {
  it("should build 'gt'", () => {
    const query = new QueryBuilder();
    query.range('quantity', 'gt', 500);
    expect(query.getMust()[0]).toEqual({
      range: {
        quantity: { gt: 500 },
      },
    });
  });
  it("should build 'between'", () => {
    const query = new QueryBuilder();
    query.range('quantity', 'between', [500, 600]);
    expect(query.getMust()[0]).toEqual({
      range: {
        quantity: { gte: 500, lte: 600 },
      },
    });
  });
  it("should treat 'between' like 'gt' if second value is empty", () => {
    const query = new QueryBuilder();
    query.range('quantity', 'between', [500, null]);
    expect(query.getMust()[0]).toEqual({
      range: {
        quantity: { gte: 500 },
      },
    });
  });
  it("should ignore 'between' when empty", () => {
    const query = new QueryBuilder();
    query.range('quantity', 'between', [null, null]);
    expect(query.getMust()).toEqual([]);
  });
});

// matchPhrase()
describe('QueryBuilder.matchPhrase()', () => {
  it('should build a match_phrase with slop default 0', () => {
    const qb = new QueryBuilder();
    qb.matchPhrase({ field: 'headline', phrase: 'global markets rally' });
    expect(qb.getMust()[0]).toEqual({
      match_phrase: {
        headline: {
          query: 'global markets rally',
          slop: 0,
        },
      },
    });
  });
  it('should honor a custom slop value', () => {
    const qb = new QueryBuilder();
    qb.matchPhrase({
      field: 'headline',
      phrase: 'federal reserve',
      slop: 2,
    });
    expect(qb.getMust()[0]).toEqual({
      match_phrase: {
        headline: {
          query: 'federal reserve',
          slop: 2,
        },
      },
    });
  });
});

// matchPhrasePrefix()
describe('QueryBuilder.matchPhrasePrefix()', () => {
  it('should build a match_phrase_prefix with slop default 0', () => {
    const qb = new QueryBuilder();
    qb.matchPhrasePrefix({
      field: 'headline',
      phrase: 'united stat',
    });
    expect(qb.getMust()[0]).toEqual({
      match_phrase_prefix: {
        headline: {
          query: 'united stat',
          slop: 0,
        },
      },
    });
  });
});

// match()
describe('QueryBuilder.match()', () => {
  it('should build a match with given options merged', () => {
    const qb = new QueryBuilder();
    qb.match({
      field: 'body',
      phrase: 'climate change',
      operator: 'and',
      boost: 2,
    });
    expect(qb.getMust()[0]).toEqual({
      match: {
        body: {
          query: 'climate change',
          operator: 'and',
          boost: 2,
        },
      },
    });
  });
});

// rrf()
describe('QueryBuilder.rrf()', () => {
  it('should add an RRF retriever combining lexical and semantic', () => {
    const qb = new QueryBuilder();
    qb.rankWindowSize(100).rankConstant(60);
    qb.rrf({
      semanticField: 'content-vector',
      standardField: 'content',
      phrase: 'magic castle',
      weight: 3,
    });
    const body: any = qb.getBody();
    expect(body).toEqual({
      retriever: {
        rrf: {
          retrievers: [
            { standard: { query: { match: { content: 'magic castle' } } } },
            {
              standard: {
                query: {
                  semantic: { field: 'content-vector', query: 'magic castle' },
                },
              },
            },
          ],
          rank_window_size: 100,
          rank_constant: 60,
        },
      },
    });
  });
});

// semantic()
describe('QueryBuilder.semantic()', () => {
  it('should add a semantic retriever with weight', () => {
    const qb = new QueryBuilder();
    qb.semantic({ field: 'title-embed', phrase: 'harry potter', weight: 2 });
    const body: any = qb.getBody();
    expect(body).toEqual({
      retriever: {
        standard: {
          query: { semantic: { field: 'title-embed', query: 'harry potter' } },
        },
      },
    });
  });
});

// term()
describe('QueryBuilder.term()', () => {
  it('should add a term filter', () => {
    const qb = new QueryBuilder();
    qb.term({ field: 'status', value: 'published' });
    expect(qb.getMust()[0]).toEqual({ term: { status: 'published' } });
  });
});

// exists()
describe('QueryBuilder.exists()', () => {
  it('should add an exists filter', () => {
    const qb = new QueryBuilder();
    qb.exists({ field: 'author.name' });
    expect(qb.getMust()[0]).toEqual({ exists: { field: 'author.name' } });
  });
});

// queryString()
describe('QueryBuilder.queryString()', () => {
  it('should add a query_string filter against a field', () => {
    const qb = new QueryBuilder();
    qb.queryString({
      field: 'body',
      queryString: '(economy AND inflation) NOT recession',
    });
    expect(qb.getMust()[0]).toEqual({
      query_string: {
        fields: ['body'],
        query: '(economy AND inflation) NOT recession',
      },
    });
  });
});

// moreLikeThis()
describe('QueryBuilder.moreLikeThis()', () => {
  it('should add more_like_this for a string like value', () => {
    const qb = new QueryBuilder();
    qb.moreLikeThis({
      field: 'content',
      like: 'mars mission updates',
      min_term_freq: 1,
      max_query_terms: 12,
    });
    expect(qb.getMust()[0]).toEqual({
      more_like_this: {
        fields: ['content'],
        like: 'mars mission updates',
        min_term_freq: 1,
        max_query_terms: 12,
      },
    });
  });
  it('should leave object likes untouched', () => {
    const qb = new QueryBuilder();
    qb.moreLikeThis({
      field: 'content',
      like: [{ _id: 'abc123', _index: 'articles' }],
    });
    expect(qb.getMust()[0]).toEqual({
      more_like_this: {
        fields: ['content'],
        like: [{ _id: 'abc123', _index: 'articles' }],
      },
    });
  });
});

// rawCondition()
describe('QueryBuilder.rawCondition()', () => {
  it('should push raw query objects into must', () => {
    const qb = new QueryBuilder();
    qb.rawCondition({ wildcard: { sku: 'WM-2025-*' } } as any);
    expect(qb.getMust()[0]).toEqual({ wildcard: { sku: 'WM-2025-*' } });
  });
});

// aggregateTerm()
describe('QueryBuilder.includeFacets()', () => {
  it('should create terms aggs for array of fields', () => {
    const qb = new QueryBuilder();
    qb.aggregateTerm({ field: 'category', limit: 50 });
    qb.aggregateTerm({ field: 'brand', limit: 50 });
    const body: any = qb.getBody();
    expect(body.aggs).toEqual({
      category: {
        terms: {
          field: 'category',
          size: 50,
          show_term_doc_count_error: false,
          order: { _count: 'desc' },
        },
      },
      brand: {
        terms: {
          field: 'brand',
          size: 50,
          show_term_doc_count_error: false,
          order: { _count: 'desc' },
        },
      },
    });
  });
});

// aggregateTerm()
describe('QueryBuilder.aggregateTerm()', () => {
  it('should create a single terms aggregation and set limit to 0', () => {
    const qb = new QueryBuilder();
    qb.aggregateTerm({ field: 'status', limit: 5, exclude: ['archived'] });
    const full = qb.getQuery();
    expect(full.aggs).toEqual({
      status: {
        terms: {
          field: 'status',
          size: 5,
          show_term_doc_count_error: false,
          order: { _count: 'desc' },
          exclude: ['archived'],
        },
      },
    });
    expect(full.size).toBe(0);
  });
});

// dateHistogram()
describe('QueryBuilder.dateHistogram()', () => {
  it('should build a date_histogram aggregation and set limit to 0', () => {
    const qb = new QueryBuilder();
    qb.dateHistogram({
      field: 'published_at',
      interval: 'month',
      timezone: '+02:00',
    });
    const full = qb.getQuery();
    expect(full.aggs).toEqual({
      published_at: {
        date_histogram: {
          calendar_interval: '1M',
          field: 'published_at',
          format: 'uuuu-MM',
          min_doc_count: 0,
          time_zone: '+02:00',
        },
      },
    });
    expect(full.size).toBe(0);
  });
  it('should build a date_histogram aggregation on integer offsets', () => {
    const qb = new QueryBuilder();
    qb.dateHistogram({
      field: 'published_at',
      interval: 'month',
      timezone: 120,
    });
    const full = qb.getQuery();
    expect(full.aggs).toEqual({
      published_at: {
        date_histogram: {
          calendar_interval: '1M',
          field: 'published_at',
          format: 'uuuu-MM',
          min_doc_count: 0,
          time_zone: '+02:00',
        },
      },
    });
    expect(full.size).toBe(0);
  });
});

// pagination and sorting

describe('QueryBuilder.limit()', () => {
  it('should set size option', () => {
    const qb = new QueryBuilder();
    qb.limit(25);
    const full = qb.getQuery();
    expect(full.size).toBe(25);
  });
});

describe('QueryBuilder.page()', () => {
  it('should set from offset when page > 1', () => {
    const qb = new QueryBuilder();
    qb.limit(10).page(3);
    const full = qb.getQuery();
    expect(full.from).toBe(20);
  });
});

describe('QueryBuilder.sort()', () => {
  it('should support string, string with direction, minus-prefix for desc, object and array inputs', () => {
    const qb = new QueryBuilder();
    qb.sort('published_at')
      .sort('updated_at', 'desc')
      .sort('-created_at')
      .sort({ _score: 'desc' })
      .sort([{ name: 'asc' }, { created_at: 'desc' }]);
    const full = qb.getQuery();
    expect(full.sort).toEqual([
      { published_at: { order: 'asc' } },
      { updated_at: { order: 'desc' } },
      { created_at: { order: 'desc' } },
      { _score: { order: 'desc' } },
      { name: { order: 'asc' } },
      { created_at: { order: 'desc' } },
    ]);
  });
});

describe('QueryBuilder.clear()', () => {
  it('should clear specified areas and also support clearing all', () => {
    const qb = new QueryBuilder();
    qb.fields(['title'])
      .excludeFields(['body'])
      .limit(50)
      .page(2)
      .sort('published_at')
      .term({ field: 'status', value: 'published' })
      .aggregateTerm({ field: 'category', limit: 10 })
      .highlightField('title')
      .decayFunctionScore({
        field_value_factor: { field: 'popularity', factor: 1.2 },
      });

    qb.reset([
      'fields',
      'excludeFields',
      'limit',
      'page',
      'sorts',
      'must',
      'aggs',
      'highlighter',
      'functionScores',
    ]);

    const empty = new QueryBuilder();
    expect(qb.getFields()).toEqual(empty.getFields());
    expect(qb.getExcludeFields()).toEqual(empty.getExcludeFields());
    expect(qb.getLimit()).toEqual(empty.getLimit());
    expect(qb.getSort()).toEqual(empty.getSort());
    expect(qb.getMust()).toEqual(empty.getMust());
    expect(qb.getAggs()).toEqual(empty.getAggs());
    expect(qb.getHighlighter()).toEqual(empty.getHighlighter());
    expect(qb.getFunctionScores()).toEqual(empty.getFunctionScores());
  });
});

describe('QueryBuilder.clone()', () => {
  it('should copy every piece of state', () => {
    const qb = new QueryBuilder({ index: 'books' });
    qb.fields(['title'])
      .excludeFields(['body'])
      .sort('published_at')
      .term({ field: 'status', value: 'published' })
      .aggregateTerm({ field: 'category', limit: 10 })
      .highlightField('title')
      .decayFunctionScore({
        field_value_factor: { field: 'popularity', factor: 1.2 },
      })
      .limit(25)
      .page(3)
      .minScore(0.5)
      .trackTotalHits(true)
      .sortByRandom(true);
    const copy = qb.clone();
    expect(copy).not.toBe(qb);
    expect(copy.getQuery()).toEqual(qb.getQuery());
    expect(copy.getLimit()).toBe(25);
    expect(copy.getPage()).toBe(3);
    expect(copy.getSortByRandom()).toBe(true);
  });
  it('should not share nested state with the original', () => {
    const qb = new QueryBuilder();
    qb.term({ field: 'status', value: 'published' })
      .sort('published_at')
      .decayFunctionScore({
        field_value_factor: { field: 'popularity', factor: 1.2 },
      })
      .aggregateTerm({ field: 'category', limit: 10 })
      .highlightField('title');
    const copy = qb.clone();
    copy.term({ field: 'author', value: 'tolkien' });
    copy.sort('title');
    copy.decayFunctionScore({ random_score: {} });
    copy.aggregateTerm({ field: 'author', limit: 5 });
    copy.highlightField('body');
    (copy.getMust()[0] as any).term.status = 'draft';
    expect(qb.getMust()).toEqual([{ term: { status: 'published' } }]);
    expect(qb.getSort().length).toBe(1);
    expect(qb.getFunctionScores().length).toBe(1);
    expect(Object.keys(qb.getAggs() ?? {})).toEqual(['category']);
    expect(Object.keys(qb.getHighlighter()?.fields ?? {})).toEqual(['title']);
  });
});

describe('QueryBuilder.sortByRandom()', () => {
  it('should wrap queries with function_score random_score when enabled', () => {
    const qb = new QueryBuilder();
    qb.term({ field: 'status', value: 'published' }).sortByRandom(true);
    const body: any = qb.getBody();
    expect(body.query).toEqual({
      function_score: {
        query: { term: { status: 'published' } },
        functions: [{ random_score: {} }],
        boost_mode: 'replace',
      },
    });
  });
  it('should not set a retriever for match_all when sorts exist and no filters', () => {
    const qb = new QueryBuilder();
    qb.sortByRandom(true).sort('_score' as any);
    const body: any = qb.getBody();
    expect(body.retriever).toBeUndefined();
  });
});

describe('QueryBuilder.decayFunctionScore() and getFunctionScores()', () => {
  const gauss = {
    gauss: {
      publish_date: {
        origin: 'now',
        scale: '10d',
        offset: '5d',
        decay: 0.5,
      },
    },
  };
  it('should collect function scores', () => {
    const qb = new QueryBuilder();
    qb.decayFunctionScore(gauss);
    expect(qb.getFunctionScores().length).toBe(1);
  });
  it('should wrap a filtered query in function_score', () => {
    const qb = new QueryBuilder();
    qb.term({ field: 'status', value: 'published' }).decayFunctionScore(gauss);
    const body: any = qb.getBody();
    expect(body.query).toEqual({
      function_score: {
        query: { term: { status: 'published' } },
        functions: [gauss],
      },
    });
    expect(qb.getQuery().query).toEqual(body.query);
  });
  it('should wrap match_all in function_score when there are no filters', () => {
    const qb = new QueryBuilder();
    qb.decayFunctionScore(gauss);
    const body: any = qb.getBody();
    expect(body.query).toEqual({
      function_score: {
        query: { match_all: {} },
        functions: [gauss],
      },
    });
  });
  it('should combine multiple functions in order', () => {
    const qb = new QueryBuilder();
    const fvf = { field_value_factor: { field: 'popularity', factor: 1.2 } };
    qb.decayFunctionScore(gauss).decayFunctionScore(fvf);
    const body: any = qb.getBody();
    expect(body.query.function_score.functions).toEqual([gauss, fvf]);
  });
  it('should merge with random_score when sortByRandom is enabled', () => {
    const qb = new QueryBuilder();
    qb.term({ field: 'status', value: 'published' })
      .decayFunctionScore(gauss)
      .sortByRandom(true);
    const body: any = qb.getBody();
    expect(body.query).toEqual({
      function_score: {
        query: { term: { status: 'published' } },
        functions: [gauss, { random_score: {} }],
        boost_mode: 'replace',
      },
    });
  });
  it('should not emit function_score after functionScores are reset', () => {
    const qb = new QueryBuilder();
    qb.decayFunctionScore(gauss).reset(['functionScores']);
    const body: any = qb.getBody();
    expect(body.query).toEqual({ match_all: {} });
  });
});

// boolean combinators

describe('QueryBuilder.should()', () => {
  it('should build a bool.should with minimum_should_match', () => {
    const qb = new QueryBuilder();
    qb.should(
      [
        (q) => {
          q.term({ field: 'status', value: 'published' });
        },
        (q) => {
          q.range('views', '>=', 1000);
        },
      ],
      {
        minimumShouldMatch: 1,
      },
    );
    expect(qb.getMust()[0]).toEqual({
      bool: {
        should: [
          { term: { status: 'published' } },
          { range: { views: { gte: 1000 } } },
        ],
        minimum_should_match: 1,
      },
    });
  });
});

describe('QueryBuilder.mustNot()', () => {
  it('should build a bool.must_not from a sub-builder', () => {
    const qb = new QueryBuilder();
    qb.mustNot((q) => {
      q.term({ field: 'status', value: 'draft' });
    });
    expect(qb.getMust()[0]).toEqual({
      bool: { must_not: [{ term: { status: 'draft' } }] },
    });
  });
});

describe('QueryBuilder.nested()', () => {
  it('should build a nested query from a sub-builder', () => {
    const qb = new QueryBuilder();
    qb.nested({
      query: (q) => {
        q.term({ field: 'authors.name', value: 'Toni Morrison' });
      },
      path: 'authors',
      scoreMode: 'avg',
      innerHits: { name: 'top_authors' } as any,
      ignoreUnmapped: true,
    });
    expect(qb.getMust()[0]).toEqual({
      nested: {
        path: 'authors',
        query: { term: { 'authors.name': 'Toni Morrison' } },
        score_mode: 'avg',
        inner_hits: { name: 'top_authors' },
        ignore_unmapped: true,
      },
    });
  });
});

// highlighting

describe('QueryBuilder.useHighlighter()', () => {
  it('should update highlighter config', () => {
    const qb = new QueryBuilder();
    qb.highlighterOptions({
      boundary_scanner_locale: 'fr-FR',
    });
    qb.highlightField('body');
    const body: any = qb.getBody();
    expect(body.highlight.boundary_scanner_locale).toEqual('fr-FR');
    expect(body.highlight.fields).toEqual({ body: {} });
  });
});

describe('QueryBuilder.highlightField()', () => {
  it('should add FVH highlight entries and preserve top-level options', () => {
    const qb = new QueryBuilder();
    qb.highlighterOptions({ type: 'plain' });
    qb.highlightField('title', {
      type: 'fvh',
      fragment_size: 100,
      number_of_fragments: 3,
    });
    qb.highlightField('body');
    const body: any = qb.getBody();
    expect(body.highlight.type).toEqual('plain');
    expect(body.highlight.fields).toEqual({
      title: { type: 'fvh', fragment_size: 100, number_of_fragments: 3 },
      body: {},
    });
  });
});

// getFields()

describe('QueryBuilder.getFields()', () => {
  it('should return fields set via fields()', () => {
    const qb = new QueryBuilder();
    qb.fields(['title', 'summary']);
    expect(qb.getFields()).toEqual(['title', 'summary']);
  });
});

// getBody() and getQuery() defaults

describe('QueryBuilder.getBody() and getQuery() defaults', () => {
  it('should build match_all retriever when no filters and no sorts', () => {
    const qb = new QueryBuilder();
    const full = qb.getQuery();
    expect(full).toEqual({
      _source: ['*'],
      query: { match_all: {} },
    });
  });
  it('should omit retriever when sorts exist and no filters', () => {
    const qb = new QueryBuilder();
    qb.sort({ _score: 'desc' } as any);
    const body: any = qb.getBody();
    expect(body.retriever).toBeUndefined();
  });
});

// knn(), rescore(), minScore(), termsSet(), toKibana()

describe('QueryBuilder.knn()', () => {
  it('should add a knn retriever entry', () => {
    const qb = new QueryBuilder();
    qb.knn({
      field: 'embedding',
      vector: [0.1, 0.2, 0.9],
      k: 10,
      numCandidates: 50,
      weight: 2,
    });
    const body: any = qb.getBody();
    expect(body).toEqual({
      retriever: {
        knn: {
          field: 'embedding',
          query_vector: [0.1, 0.2, 0.9],
          k: 10,
          num_candidates: 50,
        },
      },
    });
  });
});

describe('QueryBuilder.rescore()', () => {
  it('should append rescore entries', () => {
    const qb = new QueryBuilder();
    qb.rescore(
      (q) => {
        q.match({ field: 'title', phrase: 'harry' });
      },
      {
        windowSize: 50,
      },
    );
    qb.rescore(
      (q) => {
        q.match({ field: 'title', phrase: 'potter' });
      },
      {
        windowSize: 25,
      },
    );
    const rescore = [qb.getQuery().rescore ?? []].flat();
    expect(rescore[0]?.window_size).toBe(50);
    expect(rescore[1]?.window_size).toBe(25);
    expect(rescore.length).toBe(2);
  });
});

describe('QueryBuilder.minScore()', () => {
  it('should set min_score option', () => {
    const qb = new QueryBuilder();
    qb.minScore(0.42);
    const full = qb.getQuery();
    expect(full.min_score).toBe(0.42);
  });
});

describe('QueryBuilder.termsSet()', () => {
  it('should add a terms_set clause with a minimum_should_match_script when provided', () => {
    const qb = new QueryBuilder();
    qb.termsSet({
      field: 'tags',
      terms: ['hiking', 'camping', 'skiing'],
      script: 'Math.min(params.num_terms, 2)',
    });
    expect(qb.getMust()[0]).toEqual({
      terms_set: {
        tags: {
          terms: ['hiking', 'camping', 'skiing'],
          minimum_should_match_script: {
            source: 'Math.min(params.num_terms, 2)',
          },
        },
      },
    });
  });
});

describe('QueryBuilder.toKibana()', () => {
  it('should format a Kibana GET request with body', () => {
    const qb = new QueryBuilder();
    qb.index('news-index').term({ field: 'category', value: 'World' });
    const kibana = qb.toKibana('news-index');
    expect(kibana.startsWith('GET news-index/_search\n')).toBe(true);
    expect(kibana.includes('"category": "World"'));
  });
});

// matchBoostedPhrase()

describe('QueryBuilder.matchBoostedPhrase()', () => {
  it('should build bool.should with default operators exact and and with boosts', () => {
    const qb = new QueryBuilder();
    qb.matchBoostedPhrase({ field: 'title', phrase: 'Harry Potter' });
    expect(qb.getMust()).toEqual([
      {
        bool: {
          should: [
            // B-045: the exact phrase gets the highest default boost
            { match_phrase: { title: { query: 'Harry Potter', boost: 5 } } },
            {
              match: {
                title: { query: 'Harry Potter', operator: 'and', boost: 3 },
              },
            },
          ],
          minimum_should_match: 1,
        },
      },
    ]);
  });

  it('should respect custom operators order and weights, including or', () => {
    const qb = new QueryBuilder();
    qb.matchBoostedPhrase({
      field: 'title',
      phrase: 'Harry Potter',
      operators: ['or', 'and', 'exact'],
      weights: [2, 5, 7],
    });
    expect(qb.getMust()).toEqual([
      {
        bool: {
          should: [
            {
              match: {
                title: { query: 'Harry Potter', operator: 'or', boost: 2 },
              },
            },
            {
              match: {
                title: { query: 'Harry Potter', operator: 'and', boost: 5 },
              },
            },
            { match_phrase: { title: { query: 'Harry Potter', boost: 7 } } },
          ],
          minimum_should_match: 1,
        },
      },
    ]);
  });

  it('should not add anything when operators is empty', () => {
    const qb = new QueryBuilder();
    qb.matchBoostedPhrase({
      field: 'title',
      phrase: 'Harry Potter',
      operators: [],
      weights: [],
    });
    expect(qb.getMust()).toEqual([]);
  });
});

// Added tests for knn similarity and filter, and range between inclusivity

describe('QueryBuilder.knn() with similarity and filter', () => {
  it('should pass similarity through when provided', () => {
    const qb = new QueryBuilder();
    qb.knn({
      field: 'vec',
      vector: [1, 0, 0],
      k: 5,
      weight: 1,
      similarity: 'cosine',
    });
    const body: any = qb.getBody();
    expect(body.retriever.knn.similarity).toBe('cosine');
  });

  it('should wrap multiple filters under bool.filter', () => {
    const qb = new QueryBuilder();
    qb.knn({
      field: 'vec',
      vector: [0.1, 0.2],
      k: 3,
      filter: [
        { term: { status: 'active' } } as any,
        { range: { year: { gte: 2000 } } } as any,
      ],
      weight: 1,
    });
    const knn = qb.getBody().retriever?.knn;
    expect(knn?.filter).toEqual({
      bool: {
        filter: [
          { term: { status: 'active' } },
          { range: { year: { gte: 2000 } } },
        ],
      },
    });
  });

  it('should attach a single filter directly', () => {
    const qb = new QueryBuilder();
    qb.knn({
      field: 'vec',
      vector: [0.3, 0.4],
      k: 2,
      filter: { term: { category: 'news' } },
      weight: 1,
    });
    const knn = qb.getBody().retriever?.knn;
    expect(knn?.filter).toEqual({ term: { category: 'news' } });
  });
});

describe('QueryBuilder.range() "between" inclusivity', () => {
  it('should throw TypeError on invalid operator', () => {
    const qb = new QueryBuilder();
    // @ts-expect-error  just testing
    expect(() => qb.range('price', 'invalid', 10)).toThrow(TypeError);
  });
});

// searchAfter and trackTotalHits

describe('QueryBuilder deep pagination and total hits', () => {
  it('should include search_after and track_total_hits in options', () => {
    const qb = new QueryBuilder();
    qb.searchAfter(['A', 10]);
    qb.trackTotalHits(100000);
    const full: any = qb.getQuery();
    expect(full.search_after).toEqual(['A', 10]);
    expect(full.track_total_hits).toBe(100000);
  });

  it('should allow boolean track_total_hits', () => {
    const qb = new QueryBuilder();
    qb.trackTotalHits(true);
    const full: any = qb.getQuery();
    expect(full.track_total_hits).toBe(true);
  });
});

// rescore guardrails with retrievers

describe('QueryBuilder rescore with retrievers', () => {
  it('should omit rescore for pure knn-only retrieval', () => {
    const qb = new QueryBuilder();
    qb.knn({ field: 'vec', vector: [0.1, 0.2], k: 3, weight: 1 });
    qb.rescore(
      (q) => {
        q.match({ field: 'title', phrase: 'test' });
      },
      {
        windowSize: 50,
      },
    );
    const body: any = qb.getBody();
    expect(body.rescore).toBe(undefined);
  });
});
