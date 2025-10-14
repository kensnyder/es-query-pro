export default function isEmptyObject(obj: any) {
  if (!obj || typeof obj !== 'object') {
    // not an object
    return false;
  }
  for (const prop in obj) {
    if (Object.hasOwn(obj, prop)) {
      // not empty
      return false;
    }
  }
  return true;
}
