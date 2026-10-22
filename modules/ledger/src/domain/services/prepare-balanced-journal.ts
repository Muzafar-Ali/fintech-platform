import { Money, MoneyAmountOutOfRangeError } from '@fintech/money';
import { InvalidJournalDraftError } from '../errors/invalid-journal-draft.error.js';
import type { PrepareJournalInput, PreparedJournal } from '../value-objects/journal-draft.js';
import type { PreparedJournalPosting } from '../value-objects/journal-posting.js';

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

// Validate the runtime collection without changing
// the declared readonly JournalPostingInput[] element type.
function hasAtLeastTwoPostings(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 2;
}

/**
 * Validate and prepare a balanced double-entry journal.
 *
 * Pure domain operation:
 * - No database access
 * - No IO
 * - No mutation of caller input
 * - No JavaScript Number monetary arithmetic
 */
export function prepareBalancedJournal(input: PrepareJournalInput): PreparedJournal {
  // A journal must belong to an identified tenant.
  if (typeof input.tenantId !== 'string' || input.tenantId.trim().length === 0) {
    throw new InvalidJournalDraftError('INVALID_TENANT_ID', 'Journal tenant ID is required');
  }

  // Use the canonical currency format supported by Money.
  if (
    typeof input.currency !== 'string' ||
    input.currency.length !== 3 ||
    !CURRENCY_CODE_PATTERN.test(input.currency)
  ) {
    throw new InvalidJournalDraftError(
      'INVALID_CURRENCY',
      'Journal currency must be a three-letter uppercase code',
    );
  }

  // A valid double-entry journal needs at least two lines.
  if (!hasAtLeastTwoPostings(input.postings)) {
    throw new InvalidJournalDraftError(
      'TOO_FEW_POSTINGS',
      'A journal requires at least two postings',
    );
  }

  /**
   * Runtime validation for untrusted posting side values.
   * TypeScript types alone cannot validate incoming API data.
   */
  function isValidPostingSide(value: unknown): boolean {
    return value === 'DEBIT' || value === 'CREDIT';
  }

  const preparedPostings: PreparedJournalPosting[] = [];

  let debitTotalMinor = 0n;
  let creditTotalMinor = 0n;

  let debitCount = 0;
  let creditCount = 0;

  for (let index = 0; index < input.postings.length; index++) {
    const posting = input.postings[index];

    if (!posting || typeof posting !== 'object') {
      throw new InvalidJournalDraftError('INVALID_POSTING', 'Journal contains an invalid posting');
    }

    if (typeof posting.accountId !== 'string' || posting.accountId.trim().length === 0) {
      throw new InvalidJournalDraftError(
        'INVALID_ACCOUNT_ID',
        'Each posting requires an account ID',
      );
    }

    if (!isValidPostingSide(posting.side)) {
      throw new InvalidJournalDraftError(
        'INVALID_POSTING_SIDE',
        'Posting side must be DEBIT or CREDIT',
      );
    }

    if (typeof posting.amountMinor !== 'bigint' || posting.amountMinor <= 0n) {
      throw new InvalidJournalDraftError(
        'INVALID_AMOUNT',
        'Posting amount must be a positive bigint',
      );
    }

    // Reuse the existing Money package for signed BIGINT
    // range validation. Do not duplicate its limits.
    try {
      Money.of(posting.amountMinor, input.currency);
    } catch (error: unknown) {
      if (error instanceof MoneyAmountOutOfRangeError) {
        throw new InvalidJournalDraftError(
          'INVALID_AMOUNT',
          'Posting amount exceeds the supported monetary range',
          { cause: error },
        );
      }

      // Preserve unexpected errors if they are already Error instances.
      if (error instanceof Error) {
        throw error;
      }

      // Normalize unexpected non-Error values.
      throw new Error('Unexpected Money validation failure', {
        cause: error,
      });
    }

    // BigInt totals can exceed the range of a single posting.
    // We never convert monetary values into Number.
    if (posting.side === 'DEBIT') {
      debitTotalMinor += posting.amountMinor;
      debitCount++;
    } else {
      creditTotalMinor += posting.amountMinor;
      creditCount++;
    }

    // The domain owns deterministic line numbering.
    preparedPostings.push(
      Object.freeze({
        accountId: posting.accountId,
        side: posting.side,
        amountMinor: posting.amountMinor,
        lineNo: index + 1,
      }),
    );
  }

  if (debitCount === 0 || creditCount === 0) {
    throw new InvalidJournalDraftError(
      'MISSING_POSTING_SIDE',
      'A journal requires at least one debit and one credit',
    );
  }

  if (debitTotalMinor !== creditTotalMinor) {
    throw new InvalidJournalDraftError(
      'UNBALANCED_JOURNAL',
      'Total debits must equal total credits',
    );
  }

  return Object.freeze({
    tenantId: input.tenantId,
    currency: input.currency,
    postings: Object.freeze(preparedPostings),
    debitTotalMinor,
    creditTotalMinor,
  });
}
