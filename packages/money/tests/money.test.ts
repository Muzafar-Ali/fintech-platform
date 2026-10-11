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

  describe('serialization', () => {
    it('serializes positive money using a decimal string', () => {
      const money = Money.of(250000n, 'PKR');

      expect(money.toJSON()).toEqual({
        amount_minor: '250000',
        currency: 'PKR',
      });
    });

    it('serializes zero correctly', () => {
      const money = Money.of(0n, 'USD');

      expect(money.toJSON()).toEqual({
        amount_minor: '0',
        currency: 'USD',
      });
    });

    it('serializes negative money correctly', () => {
      const money = Money.of(-500n, 'PKR');

      expect(money.toJSON()).toEqual({
        amount_minor: '-500',
        currency: 'PKR',
      });
    });

    it('preserves large monetary amounts exactly', () => {
      const money = Money.of(9223372036854775807n, 'PKR');

      const result = money.toJSON();

      expect(result.amount_minor).toBe('9223372036854775807');
      expect(typeof result.amount_minor).toBe('string');
    });

    it('supports native JSON.stringify without bigint errors', () => {
      const money = Money.of(250000n, 'PKR');

      const serialized = JSON.stringify(money);
      const parsed: unknown = JSON.parse(serialized);

      expect(parsed).toEqual({
        amount_minor: '250000',
        currency: 'PKR',
      });
    });
  });

  describe('deserialization', () => {
    it('restores a positive monetary amount', () => {
      const money = Money.fromJSON({
        amount_minor: '250000',
        currency: 'PKR',
      });

      expect(money.amountMinor).toBe(250000n);
      expect(money.currency).toBe('PKR');
    });

    it('restores zero', () => {
      const money = Money.fromJSON({
        amount_minor: '0',
        currency: 'USD',
      });

      expect(money.amountMinor).toBe(0n);
    });

    it('restores negative monetary amounts', () => {
      const money = Money.fromJSON({
        amount_minor: '-500',
        currency: 'PKR',
      });

      expect(money.amountMinor).toBe(-500n);
    });

    it('restores the maximum supported amount exactly', () => {
      const money = Money.fromJSON({
        amount_minor: '9223372036854775807',
        currency: 'PKR',
      });

      expect(money.amountMinor).toBe(9223372036854775807n);
    });

    it('restores the minimum supported amount exactly', () => {
      const money = Money.fromJSON({
        amount_minor: '-9223372036854775808',
        currency: 'PKR',
      });

      expect(money.amountMinor).toBe(-9223372036854775808n);
    });

    it('round-trips through native JSON without losing precision', () => {
      const original = Money.of(9007199254740993n, 'PKR');

      const serialized = JSON.stringify(original);
      const parsed: unknown = JSON.parse(serialized);

      const restored = Money.fromJSON(parsed);

      expect(restored.equals(original)).toBe(true);
    });

    it.each([
      { name: 'null', payload: null },
      { name: 'array', payload: [] },
      { name: 'string', payload: '100' },
      { name: 'empty object', payload: {} },
      { name: 'missing amount', payload: { currency: 'PKR' } },
      { name: 'missing currency', payload: { amount_minor: '100' } },
      { name: 'numeric amount', payload: { amount_minor: 100, currency: 'PKR' } },
      { name: 'bigint amount', payload: { amount_minor: 100n, currency: 'PKR' } },
      { name: 'null amount', payload: { amount_minor: null, currency: 'PKR' } },
      { name: 'numeric currency', payload: { amount_minor: '100', currency: 123 } },
    ])('rejects malformed JSON shape: $name', ({ payload }) => {
      expect(() => Money.fromJSON(payload)).toThrow('Invalid money JSON');
    });

    it.each(['', ' ', '01', '-01', '+100', '-0', '1.5', '1e3', ' 100', '100 ', '1_000', '--5'])(
      'rejects non-canonical monetary string "%s"',
      (amount) => {
        expect(() =>
          Money.fromJSON({
            amount_minor: amount,
            currency: 'PKR',
          }),
        ).toThrow('Invalid money JSON');
      },
    );

    it.each(['pkr', 'US'])('rejects malformed currency "%s"', (currency) => {
      expect(() =>
        Money.fromJSON({
          amount_minor: '100',
          currency,
        }),
      ).toThrow('Invalid currency code');
    });

    it.each(['9223372036854775808', '-9223372036854775809'])(
      'rejects an out-of-range amount "%s"',
      (amount) => {
        expect(() =>
          Money.fromJSON({
            amount_minor: amount,
            currency: 'PKR',
          }),
        ).toThrow('Money amount is outside the supported range');
      },
    );
  });

  describe('deserialization hardening', () => {
    it.each(['100\n', '100\r', '100\r\n', '100\t', '100\n\n'])(
      'rejects monetary strings containing trailing control characters',
      (amount) => {
        expect(() =>
          Money.fromJSON({
            amount_minor: amount,
            currency: 'PKR',
          }),
        ).toThrow('Invalid money JSON');
      },
    );

    it('rejects monetary strings exceeding the maximum supported length', () => {
      const oversizedAmount = '9'.repeat(100_000);

      expect(() =>
        Money.fromJSON({
          amount_minor: oversizedAmount,
          currency: 'PKR',
        }),
      ).toThrow('Invalid money JSON');
    });

    it('continues accepting the longest valid negative amount', () => {
      const money = Money.fromJSON({
        amount_minor: '-9223372036854775808',
        currency: 'PKR',
      });

      expect(money.amountMinor).toBe(-9223372036854775808n);
    });
  });
});
