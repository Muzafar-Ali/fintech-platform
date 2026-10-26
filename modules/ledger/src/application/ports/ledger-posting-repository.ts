import type { PreparedJournal } from '../../domain/value-objects/journal-draft.js';

export interface PersistPreparedJournalInput {
  readonly draft: PreparedJournal;
  readonly transactionType: string;
  readonly correlationId: string;

  // Task 13E: durable command identity.
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface PostedJournalResult {
  readonly journalId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly currency: string;
  readonly transactionType: string;
  readonly status: 'POSTED';
  readonly postingCount: number;
  readonly postedAt: Date;
}

export interface LedgerPostingRepository {
  /**
   * Atomically claim the idempotency key and post the journal,
   * or replay the previously committed result.
   *
   * The promise resolves only after the DB transaction commits.
   */
  postPreparedJournal(input: PersistPreparedJournalInput): Promise<PostedJournalResult>;
}
