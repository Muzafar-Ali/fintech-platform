import type { JournalPostingInput, PreparedJournalPosting } from './journal-posting.js';

export interface PrepareJournalInput {
  readonly tenantId: string;
  readonly currency: string;
  readonly postings: readonly JournalPostingInput[];
}

export interface PreparedJournal {
  readonly tenantId: string;
  readonly currency: string;
  readonly postings: readonly PreparedJournalPosting[];
  readonly debitTotalMinor: bigint;
  readonly creditTotalMinor: bigint;
}
