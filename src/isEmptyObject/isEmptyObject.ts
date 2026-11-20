/**
 * Return true if value is a plain object (an object literal, or one created
 * with `Object.create(null)`) with no own keys, including symbol and
 * non-enumerable keys. Arrays, Dates, Maps, Sets, class instances and
 * primitives return false.
 * @param value  The value to check
 */
export default function isEmptyObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return false;
  }
  return Reflect.ownKeys(value).length === 0;
}
