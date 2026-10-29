import { describe, expect, it } from 'vitest';

import { traceOperation } from '../../src/tracing.js';

describe('traceOperation', () => {
  it('preserves a successful business result', async () => {
    const result = { journalId: 'journal-123' };
    let executions = 0;

    const actual = await traceOperation('ledger.post_journal', () => {
      executions++;

      return Promise.resolve(result);
    });

    expect(actual).toBe(result);
    expect(executions).toBe(1);
  });

  it('preserves the original business error', async () => {
    const originalError = new Error('Financial invariant violated');

    await expect(
      traceOperation('ledger.post_journal', () => Promise.reject(originalError)),
    ).rejects.toBe(originalError);
  });

  it('preserves non-Error rejection reasons', async () => {
    const originalRejection = {
      code: 'TEST_REJECTION',
    };

    // An external Promise can reject with a non-Error value.
    // The tracing wrapper must preserve that original value.
    const operation = (): Promise<never> =>
      new Promise<never>((_resolve, reject) => {
        // Deliberately simulate a non-Error rejection from external code.
        // Verify that observability preserves the original rejection.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(originalRejection);
      });

    await expect(traceOperation('ledger.post_journal', operation)).rejects.toBe(originalRejection);
  });

  it('executes business logic exactly once', async () => {
    let executions = 0;

    await traceOperation('ledger.post_journal', () => {
      executions++;

      return Promise.resolve();
    });

    expect(executions).toBe(1);
  });
});
