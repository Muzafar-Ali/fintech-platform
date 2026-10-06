import { InvalidCurrencyCodeError } from './errors/invalid-currency-code.error.js';

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export class Money {
  private constructor(
    public readonly amountMinor: bigint,
    public readonly currency: string,
  ) {}

  static of(amountMinor: bigint, currency: string): Money {
    if (!CURRENCY_CODE_PATTERN.test(currency)) {
      throw new InvalidCurrencyCodeError(currency);
    }

    return new Money(amountMinor, currency);
  }
}
