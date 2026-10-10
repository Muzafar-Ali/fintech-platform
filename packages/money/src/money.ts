import { CurrencyMismatchError } from './errors/currency-mismatch.error.js';
import { InvalidCurrencyCodeError } from './errors/invalid-currency-code.error.js';
import { MoneyAmountOutOfRangeError } from './errors/money-amount-out-of-range.error.js';

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

// min/max 64 bit supported by postgresql
const MIN_SUPPORTED_AMOUNT_MINOR = -9223372036854775808n;
const MAX_SUPPORTED_AMOUNT_MINOR = 9223372036854775807n;

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
}
