import { describe, expect, expectTypeOf, it } from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { getAllFields, getFulltextFields } from './mappingFields';
import type {
  MappingFieldPath,
  MappingFulltextPath,
  MappingRecord,
} from './mappingTypes';

/**
 * Type-level tests. The `expectTypeOf` and `@ts-expect-error` assertions are
 * only enforced by `bunx tsc --noEmit -p .`; `bun test` runs the runtime
 * parts.
 */

/** Stand-in for the `IndexManager` constructor's `const` type parameter */
function define<const Create extends estypes.IndicesCreateRequest>(
  create: Create,
) {
  return create;
}

/** Type-checks `value` against `T` without creating unused variables */
function accept<T>(value: T) {
  return value;
}

const books = define({
  index: 'books',
  settings: {
    analysis: {
      analyzer: {
        englishplus: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'porter_stem'],
        },
      },
    },
    index: { sort: { field: ['id'], order: ['asc'] } },
  },
  mappings: {
    properties: {
      id: { type: 'keyword' },
      title: {
        type: 'text',
        analyzer: 'englishplus',
        copy_to: ['all_text'],
        fields: { exact: { type: 'keyword', ignore_above: 256 } },
      },
      all_text: { type: 'text' },
      categories: {
        type: 'nested',
        properties: { id: { type: 'integer' }, name: { type: 'text' } },
      },
    },
  },
});
type Books = typeof books;

/**
 * Shared fixture: the hand-listed paths below are what T1's
 * `getAllFields(fixture, { subFields: true, containers: true })` and
 * `getFulltextFields(fixture, { subFields: true })` return (section 1.2).
 */
const fixture = {
  index: 'library',
  mappings: {
    properties: {
      id: { type: 'keyword' },
      title: {
        type: 'text',
        fields: {
          exact: { type: 'keyword' },
          stems: { type: 'text', analyzer: 'english' },
        },
      },
      code: {
        type: 'keyword',
        fields: { search: { type: 'search_as_you_type' } },
      },
      summary: { type: 'match_only_text' },
      embedding: { type: 'semantic_text' },
      headline: { type: 'alias', path: 'title' },
      code_alias: { type: 'alias', path: 'id' },
      stems_alias: { type: 'alias', path: 'title.stems' },
      counter: { type: 'token_count', analyzer: 'standard' },
      suggest: { type: 'completion' },
      meta: {
        properties: {
          deep: {
            type: 'object',
            properties: { leaf: { type: 'text' } },
          },
        },
      },
      categories: {
        type: 'nested',
        properties: {
          id: { type: 'integer' },
          name: { type: 'text', fields: { raw: { type: 'keyword' } } },
        },
      },
      'dotted.name': { type: 'keyword' },
    },
    runtime: { day_of_week: { type: 'keyword' } },
  },
} as const satisfies estypes.IndicesCreateRequest;
type Fixture = typeof fixture;

const fixtureAllFields = [
  'id',
  'title',
  'title.exact',
  'title.stems',
  'code',
  'code.search',
  'summary',
  'embedding',
  'headline',
  'code_alias',
  'stems_alias',
  'counter',
  'suggest',
  'meta',
  'meta.deep',
  'meta.deep.leaf',
  'categories',
  'categories.id',
  'categories.name',
  'categories.name.raw',
  'dotted.name',
  'day_of_week',
] as const;

const fixtureFulltextFields = [
  'title',
  'title.stems',
  'code.search',
  'summary',
  'embedding',
  'headline',
  'stems_alias',
  'meta.deep.leaf',
  'categories.name',
] as const;

