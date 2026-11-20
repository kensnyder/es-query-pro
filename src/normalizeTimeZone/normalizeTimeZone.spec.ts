import { describe, expect, it } from 'bun:test';
import { normalizeTimeZone, offsetMinutesToString } from './normalizeTimeZone';

describe('offsetMinutesToString', () => {
  it('should convert negative whole-hour offsets', () => {
    expect(offsetMinutesToString(-360)).toBe('-06:00');
    expect(offsetMinutesToString(-300)).toBe('-05:00');
    expect(offsetMinutesToString(-60)).toBe('-01:00');
  });

  it('should convert positive whole-hour offsets', () => {
    expect(offsetMinutesToString(60)).toBe('+01:00');
    expect(offsetMinutesToString(120)).toBe('+02:00');
  });

  it('should handle two-digit hours', () => {
    expect(offsetMinutesToString(600)).toBe('+10:00');
    expect(offsetMinutesToString(840)).toBe('+14:00');
    expect(offsetMinutesToString(-720)).toBe('-12:00');
  });

  it('should convert negative offsets with partial hours', () => {
    expect(offsetMinutesToString(-30)).toBe('-00:30');
    expect(offsetMinutesToString(-210)).toBe('-03:30');
    expect(offsetMinutesToString(-570)).toBe('-09:30');
  });

  it('should convert positive offsets with partial hours', () => {
    expect(offsetMinutesToString(30)).toBe('+00:30');
    expect(offsetMinutesToString(330)).toBe('+05:30');
    expect(offsetMinutesToString(345)).toBe('+05:45');
  });

  it('should convert zero, including -0, to +00:00', () => {
    expect(offsetMinutesToString(0)).toBe('+00:00');
    expect(offsetMinutesToString(-0)).toBe('+00:00');
  });

  it('should accept the ±18 hour limit of Elasticsearch', () => {
    expect(offsetMinutesToString(1080)).toBe('+18:00');
    expect(offsetMinutesToString(-1080)).toBe('-18:00');
  });

  it('should reject numbers that are not whole minutes', () => {
    expect(() => offsetMinutesToString(330.5)).toThrow(RangeError);
    expect(() => offsetMinutesToString(Number.NaN)).toThrow(RangeError);
    expect(() => offsetMinutesToString(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });

  it('should reject offsets beyond ±18 hours', () => {
    expect(() => offsetMinutesToString(1081)).toThrow(RangeError);
    expect(() => offsetMinutesToString(-1081)).toThrow(RangeError);
    expect(() => offsetMinutesToString(100000)).toThrow(
      /between -1080 and 1080.*Received 100000$/,
    );
  });
});

describe('normalizeTimeZone', () => {
  describe('numeric offsets', () => {
    it('should convert minutes east of UTC to an offset string', () => {
      expect(normalizeTimeZone(-360)).toBe('-06:00');
      expect(normalizeTimeZone(120)).toBe('+02:00');
    });

    it('should not match the sign of Date#getTimezoneOffset()', () => {
      // getTimezoneOffset() is minutes *west* of UTC: negate it first
      const westOfUtc = 300; // what New York returns in winter
      expect(normalizeTimeZone(-westOfUtc)).toBe('-05:00');
    });

    it('should reject fractional, non-finite and out-of-range numbers', () => {
      expect(() => normalizeTimeZone(330.5)).toThrow(RangeError);
      expect(() => normalizeTimeZone(Number.NaN)).toThrow(RangeError);
      expect(() => normalizeTimeZone(100000)).toThrow(RangeError);
      expect(() => normalizeTimeZone(-1081)).toThrow(RangeError);
    });
  });

  describe('UTC', () => {
    it('should normalize "UTC" to "Z"', () => {
      expect(normalizeTimeZone('UTC')).toBe('Z');
    });

    it('should pass "Z" through', () => {
      expect(normalizeTimeZone('Z')).toBe('Z');
    });

    it('should reject lowercase variants', () => {
      expect(() => normalizeTimeZone('utc')).toThrow(RangeError);
      expect(() => normalizeTimeZone('z')).toThrow(RangeError);
    });
  });

  describe('IANA zones', () => {
    it('should pass through two-segment zones', () => {
      expect(normalizeTimeZone('America/New_York')).toBe('America/New_York');
      expect(normalizeTimeZone('Europe/London')).toBe('Europe/London');
    });

    it('should pass through three-segment zones', () => {
      expect(normalizeTimeZone('America/Argentina/Buenos_Aires')).toBe(
        'America/Argentina/Buenos_Aires',
      );
    });

    it('should pass through zones containing a hyphen', () => {
      expect(normalizeTimeZone('America/Port-au-Prince')).toBe(
        'America/Port-au-Prince',
      );
    });

    it('should pass through zones containing digits', () => {
      expect(normalizeTimeZone('Etc/GMT+6')).toBe('Etc/GMT+6');
      expect(normalizeTimeZone('Etc/GMT-14')).toBe('Etc/GMT-14');
    });

    it('should pass through single-segment zones and aliases', () => {
      expect(normalizeTimeZone('GMT')).toBe('GMT');
      expect(normalizeTimeZone('CET')).toBe('CET');
      expect(normalizeTimeZone('Etc/UTC')).toBe('Etc/UTC');
      expect(normalizeTimeZone('US/Eastern')).toBe('US/Eastern');
      expect(normalizeTimeZone('Asia/Calcutta')).toBe('Asia/Calcutta');
    });

    it('should pass through POSIX-style zones that Java knows', () => {
      expect(normalizeTimeZone('EST5EDT')).toBe('EST5EDT');
      expect(normalizeTimeZone('CST6CDT')).toBe('CST6CDT');
      expect(normalizeTimeZone('MST7MDT')).toBe('MST7MDT');
      expect(normalizeTimeZone('PST8PDT')).toBe('PST8PDT');
    });

    it('should reject zone names that do not exist', () => {
      expect(() => normalizeTimeZone('Foo/Bar')).toThrow(RangeError);
      expect(() => normalizeTimeZone('America/Nowhere')).toThrow(RangeError);
    });

    it('should reject zone names in the wrong case', () => {
      expect(() => normalizeTimeZone('america/new_york')).toThrow(RangeError);
      expect(() => normalizeTimeZone('America/new_york')).toThrow(RangeError);
      expect(() => normalizeTimeZone('gmt')).toThrow(RangeError);
    });

    it('should reject names that Elasticsearch rejects', () => {
      expect(() => normalizeTimeZone('EST')).toThrow(RangeError);
      expect(() => normalizeTimeZone('MST')).toThrow(RangeError);
      expect(() => normalizeTimeZone('HST')).toThrow(RangeError);
      expect(() => normalizeTimeZone('ROC')).toThrow(RangeError);
      expect(() => normalizeTimeZone('PST')).toThrow(RangeError);
    });
  });

  describe('string offsets', () => {
    it('should pass through ±HH:MM offsets', () => {
      expect(normalizeTimeZone('+02:00')).toBe('+02:00');
      expect(normalizeTimeZone('-06:00')).toBe('-06:00');
      expect(normalizeTimeZone('+00:00')).toBe('+00:00');
      expect(normalizeTimeZone('+05:30')).toBe('+05:30');
    });

    it('should normalize ±HHMM, ±HH and ±H offsets to ±HH:MM', () => {
      expect(normalizeTimeZone('+0530')).toBe('+05:30');
      expect(normalizeTimeZone('-0930')).toBe('-09:30');
      expect(normalizeTimeZone('+05')).toBe('+05:00');
      expect(normalizeTimeZone('-5')).toBe('-05:00');
      expect(normalizeTimeZone('-00:00')).toBe('+00:00');
    });

    it('should accept the ±18 hour limit of Elasticsearch', () => {
      expect(normalizeTimeZone('+18:00')).toBe('+18:00');
      expect(normalizeTimeZone('-18')).toBe('-18:00');
    });

    it('should reject impossible offsets', () => {
      expect(() => normalizeTimeZone('+99:99')).toThrow(RangeError);
      expect(() => normalizeTimeZone('+05:60')).toThrow(RangeError);
      expect(() => normalizeTimeZone('+18:01')).toThrow(RangeError);
      expect(() => normalizeTimeZone('+19')).toThrow(RangeError);
      expect(() => normalizeTimeZone('-1900')).toThrow(RangeError);
    });

    it('should reject malformed offsets', () => {
      expect(() => normalizeTimeZone('06:00')).toThrow(RangeError);
      expect(() => normalizeTimeZone('+2:00')).toThrow(RangeError);
      expect(() => normalizeTimeZone('+020')).toThrow(RangeError);
      expect(() => normalizeTimeZone('+02:0')).toThrow(RangeError);
      expect(() => normalizeTimeZone('+02:00:00')).toThrow(RangeError);
      expect(() => normalizeTimeZone('GMT+5')).toThrow(RangeError);
    });
  });

  describe('invalid input', () => {
    it('should reject an empty string', () => {
      expect(() => normalizeTimeZone('')).toThrow(RangeError);
    });

    it('should reject malformed zone names', () => {
      expect(() => normalizeTimeZone('America/')).toThrow(RangeError);
      expect(() => normalizeTimeZone('/New_York')).toThrow(RangeError);
      expect(() => normalizeTimeZone('America/New York')).toThrow(RangeError);
      expect(() => normalizeTimeZone(' America/Denver ')).toThrow(RangeError);
    });

    it('should reject values that are neither strings nor numbers', () => {
      expect(() => normalizeTimeZone(null as unknown as string)).toThrow(
        TypeError,
      );
      expect(() => normalizeTimeZone({} as unknown as string)).toThrow(
        TypeError,
      );
    });

    it('should explain the accepted formats and echo the input', () => {
      expect(() => normalizeTimeZone('not a zone')).toThrow(
        /timezone must be IANA.*Received not a zone$/,
      );
    });

    it('should truncate long input in the error message', () => {
      const long = 'x'.repeat(500);
      expect(() => normalizeTimeZone(long)).toThrow(/Received x{100}$/);
    });
  });
});
