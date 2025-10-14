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
export default function offsetIntToString(offset: number) {
  const timezone = offset * -1;
  const sign = offset < 1 ? '-' : '+';
  const hour = Math.floor(timezone / 60);
  const min = timezone % 60;
  return `${sign}${pad2(hour)}:${pad2(min)}`;
}
