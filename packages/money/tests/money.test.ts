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
});
