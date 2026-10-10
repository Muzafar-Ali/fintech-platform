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

  describe('comparison', () => {
    it('returns zero when both amounts are equal', () => {
      const left = Money.of(1000n, 'PKR');
      const right = Money.of(1000n, 'PKR');

      expect(left.compare(right)).toBe(0);
    });

    it('returns -1 when the left amount is smaller', () => {
      const left = Money.of(500n, 'PKR');
      const right = Money.of(1000n, 'PKR');

      expect(left.compare(right)).toBe(-1);
    });

    it('returns 1 when the left amount is greater', () => {
      const left = Money.of(1500n, 'PKR');
      const right = Money.of(1000n, 'PKR');

      expect(left.compare(right)).toBe(1);
    });

    it('compares negative amounts correctly', () => {
      const left = Money.of(-1000n, 'PKR');
      const right = Money.of(-500n, 'PKR');

      expect(left.compare(right)).toBe(-1);
      expect(right.compare(left)).toBe(1);
    });

    it('compares zero against negative amounts', () => {
      const zero = Money.of(0n, 'PKR');
      const negative = Money.of(-100n, 'PKR');

      expect(zero.compare(negative)).toBe(1);
      expect(negative.compare(zero)).toBe(-1);
    });

    it('compares integers beyond Number.MAX_SAFE_INTEGER exactly', () => {
      const left = Money.of(9007199254740992n, 'PKR');
      const right = Money.of(9007199254740993n, 'PKR');

      expect(left.compare(right)).toBe(-1);
      expect(right.compare(left)).toBe(1);
    });

    it('compares the minimum and maximum supported amounts', () => {
      const minimum = Money.of(-9223372036854775808n, 'PKR');
      const maximum = Money.of(9223372036854775807n, 'PKR');

      expect(minimum.compare(maximum)).toBe(-1);
      expect(maximum.compare(minimum)).toBe(1);
    });

    it('rejects comparison across different currencies', () => {
      const pkr = Money.of(1000n, 'PKR');
      const usd = Money.of(1000n, 'USD');

      expect(() => pkr.compare(usd)).toThrow('Currency mismatch');
    });

    it('does not mutate either money object during comparison', () => {
      const left = Money.of(1000n, 'PKR');
      const right = Money.of(2000n, 'PKR');

      left.compare(right);

      expect(left.amountMinor).toBe(1000n);
      expect(right.amountMinor).toBe(2000n);
      expect(left.currency).toBe('PKR');
      expect(right.currency).toBe('PKR');
    });
  });
});
