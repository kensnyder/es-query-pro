import { describe, expect, expectTypeOf, it } from 'bun:test';
import isDefined from './isDefined';

describe('isDefined', () => {
  it('should reject null and undefined', () => {
    expect(isDefined(null)).toBe(false);
    expect(isDefined(undefined)).toBe(false);
  });

  it('should accept falsy values that are defined', () => {
    expect(isDefined(0)).toBe(true);
    expect(isDefined('')).toBe(true);
    expect(isDefined(false)).toBe(true);
    expect(isDefined(Number.NaN)).toBe(true);
  });

  it('should accept objects', () => {
    expect(isDefined({})).toBe(true);
    expect(isDefined([])).toBe(true);
  });

  it('should narrow away null and undefined', () => {
    const value = [1, null, undefined][0] as number | null | undefined;
    if (isDefined(value)) {
      expectTypeOf(value).toEqualTypeOf<number>();
    }
    const defined = [1, null, 2, undefined].filter(isDefined);
    expectTypeOf(defined).toEqualTypeOf<number[]>();
    expect(defined).toEqual([1, 2]);
  });
});
