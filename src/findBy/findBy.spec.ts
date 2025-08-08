import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import settings from '../analyzers/englishplus.js';
import getEsClient from '../getEsClient/getEsClient.js';
import findBy from './findBy';

describe('findBy', () => {
  const index = `test_index_${+new Date()}`;
  beforeAll(async () => {
    const client = getEsClient();
    await client.indices.create({
      index,
      settings,
      mappings: {
        properties: {
          name: { type: 'keyword' },
          keywords: { type: 'keyword' },
          content_review: {
            type: 'text',
            fields: {
              exact: {
                type: 'text',
                analyzer: 'standard',
              },
              fulltext: {
                type: 'text',
                analyzer: 'englishplus',
              },
            },
          },
        },
      },
    });
    await client.index({
      index,
      id: '101',
      document: {
        id: '101',
        name: 'jQuery',
        keywords: ['DOM', 'querySelector'],
        content_review: 'Love working working with it, but a tad old',
      },
    });
    await client.index({
      index,
      id: '102',
      document: {
        id: '102',
        name: 'Mootools',
        keywords: ['DOM', 'utilities'],
        content_review: "I don't love it, but it is pretty smart",
      },
    });
    await client.index({
      index,
      id: '103',
      document: {
        id: '103',
        name: 'Prototype',
        keywords: ['utilities', 'collections'],
        content_review: 'Just old; no recent releases',
      },
    });
    await client.indices.refresh({ index });
  });
  afterAll(async () => {
    const client = getEsClient();
    await client.indices.delete({ index });
  });
  describe('criteria()', () => {
    it('should find records on array field', async () => {
      const { result, error } = await findBy.criteria({
        index,
        where: {
          keywords: 'DOM',
        },
      });
      expect(error).toBe(null);
      expect(result.total).toBe(2);
      expect(result.records.length).toBe(2);
      expect(result.records.map((r: any) => r.id)).toEqual(['101', '102']);
    });
    it('should limit to 1', async () => {
      const { result, error, raw } = await findBy.criteria({
        index,
        where: {
          keywords: 'utilities',
        },
        more: { size: 1 },
      });
      expect(error).toBe(null);
      expect(result.total).toBe(2);
      expect(result.records.length).toBe(1);
      expect(result.records.map((r: any) => r.id)).toEqual(['102']);
      expect(typeof raw).toBe('object');
    });
  });
  describe('id()', () => {
    it('should find record by id', async () => {
      const { result, error } = await findBy.id({ index, id: '103' });
      expect(error).toBe(null);
      expect(result).toEqual({
        id: '103',
        name: 'Prototype',
        keywords: ['utilities', 'collections'],
        content_review: 'Just old; no recent releases',
      });
    });
  });
  describe('phrase()', () => {
    it('should find records on fulltext field', async () => {
      const { result, error } = await findBy.boostedPhrase({
        index,
        phrase: 'love',
      });
      expect(error).toBe(null);
      expect(result.total).toBe(2);
      expect(result.records.length).toBe(2);
      expect(result.records.map((r: any) => r.id)).toEqual(['101', '102']);
    });
  });
  // describe('builder()', () => {
  //   it('should find records on fulltext field', async () => {
  //     const query = new QueryBuilder();
  //     query.matchPhrase('content_review', 'love');
  //     query.term('keywords', 'DOM');
  //     query.limit(1);
  //     query.page(2);
  //     const { result, error } = await findBy.query({ index, builder: query });
  //     expect(error).toBe(null);
  //     expect(result.total).toBe(2);
  //     expect(result.records.length).toBe(1);
  //     expect(result.records[0].id).toEqual('102');
  //   });
  // });
});
