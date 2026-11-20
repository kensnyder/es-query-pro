import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { createTestKit } from '../testFixtures/esTestKit';
import { getPlacesCreateRequest, getPlacesData } from '../testFixtures/places';
import QueryBuilder from './QueryBuilder';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(30_000);

const kit = await createTestKit('qb-histogram');
const client = kit.client;
let events = '';
let places = '';

// 7 events from 2024-01-15 to 2024-07-31 (199 days, 6 distinct days; months
// Feb, Apr, May and Jun have none). Amounts 5..65 fall in 7 buckets of 10.
const eventDocs = [
  { id: '1', at: '2024-01-15T03:00:00Z', amount: 5, kind: 'a' },
  { id: '2', at: '2024-01-20T12:00:00Z', amount: 15, kind: 'b' },
  { id: '3', at: '2024-03-10T12:00:00Z', amount: 25, kind: 'a' },
  { id: '4', at: '2024-03-11T12:00:00Z', amount: 35, kind: 'a' },
  { id: '5', at: '2024-07-04T12:00:00Z', amount: 45, kind: 'b' },
  { id: '6', at: '2024-07-04T18:00:00Z', amount: 55, kind: 'b' },
  { id: '7', at: '2024-07-31T23:30:00Z', amount: 65, kind: 'a' },
];

type EventField = 'id' | 'at' | 'amount' | 'kind';
type DateBucket = estypes.AggregationsDateHistogramBucket;
type CompositeBucket = estypes.AggregationsCompositeBucket;
type AfterKey = estypes.AggregationsCompositeAggregateKey;

beforeAll(async () => {
  events = await kit.makeIndex(
    {
      index: 'events',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          at: { type: 'date' },
          amount: { type: 'integer' },
          kind: { type: 'keyword' },
        },
      },
    },
    eventDocs,
  );
  places = await kit.makeIndex(getPlacesCreateRequest('places'), [
    ...getPlacesData(),
  ]);
});

afterAll(async () => {
  await kit.cleanup();
});

async function search(qb: QueryBuilder<string>, index = events) {
  return client.search({ index, ...qb.getQuery() });
}

/** Buckets of a plain date_histogram aggregation */
async function dateBuckets(qb: QueryBuilder<string>, name: string) {
  const res = await search(qb);
  const agg = res.aggregations?.[
    name
  ] as estypes.AggregationsDateHistogramAggregate;
  return agg.buckets as DateBucket[];
}

/** Buckets and after_key of a composite aggregation */
async function compositePage(
  qb: QueryBuilder<string>,
  name: string,
  index = events,
) {
  const res = await search(qb, index);
  const agg = res.aggregations?.[
    name
  ] as estypes.AggregationsCompositeAggregate;
  return { buckets: agg.buckets as CompositeBucket[], after: agg.after_key };
}

/**
 * Fetch every page of a composite aggregation, starting a fresh builder per
 * page with `build(after)`. Gives up after 20 pages.
 */
async function allPages(
  build: (after?: AfterKey) => QueryBuilder<string>,
  name: string,
  index = events,
) {
  const pages: CompositeBucket[][] = [];
  let after: AfterKey | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await compositePage(build(after), name, index);
    if (page.buckets.length === 0) {
      return pages;
    }
    pages.push(page.buckets);
    after = page.after;
  }
  throw new Error('composite paging did not finish');
}

/** Send a raw request; resolve with the server's error reason, or null */
async function rejection(request: Omit<estypes.SearchRequest, 'index'>) {
  try {
    await client.search({ index: events, ...request });
    return null;
  } catch (error) {
    const body = (error as { meta?: { body?: unknown } }).meta?.body as
      | { error?: { root_cause?: { reason?: string }[] } }
      | undefined;
    return body?.error?.root_cause?.[0]?.reason ?? String(error);
  }
}

/** A raw monthly date_histogram on `at` with `offset`, plain or composite */
function rawMonthly(offset: string, composite: boolean) {
  const source = { field: 'at', calendar_interval: '1M', offset } as const;
  if (composite) {
    const sources = [{ at: { date_histogram: source } }];
    return { size: 0, aggs: { h: { composite: { sources } } } };
  }
  return { size: 0, aggs: { h: { date_histogram: source } } };
}

