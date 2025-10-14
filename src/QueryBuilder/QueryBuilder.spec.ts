import { describe, expect, it } from "bun:test";
import QueryBuilder from "./QueryBuilder";

// fields()
describe("QueryBuilder.fields()", () => {
  it("should add fields", () => {
    const query = new QueryBuilder();
    query.fields(["title", "body"]);
    expect(query.getQuery()).toEqual({
      _source: ["title", "body"],
      retriever: {
        standard: {
          query: {
            match_all: {},
          },
        },
      },
    });
  });
  it("should use asterisk when no fields are specified", () => {
    const query = new QueryBuilder();
    expect(query.getQuery()).toEqual({
      _source: ["*"],
      retriever: {
        standard: {
          query: {
            match_all: {},
          },
        },
      },
    });
  });
});
describe("QueryBuilder.getQuery()", () => {
  it("should add fields", () => {
    const query = new QueryBuilder();
    query.fields(["title", "body"]);
    const result = {
      _source: ["title", "body"],
      retriever: {
        standard: {
          query: {
            match_all: {},
          },
        },
      },
    };
    expect(query.getQuery()).toEqual(result);
    expect(query.toJSON()).toEqual(result);
    expect(query.valueOf()).toEqual(result);
  });
  it("should use asterisk when no fields are specified", () => {
    const query = new QueryBuilder();
    expect(query.getQuery()).toEqual({
      _source: ["*"],
      retriever: {
        standard: {
          query: {
            match_all: {},
          },
        },
      },
    });
  });
});

// range()
describe("QueryBuilder.range()", () => {
  it("should build 'gt'", () => {
    const query = new QueryBuilder();
    query.range("quantity", "gt", 500);
    expect(query.getMust()[0]).toEqual({
      range: {
        quantity: { gt: 500 },
      },
    });
  });
  it("should build 'between'", () => {
    const query = new QueryBuilder();
    query.range("quantity", "between", [500, 600]);
    expect(query.getMust()[0]).toEqual({
      range: {
        quantity: { gte: 500, lte: 600 },
      },
    });
  });
  it("should treat 'between' like 'gt' if second value is empty", () => {
    const query = new QueryBuilder();
    query.range("quantity", "between", [500, null]);
    expect(query.getMust()[0]).toEqual({
      range: {
        quantity: { gt: 500 },
      },
    });
  });
  it("should ignore 'between' when empty", () => {
    const query = new QueryBuilder();
    query.range("quantity", "between", [null, null]);
    expect(query.getMust()).toEqual([]);
  });
});

// matchPhrase()
describe("QueryBuilder.matchPhrase()", () => {
  it("should build a match_phrase with slop default 0", () => {
    const qb = new QueryBuilder();
    qb.matchPhrase({ field: "headline", phrase: "global markets rally" });
    expect(qb.getMust()[0]).toEqual({
      match_phrase: {
        headline: {
          query: "global markets rally",
          slop: 0,
        },
      },
    });
  });
  it("should honor a custom slop value", () => {
    const qb = new QueryBuilder();
    qb.matchPhrase({
      field: "headline",
      phrase: "federal reserve",
      options: { slop: 2 },
    });
    expect(qb.getMust()[0]).toEqual({
      match_phrase: {
        headline: {
          query: "federal reserve",
          slop: 2,
        },
      },
    });
  });
});

// matchPhrasePrefix()
describe("QueryBuilder.matchPhrasePrefix()", () => {
  it("should build a match_phrase_prefix with slop default 0", () => {
    const qb = new QueryBuilder();
    qb.matchPhrasePrefix({
      field: "headline",
      phrase: "united stat",
      options: {},
    });
    expect(qb.getMust()[0]).toEqual({
      match_phrase_prefix: {
        headline: {
          query: "united stat",
          slop: 0,
        },
      },
    });
  });
});

// match()
describe("QueryBuilder.match()", () => {
  it("should build a match with given options merged", () => {
    const qb = new QueryBuilder();
    qb.match({
      field: "body",
      phrase: "climate change",
      options: { operator: "and", boost: 2 } as any,
    });
    expect(qb.getMust()[0]).toEqual({
      match: {
        body: {
          query: "climate change",
          operator: "and",
          boost: 2,
        },
      },
    });
  });
});

