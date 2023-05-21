const withEsClient = require('../withEsClient/withEsClient.js');
const settings = require('../analyzers/englishplus.js');
const findBy = require('./findBy.js');
const QueryBuilder = require('../QueryBuilder/QueryBuilder.js');

describe('findBy', () => {
  const index = `test_index_${+new Date()}`;
  beforeAll(async () => {
    const { error } = await withEsClient(client =>
      client.indices.create({
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
    await withEsClient(async client => {
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
  afterAll(async () => {
    const { error } = await withEsClient(client =>
      client.indices.delete({ index })
    );
    if (error) {
      throw error;
    }
  });
  describe('criteria()', () => {
    it('should find records on array field', async () => {
      const { result, error, details } = await findBy.criteria(index, {
        keywords: 'DOM',
      });
      expect(error).toBe(null);
      expect(result.total).toBe(2);
      expect(result.records.length).toBe(2);
      expect(result.records.map(r => r.id)).toEqual(['101', '102']);
    });
    it('should limit to 1', async () => {
      const { result, error, details } = await findBy.criteria(
        index,
        {
          keywords: 'utilities',
        },
        { size: 1 }
      );
      expect(error).toBe(null);
      expect(result.total).toBe(2);
      expect(result.records.length).toBe(1);
      expect(result.records.map(r => r.id)).toEqual(['102']);
      expect(typeof details).toBe('object');
    });
  });
  describe('byId()', () => {
    it('should find record by id', async () => {
      const { result, error, details } = await findBy.id(index, '103');
      expect(error).toBe(null);
      expect(result.id).toEqual('103');
      expect(typeof details).toBe('object');
    });
  });
  describe('phrase()', () => {
    it('should find records on fulltext field', async () => {
      const { result, error, details } = await findBy.phrase(index, 'love');
      expect(error).toBe(null);
      expect(result.total).toBe(2);
      expect(result.records.length).toBe(2);
      expect(result.records.map(r => r.id)).toEqual(['101', '102']);
      expect(typeof details).toBe('object');
    });
  });
  describe('query()', () => {
    it('should find records on fulltext field', async () => {
      const query = new QueryBuilder();
      query.matchPhrase('content_review', 'love');
      query.term('keywords', 'DOM');
      query.limit(1);
      query.page(2);
      const { result, error, details } = await findBy.query(index, query);
      expect(error).toBe(null);
      expect(result.total).toBe(2);
      expect(result.records.length).toBe(1);
      expect(result.records[0].id).toEqual('102');
      expect(typeof details).toBe('object');
    });
  });
});