const JAN_1 = Date.parse('2024-01-01T00:00:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('dateHistogram offset (reproduce-first B-050)', () => {
  it('server: rejects "+1M" (it is not read as one minute)', async () => {
    expect(await rejection(rawMonthly('+1M', false))).toContain('offset');
    expect(await rejection(rawMonthly('+1M', true))).toContain('offset');
    const res = await client.search({
      index: events,
      ...rawMonthly('+1m', false),
    });
    const agg = res.aggregations
      ?.h as estypes.AggregationsDateHistogramAggregate;
    expect((agg.buckets as DateBucket[])[0].key).toBe(JAN_1 + MINUTE);
  });

  for (const offset of ['+1w', '+1q', '+1y']) {
    it(`server: rejects "${offset}" (plain and composite)`, async () => {
      expect(await rejection(rawMonthly(offset, false))).not.toBeNull();
      expect(await rejection(rawMonthly(offset, true))).not.toBeNull();
    });
  }

  it('server: accepts an unsigned offset', async () => {
    expect(await rejection(rawMonthly('6h', false))).toBeNull();
    expect(await rejection(rawMonthly('6h', true))).toBeNull();
  });

  const accepted: [string, number][] = [
    ['+6h', 6 * HOUR],
    ['6h', 6 * HOUR],
    ['-6h', -6 * HOUR],
    ['+1d', DAY],
    ['-30m', -30 * MINUTE],
    ['+90s', 90_000],
    ['+500ms', 500],
    ['+3000micros', 3],
    ['+4000000nanos', 4],
    ['+0d', 0],
  ];
  for (const [offset, shift] of accepted) {
    it(`accepts "${offset}" and the server shifts buckets by it`, async () => {
      const plain = await dateBuckets(
        new QueryBuilder<EventField>().dateHistogram({
          field: 'at',
          interval: 'month',
          offset,
        }),
        'at',
      );
      const composite = await compositePage(
        new QueryBuilder<EventField>().aggregateDateHistogram({
          field: 'at',
          calendarInterval: 'month',
          offset,
        }),
        'at',
      );
      // the January bucket holds the first documents either way
      expect(plain[0].key).toBe(JAN_1 + shift);
      expect(composite.buckets[0].key.at).toBe(JAN_1 + shift);
    });
  }

  for (const offset of ['+1M', '+1w', '+1q', '+1y', '+1H', '+1.5h', '']) {
    it(`rejects "${offset}" locally`, () => {
      expect(() =>
        new QueryBuilder().dateHistogram({
          field: 'at',
          interval: 'month',
          offset,
        }),
      ).toThrow(RangeError);
      expect(() =>
        new QueryBuilder().aggregateDateHistogram({
          field: 'at',
          calendarInterval: '1M',
          offset,
        }),
      ).toThrow(RangeError);
    });
  }
});