// rrf()
describe("QueryBuilder.rrf()", () => {
  it("should add an RRF retriever combining lexical and semantic", () => {
    const qb = new QueryBuilder();
    qb.rankWindowSize(100).rankConstant(60);
    qb.rrf({
      semanticField: "content-vector",
      standardField: "content",
      phrase: "magic castle",
      weight: 3,
    });
    const body: any = qb.getBody();
    expect(body.retriever.linear.retrievers[0]).toEqual({
      retriever: {
        rrf: {
          retrievers: [
            { standard: { query: { match: { content: "magic castle" } } } },
            {
              standard: {
                query: {
                  semantic: { field: "content-vector", query: "magic castle" },
                },
              },
            },
          ],
          rank_window_size: 100,
          rank_constant: 60,
        },
      },
      weight: 3,
      normalizer: "minmax",
    });
  });
});

// semantic()
describe("QueryBuilder.semantic()", () => {
  it("should add a semantic retriever with weight", () => {
    const qb = new QueryBuilder();
    qb.semantic({ field: "title-embed", value: "harry potter", weight: 2 });
    const body: any = qb.getBody();
    expect(body.retriever.linear.retrievers[0]).toEqual({
      retriever: {
        standard: {
          query: { semantic: { field: "title-embed", query: "harry potter" } },
        },
      },
      weight: 2,
      normalizer: "minmax",
    });
  });
});

// term()
describe("QueryBuilder.term()", () => {
  it("should add a term filter", () => {
    const qb = new QueryBuilder();
    qb.term({ field: "status", value: "published" });
    expect(qb.getMust()[0]).toEqual({ term: { status: "published" } });
  });
});

// exists()
describe("QueryBuilder.exists()", () => {
  it("should add an exists filter", () => {
    const qb = new QueryBuilder();
    qb.exists({ field: "author.name" });
    expect(qb.getMust()[0]).toEqual({ exists: { field: "author.name" } });
  });
});

// queryString()
describe("QueryBuilder.queryString()", () => {
  it("should add a query_string filter against a field", () => {
    const qb = new QueryBuilder();
    qb.queryString({
      field: "body",
      queryString: "(economy AND inflation) NOT recession",
    });
    expect(qb.getMust()[0]).toEqual({
      query_string: {
        fields: ["body"],
        query: "(economy AND inflation) NOT recession",
      },
    });
  });
});

// moreLikeThis()
describe("QueryBuilder.moreLikeThis()", () => {
  it("should add more_like_this for a string like value", () => {
    const qb = new QueryBuilder();
    qb.moreLikeThis({
      field: "content",
      like: "mars mission updates",
      options: { min_term_freq: 1, max_query_terms: 12 } as any,
    });
    expect(qb.getMust()[0]).toEqual({
      more_like_this: {
        fields: ["content"],
        like: "mars mission updates",
        min_term_freq: 1,
        max_query_terms: 12,
      },
    });
  });
  it("should leave object likes untouched", () => {
    const qb = new QueryBuilder();
    qb.moreLikeThis({
      field: "content",
      like: [{ _id: "abc123", _index: "articles" }] as any,
      options: {} as any,
    });
    expect(qb.getMust()[0]).toEqual({
      more_like_this: {
        fields: ["content"],
        like: [{ _id: "abc123", _index: "articles" }],
      },
    });
  });
});

// rawCondition()
describe("QueryBuilder.rawCondition()", () => {
  it("should push raw query objects into must", () => {
    const qb = new QueryBuilder();
    qb.rawCondition({ wildcard: { sku: "WM-2025-*" } } as any);
    expect(qb.getMust()[0]).toEqual({ wildcard: { sku: "WM-2025-*" } });
  });
});

