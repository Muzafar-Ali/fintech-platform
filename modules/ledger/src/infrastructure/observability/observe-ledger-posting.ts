import { annotateLedgerOutcome, recordLedgerOutcome } from '@fintech/observability';
import { IdempotencyConflictError } from '../../application/errors/idempotency-conflict.error.js';

import type { LedgerPostingOutcome } from '@fintech/observability';
import type { PostedJournalResult } from '../../application/ports/ledger-posting-repository.js';

export interface CommittedLedgerJournal {
  readonly result: PostedJournalResult;
  readonly outcome: 'posted' | 'replayed';
}

export type LedgerOutcomeRecorder = (
  outcome: LedgerPostingOutcome,
  durationSeconds: number,
) => void;

/**
 * Observe a financial transaction without changing its behavior.
 *
 * The supplied transaction promise must settle only after
 * Kysely completes COMMIT or ROLLBACK.
 *
 * Success metrics and span attributes are recorded after COMMIT.
 * Any telemetry failure must preserve the original result/error.
 */
export async function observeLedgerPosting(
  executeTransaction: () => Promise<CommittedLedgerJournal>,
  recordOutcome: LedgerOutcomeRecorder = recordLedgerOutcome,
): Promise<PostedJournalResult> {
  const startedAt = performance.now();

  const elapsedSeconds = (): number => Math.max(0, (performance.now() - startedAt) / 1000);

  let committed: CommittedLedgerJournal;

  try {
    committed = await executeTransaction();
  } catch (error: unknown) {
    const outcome: LedgerPostingOutcome =
      error instanceof IdempotencyConflictError ? 'conflict' : 'failed';

    annotateLedgerOutcome(outcome);

    try {
      recordOutcome(outcome, elapsedSeconds());
    } catch {
      // Preserve the original business or database error.
    }

    throw error;
  }

  // The transaction has successfully committed.
  annotateLedgerOutcome(committed.outcome, committed.result.postingCount);

  try {
    recordOutcome(committed.outcome, elapsedSeconds());
  } catch {
    // Never turn a committed financial transaction into failure.
  }

  return committed.result;
}
