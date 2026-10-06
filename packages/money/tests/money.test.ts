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
  });
});
