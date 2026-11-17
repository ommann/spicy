import { describe, expect, it } from 'vitest';
import { requiredMapValue } from '../../shared/required-map-value.ts';

describe('requiredMapValue', () => {
  it('returns present values, including falsy values', () => {
    const values = new Map<string, number | string | boolean | null>([
      ['zero', 0], ['empty', ''], ['false', false], ['null', null],
    ]);
    expect(requiredMapValue(values, 'zero')).toBe(0);
    expect(requiredMapValue(values, 'empty')).toBe('');
    expect(requiredMapValue(values, 'false')).toBe(false);
    expect(requiredMapValue(values, 'null')).toBeNull();
  });

  it('throws when a required key is missing instead of returning an unchecked value', () => {
    expect(() => requiredMapValue(new Map<string, number>(), 'missing'))
      .toThrow('Missing required map value: missing');
  });

  it('rejects an undefined value even when the key is present', () => {
    expect(() => requiredMapValue(new Map([['undefined', undefined]]), 'undefined'))
      .toThrow('Missing required map value: undefined');
  });
});