// includeFacets()
describe("QueryBuilder.includeFacets()", () => {
  it("should create terms aggs for array of fields", () => {
    const qb = new QueryBuilder();
    qb.includeFacets(["category", "brand"], 50);
    const body: any = qb.getBody();
    expect(body.aggs).toEqual({
      category: {
        terms: {
          field: "category",
          size: 50,
          show_term_doc_count_error: true,
          order: { _count: "desc" },
        },
      },
      brand: {
        terms: {
          field: "brand",
          size: 50,
          show_term_doc_count_error: true,
          order: { _count: "desc" },
        },
      },
    });
  });
  it("should support object mapping of label to field", () => {
    const qb = new QueryBuilder();
    qb.includeFacets(
      { Companies: "company.name", Countries: "company.country" },
      10,
    );
    const body: any = qb.getBody();
    expect(body.aggs).toEqual({
      Companies: {
        terms: {
          field: "company.name",
          size: 10,
          show_term_doc_count_error: true,
          order: { _count: "desc" },
        },
      },
      Countries: {
        terms: {
          field: "company.country",
          size: 10,
          show_term_doc_count_error: true,
          order: { _count: "desc" },
        },
      },
    });
  });
});

// aggregateTerm()
describe("QueryBuilder.aggregateTerm()", () => {
  it("should create a single terms aggregation and set limit to 0", () => {
    const qb = new QueryBuilder();
    qb.aggregateTerm("status", 5, ["archived"]);
    const full = qb.getQuery();
    expect(full.aggs).toEqual({
      status: {
        terms: {
          field: "status",
          size: 5,
          show_term_doc_count_error: true,
          order: { _count: "desc" },
          exclude: ["archived"],
        },
      },
    });
    expect(full.size).toBe(0);
  });
});

// dateHistogram()
describe("QueryBuilder.dateHistogram()", () => {
  it("should build a date_histogram aggregation and set limit to 0", () => {
    const qb = new QueryBuilder();
    qb.dateHistogram("published_at", "month", "+02:00");
    const full = qb.getQuery();
    expect(full.aggs).toEqual({
      published_at: {
        date_histogram: {
          field: "published_at",
          calendar_interval: "1M",
          time_zone: "+02:00",
          format: "yyyy-MM",
        },
      },
    });
    expect(full.size).toBe(0);
  });
  it("should build a date_histogram aggregation on integer offsets", () => {
    const qb = new QueryBuilder();
    qb.dateHistogram("published_at", "month", 120);
    const full = qb.getQuery();
    expect(full.aggs).toEqual({
      published_at: {
        date_histogram: {
          field: "published_at",
          calendar_interval: "1M",
          time_zone: "+02:00",
          format: "yyyy-MM",
        },
      },
    });
    expect(full.size).toBe(0);
  });
});

// pagination and sorting

describe("QueryBuilder.limit()", () => {
  it("should set size option", () => {
    const qb = new QueryBuilder();
    qb.limit(25);
    const full = qb.getQuery();
    expect(full.size).toBe(25);
  });
});

describe("QueryBuilder.page()", () => {
  it("should set from offset when page > 1", () => {
    const qb = new QueryBuilder();
    qb.limit(10).page(3);
    const full = qb.getQuery();
    expect(full.from).toBe(20);
  });
});

describe("QueryBuilder.sort()", () => {
  it("should support string, string with direction, minus-prefix for desc, object and array inputs", () => {
    const qb = new QueryBuilder();
    qb.sort("published_at")
      .sort("updated_at", "desc")
      .sort("-created_at")
      .sort({ _score: "desc" } as any)
      .sort([{ name: "asc" }, { created_at: "desc" }] as any);
    const full = qb.getQuery();
    expect(full.sort).toEqual([
      { published_at: { order: "asc" } },
      { updated_at: { order: "desc" } },
      { created_at: { order: "desc" } },
      { _score: "desc" } as any,
      { name: { order: "asc" } },
      { created_at: { order: "desc" } },
    ]);
  });
});

