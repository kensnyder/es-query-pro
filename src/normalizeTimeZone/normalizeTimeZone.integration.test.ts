import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { createTestKit } from '../testFixtures/esTestKit';
import { normalizeTimeZone } from './normalizeTimeZone';

// remote clusters (e.g. Elastic Cloud) need more than bun's 5s default
setDefaultTimeout(120_000);

const kit = await createTestKit('timezone');

afterAll(async () => {
  await kit.cleanup();
});

let index = '';

beforeAll(async () => {
  index = await kit.makeIndex(
    { index: 'tz', mappings: { properties: { at: { type: 'date' } } } },
    [{ id: '1', at: '2024-01-15T12:00:00Z' }],
  );
});

/** The day bucket key of the one document, or the server's error type. */
async function dayBucket(timeZone: string) {
  try {
    const result = await kit.client.search({
      index,
      size: 0,
      aggs: {
        day: {
          date_histogram: {
            field: 'at',
            calendar_interval: '1d',
            time_zone: timeZone,
            format: "yyyy-MM-dd'T'HH:mmXXX",
          },
        },
      },
    });
    const day = result.aggregations?.day as {
      buckets: { key_as_string: string; doc_count: number }[];
    };
    return { key: day.buckets[0]?.key_as_string, error: null };
  } catch (error) {
    return { key: null, error: (error as Error).name };
  }
}

/** Send each time zone to the server, a few at a time; list the failures. */
async function rejectedByServer(timeZones: string[]) {
  const rejected: string[] = [];
  for (let i = 0; i < timeZones.length; i += 25) {
    const chunk = timeZones.slice(i, i + 25);
    const results = await Promise.all(chunk.map(dayBucket));
    results.forEach((result, j) => {
      if (result.error) {
        rejected.push(chunk[j] as string);
      }
    });
  }
  return rejected;
}

describe('normalizeTimeZone - Integration', () => {
  it('should produce offsets that bucket documents at the right local day', async () => {
    const cases: [string | number, string][] = [
      ['UTC', '2024-01-15T00:00Z'],
      ['Z', '2024-01-15T00:00Z'],
      [0, '2024-01-15T00:00Z'],
      [-360, '2024-01-15T00:00-06:00'],
      [330, '2024-01-15T00:00+05:30'],
      [1080, '2024-01-16T00:00+18:00'],
      [-1080, '2024-01-14T00:00-18:00'],
      ['+05:30', '2024-01-15T00:00+05:30'],
      ['+0530', '2024-01-15T00:00+05:30'],
      ['+05', '2024-01-15T00:00+05:00'],
      ['-5', '2024-01-15T00:00-05:00'],
      ['-00:00', '2024-01-15T00:00Z'],
      ['America/New_York', '2024-01-15T00:00-05:00'],
      ['Asia/Kolkata', '2024-01-15T00:00+05:30'],
      ['Pacific/Kiritimati', '2024-01-16T00:00+14:00'],
      ['Etc/GMT+6', '2024-01-15T00:00-06:00'],
      ['GMT', '2024-01-15T00:00Z'],
      ['CET', '2024-01-15T00:00+01:00'],
      ['EST5EDT', '2024-01-15T00:00-05:00'],
      ['US/Eastern', '2024-01-15T00:00-05:00'],
    ];
    for (const [input, expected] of cases) {
      const timeZone = normalizeTimeZone(input);
      expect({ input, ...(await dayBucket(timeZone)) }).toEqual({
        input,
        key: expected,
        error: null,
      });
    }
  });

  it('should only accept zone names the server accepts', async () => {
    const names = [
      ...Intl.supportedValuesOf('timeZone'),
      'UTC',
      'Etc/UTC',
      'GMT',
      'GMT0',
      'UCT',
      'Zulu',
      'Universal',
      'CET',
      'EET',
      'MET',
      'WET',
      'EST5EDT',
      'CST6CDT',
      'MST7MDT',
      'PST8PDT',
      'US/Eastern',
      'Asia/Calcutta',
      'Europe/Kiev',
      'PRC',
      'ROK',
      'Japan',
      'W-SU',
      // names the function rejects
      'EST',
      'MST',
      'HST',
      'ROC',
      'PST',
      'Foo/Bar',
    ];
    const accepted = names.filter((name) => {
      try {
        normalizeTimeZone(name);
        return true;
      } catch {
        return false;
      }
    });
    expect(accepted.length).toBeGreaterThan(400);
    expect(await rejectedByServer(accepted.map(normalizeTimeZone))).toEqual([]);
  });

  it('should accept every string offset form the function accepts', async () => {
    const forms: string[] = [];
    for (let hour = -18; hour <= 18; hour++) {
      const sign = hour < 0 ? '-' : '+';
      const hh = String(Math.abs(hour)).padStart(2, '0');
      forms.push(`${sign}${hh}`, `${sign}${hh}00`, `${sign}${hh}:00`);
      if (Math.abs(hour) < 10) {
        forms.push(`${sign}${Math.abs(hour)}`);
      }
      if (Math.abs(hour) < 18) {
        forms.push(`${sign}${hh}:30`, `${sign}${hh}45`);
      }
    }
    const normalized = forms.map(normalizeTimeZone);
    expect(await rejectedByServer(normalized)).toEqual([]);
  });

  it('should accept every numeric offset from -18 to +18 hours', async () => {
    const minutes: number[] = [];
    for (let offset = -1080; offset <= 1080; offset += 15) {
      minutes.push(offset);
    }
    const normalized = minutes.map(normalizeTimeZone);
    expect(await rejectedByServer(normalized)).toEqual([]);
  });

  it('should reject what the server rejects (B-073)', async () => {
    // what the old code passed to the server for these inputs
    const oldOutputs = [
      '+05:30.5',
      '+NaN:NaN',
      '+1666:40',
      '+99:99',
      'Foo/Bar',
      'EST',
      'america/new_york',
    ];
    expect(await rejectedByServer(oldOutputs)).toEqual(oldOutputs);
    const inputs = [330.5, Number.NaN, 100000, '+99:99', 'Foo/Bar', 'EST'];
    for (const input of inputs) {
      expect(() => normalizeTimeZone(input)).toThrow(RangeError);
    }
  });
});
