import { describe, expect, it } from 'vitest';

import { Money } from '../src/money.js';

describe('Money', () => {
  describe('creation', () => {
    it('creates money using bigint minor units and currency', () => {
      const money = Money.of(250000n, 'PKR');

      expect(money.amountMinor).toBe(250000n);
      expect(money.currency).toBe('PKR');
    });

    it('preserves amounts larger than Number.MAX_SAFE_INTEGER exactly', () => {
      const amount = 9007199254740992n;

      const money = Money.of(amount, 'PKR');

      expect(money.amountMinor).toBe(amount);
    });

    it('allows zero', () => {
      const money = Money.of(0n, 'PKR');

      expect(money.amountMinor).toBe(0n);
    });

    it('allows negative amounts at the primitive level', () => {
      const money = Money.of(-500n, 'PKR');

      expect(money.amountMinor).toBe(-500n);
    });

    it.each(['', 'pkr', 'PK', 'PKRR', 'P1R', ' PKR '])(
      'rejects malformed currency code "%s"',
      (currency) => {
        expect(() => Money.of(100n, currency)).toThrow('Invalid currency code');
      },
    );

    it.each(['PKR', 'USD', 'EUR'])('accepts valid currency code "%s"', (currency) => {
      const money = Money.of(100n, currency);

      expect(money.currency).toBe(currency);
    });

    it('accepts the minimum supported minor-unit amount', () => {
      const money = Money.of(-9223372036854775808n, 'PKR');

      expect(money.amountMinor).toBe(-9223372036854775808n);
    });

    it('accepts the maximum supported minor-unit amount', () => {
      const money = Money.of(9223372036854775807n, 'PKR');

      expect(money.amountMinor).toBe(9223372036854775807n);
    });

    it('rejects an amount below the supported minor-unit range', () => {
      expect(() => Money.of(-9223372036854775809n, 'PKR')).toThrow(
        'Money amount is outside the supported range',
      );
    });

    it('rejects an amount above the supported minor-unit range', () => {
      expect(() => Money.of(9223372036854775808n, 'PKR')).toThrow(
        'Money amount is outside the supported range',
      );
    });
  });

  describe('addition', () => {
    it('adds money with the same currency', () => {
      const left = Money.of(1000n, 'PKR');
      const right = Money.of(250n, 'PKR');

      const result = left.add(right);

      expect(result.amountMinor).toBe(1250n);
      expect(result.currency).toBe('PKR');
    });

    it('adds negative money exactly', () => {
      const left = Money.of(1000n, 'PKR');
      const right = Money.of(-250n, 'PKR');

      const result = left.add(right);

      expect(result.amountMinor).toBe(750n);
    });

    it('rejects addition across different currencies', () => {
      const pkr = Money.of(1000n, 'PKR');
      const usd = Money.of(1000n, 'USD');

      expect(() => pkr.add(usd)).toThrow('Currency mismatch');
    });

    it('rejects addition when the result exceeds the supported range', () => {
      const maximum = Money.of(9223372036854775807n, 'PKR');
      const one = Money.of(1n, 'PKR');

      expect(() => maximum.add(one)).toThrow('Money amount is outside the supported range');
    });
  });

  describe('subtraction', () => {
    it('subtracts money with the same currency', () => {
      const left = Money.of(1000n, 'PKR');
      const right = Money.of(250n, 'PKR');

      const result = left.subtract(right);

      expect(result.amountMinor).toBe(750n);
      expect(result.currency).toBe('PKR');
    });

    it('can produce a negative result', () => {
      const left = Money.of(250n, 'PKR');
      const right = Money.of(1000n, 'PKR');

      const result = left.subtract(right);

      expect(result.amountMinor).toBe(-750n);
    });

    it('rejects subtraction across different currencies', () => {
      const pkr = Money.of(1000n, 'PKR');
      const usd = Money.of(100n, 'USD');

      expect(() => pkr.subtract(usd)).toThrow('Currency mismatch');
    });

    it('rejects subtraction when the result exceeds the supported range', () => {
      const minimum = Money.of(-9223372036854775808n, 'PKR');
      const one = Money.of(1n, 'PKR');

      expect(() => minimum.subtract(one)).toThrow('Money amount is outside the supported range');
    });
  });

  describe('equality', () => {
    it('returns true when amount and currency are equal', () => {
      const left = Money.of(1000n, 'PKR');
      const right = Money.of(1000n, 'PKR');

      expect(left.equals(right)).toBe(true);
    });

    it('returns false when amounts are different', () => {
      const left = Money.of(1000n, 'PKR');
      const right = Money.of(999n, 'PKR');

      expect(left.equals(right)).toBe(false);
    });

    it('returns false when currencies are different', () => {
      const pkr = Money.of(1000n, 'PKR');
      const usd = Money.of(1000n, 'USD');

      expect(pkr.equals(usd)).toBe(false);
    });
  });

  describe('zero', () => {
    it('returns true when the amount is zero', () => {
      const money = Money.of(0n, 'PKR');

      expect(money.isZero()).toBe(true);
    });

    it('returns false when the amount is positive', () => {
      const money = Money.of(1n, 'PKR');

      expect(money.isZero()).toBe(false);
    });

    it('returns false when the amount is negative', () => {
      const money = Money.of(-1n, 'PKR');

      expect(money.isZero()).toBe(false);
    });
  });

  describe('negation', () => {
    it('negates a positive amount', () => {
      const money = Money.of(500n, 'PKR');

      const result = money.negate();

      expect(result.amountMinor).toBe(-500n);
      expect(result.currency).toBe('PKR');
    });

    it('negates a negative amount', () => {
      const money = Money.of(-500n, 'PKR');

      const result = money.negate();

      expect(result.amountMinor).toBe(500n);
      expect(result.currency).toBe('PKR');
    });

    it('keeps zero as zero when negated', () => {
      const money = Money.of(0n, 'PKR');

      const result = money.negate();

      expect(result.amountMinor).toBe(0n);
    });

    it('rejects negation when the result exceeds the supported range', () => {
      const minimum = Money.of(-9223372036854775808n, 'PKR');

      expect(() => minimum.negate()).toThrow('Money amount is outside the supported range');
    });
  });
});
