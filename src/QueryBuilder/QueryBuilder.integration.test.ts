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
  let index = `test_query_builder_${Date.now()}`;

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

  it("should find documents by term query", async () => {
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

  it("should find documents by range query", async () => {
    const qb = new QueryBuilder();
    qb.nested({
      path: "publishing",
      withBuilder: (qb) => qb.range("publishing.year", "gte", 1999),
    });
    const result = await client.search({
      index,
      ...qb.getQuery(),
      _source: true,
      fields: ["id"],
      size: 10,
    });

    const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
    expect(docIds).toEqual(["2", "3"]);
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

  it("should find documents with multi_match", async () => {
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
    console.log("qb query=", JSON.stringify(qb.getQuery(), null, 2));
    const result = await client.search(qb.getQuery());

    const docIds = result.hits.hits.map((hit: any) => hit._id);
    expect(docIds).toEqual(["3"]);
    const years = result.hits.hits.map(
      (hit: any) => hit._source.publishing.year,
    );
    expect(years).toEqual([2018]);
  });

  // it('should handle exists query', async () => {
  //   const qb = new QueryBuilder();
  //   qb.index(index);
  //   qb.fields(['*']);
  //   qb.exists('publishing/movieYear');
  //   const result = await client.search(qb.getQuery());
  //
  //   const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
  //   expect(docIds).toEqual(['1', '2']);
  // });

  // it('should handle notExists query', async () => {
  //   const qb = new QueryBuilder();
  //   qb.index(index);
  //   qb.fields(['*']);
  //   qb.term('categories/id', 101);
  //   qb.notExists('publishing/movieYear');
  //   // console.log('matchPhrase', JSON.stringify(qb.getQuery(), null, 2));
  //   const result = await client.search(qb.getQuery());
  //
  //   const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
  //   expect(docIds).toEqual(['3']);
  // });

  it("should handle matchPhrase query", async () => {
    const qb = new QueryBuilder();
    qb.index(index);
    qb.matchPhrase({ field: "title", phrase: "Harry Potter" });
    const result = await client.search(qb.getQuery());
    // console.log('matchPhrase', JSON.stringify(qb.getQuery(), null, 2));
    const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
    expect(docIds).toEqual(["1", "2"]);
  });

  // it('should handle matchPhrase nested query', async () => {
  //   const qb = new QueryBuilder();
  //   qb.index(index);
  //   qb.matchPhrase('publishing/organization', 'publish');
  //   // console.log('matchPhrase', JSON.stringify(qb.getQuery(), null, 2));
  //   const result = await client.search(qb.getQuery());
  //   const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
  //   expect(docIds).toEqual(['1', '2']);
  // });

  // it('should handle matchPhrase nested with slop', async () => {
  //   const qb = new QueryBuilder();
  //   qb.index(index);
  //   qb.matchPhrase('publishing/series', 'harry series', { slop: 3 });
  //   // console.log('matchPhrase', JSON.stringify(qb.getQuery(), null, 2));
  //   const result = await client.search(qb.getQuery());
  //
  //   const docIds = result.hits.hits.map((hit: any) => hit._id).sort();
  //   expect(docIds).toEqual(['1', '2']);
  // });
});
