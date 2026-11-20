import { describe, expect, expectTypeOf, it } from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import IndexManager from './IndexManager/IndexManager';
import QueryBuilder from './QueryBuilder/QueryBuilder';
import { getRecordingClient } from './testFixtures/recordingClient';
import type {
  AliasExistParams,
  IndexExistParams,
  RangeBound,
  RangeShape,
} from './types';

/**
 * Type-level tests. The `expectTypeOf` and `@ts-expect-error` assertions are
 * only enforced by `bun run typecheck`; `bun test` runs the runtime parts.
 */

/** Type-checks `value` against `T` without creating unused variables */
function accept<T>(value: T) {
  return value;
}

type ExistsOptions = NonNullable<Parameters<IndexManager['exists']>[0]>;

describe('IndexExistParams (B-079)', () => {
  it('is the index-exists request, not the alias-exists request', () => {
    expectTypeOf<IndexExistParams>().toEqualTypeOf<estypes.IndicesExistsRequest>();
    expectTypeOf<IndexExistParams>().toHaveProperty('flat_settings');
    expectTypeOf<IndexExistParams>().toHaveProperty('include_defaults');
    expectTypeOf<IndexExistParams>().not.toHaveProperty('name');
  });

  it('leaves AliasExistParams as the alias-exists request', () => {
    expectTypeOf<AliasExistParams>().toEqualTypeOf<estypes.IndicesExistsAliasRequest>();
    expectTypeOf<AliasExistParams>().toHaveProperty('name');
  });

  it('types the options of IndexManager.exists()', () => {
    accept<ExistsOptions>({ flat_settings: true, include_defaults: true });
    accept<ExistsOptions>({ local: true, ignore_unavailable: true });
    // @ts-expect-error `name` belongs to the alias-exists request
    accept<ExistsOptions>({ name: 'x' });
    expect(true).toBe(true);
  });

  it('sends the index-exists options as query string parameters', async () => {
    const { client, sent } = getRecordingClient();
    const index = new IndexManager({ client }, { index: 'books' });
    const result = await index.exists({
      flat_settings: true,
      include_defaults: true,
    });
    expect(result.error).toBe(null);
    expect(result.exists).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('HEAD');
    expect(sent[0].path).toBe(`/${index.getFullName()}`);
    const params = new URLSearchParams(sent[0].querystring);
    expect(params.get('flat_settings')).toBe('true');
    expect(params.get('include_defaults')).toBe('true');
  });
});

describe('RangeShape (S-048, type only)', () => {
  it('accepts the scalar and tuple shapes it always accepted', () => {
    accept<RangeShape>('now-1d');
    accept<RangeShape>(5);
    accept<RangeShape>(['a', 'z']);
    accept<RangeShape>([1, 10]);
    accept<RangeShape>([null, 10]);
    accept<RangeShape>(['2020-01-01', undefined]);
    expect(true).toBe(true);
  });

  it('accepts Date values and Date bounds', () => {
    accept<RangeShape>(new Date('2020-01-01T00:00:00Z'));
    accept<RangeShape>([new Date('2020-01-01T00:00:00Z'), null]);
    accept<RangeShape>([undefined, new Date('2020-01-01T00:00:00Z')]);
    accept<RangeShape>([new Date('2020-01-01T00:00:00Z'), 'now']);
    accept<RangeShape>(['now-1y', new Date('2020-01-01T00:00:00Z')]);
    expectTypeOf<Date>().toMatchTypeOf<RangeShape>();
    expect(true).toBe(true);
  });

  it('still rejects numbers mixed with strings or dates, and other types', () => {
    // @ts-expect-error a number bound with a string bound
    accept<RangeShape>([1, 'z']);
    // @ts-expect-error a number bound with a Date bound
    accept<RangeShape>([1, new Date()]);
    // @ts-expect-error booleans are not range values
    accept<RangeShape>(true);
    // @ts-expect-error a range needs exactly two bounds
    accept<RangeShape>([1, 2, 3]);
    expect(true).toBe(true);
  });

  it('keeps RangeBound as the nullable bound helper', () => {
    expectTypeOf<RangeBound<Date>>().toEqualTypeOf<Date | null | undefined>();
  });

  it('lets QueryBuilder.range() take Date values', () => {
    const date = new Date('2020-01-01T00:00:00Z');
    const qb = new QueryBuilder<'published_at'>()
      .range('published_at', '>=', date)
      .range('published_at', 'between', [date, 'now']);
    expect(JSON.parse(JSON.stringify(qb.getQuery().query))).toEqual({
      bool: {
        must: [
          { range: { published_at: { gte: '2020-01-01T00:00:00.000Z' } } },
          {
            range: {
              published_at: { gte: '2020-01-01T00:00:00.000Z', lte: 'now' },
            },
          },
        ],
      },
    });
  });
});
