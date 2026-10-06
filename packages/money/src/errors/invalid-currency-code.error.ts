export class InvalidCurrencyCodeError extends Error {
  constructor(currency: string) {
    super(`Invalid currency code: "${currency}"`);

    this.name = 'InvalidCurrencyCodeError';
  }
}
