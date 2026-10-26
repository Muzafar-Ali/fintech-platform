import { MoneyAmountOutOfRangeError } from '@fintech/money';
import { describe, expect, it } from 'vitest';
import { InvalidJournalDraftError, prepareBalancedJournal } from '../../src/index.js';
import type {
  JournalPostingInput,
  JournalValidationCode,
  PrepareJournalInput,
} from '../../src/index.js';

const TENANT_ID = 'tenant-001';
const CASH_ACCOUNT = 'cash-account';
const PAYABLE_ACCOUNT = 'payable-account';
const FEES_ACCOUNT = 'fees-account';

const MAX_INT64 = 9223372036854775807n;

function makeInput(overrides: Partial<PrepareJournalInput> = {}): PrepareJournalInput {
  return {
    tenantId: TENANT_ID,
    currency: 'PKR',
    postings: [
      {
        accountId: CASH_ACCOUNT,
        side: 'DEBIT',
        amountMinor: 10_000n,
      },
      {
        accountId: PAYABLE_ACCOUNT,
        side: 'CREDIT',
        amountMinor: 10_000n,
      },
    ],
    ...overrides,
  };
}

/**
 * Simulate data from an untrusted runtime boundary.
 *
 * The assertion is intentionally isolated in this test helper.
 * Production callers must validate unknown HTTP input before
 * passing it to the typed domain API.
 */
function untrustedInput(overrides: Record<string, unknown>): PrepareJournalInput {
  return {
    ...makeInput(),
    ...overrides,
  };
}

function expectDomainError(
  input: PrepareJournalInput,
  expectedCode: JournalValidationCode,
): InvalidJournalDraftError {
  let caught: unknown;

  try {
    prepareBalancedJournal(input);
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof InvalidJournalDraftError)) {
    throw new Error(`Expected InvalidJournalDraftError with code ${expectedCode}`, {
      cause: caught,
    });
  }

  expect(caught.name).toBe('InvalidJournalDraftError');
  expect(caught.code).toBe(expectedCode);

  return caught;
}

