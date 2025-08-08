import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import settings from '../analyzers/englishplus.js';
import getEsClient from '../getEsClient/getEsClient.js';
import deleteRecord from './deleteRecord';

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
  });
  it('should delete a record', async () => {
    const { result, error } = await deleteRecord({ index, id: '101' });
    expect(error).toBe(null);
    expect(result).toHaveProperty('_id', '101');
    expect(result).toHaveProperty('_index', index);
    expect(result).toHaveProperty('result', 'deleted');
  });
  it('should error if record does not exist', async () => {
    const { result, error } = await deleteRecord({ index, id: '99' });
    expect(result).toBe(null);
    expect(error.message).toContain('not_found');
  });
});
