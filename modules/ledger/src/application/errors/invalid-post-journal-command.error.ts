export type InvalidPostJournalCommandCode =
  | 'INVALID_TENANT_UUID'
  | 'INVALID_ACCOUNT_UUID'
  | 'INVALID_CORRELATION_UUID'
  | 'INVALID_TRANSACTION_TYPE'
  | 'INVALID_IDEMPOTENCY_KEY';

export class InvalidPostJournalCommandError extends Error {
  constructor(
    public readonly code: InvalidPostJournalCommandCode,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidPostJournalCommandError';
  }
}
