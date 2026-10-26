import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it, vi } from 'vitest';
import { InvalidJournalDraftError } from '../../src/domain/errors/invalid-journal-draft.error.js';
import { InvalidPostJournalCommandError } from '../../src/application/errors/invalid-post-journal-command.error.js';
import { createPostJournalService } from '../../src/application/services/post-journal.js';
import type {
  LedgerPostingRepository,
  PersistPreparedJournalInput,
  PostedJournalResult,
} from '../../src/application/ports/ledger-posting-repository.js';
import type { PostJournalCommand } from '../../src/application/services/post-journal.js';

const tenantId = uuidv7();
const debitAccountId = uuidv7();
const creditAccountId = uuidv7();
const correlationId = uuidv7();

function command(overrides: Partial<PostJournalCommand> = {}): PostJournalCommand {
  return {
    tenantId,
    correlationId,
    currency: 'PKR',
    transactionType: 'TRANSFER',
    idempotencyKey: 'unit-transfer-001',
    postings: [
      {
        accountId: debitAccountId,
        side: 'DEBIT',
        amountMinor: 125n,
      },
      {
        accountId: creditAccountId,
        side: 'CREDIT',
        amountMinor: 125n,
      },
    ],
    ...overrides,
  };
}

function fakeRepository(): {
  repository: LedgerPostingRepository;
  calls: PersistPreparedJournalInput[];
} {
  const calls: PersistPreparedJournalInput[] = [];

  const repository: LedgerPostingRepository = {
    postPreparedJournal: vi.fn(
      (input: PersistPreparedJournalInput): Promise<PostedJournalResult> => {
        calls.push(input);

        return Promise.resolve({
          journalId: uuidv7(),
          tenantId: input.draft.tenantId,
          correlationId: input.correlationId,
          currency: input.draft.currency,
          transactionType: input.transactionType,
          status: 'POSTED',
          postingCount: input.draft.postings.length,
          postedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
      },
    ),
  };

  return { repository, calls };
}

async function expectApplicationError(
  input: PostJournalCommand,
  code: InvalidPostJournalCommandError['code'],
): Promise<void> {
  const { repository, calls } = fakeRepository();
  const postJournal = createPostJournalService(repository);

  try {
    await postJournal(input);
    throw new Error(`Expected ${code}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(InvalidPostJournalCommandError);

    if (error instanceof InvalidPostJournalCommandError) {
      expect(error.code).toBe(code);
    }
  }

  expect(calls).toHaveLength(0);
}

describe('postJournal application orchestration', () => {
  it('sends a balanced immutable prepared draft to the repository', async () => {
    const { repository, calls } = fakeRepository();
    const postJournal = createPostJournalService(repository);

    const input = command();
    const output = await postJournal(input);

    expect(output.status).toBe('POSTED');
    expect(output.postingCount).toBe(2);
    expect(calls).toHaveLength(1);

    expect(calls[0]?.draft.debitTotalMinor).toBe(125n);
    expect(calls[0]?.draft.creditTotalMinor).toBe(125n);

    expect(calls[0]?.draft.postings.map((posting) => posting.lineNo)).toEqual([1, 2]);

    expect(Object.isFrozen(calls[0]?.draft)).toBe(true);
    expect(calls[0]?.transactionType).toBe('TRANSFER');
    expect(calls[0]?.correlationId).toBe(correlationId);
  });

  it('rejects unbalanced drafts before persistence', async () => {
    const { repository, calls } = fakeRepository();

    await expect(
      createPostJournalService(repository)(
        command({
          postings: [
            {
              accountId: debitAccountId,
              side: 'DEBIT',
              amountMinor: 125n,
            },
            {
              accountId: creditAccountId,
              side: 'CREDIT',
              amountMinor: 124n,
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidJournalDraftError);

    expect(calls).toHaveLength(0);
  });

  it('rejects non-UUID tenant IDs', async () => {
    await expectApplicationError(command({ tenantId: 'tenant-123' }), 'INVALID_TENANT_UUID');
  });

  it('rejects non-UUID account IDs', async () => {
    await expectApplicationError(
      command({
        postings: [
          {
            accountId: 'not-uuid',
            side: 'DEBIT',
            amountMinor: 125n,
          },
          {
            accountId: creditAccountId,
            side: 'CREDIT',
            amountMinor: 125n,
          },
        ],
      }),
      'INVALID_ACCOUNT_UUID',
    );
  });

  it('rejects non-UUID correlation IDs', async () => {
    await expectApplicationError(command({ correlationId: 'invalid' }), 'INVALID_CORRELATION_UUID');
  });

  it('rejects blank transaction types', async () => {
    await expectApplicationError(command({ transactionType: '  ' }), 'INVALID_TRANSACTION_TYPE');
  });

  it('rejects transaction types longer than 80 characters', async () => {
    await expectApplicationError(
      command({ transactionType: 'X'.repeat(81) }),
      'INVALID_TRANSACTION_TYPE',
    );
  });

  it('accepts an 80-character transaction type', async () => {
    const { repository, calls } = fakeRepository();

    await createPostJournalService(repository)(command({ transactionType: 'X'.repeat(80) }));

    expect(calls).toHaveLength(1);
  });

  it('propagates persistence failure instead of reporting success', async () => {
    const repository: LedgerPostingRepository = {
      postPreparedJournal: vi.fn(() =>
        Promise.reject(new Error('Database transaction rolled back')),
      ),
    };

    await expect(createPostJournalService(repository)(command())).rejects.toThrow(
      'Database transaction rolled back',
    );
  });

  it('does not mutate the command postings', async () => {
    const { repository } = fakeRepository();
    const input = command();

    const originalFirst = input.postings[0];

    await createPostJournalService(repository)(input);

    expect(input.postings[0]).toBe(originalFirst);
    expect(input.postings[0]).not.toHaveProperty('lineNo');
  });
});
