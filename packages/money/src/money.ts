import { InvalidCurrencyCodeError } from './errors/invalid-currency-code.error.js';
import { MoneyAmountOutOfRangeError } from './errors/money-amount-out-of-range.error.js';

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

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
}
