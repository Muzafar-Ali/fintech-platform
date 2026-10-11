import { CurrencyMismatchError } from './errors/currency-mismatch.error.js';
import { InvalidCurrencyCodeError } from './errors/invalid-currency-code.error.js';
import { InvalidMoneyJSONError } from './errors/invalid-money-json.error.js';
import { MoneyAmountOutOfRangeError } from './errors/money-amount-out-of-range.error.js';
import type { MoneyJSON } from './types/money-json.js';

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
// Accept only canonical integer strings:
// - "0" or non-zero positive/negative integers.
// - No leading zeros, negative zero, whitespace, or extra characters.
const CANONICAL_AMOUNT_PATTERN = /^(?:0|-?[1-9][0-9]*)(?![\s\S])/;

// min / max 64 bit supported by postgresql
const MIN_SUPPORTED_AMOUNT_MINOR = -9223372036854775808n;
const MAX_SUPPORTED_AMOUNT_MINOR = 9223372036854775807n;
// Maximum canonical string length of a signed PostgreSQL BIGINT.
const MAX_CANONICAL_AMOUNT_LENGTH = 20;

export class Money {
  // Prevent direct object creation, ensuring all Money instances are validated through Money.of().
  private constructor(
    public readonly amountMinor: bigint,
    public readonly currency: string,
  ) {}

  // Create a Money object after validating its currency format and amount range.
  static of(amountMinor: bigint, currency: string): Money {
    if (!CURRENCY_CODE_PATTERN.test(currency)) {
      throw new InvalidCurrencyCodeError(currency);
    }

    if (amountMinor < MIN_SUPPORTED_AMOUNT_MINOR || amountMinor > MAX_SUPPORTED_AMOUNT_MINOR) {
      throw new MoneyAmountOutOfRangeError(amountMinor);
    }

    return new Money(amountMinor, currency);
  }

  // Add two monetary amounts of the same currency and return a new Money object.
  add(other: Money): Money {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }

    return Money.of(this.amountMinor + other.amountMinor, this.currency);
  }

  // Subtract another monetary amount of the same currency and return a new Money object.
  subtract(other: Money): Money {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }

    return Money.of(this.amountMinor - other.amountMinor, this.currency);
  }

  // Check whether two Money objects have identical amounts and currencies.
  equals(other: Money): boolean {
    return this.amountMinor === other.amountMinor && this.currency === other.currency;
  }

  // Check whether the amount is zero, regardless of currency.
  isZero(): boolean {
    return this.amountMinor === 0n;
  }

  // Reverse the amount's sign and revalidate the result through Money.of() to prevent overflow.
  negate(): Money {
    return Money.of(-this.amountMinor, this.currency);
  }

  // Compare two Money objects of the same currency.
  // Return -1 if smaller, 0 if equal, or 1 if greater.
  compare(other: Money): -1 | 0 | 1 {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }

    if (this.amountMinor < other.amountMinor) {
      return -1;
    }

    if (this.amountMinor > other.amountMinor) {
      return 1;
    }

    return 0;
  }

  // Convert Money into a JSON-safe representation.
  // Store bigint as a string because JSON does not support bigint.
  toJSON(): MoneyJSON {
    return {
      amount_minor: this.amountMinor.toString(),
      currency: this.currency,
    };
  }

  // Reconstruct a Money object from JSON after validating its structure
  // and canonical amount format, then revalidate currency and amount range.
  static fromJSON(input: unknown): Money {
    if (
      typeof input !== 'object' ||
      input === null ||
      Array.isArray(input) ||
      !('amount_minor' in input) ||
      !('currency' in input) ||
      typeof input.amount_minor !== 'string' ||
      typeof input.currency !== 'string'
    ) {
      throw new InvalidMoneyJSONError();
    }

    // Reject oversized or non-canonical amounts before bigint conversion.
    if (
      input.amount_minor.length > MAX_CANONICAL_AMOUNT_LENGTH ||
      !CANONICAL_AMOUNT_PATTERN.test(input.amount_minor)
    ) {
      throw new InvalidMoneyJSONError();
    }

    const amountMinor = BigInt(input.amount_minor);

    return Money.of(amountMinor, input.currency);
  }
}
