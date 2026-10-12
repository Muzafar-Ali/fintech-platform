import { describe, expect, it } from 'vitest';

import { formatPgInt8, InvalidPgInt8Error, parsePgInt8 } from '../src/index.js';

const MIN_INT8 = -9223372036854775808n;
const MAX_INT8 = 9223372036854775807n;

describe('PostgreSQL BIGINT mapping', () => {
  describe('parsePgInt8', () => {
    it.each([
      { input: '0', expected: 0n },
      { input: '1', expected: 1n },
      { input: '-1', expected: -1n },
      { input: '9007199254740993', expected: 9007199254740993n },
      { input: '9223372036854775807', expected: MAX_INT8 },
      { input: '-9223372036854775808', expected: MIN_INT8 },
    ])('parses "$input" exactly', ({ input, expected }) => {
      expect(parsePgInt8(input)).toBe(expected);
    });

    it.each([
      { name: 'null', input: null },
      { name: 'undefined', input: undefined },
      { name: 'number', input: 100 },
      { name: 'bigint', input: 100n },
      { name: 'array', input: [] },
      { name: 'object', input: {} },
      { name: 'boolean', input: true },
    ])('rejects $name input', ({ input }) => {
      expect(() => parsePgInt8(input)).toThrow(InvalidPgInt8Error);
    });

    it.each(['', ' ', '01', '-01', '-0', '+100', '1.5', '1e3', '0x10', ' 100', '100 ', '100\n'])(
      'rejects non-canonical value "%s"',
      (input) => {
        expect(() => parsePgInt8(input)).toThrow(InvalidPgInt8Error);
      },
    );

    it.each(['9223372036854775808', '-9223372036854775809'])(
      'rejects out-of-range value "%s"',
      (input) => {
        expect(() => parsePgInt8(input)).toThrow(InvalidPgInt8Error);
      },
    );

    it('rejects excessively long numeric strings', () => {
      const input = '9'.repeat(100_000);

      expect(() => parsePgInt8(input)).toThrow(InvalidPgInt8Error);
    });
  });

  describe('formatPgInt8', () => {
    it.each([
      { input: 0n, expected: '0' },
      { input: 1n, expected: '1' },
      { input: -1n, expected: '-1' },
      { input: 9007199254740993n, expected: '9007199254740993' },
      { input: MAX_INT8, expected: '9223372036854775807' },
      { input: MIN_INT8, expected: '-9223372036854775808' },
    ])('formats $expected exactly', ({ input, expected }) => {
      expect(formatPgInt8(input)).toBe(expected);
    });

    it.each([MAX_INT8 + 1n, MIN_INT8 - 1n])('rejects out-of-range bigint %s', (amount) => {
      expect(() => formatPgInt8(amount)).toThrow(InvalidPgInt8Error);
    });

    it('round-trips a large value without precision loss', () => {
      const original = 9007199254740993n;

      const serialized = formatPgInt8(original);
      const restored = parsePgInt8(serialized);

      expect(restored).toBe(original);
    });
  });
});
