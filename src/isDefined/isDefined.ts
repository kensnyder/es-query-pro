/**
 * Return true if value is not null and not undefined
 * @param value
 */
export default function isDefined(value: any) {
  return value !== null && value !== undefined;
}
