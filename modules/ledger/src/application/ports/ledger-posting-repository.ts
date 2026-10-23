import type { PreparedJournal } from '../../domain/value-objects/journal-draft.js';

export interface PersistPreparedJournalInput {
  readonly draft: PreparedJournal;
  readonly transactionType: string;
  readonly correlationId: string;
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

/** Persistence owns the SQL transaction and resolves only after COMMIT. */
export interface LedgerPostingRepository {
  postPreparedJournal(input: PersistPreparedJournalInput): Promise<PostedJournalResult>;
}