describe("QueryBuilder.clear()", () => {
  it("should clear specified areas and also support clearing all", () => {
    const qb = new QueryBuilder();
    qb.fields(["title"])
      .excludeFields(["body"])
      .limit(50)
      .page(2)
      .sort("published_at")
      .term({ field: "status", value: "published" })
      .includeFacets(["category"], 10)
      .useHighlighter({ fields: { title: { type: "fvh" } } } as any)
      .decayFunctionScore({
        field_value_factor: { field: "popularity", factor: 1.2 },
      } as any);

    qb.clear([
      "fields",
      "excludeFields",
      "limit",
      "page",
      "sort",
      "must",
      "aggs",
      "highlighter",
      "functionScores",
    ]);

    const full = qb.getQuery();
    expect(full._source).toBeUndefined();
    expect(full._source_excludes).toBeUndefined();
    expect(full.size).toBeUndefined();
    expect(full.from).toBeUndefined();
    expect(full.sort).toBeUndefined();
    expect(qb.getMust()).toEqual([]);
    expect(full.aggs).toBeUndefined();
    expect(full.highlight).toBeUndefined();
    expect(qb.getFunctionScores()).toEqual([]);
  });
});

describe("QueryBuilder.sortByRandom()", () => {
  it("should wrap queries with function_score random_score when enabled", () => {
    const qb = new QueryBuilder();
    qb.term({ field: "status", value: "published" }).sortByRandom(true);
    const body: any = qb.getBody();
    expect(body.retriever.standard.query).toEqual({
      function_score: {
        query: { term: { status: "published" } },
        functions: [{ random_score: {} }],
        boost_mode: "replace",
      },
    });
  });
  it("should not set a retriever for match_all when sorts exist and no filters", () => {
    const qb = new QueryBuilder();
    qb.sortByRandom(true).sort("_score" as any);
    const body: any = qb.getBody();
    expect(body.retriever).toBeUndefined();
  });
});

describe("QueryBuilder.decayFunctionScore() and getFunctionScores()", () => {
  it("should collect function scores", () => {
    const qb = new QueryBuilder();
    qb.decayFunctionScore({
      gauss: {
        publish_date: {
          origin: "now",
          scale: "10d",
          offset: "5d",
          decay: 0.5,
        },
      },
    } as any);
    expect(qb.getFunctionScores().length).toBe(1);
  });
});

// boolean combinators

describe("QueryBuilder.should()", () => {
  it("should build a bool.should with minimum_should_match", () => {
    const qb = new QueryBuilder();
    qb.should({
      withBuilders: [
        (q) => {
          q.term({ field: "status", value: "published" });
        },
        (q) => {
          q.range("views", ">=", 1000);
        },
      ],
      minimumShouldMatch: 1,
    });
    expect(qb.getMust()[0]).toEqual({
      bool: {
        should: [
          { term: { status: "published" } },
          { range: { views: { gte: 1000 } } },
        ],
        minimum_should_match: 1,
      },
    });
  });
});

describe("QueryBuilder.mustNot()", () => {
  it("should build a bool.must_not from a sub-builder", () => {
    const qb = new QueryBuilder();
    qb.mustNot((q) => {
      q.term({ field: "status", value: "draft" });
    });
    expect(qb.getMust()[0]).toEqual({
      bool: { must_not: [{ term: { status: "draft" } }] },
    });
  });
});

describe("QueryBuilder.nested()", () => {
  it("should build a nested query from a sub-builder", () => {
    const qb = new QueryBuilder();
    qb.nested({
      path: "authors",
      withBuilder: (q) => {
        q.term({ field: "authors.name", value: "Toni Morrison" });
      },
      scoreMode: "avg",
      innerHits: { name: "top_authors" } as any,
      ignoreUnmapped: true,
    });
    expect(qb.getMust()[0]).toEqual({
      nested: {
        path: "authors",
        query: {
          bool: { must: [{ term: { "authors.name": "Toni Morrison" } }] },
        },
        score_mode: "avg",
        inner_hits: { name: "top_authors" },
        ignore_unmapped: true,
      },
    });
  });
});

// highlighting

describe("QueryBuilder.useHighlighter()", () => {
  it("should attach a highlight config to the body", () => {
    const qb = new QueryBuilder();
    qb.useHighlighter({
      fields: { body: { type: "fvh" } },
      tags_schema: "styled",
    } as any);
    const body: any = qb.getBody();
    expect(body.highlight).toEqual({
      fields: { body: { type: "fvh" } },
      tags_schema: "styled",
    });
  });
});

