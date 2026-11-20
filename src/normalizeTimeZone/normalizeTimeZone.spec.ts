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

  it('should convert zero to +00:00', () => {
    expect(offsetMinutesToString(0)).toBe('+00:00');
  });
});

describe('normalizeTimeZone', () => {
  describe('numeric offsets', () => {
    it('should convert minutes to an offset string', () => {
      expect(normalizeTimeZone(-360)).toBe('-06:00');
      expect(normalizeTimeZone(120)).toBe('+02:00');
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
      expect(() => normalizeTimeZone('utc')).toThrow();
      expect(() => normalizeTimeZone('z')).toThrow();
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
  });

  describe('string offsets', () => {
    it('should pass through ±HH:MM offsets', () => {
      expect(normalizeTimeZone('+02:00')).toBe('+02:00');
      expect(normalizeTimeZone('-06:00')).toBe('-06:00');
      expect(normalizeTimeZone('+00:00')).toBe('+00:00');
      expect(normalizeTimeZone('+05:30')).toBe('+05:30');
    });

    it('should reject malformed offsets', () => {
      expect(() => normalizeTimeZone('06:00')).toThrow();
      expect(() => normalizeTimeZone('+2:00')).toThrow();
      expect(() => normalizeTimeZone('+0200')).toThrow();
      expect(() => normalizeTimeZone('+02')).toThrow();
      expect(() => normalizeTimeZone('+02:00:00')).toThrow();
    });
  });

  describe('invalid input', () => {
    it('should reject an empty string', () => {
      expect(() => normalizeTimeZone('')).toThrow();
    });

    it('should reject abbreviations without a slash', () => {
      expect(() => normalizeTimeZone('EST')).toThrow();
      expect(() => normalizeTimeZone('GMT')).toThrow();
    });

    it('should reject malformed zone names', () => {
      expect(() => normalizeTimeZone('America/')).toThrow();
      expect(() => normalizeTimeZone('/New_York')).toThrow();
      expect(() => normalizeTimeZone('America/New York')).toThrow();
      expect(() => normalizeTimeZone(' America/Denver ')).toThrow();
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
