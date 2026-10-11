import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  CurrencyMismatchError,
  InvalidMoneyJSONError,
  Money,
  MoneyAmountOutOfRangeError,
} from '../src/index.js';

const MIN_AMOUNT = -9223372036854775808n;
const MAX_AMOUNT = 9223372036854775807n;

// Include random values and important financial boundaries.
const amountArb = fc.oneof(
  fc.bigInt({
    min: MIN_AMOUNT,
    max: MAX_AMOUNT,
  }),
  fc.constantFrom(MIN_AMOUNT, MAX_AMOUNT, 0n, 1n, -1n),
);

const currencyArb = fc.constantFrom('PKR', 'USD', 'EUR', 'JPY', 'KWD');

const differentCurrencyPairArb = fc.constantFrom(
  ['PKR', 'USD'] as const,
  ['USD', 'EUR'] as const,
  ['EUR', 'JPY'] as const,
  ['KWD', 'PKR'] as const,
);

const PROPERTY_OPTIONS = {
  numRuns: 500,
};

describe('Money property-based invariants', () => {
  it('preserves exact values through JSON round-trips', () => {
    fc.assert(
      fc.property(amountArb, currencyArb, (amount, currency) => {
        const original = Money.of(amount, currency);

        const json = JSON.stringify(original);
        const parsed: unknown = JSON.parse(json);

        const restored = Money.fromJSON(parsed);

        expect(restored.equals(original)).toBe(true);
        expect(restored.amountMinor).toBe(amount);
        expect(restored.currency).toBe(currency);
        expect(original.toJSON().amount_minor).toBe(amount.toString());
      }),
      PROPERTY_OPTIONS,
    );
  });

  it('performs exact addition or rejects overflow', () => {
    fc.assert(
      fc.property(amountArb, amountArb, currencyArb, (a, b, currency) => {
        const left = Money.of(a, currency);
        const right = Money.of(b, currency);

        const expected = a + b;

        if (expected < MIN_AMOUNT || expected > MAX_AMOUNT) {
          expect(() => left.add(right)).toThrow(MoneyAmountOutOfRangeError);
          return;
        }

        const result = left.add(right);

        expect(result.amountMinor).toBe(expected);
        expect(result.currency).toBe(currency);

        // Addition must be commutative.
        expect(right.add(left).equals(result)).toBe(true);

        // Reversing addition recovers the original amount.
        expect(result.subtract(right).equals(left)).toBe(true);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it('performs exact subtraction or rejects out-of-range results', () => {
    fc.assert(
      fc.property(amountArb, amountArb, currencyArb, (a, b, currency) => {
        const left = Money.of(a, currency);
        const right = Money.of(b, currency);

        const expected = a - b;

        if (expected < MIN_AMOUNT || expected > MAX_AMOUNT) {
          expect(() => left.subtract(right)).toThrow(MoneyAmountOutOfRangeError);
          return;
        }

        const result = left.subtract(right);

        expect(result.amountMinor).toBe(expected);

        // Reversing subtraction recovers the original value.
        expect(result.add(right).equals(left)).toBe(true);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it('preserves numerical ordering and comparison symmetry', () => {
    fc.assert(
      fc.property(amountArb, amountArb, currencyArb, (a, b, currency) => {
        const left = Money.of(a, currency);
        const right = Money.of(b, currency);

        const expected = a < b ? -1 : a > b ? 1 : 0;

        expect(left.compare(right)).toBe(expected);

        // Reverse comparison must produce the opposite ordering.
        // Handle equality explicitly to avoid JavaScript negative zero.
        const reverseExpected = expected === 0 ? 0 : -expected;

        expect(right.compare(left)).toBe(reverseExpected);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it('negates exactly and rejects unrepresentable negation', () => {
    fc.assert(
      fc.property(amountArb, currencyArb, (amount, currency) => {
        const money = Money.of(amount, currency);

        if (amount === MIN_AMOUNT) {
          expect(() => money.negate()).toThrow(MoneyAmountOutOfRangeError);
          return;
        }

        const negated = money.negate();

        expect(negated.amountMinor).toBe(-amount);
        expect(negated.currency).toBe(currency);

        // Negating twice must restore the original value.
        expect(negated.negate().equals(money)).toBe(true);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it('uses value equality rather than object identity', () => {
    fc.assert(
      fc.property(amountArb, amountArb, currencyArb, (a, b, currency) => {
        const left = Money.of(a, currency);
        const sameValue = Money.of(a, currency);
        const right = Money.of(b, currency);

        expect(left.equals(sameValue)).toBe(true);
        expect(sameValue.equals(left)).toBe(true);

        expect(left.equals(right)).toBe(a === b);
        expect(left.equals(left)).toBe(true);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it('rejects arithmetic and comparison across currencies', () => {
    fc.assert(
      fc.property(amountArb, amountArb, differentCurrencyPairArb, (a, b, currencies) => {
        const [leftCurrency, rightCurrency] = currencies;

        const left = Money.of(a, leftCurrency);
        const right = Money.of(b, rightCurrency);

        expect(() => left.add(right)).toThrow(CurrencyMismatchError);

        expect(() => left.subtract(right)).toThrow(CurrencyMismatchError);

        expect(() => left.compare(right)).toThrow(CurrencyMismatchError);

        expect(left.equals(right)).toBe(false);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it('rejects non-canonical string representations', () => {
    fc.assert(
      fc.property(amountArb, currencyArb, (amount, currency) => {
        const canonical = amount.toString();

        expect(() =>
          Money.fromJSON({
            amount_minor: `${canonical}\n`,
            currency,
          }),
        ).toThrow(InvalidMoneyJSONError);

        expect(() =>
          Money.fromJSON({
            amount_minor: `0${canonical}`,
            currency,
          }),
        ).toThrow(InvalidMoneyJSONError);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it('does not mutate monetary operands', () => {
    const smallAmountArb = fc.bigInt({
      min: -1000000000000n,
      max: 1000000000000n,
    });

    fc.assert(
      fc.property(smallAmountArb, smallAmountArb, currencyArb, (a, b, currency) => {
        const left = Money.of(a, currency);
        const right = Money.of(b, currency);

        left.add(right);
        left.subtract(right);
        left.compare(right);
        left.equals(right);
        left.toJSON();

        expect(left.amountMinor).toBe(a);
        expect(right.amountMinor).toBe(b);
        expect(left.currency).toBe(currency);
        expect(right.currency).toBe(currency);
      }),
      PROPERTY_OPTIONS,
    );
  });
});
