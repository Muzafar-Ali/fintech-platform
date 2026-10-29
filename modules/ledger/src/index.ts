// Ledger domain errors and validation
export { InvalidJournalDraftError } from './domain/errors/invalid-journal-draft.error.js';
export { prepareBalancedJournal } from './domain/services/prepare-balanced-journal.js';
// Application errors
export { InvalidPostJournalCommandError } from './application/errors/invalid-post-journal-command.error.js';
export { LedgerAccountUnavailableError } from './application/errors/ledger-account-unavailable.error.js';
// Application service
export { createPostJournalService } from './application/services/post-journal.js';
// PostgreSQL infrastructure adapter
export { KyselyLedgerPostingRepository } from './infrastructure/repositories/kysely-ledger-posting.repository.js';
export { IdempotencyConflictError } from './application/errors/idempotency-conflict.error.js';

export type { JournalValidationCode } from './domain/errors/invalid-journal-draft.error.js';
export type { PrepareJournalInput, PreparedJournal } from './domain/value-objects/journal-draft.js';
export type {
  JournalPostingInput,
  PostingSide,
  PreparedJournalPosting,
} from './domain/value-objects/journal-posting.js';
export type { InvalidPostJournalCommandCode } from './application/errors/invalid-post-journal-command.error.js';
export type { PostJournalCommand } from './application/services/post-journal.js';
// Repository port and contracts
export type {
  LedgerPostingRepository,
  PersistPreparedJournalInput,
  PostedJournalResult,
} from './application/ports/ledger-posting-repository.js';