describe('dateHistogram() (D9, B-054)', () => {
  it('returns every day, including empty ones, beyond 100 buckets', async () => {
    const buckets = await dateBuckets(
      new QueryBuilder<EventField>().dateHistogram({
        field: 'at',
        interval: 'day',
      }),
      'at',
    );
    expect(buckets).toHaveLength(199);
    expect(buckets[0].key_as_string).toBe('2024-01-15');
    expect(buckets[198].key_as_string).toBe('2024-07-31');
    const nonEmpty = buckets.filter((b) => b.doc_count > 0);
    expect(nonEmpty.map((b) => [b.key_as_string, b.doc_count])).toEqual([
      ['2024-01-15', 1],
      ['2024-01-20', 1],
      ['2024-03-10', 1],
      ['2024-03-11', 1],
      ['2024-07-04', 2],
      ['2024-07-31', 1],
    ]);
  });

  it('the old composite form returned only non-empty buckets', async () => {
    const page = await compositePage(
      new QueryBuilder<EventField>().aggregateDateHistogram({
        field: 'at',
        calendarInterval: 'day',
        limit: 100,
      }),
      'at',
    );
    expect(page.buckets).toHaveLength(6);
  });

  it('fills months with no documents', async () => {
    const buckets = await dateBuckets(
      new QueryBuilder<EventField>().dateHistogram({
        field: 'at',
        interval: 'month',
        name: 'per_month',
      }),
      'per_month',
    );
    expect(buckets.map((b) => [b.key_as_string, b.doc_count])).toEqual([
      ['2024-01', 2],
      ['2024-02', 0],
      ['2024-03', 2],
      ['2024-04', 0],
      ['2024-05', 0],
      ['2024-06', 0],
      ['2024-07', 3],
    ]);
  });

  it('extendedBounds adds empty buckets outside the data (epoch ms)', async () => {
    const buckets = await dateBuckets(
      new QueryBuilder<EventField>().dateHistogram({
        field: 'at',
        interval: 'quarter',
        extendedBounds: {
          min: Date.parse('2023-10-01T00:00:00Z'),
          max: Date.parse('2024-12-31T00:00:00Z'),
        },
      }),
      'at',
    );
    expect(buckets.map((b) => [b.key_as_string, b.doc_count])).toEqual([
      ['2023-Q4', 0],
      ['2024-Q1', 4],
      ['2024-Q2', 0],
      ['2024-Q3', 3],
      ['2024-Q4', 0],
    ]);
  });

  it('extendedBounds strings use the interval key format', async () => {
    const buckets = await dateBuckets(
      new QueryBuilder<EventField>().dateHistogram({
        field: 'at',
        interval: 'month',
        extendedBounds: { min: '2023-12', max: '2024-08' },
      }),
      'at',
    );
    expect(buckets).toHaveLength(9);
    expect(buckets[0].key_as_string).toBe('2023-12');
    expect(buckets[8].key_as_string).toBe('2024-08');
  });
});

describe('time zone normalization (B-096, S-052)', () => {
  it('dateHistogram buckets days in the given zone', async () => {
    for (const timeZone of ['America/New_York', -300, '-0500']) {
      const buckets = await dateBuckets(
        new QueryBuilder<EventField>().dateHistogram({
          field: 'at',
          interval: 'day',
          timeZone,
        }),
        'at',
      );
      // 2024-01-15T03:00Z is still the 14th in New York
      expect(buckets[0].key_as_string).toBe('2024-01-14');
    }
  });

  it('accepts the deprecated timezone spelling', async () => {
    const buckets = await dateBuckets(
      new QueryBuilder<EventField>().dateHistogram({
        field: 'at',
        interval: 'month',
        timezone: 60,
      }),
      'at',
    );
    // 2024-07-31T23:30Z is August 1st at UTC+1
    expect(buckets.at(-1)?.key_as_string).toBe('2024-08');
  });

  it('aggregateDateHistogram normalizes a numeric timeZone', async () => {
    const page = await compositePage(
      new QueryBuilder<EventField>().aggregateDateHistogram({
        field: 'at',
        calendarInterval: '1M',
        timeZone: 60,
        format: 'uuuu-MM',
      }),
      'at',
    );
    expect(page.buckets.map((b) => b.key.at)).toEqual([
      '2024-01',
      '2024-03',
      '2024-07',
      '2024-08',
    ]);
  });

  it('rejects a zone name the server rejects, before sending', () => {
    expect(() =>
      new QueryBuilder<EventField>().aggregateDateHistogram({
        field: 'at',
        calendarInterval: '1d',
        timeZone: 'utc',
      }),
    ).toThrow(RangeError);
  });
});

