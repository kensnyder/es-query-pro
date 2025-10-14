import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import getEsClient from "../getEsClient/getEsClient";
import {
  createBooksIndex,
  deleteBooksIndex,
  insertBooksData,
} from "../testFixtures/books";
import QueryBuilder from "./QueryBuilder";

describe("QueryBuilder - Integration", () => {
  const client = getEsClient();
  const index = `test_query_builder_${Date.now()}`;

  beforeAll(async () => {
    await deleteBooksIndex(index);
    await createBooksIndex(index);
    await insertBooksData(index);
  });

  afterAll(async () => {
    await deleteBooksIndex(index);
  });

  it("should work with no criteria", async () => {
    const qb = new QueryBuilder();
    const result = await client.search({
      index,
      ...qb.getQuery(),
      _source: true,
      fields: ["id"],
      size: 10,
    });

    const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
    expect(docIds).toEqual(["1", "2", "3"]);
  });

  it("should find documents by term query", async () => {
    const qb = new QueryBuilder();
    qb.term({ field: "country", value: "United Kingdom" });
    const result = await client.search({
      index,
      ...qb.getQuery(),
      _source: true,
      fields: ["id"],
      size: 10,
    });

    const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
    expect(docIds).toEqual(["1", "2"]);
  });

  it("should find documents by match query", async () => {
    const qb = new QueryBuilder();
    qb.match({ field: "title", phrase: "Harry" });
    const result = await client.search({
      index,
      ...qb.getQuery(),
      _source: true,
      fields: ["id"],
      size: 10,
    });

    const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
    expect(docIds).toEqual(["1", "2"]);
  });

  it("should find documents by nested range query", async () => {
    const query = new QueryBuilder();
    query.nested({
      path: "publishing",
      withBuilder: (qb) => qb.range("publishing.year", "gte", 1999),
    });
    const result = await client.search({
      index,
      ...query.getQuery(),
      _source: true,
      fields: ["id"],
      size: 10,
    });

    const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
    expect(docIds).toEqual(["2", "3"]);
  });

  it("should handle matchPhrase nested with slop", async () => {
    const query = new QueryBuilder();
    query.index(index);
    query.nested({
      path: "publishing",
      withBuilder: (qb) => {
        qb.matchPhrase({
          field: "publishing.series",
          phrase: "harry series",
          options: { slop: 3 },
        });
      },
    });
    const result = await client.search(query.getQuery());

    const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
    expect(docIds).toEqual(["1", "2"]);
  });

  it("should find documents with both must and must_not", async () => {
    const qb = new QueryBuilder();
    qb.term({ field: "country", value: "United Kingdom" });
    qb.mustNot((qb) => {
      qb.term({ field: "title", value: "stone" });
    });
    const result = await client.search({
      index,
      ...qb.getQuery(),
      _source: true,
      fields: ["id"],
    });

    const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
    expect(docIds).toEqual(["2"]);
  });

  it("should find documents with AND concept", async () => {
    const qb = new QueryBuilder();
    qb.should({
      withBuilders: [
        (qb) => qb.match({ field: "title", phrase: "mystery" }),
        (qb) => qb.match({ field: "premise", phrase: "mystery" }),
      ],
    });
    const result = await client.search({
      index,
      ...qb.getQuery(),
      _source: true,
      fields: ["id"],
    });

    const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
    expect(docIds).toEqual(["1", "2"]);
  });

  it("should sort documents", async () => {
    const qb = new QueryBuilder();
    qb.index(index);
    qb.fields(["id", "price"]);
    qb.sort("price");
    qb.limit(2);
    const result = await client.search(qb.getQuery());

    const docIds = result.hits.hits.map((hit: any) => hit._id);
    expect(docIds).toEqual(["3", "2"]);
    const prices = result.hits.hits.map((hit: any) => hit._source.price);
    expect(prices).toEqual([18.99, 22.99]);
  });

  it("should handle pagination", async () => {
    const qb = new QueryBuilder();
    qb.index(index);
    qb.limit(2);
    qb.page(2);
    const result = await client.search(qb.getQuery());

    const docIds = result.hits.hits.map((hit: any) => hit._id);
    expect(docIds).toEqual(["3"]);
    const years = result.hits.hits.map(
      (hit: any) => hit._source.publishing.year,
    );
    expect(years).toEqual([2018]);
  });

  it("should handle exists query", async () => {
    const qb = new QueryBuilder();
    qb.index(index);
    qb.exists({ field: "extra" });
    const result = await client.search(qb.getQuery());

    const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
    expect(docIds).toEqual(["3"]);
  });

  it("should handle notExists query", async () => {
    const qb = new QueryBuilder();
    qb.index(index);
    qb.mustNot((qb) => {
      qb.exists({ field: "extra" });
    });
    const result = await client.search(qb.getQuery());

    const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
    expect(docIds).toEqual(["1", "2"]);
  });

  it("should handle matchPhrase query", async () => {
    const qb = new QueryBuilder();
    qb.index(index);
    qb.matchPhrase({ field: "title", phrase: "Harry Potter" });
    const result = await client.search(qb.getQuery());
    const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
    expect(docIds).toEqual(["1", "2"]);
  });

  it("should handle matchPhrasePrefix query", async () => {
    const qb = new QueryBuilder();
    qb.index(index);
    qb.matchPhrasePrefix({ field: "title", phrase: "Harry Pot" });
    const result = await client.search(qb.getQuery());
    const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
    expect(docIds).toEqual(["1", "2"]);
  });

  it("should handle queryString query", async () => {
    const qb = new QueryBuilder();
    qb.index(index);
    qb.queryString({ field: "premise", queryString: "myster* AND NOT alien" });
    const result = await client.search(qb.getQuery());
    const ids = result.hits.hits.map((h: any) => h._id).sort();
    expect(ids).toEqual(["1", "2"]);
  });

  it("should handle moreLikeThis query with like text", async () => {
    const qb = new QueryBuilder();
    qb.index(index);
    qb.moreLikeThis({
      field: "premise",
      like: "alien attack young pilot",
      options: {
        min_term_freq: 1,
        min_doc_freq: 1,
        max_query_terms: 25,
      } as any,
    });
    const result = await client.search(qb.getQuery());
    const ids = result.hits.hits.map((h: any) => h._id).sort();
    expect(ids.includes("3")).toBe(true);
  });

  it("should include facets for country", async () => {
    const qb = new QueryBuilder();
    qb.index(index);
    qb.includeFacets(["country"], 10);
    const result: any = await client.search(qb.getQuery());
    const buckets = result.aggregations.country.buckets;
    const map: Record<string, number> = {};
    for (const b of buckets) {
      map[b.key] = b.doc_count;
    }
    expect(map["United Kingdom"]).toBe(2);
    expect(map["United States of America"]).toBe(1);
  });

  it("should aggregate countries with aggregateTerm", async () => {
    const qb = new QueryBuilder();
    qb.index(index);
    qb.aggregateTerm("country", 10);
    const result: any = await client.search(qb.getQuery());
    const buckets = result.aggregations.country.buckets;
    const keys = buckets.map((b: any) => b.key).sort();
    const counts = buckets.reduce(
      (acc: Record<string, number>, b: any) => {
        acc[b.key] = b.doc_count;
        return acc;
      },
      {} as Record<string, number>,
    );
    expect(keys).toEqual(["United Kingdom", "United States of America"]);
    expect(counts["United Kingdom"]).toBe(2);
    expect(counts["United States of America"]).toBe(1);
  });

  it("should build a date histogram over published_at by year (ES9 calendar_interval)", async () => {
    const qb = new QueryBuilder();
    qb.index(index);
    qb.dateHistogram("published_at", "year", "+00:00");
    const result: any = await client.search(qb.getQuery());
    const buckets = result.aggregations.published_at.buckets;
    const keys = buckets.map((b: any) => b.key_as_string);
    const counts = buckets.map((b: any) => b.doc_count);
    expect(keys).toEqual(["1998", "1999", "2018"]);
    expect(counts).toEqual([1, 1, 1]);
  });

  // make sure field is indexed with term vector
  it("should return highlights for given fields", async () => {
    const qb = new QueryBuilder();
    qb.index(index);
    qb.match({ field: "title.fvh", phrase: "Harry" });
    qb.highlightField("title.fvh");
    const result: any = await client.search(qb.getQuery());
    const byId: Record<string, any> = {};
    for (const hit of result.hits.hits) {
      byId[hit._id] = hit;
    }
    expect(byId["1"].highlight?.["title.fvh"]?.[0]).toContain("<em");
    expect(byId["2"].highlight?.["title.fvh"]?.[0]).toContain("<em");
  });
});