describe('prepareBalancedJournal — valid journals', () => {
  it('prepares a balanced two-posting journal', () => {
    const result = prepareBalancedJournal(makeInput());

    expect(result.tenantId).toBe(TENANT_ID);
    expect(result.currency).toBe('PKR');
    expect(result.postings).toHaveLength(2);
    expect(result.debitTotalMinor).toBe(10_000n);
    expect(result.creditTotalMinor).toBe(10_000n);
  });

  it('supports one debit and multiple credits', () => {
    const result = prepareBalancedJournal(
      makeInput({
        postings: [
          {
            accountId: CASH_ACCOUNT,
            side: 'DEBIT',
            amountMinor: 10_000n,
          },
          {
            accountId: PAYABLE_ACCOUNT,
            side: 'CREDIT',
            amountMinor: 6_000n,
          },
          {
            accountId: FEES_ACCOUNT,
            side: 'CREDIT',
            amountMinor: 4_000n,
          },
        ],
      }),
    );

    expect(result.postings).toHaveLength(3);
    expect(result.debitTotalMinor).toBe(10_000n);
    expect(result.creditTotalMinor).toBe(10_000n);
  });

  it('supports multiple debits and one credit', () => {
    const result = prepareBalancedJournal(
      makeInput({
        postings: [
          {
            accountId: CASH_ACCOUNT,
            side: 'DEBIT',
            amountMinor: 7_000n,
          },
          {
            accountId: FEES_ACCOUNT,
            side: 'DEBIT',
            amountMinor: 3_000n,
          },
          {
            accountId: PAYABLE_ACCOUNT,
            side: 'CREDIT',
            amountMinor: 10_000n,
          },
        ],
      }),
    );

    expect(result.debitTotalMinor).toBe(10_000n);
    expect(result.creditTotalMinor).toBe(10_000n);
  });

  it('supports different valid currency codes', () => {
    for (const currency of ['PKR', 'USD', 'EUR']) {
      const result = prepareBalancedJournal(makeInput({ currency }));

      expect(result.currency).toBe(currency);
    }
  });

  it('preserves posting order and assigns line numbers', () => {
    const result = prepareBalancedJournal(
      makeInput({
        postings: [
          {
            accountId: FEES_ACCOUNT,
            side: 'CREDIT',
            amountMinor: 2_000n,
          },
          {
            accountId: CASH_ACCOUNT,
            side: 'DEBIT',
            amountMinor: 10_000n,
          },
          {
            accountId: PAYABLE_ACCOUNT,
            side: 'CREDIT',
            amountMinor: 8_000n,
          },
        ],
      }),
    );

    expect(result.postings.map((posting) => posting.lineNo)).toEqual([1, 2, 3]);

    expect(result.postings.map((posting) => posting.accountId)).toEqual([
      FEES_ACCOUNT,
      CASH_ACCOUNT,
      PAYABLE_ACCOUNT,
    ]);
  });

  it('accepts the maximum supported individual posting amount', () => {
    const result = prepareBalancedJournal(
      makeInput({
        postings: [
          {
            accountId: CASH_ACCOUNT,
            side: 'DEBIT',
            amountMinor: MAX_INT64,
          },
          {
            accountId: PAYABLE_ACCOUNT,
            side: 'CREDIT',
            amountMinor: MAX_INT64,
          },
        ],
      }),
    );

    expect(result.debitTotalMinor).toBe(MAX_INT64);
    expect(result.creditTotalMinor).toBe(MAX_INT64);
  });

  it('allows aggregate totals larger than a single BIGINT value', () => {
    const result = prepareBalancedJournal(
      makeInput({
        postings: [
          {
            accountId: CASH_ACCOUNT,
            side: 'DEBIT',
            amountMinor: MAX_INT64,
          },
          {
            accountId: FEES_ACCOUNT,
            side: 'DEBIT',
            amountMinor: MAX_INT64,
          },
          {
            accountId: PAYABLE_ACCOUNT,
            side: 'CREDIT',
            amountMinor: MAX_INT64,
          },
          {
            accountId: PAYABLE_ACCOUNT,
            side: 'CREDIT',
            amountMinor: MAX_INT64,
          },
        ],
      }),
    );

    expect(result.debitTotalMinor).toBe(MAX_INT64 * 2n);
    expect(result.creditTotalMinor).toBe(MAX_INT64 * 2n);
  });

  it('returns the same result for the same input', () => {
    const input = makeInput();

    const first = prepareBalancedJournal(input);
    const second = prepareBalancedJournal(input);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('does not mutate the original input', () => {
    const input = makeInput();
    const originalPostings = input.postings;
    const originalFirstPosting = input.postings[0];

    const result = prepareBalancedJournal(input);

    expect(input.postings).toBe(originalPostings);
    expect(input.postings[0]).toBe(originalFirstPosting);
    expect(input.postings[0]).not.toHaveProperty('lineNo');

    expect(result.postings).not.toBe(originalPostings);
    expect(result.postings[0]).not.toBe(originalFirstPosting);
    expect(Object.isFrozen(input.postings)).toBe(false);
  });

  it('returns a frozen journal, postings array and posting records', () => {
    const result = prepareBalancedJournal(makeInput());

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.postings)).toBe(true);

    for (const posting of result.postings) {
      expect(Object.isFrozen(posting)).toBe(true);
    }
  });

  it('accepts already frozen caller inputs', () => {
    const input: PrepareJournalInput = Object.freeze({
      tenantId: TENANT_ID,
      currency: 'PKR',
      postings: Object.freeze([
        Object.freeze({
          accountId: CASH_ACCOUNT,
          side: 'DEBIT' as const,
          amountMinor: 100n,
        }),
        Object.freeze({
          accountId: PAYABLE_ACCOUNT,
          side: 'CREDIT' as const,
          amountMinor: 100n,
        }),
      ]),
    });

    const result = prepareBalancedJournal(input);

    expect(result.debitTotalMinor).toBe(100n);
    expect(result.creditTotalMinor).toBe(100n);
  });

  it('does not require account IDs to be unique across lines', () => {
    const result = prepareBalancedJournal(
      makeInput({
        postings: [
          {
            accountId: CASH_ACCOUNT,
            side: 'DEBIT',
            amountMinor: 500n,
          },
          {
            accountId: CASH_ACCOUNT,
            side: 'CREDIT',
            amountMinor: 500n,
          },
        ],
      }),
    );

    expect(result.postings).toHaveLength(2);
  });
});

