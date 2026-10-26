import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidJournalDraftError, prepareBalancedJournal } from '../../src/index.js';
import type { JournalPostingInput, PrepareJournalInput } from '../../src/index.js';

const MAX_INT64 = 9223372036854775807n;

const positiveAmount = fc.bigInt({
  min: 1n,
  max: 1_000_000_000_000n,
});

function journalInput(postings: readonly JournalPostingInput[]): PrepareJournalInput {
  return {
    tenantId: 'property-test-tenant',
    currency: 'PKR',
    postings,
  };
}

describe('Ledger journal balancing — properties', () => {
  it('balances arbitrary positive two-sided journals exactly', () => {
    fc.assert(
      fc.property(positiveAmount, (amountMinor) => {
        const result = prepareBalancedJournal(
          journalInput([
            {
              accountId: 'cash',
              side: 'DEBIT',
              amountMinor,
            },
            {
              accountId: 'payable',
              side: 'CREDIT',
              amountMinor,
            },
          ]),
        );

        expect(result.debitTotalMinor).toBe(amountMinor);
        expect(result.creditTotalMinor).toBe(amountMinor);
        expect(result.postings).toHaveLength(2);
      }),
      { numRuns: 300 },
    );
  });

  it('balances arbitrary one-debit/two-credit splits', () => {
    fc.assert(
      fc.property(positiveAmount, positiveAmount, (firstCredit, secondCredit) => {
        const total = firstCredit + secondCredit;

        const result = prepareBalancedJournal(
          journalInput([
            {
              accountId: 'cash',
              side: 'DEBIT',
              amountMinor: total,
            },
            {
              accountId: 'customer-payable',
              side: 'CREDIT',
              amountMinor: firstCredit,
            },
            {
              accountId: 'fee-payable',
              side: 'CREDIT',
              amountMinor: secondCredit,
            },
          ]),
        );

        expect(result.debitTotalMinor).toBe(total);
        expect(result.creditTotalMinor).toBe(total);
        expect(result.postings.map((posting) => posting.lineNo)).toEqual([1, 2, 3]);
      }),
      { numRuns: 300 },
    );
  });

  it('balances randomly generated multi-line journals', () => {
    fc.assert(
      fc.property(
        fc.array(positiveAmount, {
          minLength: 1,
          maxLength: 20,
        }),
        (creditAmounts) => {
          const total = creditAmounts.reduce((sum, amount) => sum + amount, 0n);

          const postings: JournalPostingInput[] = [
            {
              accountId: 'clearing',
              side: 'DEBIT',
              amountMinor: total,
            },
            ...creditAmounts.map((amountMinor, index) => ({
              accountId: `payable-${index}`,
              side: 'CREDIT' as const,
              amountMinor,
            })),
          ];

          const result = prepareBalancedJournal(journalInput(postings));

          expect(result.debitTotalMinor).toBe(total);
          expect(result.creditTotalMinor).toBe(total);

          expect(result.postings).toHaveLength(creditAmounts.length + 1);

          expect(result.postings.map((posting) => posting.lineNo)).toEqual(
            Array.from({ length: postings.length }, (_, index) => index + 1),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('rejects any positive imbalance in generated journals', () => {
    fc.assert(
      fc.property(positiveAmount, positiveAmount, (amount, difference) => {
        const input = journalInput([
          {
            accountId: 'cash',
            side: 'DEBIT',
            amountMinor: amount,
          },
          {
            accountId: 'payable',
            side: 'CREDIT',
            amountMinor: amount + difference,
          },
        ]);

        let caught: unknown;

        try {
          prepareBalancedJournal(input);
        } catch (error: unknown) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(InvalidJournalDraftError);

        if (caught instanceof InvalidJournalDraftError) {
          expect(caught.code).toBe('UNBALANCED_JOURNAL');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('supports exact aggregate totals above signed BIGINT range', () => {
    fc.assert(
      fc.property(
        fc.bigInt({
          min: MAX_INT64 / 2n + 1n,
          max: MAX_INT64,
        }),
        (amountMinor) => {
          const total = amountMinor * 2n;

          const result = prepareBalancedJournal(
            journalInput([
              {
                accountId: 'debit-1',
                side: 'DEBIT',
                amountMinor,
              },
              {
                accountId: 'debit-2',
                side: 'DEBIT',
                amountMinor,
              },
              {
                accountId: 'credit-1',
                side: 'CREDIT',
                amountMinor,
              },
              {
                accountId: 'credit-2',
                side: 'CREDIT',
                amountMinor,
              },
            ]),
          );

          expect(total > MAX_INT64).toBe(true);
          expect(result.debitTotalMinor).toBe(total);
          expect(result.creditTotalMinor).toBe(total);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('remains balanced when debit and credit line order changes', () => {
    fc.assert(
      fc.property(positiveAmount, fc.boolean(), (amountMinor, reverseOrder) => {
        const debit: JournalPostingInput = {
          accountId: 'cash',
          side: 'DEBIT',
          amountMinor,
        };

        const credit: JournalPostingInput = {
          accountId: 'payable',
          side: 'CREDIT',
          amountMinor,
        };

        const postings = reverseOrder ? [credit, debit] : [debit, credit];

        const result = prepareBalancedJournal(journalInput(postings));

        expect(result.debitTotalMinor).toBe(amountMinor);
        expect(result.creditTotalMinor).toBe(amountMinor);

        expect(result.postings.map((posting) => posting.side)).toEqual(
          postings.map((posting) => posting.side),
        );
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic and does not mutate generated inputs', () => {
    fc.assert(
      fc.property(positiveAmount, (amountMinor) => {
        const debit: JournalPostingInput = {
          accountId: 'cash',
          side: 'DEBIT',
          amountMinor,
        };

        const credit: JournalPostingInput = {
          accountId: 'payable',
          side: 'CREDIT',
          amountMinor,
        };

        const postings = [debit, credit];
        const input = journalInput(postings);

        const first = prepareBalancedJournal(input);
        const second = prepareBalancedJournal(input);

        expect(first).toEqual(second);

        expect(input.postings[0]).toBe(debit);
        expect(input.postings[1]).toBe(credit);

        expect(Object.isFrozen(first)).toBe(true);
        expect(Object.isFrozen(first.postings)).toBe(true);
        expect(first.postings.every((posting) => Object.isFrozen(posting))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
