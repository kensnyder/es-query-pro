import { describe, expect, expectTypeOf, it } from 'bun:test';
import type { Client } from '@elastic/elasticsearch';
import IndexManager from '../IndexManager/IndexManager';
import SchemaRegistry from './SchemaRegistry';

const client = {} as Client;

function booksIndex(version: number | string = 1, prefix = 'test') {
  return new IndexManager(
    { client, prefix, version },
    {
      index: 'books',
      mappings: { properties: { title: { type: 'text' } } },
    },
  );
}

function authorsIndex(version: number | string = 1) {
  return new IndexManager(
    { client, prefix: 'test', version },
    {
      index: 'authors',
      mappings: { properties: { name: { type: 'keyword' } } },
    },
  );
}

describe('SchemaRegistry registration', () => {
  it('should not mutate the array given to the constructor (B-107)', () => {
    const given = [booksIndex()];
    const registry = new SchemaRegistry(given);
    registry.register(authorsIndex());
    expect(given).toHaveLength(1);
    expect(registry.indexes).toHaveLength(2);
  });

  it('should ignore an index registered twice (B-106)', () => {
    const books = booksIndex();
    const registry = new SchemaRegistry([books, books]);
    registry.register(books).registerAll([books, booksIndex()]);
    expect(registry.indexes).toEqual([books]);
  });

  it('should throw when two versions claim the same alias (B-106)', () => {
    const registry = new SchemaRegistry([booksIndex(1)]);
    expect(() => registry.register(booksIndex(2))).toThrow(
      /test~english~books~v1.*test~english~books~v2|alias "test~english~books"/,
    );
    expect(() => new SchemaRegistry([booksIndex(1), booksIndex(2)])).toThrow(
      Error,
    );
    expect(registry.indexes).toHaveLength(1);
  });

  it('should register nothing from registerAll() when one conflicts', () => {
    const registry = new SchemaRegistry([booksIndex(1)]);
    expect(() =>
      registry.registerAll([authorsIndex(), booksIndex(3)]),
    ).toThrow();
    expect(registry.listIndexes().map((entry) => entry.name)).toEqual([
      'test~english~books~v1',
    ]);
  });

  it('should register several indexes in order with registerAll()', () => {
    const registry = new SchemaRegistry().registerAll([
      authorsIndex(),
      booksIndex(),
    ]);
    expect(registry.listIndexes().map((entry) => entry.alias)).toEqual([
      'test~english~authors',
      'test~english~books',
    ]);
  });

  it('should list each index with its version', () => {
    const books = booksIndex(3);
    const authors = new IndexManager(
      { client, version: '2024a' },
      { index: 'authors' },
    );
    const registry = new SchemaRegistry([books]).register(authors);
    expect(registry.listIndexes()).toEqual([
      {
        alias: 'test~english~books',
        name: 'test~english~books~v3',
        version: 3,
      },
      {
        alias: 'english~authors',
        name: 'english~authors~v2024a',
        version: '2024a',
      },
    ]);
  });

  it('should look indexes up by alias name', () => {
    const books = booksIndex();
    const authors = authorsIndex();
    const lookup = new SchemaRegistry([books, authors]).getIndexLookup();
    expect(lookup).toEqual({
      'test~english~books': books,
      'test~english~authors': authors,
    });
  });
});

describe('SchemaRegistry with named indexes (S-062)', () => {
  it('should register a named map in key order', () => {
    const books = booksIndex();
    const authors = authorsIndex();
    const registry = new SchemaRegistry({ books, authors });
    expect(registry.indexes).toEqual([books, authors]);
    expect(registry.get('books')).toBe(books);
    expect(registry.get('authors')).toBe(authors);
    expect(registry.getNamedIndexes()).toEqual({ books, authors });
  });

  it('should keep each named index typed', () => {
    const books = booksIndex();
    const authors = authorsIndex();
    const registry = new SchemaRegistry({ books, authors });
    expectTypeOf(registry.get('books')).toEqualTypeOf<typeof books>();
    expectTypeOf(registry.getNamedIndexes().authors).toEqualTypeOf<
      typeof authors
    >();
    // @ts-expect-error not a registered name
    registry.get('nope');
  });

  it('should still accept an array and register()', () => {
    const books = booksIndex();
    const registry = new SchemaRegistry();
    registry.register(books);
    expect(registry.indexes).toEqual([books]);
    expect(registry.getNamedIndexes()).toEqual({});
    // @ts-expect-error no names in an array registry
    registry.get('books');
  });

  it('should apply the alias check to a named map', () => {
    expect(
      () => new SchemaRegistry({ a: booksIndex(1), b: booksIndex(2) }),
    ).toThrow();
  });
});
