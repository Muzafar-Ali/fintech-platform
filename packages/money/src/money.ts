import { CurrencyMismatchError } from './errors/currency-mismatch.error.js';
import { InvalidCurrencyCodeError } from './errors/invalid-currency-code.error.js';
import { MoneyAmountOutOfRangeError } from './errors/money-amount-out-of-range.error.js';

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

// min/max 64 bit supported by postgresql
const MIN_SUPPORTED_AMOUNT_MINOR = -9223372036854775808n;
const MAX_SUPPORTED_AMOUNT_MINOR = 9223372036854775807n;

export class Money {
  private constructor(
    public readonly amountMinor: bigint,
    public readonly currency: string,
  ) {}

  static of(amountMinor: bigint, currency: string): Money {
    if (!CURRENCY_CODE_PATTERN.test(currency)) {
      throw new InvalidCurrencyCodeError(currency);
    }

    if (amountMinor < MIN_SUPPORTED_AMOUNT_MINOR || amountMinor > MAX_SUPPORTED_AMOUNT_MINOR) {
      throw new MoneyAmountOutOfRangeError(amountMinor);
    }

    return new Money(amountMinor, currency);
  }

  add(other: Money): Money {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }

    return Money.of(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }

    return Money.of(this.amountMinor - other.amountMinor, this.currency);
  }
}
