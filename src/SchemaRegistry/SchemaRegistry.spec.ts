import { describe, expect, it } from 'bun:test';
import SchemaRegistry from './SchemaRegistry';

describe('SchemaRegistry', () => {
  it('should properly chunkify', () => {
    const registry = new SchemaRegistry();
    const input = [1, 2, 3, 4, 5, 6, 7];
    const chunks = registry.chunkify(input, 3);
    expect(chunks).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });
});
