import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { InvalidPostJournalCommandError } from '../../src/application/errors/invalid-post-journal-command.error.js';
import {
  createPostJournalService,
  type PostJournalCommand,
} from '../../src/application/services/post-journal.js';
import type {
  LedgerPostingRepository,
  PersistPreparedJournalInput,
  PostedJournalResult,
} from '../../src/application/ports/ledger-posting-repository.js';

function makeCommand(overrides: Partial<PostJournalCommand> = {}): PostJournalCommand {
  return {
    tenantId: uuidv7(),
    correlationId: uuidv7(),
    currency: 'PKR',
    transactionType: 'TRANSFER',
    idempotencyKey: 'transfer-001',
    postings: [
      {
        accountId: uuidv7(),
        side: 'DEBIT',
        amountMinor: 1250n,
      },
      {
        accountId: uuidv7(),
        side: 'CREDIT',
        amountMinor: 1250n,
      },
    ],
    ...overrides,
  };
}

function makeRepository(): {
  repository: LedgerPostingRepository;
  calls: PersistPreparedJournalInput[];
} {
  const calls: PersistPreparedJournalInput[] = [];

  const repository: LedgerPostingRepository = {
    postPreparedJournal: (input: PersistPreparedJournalInput): Promise<PostedJournalResult> => {
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
  };

  return { repository, calls };
}

describe('Post Journal idempotency command preparation', () => {
  it('generates a 64-character SHA-256 fingerprint', async () => {
    const { repository, calls } = makeRepository();

    await createPostJournalService(repository)(makeCommand());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0]?.idempotencyKey).toBe('transfer-001');
  });

  it('generates the same fingerprint for the same financial intent', async () => {
    const input = makeCommand();
    const { repository, calls } = makeRepository();

    const service = createPostJournalService(repository);

    await service(input);
    await service(input);

    expect(calls[0]?.requestHash).toBe(calls[1]?.requestHash);
  });

  it('excludes correlation ID from the financial fingerprint', async () => {
    const input = makeCommand();
    const { repository, calls } = makeRepository();

    const service = createPostJournalService(repository);

    await service(input);
    await service({
      ...input,
      correlationId: uuidv7(),
    });

    expect(calls[0]?.requestHash).toBe(calls[1]?.requestHash);
  });

  it('changes the fingerprint when financial amounts change', async () => {
    const input = makeCommand();
    const { repository, calls } = makeRepository();

    const service = createPostJournalService(repository);

    await service(input);

    await service({
      ...input,
      postings: input.postings.map((posting) => ({
        ...posting,
        amountMinor: posting.amountMinor + 1n,
      })),
    });

    expect(calls[0]?.requestHash).not.toBe(calls[1]?.requestHash);
  });

  it('changes the fingerprint when transaction type changes', async () => {
    const input = makeCommand();
    const { repository, calls } = makeRepository();

    const service = createPostJournalService(repository);

    await service(input);
    await service({
      ...input,
      transactionType: 'ADJUSTMENT',
    });

    expect(calls[0]?.requestHash).not.toBe(calls[1]?.requestHash);
  });

  it('rejects invalid idempotency keys before persistence', async () => {
    const { repository, calls } = makeRepository();
    const service = createPostJournalService(repository);

    for (const idempotencyKey of ['', ' ', 'key with spaces', 'x'.repeat(129)]) {
      await expect(service(makeCommand({ idempotencyKey }))).rejects.toMatchObject({
        name: 'InvalidPostJournalCommandError',
        code: 'INVALID_IDEMPOTENCY_KEY',
      });
    }

    expect(calls).toHaveLength(0);
  });

  it('returns the existing typed command error', async () => {
    const { repository } = makeRepository();

    await expect(
      createPostJournalService(repository)(makeCommand({ idempotencyKey: '' })),
    ).rejects.toBeInstanceOf(InvalidPostJournalCommandError);
  });
});