describe('MappingFieldPath', () => {
  it('infers paths from an inline specification', () => {
    expectTypeOf<MappingFieldPath<Books>>().toEqualTypeOf<
      | 'id'
      | 'title'
      | 'title.exact'
      | 'all_text'
      | 'categories'
      | 'categories.id'
      | 'categories.name'
    >();
    accept<MappingFieldPath<Books>>('categories.id');
    // @ts-expect-error unknown top-level field
    accept<MappingFieldPath<Books>>('author');
    // @ts-expect-error unknown nested field
    accept<MappingFieldPath<Books>>('categoreis.id');
    // @ts-expect-error unknown field inside a nested container
    accept<MappingFieldPath<Books>>('categories.label');
    // @ts-expect-error unknown sub-field
    accept<MappingFieldPath<Books>>('title.fulltext');
  });

  it('matches the hand-listed paths of the shared fixture', () => {
    expectTypeOf<MappingFieldPath<Fixture>>().toEqualTypeOf<
      (typeof fixtureAllFields)[number]
    >();
  });

  it('walks three levels of properties, objects without a type and nested', () => {
    const create = define({
      index: 'deep',
      mappings: {
        properties: {
          a: {
            properties: {
              b: {
                type: 'nested',
                properties: {
                  c: { type: 'object', properties: { d: { type: 'long' } } },
                },
              },
            },
          },
        },
      },
    });
    expectTypeOf<MappingFieldPath<typeof create>>().toEqualTypeOf<
      'a' | 'a.b' | 'a.b.c' | 'a.b.c.d'
    >();
  });

  it('does not nest sub-fields', () => {
    const create = define({
      index: 'multi',
      mappings: {
        properties: {
          name: {
            type: 'keyword',
            fields: {
              text: { type: 'text', fields: { inner: { type: 'keyword' } } },
            },
          },
        },
      },
    });
    expectTypeOf<MappingFieldPath<typeof create>>().toEqualTypeOf<
      'name' | 'name.text'
    >();
  });

  it('includes runtime fields', () => {
    const create = define({
      index: 'runtime',
      mappings: {
        properties: { ts: { type: 'date' } },
        runtime: { day: { type: 'keyword' } },
      },
    });
    expectTypeOf<MappingFieldPath<typeof create>>().toEqualTypeOf<
      'ts' | 'day'
    >();
  });

  it('works with an `as const satisfies` declaration', () => {
    expectTypeOf<MappingFieldPath<Fixture>>().toExtend<string>();
    accept<MappingFieldPath<Fixture>>('categories.name.raw');
    // @ts-expect-error unknown field
    accept<MappingFieldPath<Fixture>>('categories.label');
  });

  it('falls back to string for a widened creation request', () => {
    expectTypeOf<
      MappingFieldPath<estypes.IndicesCreateRequest>
    >().toEqualTypeOf<string>();
    const widened: estypes.IndicesCreateRequest = books;
    expectTypeOf<MappingFieldPath<typeof widened>>().toEqualTypeOf<string>();
    expectTypeOf<
      MappingFieldPath<ReturnType<typeof define<typeof widened>>>
    >().toEqualTypeOf<string>();
    expectTypeOf<MappingFieldPath<any>>().toEqualTypeOf<string>();
    expectTypeOf<MappingFieldPath<never>>().toEqualTypeOf<string>();
    expectTypeOf<
      MappingFieldPath<{
        index: 'x';
        mappings: estypes.MappingTypeMapping;
      }>
    >().toEqualTypeOf<string>();
  });

  it('falls back to string without mappings or properties', () => {
    const noMappings = define({ index: 'bare' });
    expectTypeOf<MappingFieldPath<typeof noMappings>>().toEqualTypeOf<string>();
    const emptyMappings = define({ index: 'bare', mappings: {} });
    expectTypeOf<
      MappingFieldPath<typeof emptyMappings>
    >().toEqualTypeOf<string>();
  });

  it('is string when mappings.dynamic is loose (D3)', () => {
    const dynamicTrue = define({
      index: 'loose',
      mappings: { dynamic: true, properties: { a: { type: 'keyword' } } },
    });
    expectTypeOf<
      MappingFieldPath<typeof dynamicTrue>
    >().toEqualTypeOf<string>();
    const dynamicString = define({
      index: 'loose',
      mappings: { dynamic: 'true', properties: { a: { type: 'keyword' } } },
    });
    expectTypeOf<
      MappingFieldPath<typeof dynamicString>
    >().toEqualTypeOf<string>();
    const dynamicRuntime = define({
      index: 'loose',
      mappings: { dynamic: 'runtime', properties: { a: { type: 'keyword' } } },
    });
    expectTypeOf<
      MappingFieldPath<typeof dynamicRuntime>
    >().toEqualTypeOf<string>();
  });

  it('is strict when dynamic is omitted, false or strict (D3)', () => {
    const omitted = define({
      index: 'strict',
      mappings: { properties: { a: { type: 'keyword' } } },
    });
    expectTypeOf<MappingFieldPath<typeof omitted>>().toEqualTypeOf<'a'>();
    const off = define({
      index: 'strict',
      mappings: { dynamic: false, properties: { a: { type: 'keyword' } } },
    });
    expectTypeOf<MappingFieldPath<typeof off>>().toEqualTypeOf<'a'>();
    const strict = define({
      index: 'strict',
      mappings: { dynamic: 'strict', properties: { a: { type: 'keyword' } } },
    });
    expectTypeOf<MappingFieldPath<typeof strict>>().toEqualTypeOf<'a'>();
  });

  it('accepts any child path below a loose object, flattened or open spec', () => {
    const textProperty: estypes.MappingTextProperty = { type: 'text' };
    const create = define({
      index: 'partial',
      mappings: {
        properties: {
          meta: {
            dynamic: true,
            properties: { known: { type: 'keyword' } },
          },
          labels: { type: 'flattened' },
          body: textProperty,
          id: { type: 'keyword' },
        },
      },
    });
    accept<MappingFieldPath<typeof create>>('meta.anything');
    accept<MappingFieldPath<typeof create>>('labels.release');
    accept<MappingFieldPath<typeof create>>('body.exact');
    accept<MappingFieldPath<typeof create>>('id');
    // @ts-expect-error unknown top-level field
    accept<MappingFieldPath<typeof create>>('other');
    // @ts-expect-error id has no sub-fields
    accept<MappingFieldPath<typeof create>>('id.raw');
  });

  it('keeps property names that contain dots', () => {
    const create = define({
      index: 'dots',
      mappings: { properties: { 'a.b': { type: 'keyword' } } },
    });
    expectTypeOf<MappingFieldPath<typeof create>>().toEqualTypeOf<'a.b'>();
  });
});