describe('prepareBalancedJournal — invalid journal metadata', () => {
  it('rejects empty, whitespace, null and numeric tenant IDs', () => {
    for (const tenantId of ['', '   ', null, 42]) {
      expectDomainError(untrustedInput({ tenantId }), 'INVALID_TENANT_ID');
    }
  });

  it('rejects invalid currency formats and runtime types', () => {
    const invalidCurrencies: readonly unknown[] = [
      '',
      'pkR',
      'pkr',
      'PK',
      'PKRR',
      'P1R',
      'PK ',
      null,
      123,
    ];

    for (const currency of invalidCurrencies) {
      expectDomainError(untrustedInput({ currency }), 'INVALID_CURRENCY');
    }
  });

  it('rejects missing, null and non-array postings', () => {
    const invalidCollections: readonly unknown[] = [undefined, null, 'not-an-array', 123, {}];

    for (const postings of invalidCollections) {
      expectDomainError(untrustedInput({ postings }), 'TOO_FEW_POSTINGS');
    }
  });

  it('rejects empty and single-line journals', () => {
    expectDomainError(
      makeInput({
        postings: [
          {
            accountId: CASH_ACCOUNT,
            side: 'DEBIT',
            amountMinor: 100n,
          },
        ],
      }),
      'TOO_FEW_POSTINGS',
    );

    expectDomainError(makeInput({ postings: [makeInput().postings[0]!] }), 'TOO_FEW_POSTINGS');
  });
});

describe('prepareBalancedJournal — invalid postings', () => {
  it('rejects null, undefined and primitive posting records', () => {
    const invalidPostings: readonly unknown[] = [null, undefined, 123, 'posting'];

    for (const invalidPosting of invalidPostings) {
      expectDomainError(
        untrustedInput({
          postings: [
            invalidPosting,
            {
              accountId: PAYABLE_ACCOUNT,
              side: 'CREDIT',
              amountMinor: 100n,
            },
          ],
        }),
        'INVALID_POSTING',
      );
    }
  });

  it('rejects invalid account IDs', () => {
    const invalidAccountIds: readonly unknown[] = ['', '   ', null, 123, undefined];

    for (const accountId of invalidAccountIds) {
      expectDomainError(
        untrustedInput({
          postings: [
            {
              accountId,
              side: 'DEBIT',
              amountMinor: 100n,
            },
            {
              accountId: PAYABLE_ACCOUNT,
              side: 'CREDIT',
              amountMinor: 100n,
            },
          ],
        }),
        'INVALID_ACCOUNT_ID',
      );
    }
  });

  it('rejects invalid posting sides at runtime', () => {
    const invalidSides: readonly unknown[] = [
      '',
      'debit',
      'credit',
      'CREDIT ',
      'BOTH',
      null,
      1,
      undefined,
    ];

    for (const side of invalidSides) {
      expectDomainError(
        untrustedInput({
          postings: [
            {
              accountId: CASH_ACCOUNT,
              side,
              amountMinor: 100n,
            },
            {
              accountId: PAYABLE_ACCOUNT,
              side: 'CREDIT',
              amountMinor: 100n,
            },
          ],
        }),
        'INVALID_POSTING_SIDE',
      );
    }
  });

  it('rejects zero and negative posting amounts', () => {
    for (const amountMinor of [0n, -1n, -100_000n]) {
      expectDomainError(
        makeInput({
          postings: [
            {
              accountId: CASH_ACCOUNT,
              side: 'DEBIT',
              amountMinor,
            },
            {
              accountId: PAYABLE_ACCOUNT,
              side: 'CREDIT',
              amountMinor: 100n,
            },
          ],
        }),
        'INVALID_AMOUNT',
      );
    }
  });

  it('rejects amounts that are not bigint values', () => {
    const invalidAmounts: readonly unknown[] = [100, 100.5, '100', null, true, undefined];

    for (const amountMinor of invalidAmounts) {
      expectDomainError(
        untrustedInput({
          postings: [
            {
              accountId: CASH_ACCOUNT,
              side: 'DEBIT',
              amountMinor,
            },
            {
              accountId: PAYABLE_ACCOUNT,
              side: 'CREDIT',
              amountMinor: 100n,
            },
          ],
        }),
        'INVALID_AMOUNT',
      );
    }
  });

  it('rejects a posting beyond PostgreSQL BIGINT range', () => {
    const error = expectDomainError(
      makeInput({
        postings: [
          {
            accountId: CASH_ACCOUNT,
            side: 'DEBIT',
            amountMinor: MAX_INT64 + 1n,
          },
          {
            accountId: PAYABLE_ACCOUNT,
            side: 'CREDIT',
            amountMinor: MAX_INT64 + 1n,
          },
        ],
      }),
      'INVALID_AMOUNT',
    );

    expect(error.cause).toBeInstanceOf(MoneyAmountOutOfRangeError);
  });
});

