import { describe, expect, it } from 'bun:test';
import getEsClient from '../getEsClient/getEsClient';
import createIndex from './createIndex.js';

describe('createIndex', () => {
  it('should create new index', async () => {
    const index = `test1_at_${+new Date()}`;
    const { result, error } = await createIndex({ index });
    expect(error).toBe(null);
    expect(result).toEqual({
      acknowledged: true,
      shards_acknowledged: true,
      index,
    });
    getEsClient().indices.delete({ index });
  });
  it('should create new index with mappings', async () => {
    const index = `test2_at_${+new Date()}`;
    const { result, error } = await createIndex({
      index,
      body: {
        mappings: {
          properties: {
            source_code: { type: 'keyword', index: false },
            created_at: { type: 'date', format: 'epoch_millis' },
          },
        },
      },
    });
    expect(result).toEqual({
      acknowledged: true,
      shards_acknowledged: true,
      index,
    });
    expect(error).toBe(null);
    getEsClient().indices.delete({ index });
  });
  it('should fail on invalid name', async () => {
    const { result, error } = await createIndex({ index: '< invalid name >' });
    expect(result).toBe(null);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('invalid_index_name_exception');
  });
});
