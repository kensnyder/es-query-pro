/** Elasticsearch (Java `ZoneOffset`) accepts offsets up to ±18:00. */
const MAX_OFFSET_MINUTES = 18 * 60;

/**
 * Names that the JavaScript `Intl` API accepts but Elasticsearch rejects
 * (Java's ambiguous short IDs, and `ROC`, which Java's time zone data omits).
 */
const REJECTED_BY_ELASTICSEARCH = new Set(['EST', 'MST', 'HST', 'ROC']);

/**
 * POSIX-style names that Elasticsearch accepts but some `Intl`
 * implementations (Bun among them) no longer list.
 */
const POSIX_STYLE_ZONES = new Set(['EST5EDT', 'CST6CDT', 'MST7MDT', 'PST8PDT']);

/** Every segment of a zone name starts with an upper-case letter. */
const ZONE_NAME = /^[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z][A-Za-z0-9_+-]*)*$/;

/** `±H`, `±HH`, `±HHMM` or `±HH:MM` */
const STRING_OFFSET = /^([+-])(?:(\d)|(\d{2})(?::?(\d{2}))?)$/;

const FORMATS =
  'es-query-pro: timezone must be IANA (e.g. "America/New_York"), "UTC"/"Z", ' +
  'a string offset like "+05:30", "+0530" or "+05", or a whole number of ' +
  'minutes east of UTC.';

const pad2 = (n: number) => {
  return String(Math.abs(n)).padStart(2, '0');
};

const received = (tz: unknown) => {
  return `Received ${String(tz).slice(0, 100)}`;
};

/**
 * Get a timezone string from a whole number of minutes **east** of UTC.
 *
 * The sign is the opposite of `Date#getTimezoneOffset()`, which counts
 * minutes *west* of UTC: pass `-date.getTimezoneOffset()`.
 * @example
 *    -360 => -06:00
 *    330 => +05:30
 *    0 => +00:00
 * @param offset  Minutes east of UTC, an integer from -1080 to 1080
 * @throws {RangeError} if offset is not an integer or is beyond ±18 hours
 */
export function offsetMinutesToString(offset: number) {
  if (!Number.isInteger(offset) || Math.abs(offset) > MAX_OFFSET_MINUTES) {
    throw new RangeError(
      `es-query-pro: a numeric timezone must be a whole number of minutes ` +
        `east of UTC between -${MAX_OFFSET_MINUTES} and ` +
        `${MAX_OFFSET_MINUTES}. ${received(offset)}`,
    );
  }
  const sign = offset < 0 ? '-' : '+';
  const minutes = Math.abs(offset);
  const hour = Math.floor(minutes / 60);
  const min = minutes % 60;
  return `${sign}${pad2(hour)}:${pad2(min)}`;
}

/**
 * Parse `±H`, `±HH`, `±HHMM` or `±HH:MM` into minutes east of UTC.
 * Returns null if the string has another shape.
 */
function parseStringOffset(tz: string) {
  const match = STRING_OFFSET.exec(tz);
  if (!match) {
    return null;
  }
  const [, sign, oneDigitHour, twoDigitHour, minutes = '0'] = match;
  const hours = Number(oneDigitHour ?? twoDigitHour);
  const mins = Number(minutes);
  if (mins >= 60) {
    return Number.NaN;
  }
  const total = hours * 60 + mins;
  return sign === '-' ? -total : total;
}

/**
 * True if the JavaScript runtime knows the zone under exactly this name
 * (`Intl` also accepts names in the wrong case, which Elasticsearch rejects).
 */
function isKnownZone(tz: string) {
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions()
      .timeZone;
  } catch {
    return false;
  }
  const sameIgnoringCase = resolved.toLowerCase() === tz.toLowerCase();
  return resolved === tz || !sameIgnoringCase;
}

/**
 * Validate a timezone for Elasticsearch's `time_zone` parameter and return it
 * in a form Elasticsearch accepts.
 *
 * Accepted forms:
 * - an IANA zone name such as `"America/New_York"`, and the other names both
 *   the JavaScript runtime and Elasticsearch know (`"GMT"`, `"CET"`,
 *   `"EST5EDT"`, `"US/Eastern"`, ...); names are case-sensitive. The
 *   ambiguous `"EST"`, `"MST"` and `"HST"` are rejected, as Elasticsearch
 *   does. Returned as given.
 * - `"UTC"` or `"Z"`, returned as `"Z"`.
 * - a string offset `±HH:MM`, `±HHMM`, `±HH` or `±H`, up to ±18:00,
 *   returned as `±HH:MM`.
 * - a number of minutes **east** of UTC, e.g. `-360` for `"-06:00"`. This is
 *   the opposite sign of `Date#getTimezoneOffset()`.
 *
 * Prefer zone names: a fixed offset does not follow daylight saving time, so
 * day and month buckets shift by an hour for part of the year.
 * @param tz  The timezone
 * @throws {RangeError} if tz is not one of the accepted forms
 * @throws {TypeError} if tz is neither a string nor a number
 */
export function normalizeTimeZone(tz: string | number): string {
  if (typeof tz === 'number') {
    return offsetMinutesToString(tz);
  }
  if (typeof tz !== 'string') {
    throw new TypeError(`${FORMATS} ${received(tz)}`);
  }
  if (tz === 'UTC' || tz === 'Z') {
    return 'Z';
  }
  const offset = parseStringOffset(tz);
  if (offset !== null) {
    if (Number.isNaN(offset) || Math.abs(offset) > MAX_OFFSET_MINUTES) {
      throw new RangeError(
        `es-query-pro: a timezone offset must be at most ±18:00 with ` +
          `minutes below 60. ${received(tz)}`,
      );
    }
    return offsetMinutesToString(offset);
  }
  if (!ZONE_NAME.test(tz) || REJECTED_BY_ELASTICSEARCH.has(tz)) {
    throw new RangeError(`${FORMATS} ${received(tz)}`);
  }
  if (POSIX_STYLE_ZONES.has(tz) || isKnownZone(tz)) {
    return tz;
  }
  throw new RangeError(`${FORMATS} ${received(tz)}`);
}