describe('MappingFulltextPath', () => {
  it('lists full-text leaves and sub-fields for the books mapping', () => {
    expectTypeOf<MappingFulltextPath<Books>>().toEqualTypeOf<
      'title' | 'all_text' | 'categories.name'
    >();
    // @ts-expect-error keyword field is not full-text
    accept<MappingFulltextPath<Books>>('id');
  });

  it('matches the hand-listed full-text paths of the shared fixture', () => {
    expectTypeOf<MappingFulltextPath<Fixture>>().toEqualTypeOf<
      (typeof fixtureFulltextFields)[number]
    >();
  });

  it('resolves aliases to full-text and non-full-text targets', () => {
    accept<MappingFulltextPath<Fixture>>('headline');
    accept<MappingFulltextPath<Fixture>>('stems_alias');
    // @ts-expect-error alias to a keyword field
    accept<MappingFulltextPath<Fixture>>('code_alias');
    // @ts-expect-error completion is not full-text (D4)
    accept<MappingFulltextPath<Fixture>>('suggest');
    // @ts-expect-error token_count is not full-text (D4)
    accept<MappingFulltextPath<Fixture>>('counter');
    // @ts-expect-error runtime fields are not full-text
    accept<MappingFulltextPath<Fixture>>('day_of_week');
    // @ts-expect-error containers are not full-text
    accept<MappingFulltextPath<Fixture>>('categories');
  });

  it('resolves an alias to a nested full-text field', () => {
    const create = define({
      index: 'alias',
      mappings: {
        properties: {
          categories: {
            type: 'nested',
            properties: {
              name: { type: 'text' },
              label: { type: 'alias', path: 'categories.name' },
            },
          },
        },
      },
    });
    expectTypeOf<MappingFulltextPath<typeof create>>().toEqualTypeOf<
      'categories.name' | 'categories.label'
    >();
  });

  it('uses the same fallbacks as MappingFieldPath', () => {
    expectTypeOf<
      MappingFulltextPath<estypes.IndicesCreateRequest>
    >().toEqualTypeOf<string>();
    const noMappings = define({ index: 'bare' });
    expectTypeOf<
      MappingFulltextPath<typeof noMappings>
    >().toEqualTypeOf<string>();
    const dynamicTrue = define({
      index: 'loose',
      mappings: { dynamic: true, properties: { a: { type: 'keyword' } } },
    });
    expectTypeOf<
      MappingFulltextPath<typeof dynamicTrue>
    >().toEqualTypeOf<string>();
  });
});

