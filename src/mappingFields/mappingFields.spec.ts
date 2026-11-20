import { describe, expect, it } from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { getAllFields, getFulltextFields } from './mappingFields';

function withProperties(
  properties: Record<string, estypes.MappingProperty>,
): estypes.IndicesCreateRequest {
  return { index: 'test', mappings: { properties } };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

const books = {
  index: 'books',
  settings: { analysis: { analyzer: { englishplus: { type: 'english' } } } },
  mappings: {
    properties: {
      id: { type: 'keyword' },
      title: {
        type: 'text',
        analyzer: 'englishplus',
        fields: { exact: { type: 'keyword', ignore_above: 256 } },
      },
      categories: {
        type: 'nested',
        properties: { id: { type: 'integer' }, name: { type: 'text' } },
      },
    },
  },
} satisfies estypes.IndicesCreateRequest;

describe('section 1.2 rules', () => {
  it('rule 1: paths are dotted and complete', () => {
    const create = withProperties({
      meta: {
        properties: {
          deep: { properties: { leaf: { type: 'keyword' } } },
        },
      },
      categories: {
        type: 'nested',
        properties: { name: { type: 'text' } },
      },
    });
    expect(getAllFields(create)).toEqual(['meta.deep.leaf', 'categories.name']);
    expect(getFulltextFields(create)).toEqual(['categories.name']);
  });

  it('rule 2: containers are recursed and returned only with containers: true', () => {
    const create = withProperties({
      author: {
        type: 'object',
        properties: { name: { type: 'keyword' } },
      },
    });
    expect(getAllFields(create)).toEqual(['author.name']);
    expect(getAllFields(create, { containers: false })).toEqual([
      'author.name',
    ]);
    expect(getAllFields(create, { containers: true })).toEqual([
      'author',
      'author.name',
    ]);
  });

  it('rule 3: sub-fields are returned only with subFields: true', () => {
    const create = withProperties({
      title: {
        type: 'text',
        fields: { exact: { type: 'keyword' }, raw: { type: 'keyword' } },
      },
    });
    expect(getAllFields(create)).toEqual(['title']);
    expect(getAllFields(create, { subFields: false })).toEqual(['title']);
    expect(getAllFields(create, { subFields: true })).toEqual([
      'title',
      'title.exact',
      'title.raw',
    ]);
  });

  it('rule 3: sub-fields do not nest', () => {
    const create = withProperties({
      title: {
        type: 'text',
        fields: {
          exact: {
            type: 'keyword',
            fields: { deeper: { type: 'text' } },
          } as estypes.MappingProperty,
        },
      },
    });
    expect(getAllFields(create, { subFields: true })).toEqual([
      'title',
      'title.exact',
    ]);
    expect(getFulltextFields(create, { subFields: true })).toEqual(['title']);
  });

  it('rule 4: runtime fields are included in getAllFields as leaves', () => {
    const create: estypes.IndicesCreateRequest = {
      index: 'test',
      mappings: {
        properties: { price: { type: 'float' } },
        runtime: {
          price_with_tax: { type: 'double' },
          day_of_week: { type: 'keyword' },
        },
      },
    };
    expect(getAllFields(create)).toEqual([
      'price',
      'price_with_tax',
      'day_of_week',
    ]);
    expect(getAllFields(create, { containers: true, subFields: true })).toEqual(
      ['price', 'price_with_tax', 'day_of_week'],
    );
  });

  it('rule 4: runtime fields alone (no properties)', () => {
    const create: estypes.IndicesCreateRequest = {
      index: 'test',
      mappings: { runtime: { day_of_week: { type: 'keyword' } } },
    };
    expect(getAllFields(create)).toEqual(['day_of_week']);
    expect(getFulltextFields(create)).toEqual([]);
  });

  it('rule 5: declaration order, depth-first', () => {
    const create = withProperties({
      z: { type: 'keyword' },
      a: {
        properties: {
          y: { type: 'text', fields: { k: { type: 'keyword' } } },
          b: { properties: { x: { type: 'keyword' } } },
        },
      },
      m: { type: 'text' },
    });
    expect(getAllFields(create, { subFields: true, containers: true })).toEqual(
      ['z', 'a', 'a.y', 'a.y.k', 'a.b', 'a.b.x', 'm'],
    );
    expect(getFulltextFields(create)).toEqual(['a.y', 'm']);
  });

  it('rule 5: no duplicates', () => {
    const create: estypes.IndicesCreateRequest = {
      index: 'test',
      mappings: {
        properties: {
          'meta.author': { type: 'keyword' },
          meta: { properties: { author: { type: 'keyword' } } },
          status: { type: 'keyword' },
        },
        // a runtime field may shadow a mapped field of the same name
        runtime: { status: { type: 'keyword' } },
      },
    };
    expect(getAllFields(create)).toEqual(['meta.author', 'status']);
    expect(getAllFields(create, { containers: true })).toEqual([
      'meta.author',
      'meta',
      'status',
    ]);
  });

  it('rule 6: full-text types and sub-fields of those types', () => {
    const create = withProperties({
      title: {
        type: 'text',
        fields: { exact: { type: 'keyword' } },
      },
      code: {
        type: 'keyword',
        fields: { text: { type: 'text' } },
      },
    });
    expect(getFulltextFields(create)).toEqual(['title']);
    expect(getFulltextFields(create, { subFields: false })).toEqual(['title']);
    expect(getFulltextFields(create, { subFields: true })).toEqual([
      'title',
      'code.text',
    ]);
  });

  it('rule 6: alias counts as full-text when its target does', () => {
    const create = withProperties({
      body: { type: 'text' },
      sku: { type: 'keyword' },
      content: { type: 'alias', path: 'body' },
      productCode: { type: 'alias', path: 'sku' },
    });
    expect(getFulltextFields(create)).toEqual(['body', 'content']);
  });

  it('rule 7: missing mappings, missing properties and empty objects return []', () => {
    const cases: estypes.IndicesCreateRequest[] = [
      { index: 'test' },
      { index: 'test', mappings: {} },
      { index: 'test', mappings: { properties: {} } },
      { index: 'test', mappings: { properties: {}, runtime: {} } },
      {} as estypes.IndicesCreateRequest,
    ];
    for (const create of cases) {
      expect(getAllFields(create)).toEqual([]);
      expect(
        getAllFields(create, { subFields: true, containers: true }),
      ).toEqual([]);
      expect(getFulltextFields(create)).toEqual([]);
      expect(getFulltextFields(create, { subFields: true })).toEqual([]);
    }
  });

  it('rule 7: nothing throws on null or undefined input', () => {
    const bad = [undefined, null] as unknown as estypes.IndicesCreateRequest[];
    for (const create of bad) {
      expect(getAllFields(create)).toEqual([]);
      expect(getFulltextFields(create)).toEqual([]);
    }
  });
});

describe('structure', () => {
  it('handles three levels of nesting', () => {
    const create = withProperties({
      a: {
        type: 'object',
        properties: {
          b: {
            type: 'nested',
            properties: {
              c: {
                properties: {
                  leaf: { type: 'text' },
                  other: { type: 'long' },
                },
              },
            },
          },
        },
      },
    });
    expect(getAllFields(create)).toEqual(['a.b.c.leaf', 'a.b.c.other']);
    expect(getAllFields(create, { containers: true })).toEqual([
      'a',
      'a.b',
      'a.b.c',
      'a.b.c.leaf',
      'a.b.c.other',
    ]);
    expect(getFulltextFields(create)).toEqual(['a.b.c.leaf']);
  });

  it('treats an object without an explicit type as a container', () => {
    const create = withProperties({
      author: { properties: { name: { type: 'text' } } },
    });
    expect(getAllFields(create)).toEqual(['author.name']);
    expect(getAllFields(create, { containers: true })).toEqual([
      'author',
      'author.name',
    ]);
    expect(getFulltextFields(create)).toEqual(['author.name']);
  });

  it('treats nested as a container', () => {
    const create = withProperties({
      tags: {
        type: 'nested',
        properties: { label: { type: 'keyword' }, note: { type: 'text' } },
      },
    });
    expect(getAllFields(create)).toEqual(['tags.label', 'tags.note']);
    expect(getAllFields(create, { containers: true })).toEqual([
      'tags',
      'tags.label',
      'tags.note',
    ]);
    expect(getFulltextFields(create)).toEqual(['tags.note']);
  });

  it('text field with keyword sub-field and keyword field with text sub-field', () => {
    const create = withProperties({
      title: { type: 'text', fields: { exact: { type: 'keyword' } } },
      code: { type: 'keyword', fields: { search: { type: 'text' } } },
    });
    expect(getAllFields(create)).toEqual(['title', 'code']);
    expect(getAllFields(create, { subFields: false })).toEqual([
      'title',
      'code',
    ]);
    expect(getAllFields(create, { subFields: true })).toEqual([
      'title',
      'title.exact',
      'code',
      'code.search',
    ]);
    expect(getFulltextFields(create)).toEqual(['title']);
    expect(getFulltextFields(create, { subFields: false })).toEqual(['title']);
    expect(getFulltextFields(create, { subFields: true })).toEqual([
      'title',
      'code.search',
    ]);
  });

  it('handles property names containing dots', () => {
    const create = withProperties({
      'meta.author': { type: 'text' },
      'stats.counts': {
        properties: { 'views.total': { type: 'long' } },
      },
    });
    expect(getAllFields(create)).toEqual([
      'meta.author',
      'stats.counts.views.total',
    ]);
    expect(getAllFields(create, { containers: true })).toEqual([
      'meta.author',
      'stats.counts',
      'stats.counts.views.total',
    ]);
    expect(getFulltextFields(create)).toEqual(['meta.author']);
  });

  it('returns sub-fields and containers together', () => {
    const create = withProperties({
      book: {
        properties: {
          title: { type: 'text', fields: { exact: { type: 'keyword' } } },
        },
      },
    });
    expect(getAllFields(create, { subFields: true, containers: true })).toEqual(
      ['book', 'book.title', 'book.title.exact'],
    );
    expect(getAllFields(create, { subFields: true })).toEqual([
      'book.title',
      'book.title.exact',
    ]);
    expect(getAllFields(create, { containers: true })).toEqual([
      'book',
      'book.title',
    ]);
  });
});

describe('full-text types', () => {
  const fulltextTypes = [
    'text',
    'match_only_text',
    'search_as_you_type',
    'semantic_text',
  ] as const;

  for (const type of fulltextTypes) {
    it(`treats ${type} as full-text`, () => {
      const create = withProperties({
        field: { type } as estypes.MappingProperty,
        other: { type: 'keyword' },
      });
      expect(getFulltextFields(create)).toEqual(['field']);
    });

    it(`treats a ${type} sub-field as full-text with subFields: true`, () => {
      const create = withProperties({
        field: {
          type: 'keyword',
          fields: { sub: { type } as estypes.MappingProperty },
        },
      });
      expect(getFulltextFields(create)).toEqual([]);
      expect(getFulltextFields(create, { subFields: true })).toEqual([
        'field.sub',
      ]);
    });
  }

  it('excludes completion and token_count', () => {
    const create = withProperties({
      suggest: { type: 'completion' },
      title: {
        type: 'text',
        fields: {
          length: { type: 'token_count', analyzer: 'standard' },
          suggest: { type: 'completion' },
        },
      },
      words: { type: 'token_count', analyzer: 'standard' },
    });
    expect(getFulltextFields(create)).toEqual(['title']);
    expect(getFulltextFields(create, { subFields: true })).toEqual(['title']);
    expect(getAllFields(create)).toEqual(['suggest', 'title', 'words']);
  });

  it('excludes other non-full-text leaves', () => {
    const create = withProperties({
      k: { type: 'keyword' },
      w: { type: 'wildcard' },
      n: { type: 'integer' },
      d: { type: 'date' },
      f: { type: 'flattened' },
    });
    expect(getFulltextFields(create)).toEqual([]);
  });
});

describe('alias', () => {
  it('alias to a text field is full-text; alias to a keyword field is not', () => {
    const create = withProperties({
      body: { type: 'text' },
      sku: { type: 'keyword' },
      content: { type: 'alias', path: 'body' },
      productCode: { type: 'alias', path: 'sku' },
    });
    expect(getAllFields(create)).toEqual([
      'body',
      'sku',
      'content',
      'productCode',
    ]);
    expect(getFulltextFields(create)).toEqual(['body', 'content']);
    expect(getFulltextFields(create, { subFields: true })).toEqual([
      'body',
      'content',
    ]);
  });

  it('resolves an alias to a nested path, regardless of declaration order', () => {
    const create = withProperties({
      summary: { type: 'alias', path: 'doc.abstract' },
      doc: {
        properties: {
          abstract: { type: 'match_only_text' },
          id: { type: 'keyword' },
        },
      },
      docId: { type: 'alias', path: 'doc.id' },
    });
    expect(getFulltextFields(create)).toEqual(['summary', 'doc.abstract']);
  });

  it('alias with a missing target is not full-text and does not throw', () => {
    const create = withProperties({
      ghost: { type: 'alias', path: 'nowhere' },
    });
    expect(getAllFields(create)).toEqual(['ghost']);
    expect(getFulltextFields(create)).toEqual([]);
  });
});

describe('input handling', () => {
  it('does not mutate the input object', () => {
    const create = {
      index: 'test',
      mappings: {
        properties: {
          title: { type: 'text', fields: { exact: { type: 'keyword' } } },
          author: { properties: { name: { type: 'text' } } },
          content: { type: 'alias', path: 'title' },
        },
        runtime: { day: { type: 'keyword' } },
      },
    } satisfies estypes.IndicesCreateRequest;
    const before = structuredClone(create);
    deepFreeze(create);
    getAllFields(create);
    getAllFields(create, { subFields: true, containers: true });
    getFulltextFields(create);
    getFulltextFields(create, { subFields: true });
    expect(create).toEqual(before);
  });

  it('returns a fresh array on each call', () => {
    const first = getAllFields(books);
    first.push('mutated');
    expect(getAllFields(books)).not.toContain('mutated');
  });
});

describe('books mapping from section 1.1', () => {
  it('getAllFields, every option combination', () => {
    expect(getAllFields(books)).toEqual([
      'id',
      'title',
      'categories.id',
      'categories.name',
    ]);
    expect(getAllFields(books, { subFields: true })).toEqual([
      'id',
      'title',
      'title.exact',
      'categories.id',
      'categories.name',
    ]);
    expect(getAllFields(books, { containers: true })).toEqual([
      'id',
      'title',
      'categories',
      'categories.id',
      'categories.name',
    ]);
    expect(getAllFields(books, { subFields: true, containers: true })).toEqual([
      'id',
      'title',
      'title.exact',
      'categories',
      'categories.id',
      'categories.name',
    ]);
  });

  it('getFulltextFields, every option combination', () => {
    expect(getFulltextFields(books)).toEqual(['title', 'categories.name']);
    expect(getFulltextFields(books, { subFields: true })).toEqual([
      'title',
      'categories.name',
    ]);
  });
});
