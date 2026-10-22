export type JournalValidationCode =
  | 'INVALID_TENANT_ID'
  | 'INVALID_CURRENCY'
  | 'TOO_FEW_POSTINGS'
  | 'INVALID_POSTING'
  | 'INVALID_ACCOUNT_ID'
  | 'INVALID_POSTING_SIDE'
  | 'INVALID_AMOUNT'
  | 'MISSING_POSTING_SIDE'
  | 'UNBALANCED_JOURNAL';

export class InvalidJournalDraftError extends Error {
  constructor(
    public readonly code: JournalValidationCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'InvalidJournalDraftError';
  }
}
