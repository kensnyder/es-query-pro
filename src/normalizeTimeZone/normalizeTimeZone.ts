const pad2 = (n: number) => {
  n = Math.abs(n);
  return `${n < 10 ? '0' : ''}${n}`;
};

/**
 * Get a timezone string from integer offset
 * @example
 *    360 => -06:00
 *    -300 => +05:00
 *    0 => +00:00
 * @param offset
 */
export function offsetMinutesToString(offset: number) {
  const timezone = offset * -1;
  const sign = offset < 1 ? '-' : '+';
  const hour = Math.floor(timezone / 60);
  const min = timezone % 60;
  return `${sign}${pad2(hour)}:${pad2(min)}`;
}

// Normalize timezone: allow IANA, 'UTC'/'Z', ±HH:MM, or numeric minutes (e.g. -360 => '-06:00')
export function normalizeTimeZone(tz: string | number): string {
  if (typeof tz === 'number') {
    return offsetMinutesToString(tz);
  } // e.g. -360 => "-06:00"
  if (tz === 'UTC' || tz === 'Z') return 'Z';
  // IANA zone (very loose check), or explicit ±HH:MM
  const ianaLikely = /^[A-Za-z]+(?:\/[A-Za-z_+-]+)+$/.test(tz);
  const offsetLike = /^[+-]\d{2}:\d{2}$/.test(tz);
  if (ianaLikely || offsetLike) return tz;
  throw new Error(
    `QueryBuilder.dateHistogram(): timezone must be IANA (e.g. "America/Denver"), "UTC"/"Z", ` +
      `a string offset like "+02:00", or a numeric minute offset. Received ${JSON.stringify(tz)}`,
  );
}
