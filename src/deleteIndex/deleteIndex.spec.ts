import { describe, expect, it } from 'bun:test';
import getEsClient from '../getEsClient/getEsClient';
import deleteIndex from './deleteIndex.js';

describe('deleteIndex', () => {
  it('should error on non-existent index', async () => {
    const index = `non_existent_${+new Date()}`;
    const { result, error } = await deleteIndex({ index });
    expect(result).toBe(null);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('index_not_found_exception');
  });
  it('should properly delete', async () => {
    const index = `test_index_${+new Date()}`;
    const client = getEsClient();
    await client.indices.create({ index });
    const { result, error } = await deleteIndex({ index });
    expect(error).toBe(null);
    expect(result).toBeTruthy();
  });
});
