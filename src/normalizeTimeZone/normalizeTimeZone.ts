const pad2 = (n: number) => {
  n = Math.abs(n);
  return `${n < 10 ? '0' : ''}${n}`;
};

/**
 * Get a timezone string from an integer offset in minutes
 * (positive is east of UTC)
 * @example
 *    -360 => -06:00
 *    330 => +05:30
 *    0 => +00:00
 * @param offset
 */
export function offsetMinutesToString(offset: number) {
  const sign = offset < 0 ? '-' : '+';
  const minutes = Math.abs(offset);
  const hour = Math.floor(minutes / 60);
  const min = minutes % 60;
  return `${sign}${pad2(hour)}:${pad2(min)}`;
}

// Normalize timezone: allow IANA, 'UTC'/'Z', ±HH:MM, or numeric minutes (e.g. -360 => '-06:00')
export function normalizeTimeZone(tz: string | number): string {
  if (typeof tz === 'number') {
    return offsetMinutesToString(tz);
  } // e.g. -360 => "-06:00"
  if (tz === 'UTC' || tz === 'Z') {
    return 'Z';
  }
  // IANA zone (very loose check), or explicit ±HH:MM
  const ianaLikely = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(tz);
  const offsetLike = /^[+-]\d{2}:\d{2}$/.test(tz);
  if (ianaLikely || offsetLike) {
    return tz;
  }
  throw new Error(
    `es-query-pro: timezone must be IANA (e.g. "America/New_York"), "UTC"/"Z", ` +
      `a string offset like "+02:00", or a numeric minute offset. Received ${String(tz).slice(0, 100)}`,
  );
}
