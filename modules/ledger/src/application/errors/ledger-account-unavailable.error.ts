/** Do not reveal whether an account belongs to another tenant. */
export class LedgerAccountUnavailableError extends Error {
  constructor() {
    super('Ledger account is unavailable for posting');
    this.name = 'LedgerAccountUnavailableError';
  }
}