describe('composite paging with after (B-054)', () => {
  it('pages a histogram to exhaustion', async () => {
    const pages = await allPages(
      (after) =>
        new QueryBuilder<EventField>().aggregateHistogram({
          field: 'amount',
          interval: 10,
          limit: 2,
          after,
        }),
      'amount',
    );
    expect(pages.map((page) => page.length)).toEqual([2, 2, 2, 1]);
    const keys = pages.flat().map((b) => b.key.amount);
    expect(keys).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });

  it('pages a descending histogram from orderBy sources', async () => {
    const pages = await allPages(
      (after) =>
        new QueryBuilder<EventField>().aggregateHistogram({
          field: 'amount',
          orderBy: [{ field: 'amount', interval: 20, order: 'desc' }],
          limit: 3,
          after,
        }),
      'amount',
    );
    const buckets = pages.flat();
    expect(buckets.map((b) => [b.key.amount, b.doc_count])).toEqual([
      [60, 1],
      [40, 2],
      [20, 2],
      [0, 2],
    ]);
  });

  it('pages a date histogram to exhaustion', async () => {
    const pages = await allPages(
      (after) =>
        new QueryBuilder<EventField>().aggregateDateHistogram({
          field: 'at',
          calendarInterval: 'day',
          format: 'uuuu-MM-dd',
          limit: 4,
          after,
        }),
      'at',
    );
    expect(pages.flat().map((b) => b.key.at)).toEqual([
      '2024-01-15',
      '2024-01-20',
      '2024-03-10',
      '2024-03-11',
      '2024-07-04',
      '2024-07-31',
    ]);
  });
});

describe('aggregation names (S-022)', () => {
  it('runs two aggregations on one field side by side', async () => {
    const res = await search(
      new QueryBuilder<EventField>()
        .aggregateTerm({ field: 'amount', name: 'amount_terms', limit: 50 })
        .aggregateHistogram({ field: 'amount', interval: 30, name: 'bands' })
        .dateHistogram({ field: 'at', interval: 'year', name: 'years' })
        .aggregateDateHistogram({
          field: 'at',
          calendarInterval: 'year',
          name: 'years_composite',
        }),
    );
    const terms = res.aggregations
      ?.amount_terms as estypes.AggregationsLongTermsAggregate;
    expect(terms.buckets).toHaveLength(7);
    const bands = res.aggregations
      ?.bands as estypes.AggregationsCompositeAggregate;
    expect(
      (bands.buckets as CompositeBucket[]).map((b) => [
        b.key.amount,
        b.doc_count,
      ]),
    ).toEqual([
      [0, 3],
      [30, 3],
      [60, 1],
    ]);
    const years = res.aggregations
      ?.years as estypes.AggregationsDateHistogramAggregate;
    expect((years.buckets as DateBucket[])[0].doc_count).toBe(7);
    expect(res.aggregations?.years_composite).toBeDefined();
    expect(res.hits.hits).toEqual([]);
  });
});

describe('aggregateGeotileGrid() (S-052, B-054)', () => {
  type PlaceField = 'location' | 'category';

  it('buckets the places into one tile each and pages with after', async () => {
    const pages = await allPages(
      (after) =>
        new QueryBuilder<PlaceField>().aggregateGeotileGrid({
          field: 'location',
          precision: 4,
          limit: 4,
          after,
        }),
      'location',
      places,
    );
    expect(pages.map((page) => page.length)).toEqual([4, 2]);
    const tiles = pages.flat();
    expect(tiles.every((b) => b.doc_count === 1)).toBe(true);
    expect(new Set(tiles.map((b) => b.key.location)).size).toBe(6);
    expect(tiles.every((b) => String(b.key.location).startsWith('4/'))).toBe(
      true,
    );
  });

  it('precision 0 puts the whole world in one tile', async () => {
    const page = await compositePage(
      new QueryBuilder<PlaceField>().aggregateGeotileGrid({
        field: 'location',
        precision: 0,
        name: 'world',
      }),
      'world',
      places,
    );
    expect(page.buckets).toEqual([
      expect.objectContaining({ key: { location: '0/0/0' }, doc_count: 6 }),
    ]);
  });

  it('bounds keep only the tiles in the box', async () => {
    // a box around western Europe: Paris, London and Madrid
    const page = await compositePage(
      new QueryBuilder<PlaceField>().aggregateGeotileGrid({
        field: 'location',
        precision: 4,
        bounds: { top_left: '55,-10', bottom_right: '36,10' },
      }),
      'location',
      places,
    );
    expect(page.buckets.reduce((n, b) => n + b.doc_count, 0)).toBe(3);
  });
});