describe('MappingRecord', () => {
  const typed = define({
    index: 'typed',
    mappings: {
      properties: {
        long: { type: 'long' },
        integer: { type: 'integer' },
        float: { type: 'float' },
        scaled: { type: 'scaled_float', scaling_factor: 100 },
        flag: { type: 'boolean' },
        date: { type: 'date' },
        nanos: { type: 'date_nanos' },
        keyword: { type: 'keyword' },
        text: { type: 'text', fields: { raw: { type: 'keyword' } } },
        wildcard: { type: 'wildcard' },
        constant: { type: 'constant_keyword', value: 'x' },
        matchOnly: { type: 'match_only_text' },
        asYouType: { type: 'search_as_you_type' },
        semantic: { type: 'semantic_text' },
        ip: { type: 'ip' },
        version: { type: 'version' },
        location: { type: 'geo_point' },
        author: {
          properties: { name: { type: 'keyword' }, age: { type: 'short' } },
        },
        categories: {
          type: 'nested',
          properties: { id: { type: 'integer' }, name: { type: 'text' } },
        },
      },
    },
  });
  type Rec = MappingRecord<typeof typed>;
  type Value<T> = T | T[] | null | undefined;

  it('maps numeric types to number', () => {
    expectTypeOf<Rec['long']>().toEqualTypeOf<Value<number>>();
    expectTypeOf<Rec['integer']>().toEqualTypeOf<Value<number>>();
    expectTypeOf<Rec['float']>().toEqualTypeOf<Value<number>>();
    expectTypeOf<Rec['scaled']>().toEqualTypeOf<Value<number>>();
  });

  it('maps boolean and date types', () => {
    expectTypeOf<Rec['flag']>().toEqualTypeOf<Value<boolean>>();
    expectTypeOf<Rec['date']>().toEqualTypeOf<Value<string | number | Date>>();
    expectTypeOf<Rec['nanos']>().toEqualTypeOf<Value<string | number | Date>>();
  });

  it('maps string-like types to string', () => {
    expectTypeOf<Rec['keyword']>().toEqualTypeOf<Value<string>>();
    expectTypeOf<Rec['text']>().toEqualTypeOf<Value<string>>();
    expectTypeOf<Rec['wildcard']>().toEqualTypeOf<Value<string>>();
    expectTypeOf<Rec['constant']>().toEqualTypeOf<Value<string>>();
    expectTypeOf<Rec['matchOnly']>().toEqualTypeOf<Value<string>>();
    expectTypeOf<Rec['asYouType']>().toEqualTypeOf<Value<string>>();
    expectTypeOf<Rec['semantic']>().toEqualTypeOf<Value<string>>();
    expectTypeOf<Rec['ip']>().toEqualTypeOf<Value<string>>();
    expectTypeOf<Rec['version']>().toEqualTypeOf<Value<string>>();
  });

  it('maps other mapping types to unknown', () => {
    expectTypeOf<Rec['location']>().toBeUnknown();
  });

  it('maps containers to objects and accepts arrays, null and omission', () => {
    accept<Rec>({});
    accept<Rec>({
      long: 1,
      flag: [true, false],
      date: new Date(),
      nanos: '2026-11-20T00:00:00Z',
      keyword: null,
      text: ['a', 'b'],
      location: { lat: 1, lon: 2 },
      author: { name: 'Ann', age: 40 },
      categories: [
        { id: 1, name: 'Fiction' },
        { id: 2, name: null },
      ],
    });
    accept<Rec>({ categories: { id: 1 }, author: [{ name: 'Ann' }] });
    // @ts-expect-error wrong value type for a numeric field
    accept<Rec>({ long: 'one' });
    // @ts-expect-error wrong value type inside a nested array of objects
    accept<Rec>({ categories: [{ id: 'one' }] });
    // @ts-expect-error wrong value type inside an object
    accept<Rec>({ author: { age: 'forty' } });
  });

  it('does not include sub-fields or runtime fields as record keys', () => {
    const strict = define({
      index: 'strict',
      mappings: {
        dynamic: 'strict',
        properties: {
          text: { type: 'text', fields: { raw: { type: 'keyword' } } },
        },
        runtime: { day: { type: 'keyword' } },
      },
    });
    accept<MappingRecord<typeof strict>>({ text: 'x' });
    // @ts-expect-error sub-fields are not document keys
    accept<MappingRecord<typeof strict>>({ 'text.raw': 'x' });
    // @ts-expect-error runtime fields are not document keys
    accept<MappingRecord<typeof strict>>({ day: 'x' });
  });

  it('rejects an array where a single document is expected', () => {
    // @ts-expect-error a record is one document
    accept<Rec>([{ long: 1 }]);
  });

  it('rejects wrong value types for the books mapping', () => {
    accept<MappingRecord<Books>>({ id: 'b1', title: 'Dune' });
    // @ts-expect-error title is a text field
    accept<MappingRecord<Books>>({ title: 42 });
  });

  it('allows extra keys unless dynamic is strict', () => {
    accept<Rec>({ extra: 1 });
    accept<Rec>({ author: { extra: 1 } });
    const strict = define({
      index: 'strict',
      mappings: {
        dynamic: 'strict',
        properties: {
          a: { type: 'keyword' },
          loose: { dynamic: true, properties: { b: { type: 'keyword' } } },
          inherits: { properties: { c: { type: 'keyword' } } },
        },
      },
    });
    type StrictRec = MappingRecord<typeof strict>;
    accept<StrictRec>({ a: 'x', loose: { b: 'y', extra: 1 } });
    // @ts-expect-error extra key on a strict mapping
    accept<StrictRec>({ a: 'x', extra: 1 });
    // @ts-expect-error extra key on an object inheriting strict
    accept<StrictRec>({ inherits: { c: 'x', extra: 1 } });
  });

  it('keeps known field types when dynamic is true', () => {
    const loose = define({
      index: 'loose',
      mappings: { dynamic: true, properties: { a: { type: 'long' } } },
    });
    type LooseRec = MappingRecord<typeof loose>;
    accept<LooseRec>({ a: 1, extra: 'x' });
    // @ts-expect-error a is numeric
    accept<LooseRec>({ a: 'x' });
  });

  it('accepts interface-typed values when extra keys are allowed', () => {
    interface Book {
      id: string;
      title: string;
      pages: number;
    }
    const book: Book = { id: 'b1', title: 'Dune', pages: 412 };
    accept<MappingRecord<Books>>(book);
  });

  it('falls back to Record<string, any>', () => {
    expectTypeOf<MappingRecord<estypes.IndicesCreateRequest>>().toEqualTypeOf<
      Record<string, any>
    >();
    const noMappings = define({ index: 'bare' });
    expectTypeOf<MappingRecord<typeof noMappings>>().toEqualTypeOf<
      Record<string, any>
    >();
  });
});

describe('creation request literals', () => {
  it('keeps validating the mapping itself', () => {
    define({
      index: 'typo',
      mappings: {
        properties: {
          // @ts-expect-error unknown mapping type
          a: { type: 'keywrd' },
        },
      },
    });
  });

  it('stays assignable to estypes.IndicesCreateRequest', () => {
    accept<estypes.IndicesCreateRequest>(books);
    accept<estypes.IndicesCreateRequest>({ ...books, index: 'books~v1' });
    accept<estypes.IndicesCreateRequest>(fixture);
  });
});

describe('shared fixture (pinned to section 1.2 runtime rules)', () => {
  it('getAllFields returns the paths MappingFieldPath lists', () => {
    expect(
      getAllFields(fixture, { subFields: true, containers: true }),
    ).toEqual([...fixtureAllFields]);
  });

  it('getFulltextFields returns the paths MappingFulltextPath lists', () => {
    expect(getFulltextFields(fixture, { subFields: true })).toEqual([
      ...fixtureFulltextFields,
    ]);
  });
});