describe('prepareBalancedJournal — double-entry invariants', () => {
  it('rejects unequal debit and credit totals', () => {
    expectDomainError(
      makeInput({
        postings: [
          {
            accountId: CASH_ACCOUNT,
            side: 'DEBIT',
            amountMinor: 10_000n,
          },
          {
            accountId: PAYABLE_ACCOUNT,
            side: 'CREDIT',
            amountMinor: 9_999n,
          },
        ],
      }),
      'UNBALANCED_JOURNAL',
    );
  });

  it('rejects a multi-line journal with unequal totals', () => {
    expectDomainError(
      makeInput({
        postings: [
          {
            accountId: CASH_ACCOUNT,
            side: 'DEBIT',
            amountMinor: 10_000n,
          },
          {
            accountId: PAYABLE_ACCOUNT,
            side: 'CREDIT',
            amountMinor: 6_000n,
          },
          {
            accountId: FEES_ACCOUNT,
            side: 'CREDIT',
            amountMinor: 3_999n,
          },
        ],
      }),
      'UNBALANCED_JOURNAL',
    );
  });

  it('rejects journals with only debit postings', () => {
    expectDomainError(
      makeInput({
        postings: [
          {
            accountId: CASH_ACCOUNT,
            side: 'DEBIT',
            amountMinor: 100n,
          },
          {
            accountId: FEES_ACCOUNT,
            side: 'DEBIT',
            amountMinor: 100n,
          },
        ],
      }),
      'MISSING_POSTING_SIDE',
    );
  });

  it('rejects journals with only credit postings', () => {
    expectDomainError(
      makeInput({
        postings: [
          {
            accountId: CASH_ACCOUNT,
            side: 'CREDIT',
            amountMinor: 100n,
          },
          {
            accountId: PAYABLE_ACCOUNT,
            side: 'CREDIT',
            amountMinor: 100n,
          },
        ],
      }),
      'MISSING_POSTING_SIDE',
    );
  });

  it('rejects imbalance regardless of line ordering', () => {
    const postings: JournalPostingInput[] = [
      {
        accountId: PAYABLE_ACCOUNT,
        side: 'CREDIT',
        amountMinor: 99n,
      },
      {
        accountId: CASH_ACCOUNT,
        side: 'DEBIT',
        amountMinor: 100n,
      },
    ];

    expectDomainError(makeInput({ postings }), 'UNBALANCED_JOURNAL');
  });
});
