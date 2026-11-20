import { describe, expect, expectTypeOf, it } from 'bun:test';
import QueryBuilder, {
  type AggregateDateHistogramOptions,
  type AggregateGeotileGridOptions,
  type AggregateHistogramOptions,
  type CompositeHistogramSource,
  type DateHistogramOptions,
} from './QueryBuilder';

type Field = 'price' | 'at' | 'location' | 'brand';

describe('QueryBuilder.aggregateHistogram() (B-054, S-022, S-025)', () => {
  it('builds a composite histogram source', () => {
    const qb = new QueryBuilder<Field>();
    qb.aggregateHistogram({ field: 'price', interval: 50 });
    expect(qb.getQuery().aggs).toEqual({
      price: {
        composite: {
          size: 25,
          sources: [
            {
              price: {
                histogram: { field: 'price', interval: 50, order: 'asc' },
              },
            },
          ],
        },
      },
    });
    expect(qb.getQuery().size).toBe(0);
  });

  it('takes name, limit, order and an after key (copied)', () => {
    const after = { price: 100 };
    const qb = new QueryBuilder<Field>().aggregateHistogram({
      field: 'price',
      interval: 50,
      name: 'prices',
      limit: 2,
      order: 'desc',
      after,
    });
    after.price = 999;
    expect(qb.getAggs()).toEqual({
      prices: {
        composite: {
          size: 2,
          after: { price: 100 },
          sources: [
            {
              price: {
                histogram: { field: 'price', interval: 50, order: 'desc' },
              },
            },
          ],
        },
      },
    });
  });

  it('does not need interval when orderBy supplies the sources', () => {
    const orderBy: CompositeHistogramSource<Field>[] = [
      { field: 'price', interval: 25, order: 'desc' },
    ];
    const qb = new QueryBuilder<Field>().aggregateHistogram({
      field: 'price',
      orderBy,
    });
    orderBy[0].interval = 1;
    expect(qb.getAggs().price.composite?.sources).toEqual([
      { price: { histogram: { field: 'price', interval: 25, order: 'desc' } } },
    ]);
  });

  it('validates its input', () => {
    const qb = new QueryBuilder<Field>();
    // @ts-expect-error  interval is required without orderBy
    expect(() => qb.aggregateHistogram({ field: 'price' })).toThrow(TypeError);
    expect(() =>
      qb.aggregateHistogram({ field: 'price', interval: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      qb.aggregateHistogram({ field: 'price', interval: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      qb.aggregateHistogram({ field: 'price', interval: 5, limit: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      qb.aggregateHistogram({ field: 'price', interval: 5, limit: 2.5 }),
    ).toThrow(RangeError);
    expect(() =>
      qb.aggregateHistogram({
        field: 'price',
        interval: 5,
        // @ts-expect-error  after is an object
        after: [1],
      }),
    ).toThrow(TypeError);
    expect(() =>
      qb.aggregateHistogram({
        field: 'price',
        orderBy: [{ field: 'price', interval: -1 }],
      }),
    ).toThrow(RangeError);
    expect(qb.getAggs()).toEqual({});
  });
});

describe('aggregation names (S-022)', () => {
  it('keeps two aggregations on one field apart', () => {
    const qb = new QueryBuilder<Field>()
      .aggregateTerm({ field: 'price', name: 'price_terms' })
      .aggregateHistogram({ field: 'price', interval: 10, name: 'price_hist' });
    expect(Object.keys(qb.getAggs())).toEqual(['price_terms', 'price_hist']);
    expect(qb.getAggs().price_terms.terms?.field).toBe('price');
  });

  it('defaults the name to the field, for every helper', () => {
    const qb = new QueryBuilder<Field>()
      .aggregateTerm({ field: 'brand' })
      .aggregateHistogram({ field: 'price', interval: 10 })
      .aggregateDateHistogram({ field: 'at', calendarInterval: '1d' })
      .aggregateGeotileGrid({ field: 'location', precision: 4 });
    expect(Object.keys(qb.getAggs())).toEqual([
      'brand',
      'price',
      'at',
      'location',
    ]);
  });

  it('rejects names Elasticsearch rejects', () => {
    const qb = new QueryBuilder<Field>();
    for (const name of ['', 'a[0]', 'a>b']) {
      expect(() => qb.aggregateTerm({ field: 'brand', name })).toThrow(
        RangeError,
      );
      expect(() =>
        qb.dateHistogram({ field: 'at', interval: 'day', name }),
      ).toThrow(RangeError);
    }
    expect(() =>
      // @ts-expect-error  name is a string
      qb.aggregateGeotileGrid({ field: 'location', precision: 4, name: 1 }),
    ).toThrow(TypeError);
  });
});

describe('QueryBuilder.aggregateDateHistogram() (B-096, B-054, S-025)', () => {
  it('builds a composite date_histogram source', () => {
    const qb = new QueryBuilder<Field>().aggregateDateHistogram({
      field: 'at',
      fixedInterval: '1h',
      timeZone: 'America/Denver',
      format: 'uuuu-MM-dd',
      offset: '+30m',
      order: 'desc',
      limit: 10,
      after: { at: 1704067200000 },
    });
    expect(qb.getAggs()).toEqual({
      at: {
        composite: {
          size: 10,
          after: { at: 1704067200000 },
          sources: [
            {
              at: {
                date_histogram: {
                  field: 'at',
                  order: 'desc',
                  fixed_interval: '1h',
                  time_zone: 'America/Denver',
                  format: 'uuuu-MM-dd',
                  offset: '+30m',
                },
              },
            },
          ],
        },
      },
    });
  });

  it('throws when both or neither interval is set (B-096)', () => {
    const qb = new QueryBuilder<Field>();
    expect(() =>
      qb.aggregateDateHistogram({
        field: 'at',
        calendarInterval: '1d',
        fixedInterval: '24h',
      }),
    ).toThrow(TypeError);
    expect(() => qb.aggregateDateHistogram({ field: 'at' })).toThrow(TypeError);
    expect(() =>
      qb.aggregateDateHistogram({
        field: 'at',
        orderBy: [
          { field: 'at', calendar_interval: '1d', fixed_interval: '24h' },
        ],
      }),
    ).toThrow(TypeError);
    expect(() =>
      qb.aggregateDateHistogram({ field: 'at', orderBy: [{ field: 'at' }] }),
    ).toThrow(TypeError);
  });

  it('normalizes timeZone, also in orderBy sources (B-096)', () => {
    const qb = new QueryBuilder<Field>().aggregateDateHistogram({
      field: 'at',
      calendarInterval: '1d',
      timeZone: 120,
    });
    const source = qb.getAggs().at.composite?.sources?.[0].at;
    expect(source?.date_histogram?.time_zone).toBe('+02:00');
    const qb2 = new QueryBuilder<Field>().aggregateDateHistogram({
      field: 'at',
      orderBy: [{ field: 'at', calendar_interval: '1d', time_zone: '+0530' }],
    });
    const source2 = qb2.getAggs().at.composite?.sources?.[0].at;
    expect(source2?.date_histogram?.time_zone).toBe('+05:30');
    expect(() =>
      qb.aggregateDateHistogram({
        field: 'at',
        calendarInterval: '1d',
        timeZone: 'utc',
      }),
    ).toThrow(RangeError);
  });

  it('validates offset like dateHistogram() (B-050)', () => {
    const qb = new QueryBuilder<Field>();
    expect(() =>
      qb.aggregateDateHistogram({
        field: 'at',
        calendarInterval: '1M',
        offset: '+1M',
      }),
    ).toThrow(RangeError);
    expect(() =>
      qb.aggregateDateHistogram({
        field: 'at',
        orderBy: [{ field: 'at', calendar_interval: '1M', offset: '+1w' }],
      }),
    ).toThrow(RangeError);
    qb.aggregateDateHistogram({
      field: 'at',
      calendarInterval: '1M',
      offset: '6h',
    });
    expect(qb.getAggs().at.composite?.sources?.[0].at?.date_histogram).toEqual({
      field: 'at',
      order: 'asc',
      calendar_interval: '1M',
      offset: '6h',
    });
  });
});

describe('QueryBuilder.aggregateGeotileGrid() (S-052, B-054, S-025)', () => {
  it('builds a composite geotile_grid source', () => {
    const qb = new QueryBuilder<Field>().aggregateGeotileGrid({
      field: 'location',
      precision: 8,
      bounds: { top_left: '40.8,-74.3', bottom_right: '40.4,-73.6' },
      after: { location: '4/1/2' },
    });
    expect(qb.getAggs()).toEqual({
      location: {
        composite: {
          size: 25,
          after: { location: '4/1/2' },
          sources: [
            {
              location: {
                geotile_grid: {
                  field: 'location',
                  precision: 8,
                  bounds: {
                    top_left: '40.8,-74.3',
                    bottom_right: '40.4,-73.6',
                  },
                  order: 'asc',
                },
              },
            },
          ],
        },
      },
    });
  });

  it('accepts precision 0 through 29 only (S-052)', () => {
    const qb = new QueryBuilder<Field>();
    qb.aggregateGeotileGrid({ field: 'location', precision: 0 });
    qb.aggregateGeotileGrid({ field: 'location', precision: 29 });
    for (const precision of [-1, 30, 1.5, Number.NaN]) {
      expect(() =>
        qb.aggregateGeotileGrid({ field: 'location', precision }),
      ).toThrow(RangeError);
      expect(() =>
        qb.aggregateGeotileGrid({
          field: 'location',
          orderBy: [{ field: 'location', precision }],
        }),
      ).toThrow(RangeError);
    }
  });

  it('leaves precision to the server default when omitted', () => {
    const qb = new QueryBuilder<Field>().aggregateGeotileGrid({
      field: 'location',
    });
    expect(
      qb.getAggs().location.composite?.sources?.[0].location?.geotile_grid,
    ).toEqual({ field: 'location', order: 'asc' });
  });
});

describe('QueryBuilder.dateHistogram() (D9, B-050, B-054, S-052, S-025)', () => {
  it('builds a plain date_histogram that keeps empty buckets', () => {
    const qb = new QueryBuilder<Field>();
    qb.dateHistogram({ field: 'at', interval: 'month', timeZone: '+02:00' });
    expect(qb.getQuery().aggs).toEqual({
      at: {
        date_histogram: {
          field: 'at',
          calendar_interval: '1M',
          format: 'uuuu-MM',
          time_zone: '+02:00',
          min_doc_count: 0,
        },
      },
    });
    expect(qb.getQuery().size).toBe(0);
  });

  it('uses fixed_interval for hour, minute and second', () => {
    const qb = new QueryBuilder<Field>().dateHistogram({
      field: 'at',
      interval: 'hour',
    });
    expect(qb.getAggs().at.date_histogram).toEqual({
      field: 'at',
      fixed_interval: '1h',
      format: "uuuu-MM-dd'T'HH",
      time_zone: 'Z',
      min_doc_count: 0,
    });
  });

  it('takes name, offset and extendedBounds', () => {
    const qb = new QueryBuilder<Field>().dateHistogram({
      field: 'at',
      interval: 'day',
      name: 'per_day',
      offset: '-6h',
      extendedBounds: { min: '2024-01-01', max: '2024-12-31' },
    });
    expect(qb.getAggs()).toEqual({
      per_day: {
        date_histogram: {
          field: 'at',
          calendar_interval: '1d',
          format: 'uuuu-MM-dd',
          time_zone: 'Z',
          min_doc_count: 0,
          offset: '-6h',
          extended_bounds: { min: '2024-01-01', max: '2024-12-31' },
        },
      },
    });
  });

  it('accepts timezone as a deprecated alias of timeZone (S-052)', () => {
    const qb = new QueryBuilder<Field>().dateHistogram({
      field: 'at',
      interval: 'day',
      timezone: 120,
    });
    expect(qb.getAggs().at.date_histogram?.time_zone).toBe('+02:00');
    expect(() =>
      qb.dateHistogram({
        field: 'at',
        interval: 'day',
        timeZone: 'UTC',
        timezone: 'UTC',
      }),
    ).toThrow(TypeError);
  });

  it('accepts the offsets Elasticsearch accepts (B-050)', () => {
    const units = ['nanos', 'micros', 'ms', 's', 'm', 'h', 'd'];
    for (const unit of units) {
      for (const sign of ['+', '-', '']) {
        const offset = `${sign}3${unit}`;
        const qb = new QueryBuilder<Field>().dateHistogram({
          field: 'at',
          interval: 'month',
          offset,
        });
        expect(qb.getAggs().at.date_histogram?.offset).toBe(offset);
      }
    }
  });

  it('rejects offsets Elasticsearch rejects (B-050)', () => {
    const offsets = ['+1M', '+1w', '+1q', '+1y', '1.5h', '+1', '', ' 1d'];
    for (const offset of offsets) {
      expect(() =>
        new QueryBuilder<Field>().dateHistogram({
          field: 'at',
          interval: 'month',
          offset,
        }),
      ).toThrow(RangeError);
    }
    expect(() =>
      new QueryBuilder<Field>().dateHistogram({
        field: 'at',
        interval: 'month',
        // @ts-expect-error  offset is a string
        offset: 6,
      }),
    ).toThrow(TypeError);
  });

  it('rejects unknown intervals and the removed limit option', () => {
    const qb = new QueryBuilder<Field>();
    expect(() =>
      // @ts-expect-error  not an interval
      qb.dateHistogram({ field: 'at', interval: 'decade' }),
    ).toThrow(RangeError);
    expect(() =>
      // @ts-expect-error  not an interval
      qb.dateHistogram({ field: 'at', interval: 'toString' }),
    ).toThrow(RangeError);
    expect(() =>
      // @ts-expect-error  limit was removed: buckets are never truncated
      qb.dateHistogram({ field: 'at', interval: 'day', limit: 10 }),
    ).toThrow(TypeError);
    expect(qb.getAggs()).toEqual({});
  });
});

describe('composite helper types (B-051)', () => {
  it('types orderBy fields as Field', () => {
    const qb = new QueryBuilder<Field>();
    qb.aggregateHistogram({
      field: 'price',
      // @ts-expect-error  unknown field
      orderBy: [{ field: 'zzz', interval: 5 }],
    });
    qb.aggregateDateHistogram({
      field: 'at',
      // @ts-expect-error  unknown field
      orderBy: [{ field: 'zzz', calendar_interval: '1d' }],
    });
    qb.aggregateGeotileGrid({
      field: 'location',
      // @ts-expect-error  unknown field
      orderBy: [{ field: 'zzz', precision: 3 }],
    });
    expectTypeOf<
      AggregateHistogramOptions<Field>['field']
    >().toEqualTypeOf<Field>();
    expectTypeOf<
      AggregateDateHistogramOptions<Field>['field']
    >().toEqualTypeOf<Field>();
    expectTypeOf<
      AggregateGeotileGridOptions<Field>['field']
    >().toEqualTypeOf<Field>();
    expectTypeOf<DateHistogramOptions<Field>['field']>().toEqualTypeOf<Field>();
  });
});