describe("QueryBuilder.highlightField()", () => {
  it("should add FVH highlight entries and preserve top-level options", () => {
    const qb = new QueryBuilder();
    qb.useHighlighter({ order: "score", fields: {} } as any);
    qb.highlightField(["title", "body"], 100, 3);
    const body: any = qb.getBody();
    expect(body.highlight).toEqual({
      order: "score",
      tags_schema: "styled",
      fields: {
        title: { type: "fvh", fragment_size: 100, number_of_fragments: 3 },
        body: { type: "fvh", fragment_size: 100, number_of_fragments: 3 },
      },
    });
  });
});

// getFields()

describe("QueryBuilder.getFields()", () => {
  it("should return fields set via fields()", () => {
    const qb = new QueryBuilder();
    qb.fields(["title", "summary"]);
    expect(qb.getFields()).toEqual(["title", "summary"]);
  });
});

// getBody() and getQuery() defaults

describe("QueryBuilder.getBody() and getQuery() defaults", () => {
  it("should build match_all retriever when no filters and no sorts", () => {
    const qb = new QueryBuilder();
    const full = qb.getQuery();
    expect(full).toEqual({
      _source: ["*"],
      retriever: { standard: { query: { match_all: {} } } },
    });
  });
  it("should omit retriever when sorts exist and no filters", () => {
    const qb = new QueryBuilder();
    qb.sort({ _score: "desc" } as any);
    const body: any = qb.getBody();
    expect(body.retriever).toBeUndefined();
  });
});

// knn(), rescore(), minScore(), termsSet(), toKibana()

describe("QueryBuilder.knn()", () => {
  it("should add a knn retriever entry", () => {
    const qb = new QueryBuilder();
    qb.knn({
      field: "embedding",
      vector: [0.1, 0.2, 0.9],
      k: 10,
      numCandidates: 50,
      weight: 2,
    });
    const body: any = qb.getBody();
    expect(body.retriever.linear.retrievers[0]).toEqual({
      retriever: {
        knn: {
          field: "embedding",
          query_vector: [0.1, 0.2, 0.9],
          k: 10,
          num_candidates: 50,
        },
      },
      weight: 2,
      normalizer: "minmax",
    });
  });
});

describe("QueryBuilder.rescore()", () => {
  it("should append rescore entries", () => {
    const qb = new QueryBuilder();
    qb.rescore({
      windowSize: 50,
      withBuilder: (q) => {
        q.match({ field: "title", phrase: "harry", options: {} as any });
      },
    });
    qb.rescore({
      windowSize: 25,
      withBuilder: (q) => {
        q.match({ field: "title", phrase: "potter", options: {} as any });
      },
    });
    const full: any = qb.getQuery();
    expect(full.rescore.length).toBe(2);
    expect(full.rescore[0].window_size).toBe(50);
    expect(full.rescore[1].window_size).toBe(25);
  });
});

describe("QueryBuilder.minScore()", () => {
  it("should set min_score option", () => {
    const qb = new QueryBuilder();
    qb.minScore(0.42);
    const full = qb.getQuery();
    expect(full.min_score).toBe(0.42);
  });
});

describe("QueryBuilder.termsSet()", () => {
  it("should add a terms_set clause with a minimum_should_match_script when provided", () => {
    const qb = new QueryBuilder();
    qb.termsSet(
      "tags",
      ["hiking", "camping", "skiing"],
      "Math.min(params.num_terms, 2)",
    );
    expect(qb.getMust()[0]).toEqual({
      terms_set: {
        tags: {
          terms: ["hiking", "camping", "skiing"],
          minimum_should_match_script: {
            source: "Math.min(params.num_terms, 2)",
          },
        },
      },
    });
  });
});

describe("QueryBuilder.toKibana()", () => {
  it("should format a Kibana GET request with body", () => {
    const qb = new QueryBuilder();
    qb.index("news-index").term({ field: "category", value: "World" });
    const kibana = qb.toKibana("news-index");
    expect(kibana.startsWith("GET news-index/_search\n")).toBe(true);
    expect(kibana.includes('"category": "World"'));
  });
});
