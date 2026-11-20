import { describe, expect, it } from 'bun:test';
import isEmptyObject from './isEmptyObject';

describe('isEmptyObject', () => {
  it('should be a function', () => {
    expect(isEmptyObject).toBeInstanceOf(Function);
  });

  it('should reject falsy values and primitives', () => {
    expect(isEmptyObject(false)).toBe(false);
    expect(isEmptyObject(null)).toBe(false);
    expect(isEmptyObject(undefined)).toBe(false);
    expect(isEmptyObject(0)).toBe(false);
    expect(isEmptyObject('')).toBe(false);
  });

  it('should identify empty literals', () => {
    expect(isEmptyObject({})).toBe(true);
  });

  it('should identify empty null-prototype objects', () => {
    expect(isEmptyObject(Object.create(null))).toBe(true);
  });

  it('should identify non-empty literals', () => {
    expect(isEmptyObject({ a: 1 })).toBe(false);
    expect(isEmptyObject({ a: undefined })).toBe(false);
  });

  it('should treat symbol keys and non-enumerable keys as content', () => {
    expect(isEmptyObject({ [Symbol('s')]: 1 })).toBe(false);
    const hidden = {};
    Object.defineProperty(hidden, 'a', { value: 1, enumerable: false });
    expect(isEmptyObject(hidden)).toBe(false);
  });

  it('should reject objects that inherit from another object', () => {
    // no own keys, but its prototype is neither Object.prototype nor null
    const child = Object.create({ a: 1 });
    expect(isEmptyObject(child)).toBe(false);
  });

  it('should reject arrays, even empty ones', () => {
    expect(isEmptyObject([])).toBe(false);
    expect(isEmptyObject([1])).toBe(false);
  });

  it('should reject Dates, Maps, Sets and other built-ins', () => {
    expect(isEmptyObject(new Date())).toBe(false);
    expect(isEmptyObject(new Map())).toBe(false);
    expect(isEmptyObject(new Map([[1, 2]]))).toBe(false);
    expect(isEmptyObject(new Set([1]))).toBe(false);
    expect(isEmptyObject(/x/)).toBe(false);
    expect(isEmptyObject(() => {})).toBe(false);
  });

  it('should reject class instances, which are not plain objects', () => {
    class Empty {}
    expect(isEmptyObject(new Empty())).toBe(false);
  });
});
