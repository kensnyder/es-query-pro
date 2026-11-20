import { describe, expect, it } from 'bun:test';
import type { Client } from '@elastic/elasticsearch';
import {
  getBooksCreateRequest,
  getBooksData,
  getBooksMappings,
  insertBooksData,
} from './books';

describe('books fixture (B-076)', () => {
  it('should map price as a floating point type, since prices have cents', () => {
    const price = getBooksMappings().properties?.price;
    expect(['float', 'double', 'scaled_float']).toContain(price?.type ?? '');
    const prices = getBooksData().map((book) => book.price);
    expect(prices.some((price) => !Number.isInteger(price))).toBe(true);
  });

  it('should map id as keyword, matching the string ids in the data', () => {
    expect(getBooksMappings().properties?.id).toEqual({ type: 'keyword' });
    for (const book of getBooksData()) {
      expect(typeof book.id).toBe('string');
    }
  });

  it('should map every top-level field the data uses', () => {
    const mapped = Object.keys(getBooksMappings().properties ?? {});
    for (const book of getBooksData()) {
      for (const key of Object.keys(book)) {
        // `extra` is deliberately unmapped (dynamic) for exists() tests
        if (key !== 'extra') {
          expect(mapped).toContain(key);
        }
      }
    }
  });

  it('should send bulk rows as "operations", not the removed "body"', async () => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      bulk: async (params: Record<string, unknown>) => {
        calls.push(params);
        return { errors: false, items: [] };
      },
    } as unknown as Client;
    await insertBooksData('books', client);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('body');
    const operations = calls[0].operations as unknown[];
    expect(operations).toHaveLength(getBooksData().length * 2);
    expect(operations[0]).toEqual({ index: { _index: 'books', _id: '1' } });
  });

  it('should throw when the bulk response reports item errors', async () => {
    const client = {
      bulk: async () => ({
        errors: true,
        items: [{ index: { status: 400, error: { type: 'x', reason: 'y' } } }],
      }),
    } as unknown as Client;
    await expect(insertBooksData('books', client)).rejects.toThrow('y');
  });

  it('should use the given index name in the creation request', () => {
    expect(getBooksCreateRequest('books_x').index).toBe('books_x');
  });
});
