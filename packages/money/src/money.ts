export class Money {
  private constructor(
    public readonly amountMinor: bigint,
    public readonly currency: string,
  ) {}

  static of(amountMinor: bigint, currency: string): Money {
    return new Money(amountMinor, currency);
  }
}
