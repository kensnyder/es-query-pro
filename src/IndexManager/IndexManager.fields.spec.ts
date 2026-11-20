import { describe, expect, expectTypeOf, it } from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import type QueryBuilder from '../QueryBuilder/QueryBuilder';
import { getRecordingClient } from '../testFixtures/recordingClient';
import IndexManager from './IndexManager';

/**
 * Type-level tests for field names in `IndexManager` query callbacks. The
 * `expectTypeOf` and `@ts-expect-error` assertions are only enforced by
 * `bunx tsc --noEmit -p .`; `bun test` runs the calls against a recording
 * client (no server) and checks what would have been sent.
 */

function getTypedIndex() {
  const { client, sent } = getRecordingClient();
  const index = new IndexManager(
    { client },
    {
      index: 'books',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: {
            type: 'text',
            fields: { exact: { type: 'keyword' } },
          },
          categories: {
            type: 'nested',
            properties: { id: { type: 'integer' }, name: { type: 'text' } },
          },
        },
      },
    },
  );
  return { index, sent };
}

type Paths =
  | 'id'
  | 'title'
  | 'title.exact'
  | 'categories'
  | 'categories.id'
  | 'categories.name';

describe('IndexManager query callbacks with an inline specification', () => {
  it('should type findMany() callbacks', async () => {
    const { index, sent } = getTypedIndex();
    await index.findMany((qb) => {
      expectTypeOf(qb).toEqualTypeOf<QueryBuilder<Paths>>();
      qb.term('title.exact', 'Dune');
      qb.nested({
        path: 'categories',
        query: (sub) => sub.term('categories.id', 101),
      });
      // @ts-expect-error  unknown nested field
      qb.term('categoreis.id', 101);
      // @ts-expect-error  unknown sub-field
      qb.term('title.raw', 'Dune');
    });
    expect(sent[0].path).toBe('/english~books/_search');
    expect(JSON.stringify(sent[0].body)).toContain('"title.exact":"Dune"');
  });

  it('should type findFirst() callbacks', async () => {
    const { index, sent } = getTypedIndex();
    await index.findFirst((qb) => {
      qb.match({ field: 'categories.name', phrase: 'fiction' });
      // @ts-expect-error  unknown field
      qb.match({ field: 'category.name', phrase: 'fiction' });
    });
    expect(sent[0].path).toBe('/english~books/_search');
  });

  it('should type count() callbacks', async () => {
    const { index, sent } = getTypedIndex();
    await index.count((qb) => qb.exists('title.exact'));
    // @ts-expect-error  unknown field
    await index.count((qb) => qb.exists('nope'));
    expect(sent[0].path).toBe('/english~books/_count');
  });

  it('should type deleteMany() callbacks', async () => {
    const { index, sent } = getTypedIndex();
    await index.deleteMany((qb) => {
      expectTypeOf(qb).toEqualTypeOf<QueryBuilder<Paths>>();
      qb.term('id', '1');
      // @ts-expect-error  unknown field
      qb.term('uuid', '1');
    });
    expect(sent[0].path).toBe('/english~books/_delete_by_query');
  });

  it('should type the run() builder and updateMany() keys', async () => {
    const { index, sent } = getTypedIndex();
    await index.run((runner) => {
      expectTypeOf(runner.builder).toEqualTypeOf<QueryBuilder<Paths>>();
      runner.builder.term('categories.id', 101);
      // @ts-expect-error  unknown field
      runner.builder.term('categories.uid', 101);
      // @ts-expect-error  unknown key
      runner.updateMany({ titel: 'x' });
      return runner.updateMany({ title: 'x', 'categories.name': 'y' });
    });
    expect(sent.at(-1)?.path).toBe('/english~books/_update_by_query');
    const body = sent.at(-1)?.body as any;
    expect(body?.script?.params?.updates).toEqual([
      { path: ['title'], value: 'x' },
      { path: ['categories', 'name'], value: 'y' },
    ]);
  });
});

describe('IndexManager query callbacks without known paths', () => {
  it('should accept any field for a widened specification', async () => {
    const { client } = getRecordingClient();
    const spec: estypes.IndicesCreateRequest = {
      index: 'books',
      mappings: { properties: { id: { type: 'keyword' } } },
    };
    const index = new IndexManager({ client }, spec);
    await index.findMany((qb) => {
      expectTypeOf(qb).toEqualTypeOf<QueryBuilder<string>>();
      qb.term('anything.at.all', 1);
    });
    await index.findFirst((qb) => qb.term('anything', 1));
    await index.count((qb) => qb.term('anything', 1));
    await index.deleteMany((qb) => qb.term('anything', 1));
    await index.run((runner) => runner.updateMany({ anything: 1 }));
    expect(true).toBe(true);
  });

  it('should accept any field for dynamic: true', async () => {
    const { client } = getRecordingClient();
    const index = new IndexManager(
      { client },
      {
        index: 'books',
        mappings: {
          dynamic: true,
          properties: { id: { type: 'keyword' } },
        },
      },
    );
    await index.findMany((qb) => {
      expectTypeOf(qb).toEqualTypeOf<QueryBuilder<string>>();
      qb.term('anything.at.all', 1);
    });
    await index.findFirst((qb) => qb.term('anything', 1));
    await index.count((qb) => qb.term('anything', 1));
    await index.deleteMany((qb) => qb.term('anything', 1));
    await index.run((runner) => runner.updateMany({ anything: 1 }));
    expect(true).toBe(true);
  });

  it('should still hold differently-typed managers in IndexManager[]', () => {
    const { index } = getTypedIndex();
    const all: IndexManager[] = [index];
    expect(all).toHaveLength(1);
  });
});
