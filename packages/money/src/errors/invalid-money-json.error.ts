export class InvalidMoneyJSONError extends Error {
  constructor() {
    super('Invalid money JSON');

    this.name = 'InvalidMoneyJSONError';
  }
}
