// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'withEsClie... Remove this comment to see the full error message
import withEsClient from '../withEsClient/withEsClient.js';
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'settings'.
import settings from '../analyzers/englishplus.js';
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'findBy'.
import findBy from './findBy.js';
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'QueryBuild... Remove this comment to see the full error message
import QueryBuilder from '../QueryBuilder/QueryBuilder.js';

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('findBy', () => {
  const index = `test_index_${+new Date()}`;
  // @ts-expect-error TS(2304): Cannot find name 'beforeAll'.
  beforeAll(async () => {
    const { error } = await withEsClient((client: any) => client.indices.create({
      index,
      body: {
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
      },
    })
    );
    if (error) {
      throw error;
    }
    await withEsClient(async (client: any) => {
      await client.index({
        index,
        id: '101',
        body: {
          id: '101',
          name: 'jQuery',
          keywords: ['DOM', 'querySelector'],
          content_review: 'Love working working with it, but a tad old',
        },
      });
      await client.index({
        index,
        id: '102',
        body: {
          id: '102',
          name: 'Mootools',
          keywords: ['DOM', 'utilities'],
          content_review: "I don't love it, but it is pretty smart",
        },
      });
      await client.index({
        index,
        id: '103',
        body: {
          id: '103',
          name: 'Prototype',
          keywords: ['utilities', 'collections'],
          content_review: 'Just old; no recent releases',
        },
      });
    });
  });
  // @ts-expect-error TS(2304): Cannot find name 'afterAll'.
  afterAll(async () => {
    const { error } = await withEsClient((client: any) => client.indices.delete({ index })
    );
    if (error) {
      throw error;
    }
  });
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe('criteria()', () => {
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should find records on array field', async () => {
      const { result, error, details } = await findBy.criteria(index, {
        keywords: 'DOM',
      });
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(error).toBe(null);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(result.total).toBe(2);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(result.records.length).toBe(2);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(result.records.map((r: any) => r.id)).toEqual(['101', '102']);
    });
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should limit to 1', async () => {
      const { result, error, details } = await findBy.criteria(
        index,
        {
          keywords: 'utilities',
        },
        { size: 1 }
      );
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(error).toBe(null);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(result.total).toBe(2);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(result.records.length).toBe(1);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(result.records.map((r: any) => r.id)).toEqual(['102']);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(typeof details).toBe('object');
    });
  });
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe('byId()', () => {
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should find record by id', async () => {
      const { result, error, details } = await findBy.id(index, '103');
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(error).toBe(null);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(result.id).toEqual('103');
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(typeof details).toBe('object');
    });
  });
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe('phrase()', () => {
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should find records on fulltext field', async () => {
      const { result, error, details } = await findBy.phrase(index, 'love');
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(error).toBe(null);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(result.total).toBe(2);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(result.records.length).toBe(2);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(result.records.map((r: any) => r.id)).toEqual(['101', '102']);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(typeof details).toBe('object');
    });
  });
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe('query()', () => {
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should find records on fulltext field', async () => {
      const query = new QueryBuilder();
      query.matchPhrase('content_review', 'love');
      query.term('keywords', 'DOM');
      query.limit(1);
      query.page(2);
      const { result, error, details } = await findBy.query(index, query);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(error).toBe(null);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(result.total).toBe(2);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(result.records.length).toBe(1);
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(result.records[0].id).toEqual('102');
      // @ts-expect-error TS(2304): Cannot find name 'expect'.
      expect(typeof details).toBe('object');
    });
  });
});
