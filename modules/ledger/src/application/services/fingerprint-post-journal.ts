import { createHash } from 'node:crypto';
import type { PreparedJournal } from '../../domain/value-objects/journal-draft.js';

export interface FingerprintPostJournalInput {
  readonly draft: PreparedJournal;
  readonly transactionType: string;
}

/**
 * Produce a stable SHA-256 fingerprint of the financial intent.
 *
 * Array-based canonical representation avoids JSON property
 * ordering differences.
 *
 * Version marker allows future fingerprint-format evolution.
 *
 * Correlation ID is deliberately excluded:
 * it represents tracing metadata, not financial intent.
 */
export function fingerprintPostJournal(input: FingerprintPostJournalInput): string {
  const { draft, transactionType } = input;

  const canonical = JSON.stringify([
    'POST_JOURNAL_V1',
    draft.tenantId.toLowerCase(),
    draft.currency,
    transactionType,
    draft.postings.map((posting) => [
      posting.lineNo,
      posting.accountId.toLowerCase(),
      posting.side,
      posting.amountMinor.toString(),
    ]),
  ]);

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
