export class CurrencyMismatchError extends Error {
  constructor(leftCurrency: string, rightCurrency: string) {
    super(`Currency mismatch: ${leftCurrency} and ${rightCurrency}`);

    this.name = 'CurrencyMismatchError';
  }
}
