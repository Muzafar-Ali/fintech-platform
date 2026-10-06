export class MoneyAmountOutOfRangeError extends Error {
  constructor(amountMinor: bigint) {
    super(`Money amount is outside the supported range: ${amountMinor.toString()}`);

    this.name = 'MoneyAmountOutOfRangeError';
  }
}
