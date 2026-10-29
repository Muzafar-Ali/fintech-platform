import { describe, expect, it } from 'vitest';

import { IdempotencyConflictError } from '../../src/application/errors/idempotency-conflict.error.js';
import { observeLedgerPosting } from '../../src/infrastructure/observability/observe-ledger-posting.js';
import type { PostedJournalResult } from '../../src/application/ports/ledger-posting-repository.js';
import type { LedgerOutcomeRecorder } from '../../src/infrastructure/observability/observe-ledger-posting.js';

const postedResult: PostedJournalResult = {
  journalId: '00000000-0000-7000-8000-000000000001',
  tenantId: '00000000-0000-7000-8000-000000000002',
  correlationId: '00000000-0000-7000-8000-000000000003',
  currency: 'USD',
  transactionType: 'TRANSFER',
  status: 'POSTED',
  postingCount: 2,
  postedAt: new Date('2026-10-28T00:00:00.000Z'),
};

describe('observeLedgerPosting', () => {
  it('records posted only after transaction resolution', async () => {
    const recorded: string[] = [];
    let transactionResolved = false;
    let executions = 0;

    const result = await observeLedgerPosting(
      () => {
        executions++;

        return Promise.resolve().then(() => {
          transactionResolved = true;

          return {
            result: postedResult,
            outcome: 'posted' as const,
          };
        });
      },
      (outcome, duration) => {
        expect(transactionResolved).toBe(true);
        expect(duration).toBeGreaterThanOrEqual(0);
        recorded.push(outcome);
      },
    );

    expect(result).toBe(postedResult);
    expect(executions).toBe(1);
    expect(recorded).toEqual(['posted']);
  });

  it('records replay without altering the original result', async () => {
    const recorded: string[] = [];

    const result = await observeLedgerPosting(
      () =>
        Promise.resolve({
          result: postedResult,
          outcome: 'replayed' as const,
        }),
      (outcome) => {
        recorded.push(outcome);
      },
    );

    expect(result).toBe(postedResult);
    expect(recorded).toEqual(['replayed']);
  });

  it('classifies idempotency conflicts without replacing the error', async () => {
    const originalError = new IdempotencyConflictError();
    const recorded: string[] = [];

    await expect(
      observeLedgerPosting(
        () => Promise.reject(originalError),
        (outcome) => {
          recorded.push(outcome);
        },
      ),
    ).rejects.toBe(originalError);

    expect(recorded).toEqual(['conflict']);
  });

  it('classifies a failed commit as failed, never posted', async () => {
    const commitError = new Error('Deferred PostgreSQL constraint rejected COMMIT');
    const recorded: string[] = [];

    await expect(
      observeLedgerPosting(
        () => Promise.reject(commitError),
        (outcome) => {
          recorded.push(outcome);
        },
      ),
    ).rejects.toBe(commitError);

    expect(recorded).toEqual(['failed']);
  });

  it('preserves financial success when metrics reporting fails', async () => {
    const telemetryFailure = new Error('Metrics exporter unavailable');

    const failingRecorder: LedgerOutcomeRecorder = () => {
      throw telemetryFailure;
    };

    const result = await observeLedgerPosting(
      () =>
        Promise.resolve({
          result: postedResult,
          outcome: 'posted' as const,
        }),
      failingRecorder,
    );

    expect(result).toBe(postedResult);
  });

  it('preserves the business error when metrics reporting fails', async () => {
    const businessError = new Error('Database connection lost');

    const failingRecorder: LedgerOutcomeRecorder = () => {
      throw new Error('Metrics exporter unavailable');
    };

    await expect(
      observeLedgerPosting(() => Promise.reject(businessError), failingRecorder),
    ).rejects.toBe(businessError);
  });
});
