/**
 * Return true if value is not null and not undefined. A type guard, so it
 * narrows `T | null | undefined` to `T` (also in `array.filter(isDefined)`).
 * @param value  The value to check
 */
export default function isDefined<T>(value: T): value is NonNullable<T> {
  return value !== null && value !== undefined;
}
