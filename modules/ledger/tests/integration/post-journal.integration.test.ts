import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { Pool } from 'pg';
import { v7 as uuidv7, version as uuidVersion } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LedgerAccountUnavailableError } from '../../src/application/errors/ledger-account-unavailable.error.js';
import { createPostJournalService } from '../../src/application/services/post-journal.js';
import type { PostJournalCommand } from '../../src/application/services/post-journal.js';
import { KyselyLedgerPostingRepository } from '../../src/infrastructure/repositories/kysely-ledger-posting.repository.js';
import type { PreparedJournal } from '../../src/domain/value-objects/journal-draft.js';
import { IdempotencyConflictError } from '../../src/application/errors/idempotency-conflict.error.js';

/**
 * This suite MUST NEVER run against fintech_local
 * or any production database.
 */
const connectionString = process.env['LEDGER_TEST_DATABASE_URL'];

const databaseName = connectionString
  ? decodeURIComponent(new URL(connectionString).pathname.slice(1))
  : '';

let db: Kysely<Record<string, never>> | undefined;

function testDatabase(): Kysely<Record<string, never>> {
  if (!db) {
    throw new Error('Ledger test database was not initialized');
  }

  return db;
}

let postJournal: ReturnType<typeof createPostJournalService>;

let repository: KyselyLedgerPostingRepository<Record<string, never>>;

let tenantId: string;
let debitAccountId: string;
let creditAccountId: string;

async function addAccount(
  id: string,
  tenant: string,
  currency = 'PKR',
  status = 'ACTIVE',
): Promise<void> {
  await sql`
    INSERT INTO ledger.accounts (
      id,
      tenant_id,
      currency,
      account_type,
      status
    )
    VALUES (
      ${id}::uuid,
      ${tenant}::uuid,
      ${currency},
      'ASSET',
      ${status}
    )
  `.execute(testDatabase());
}

function command(overrides: Partial<PostJournalCommand> = {}): PostJournalCommand {
  return {
    tenantId,
    currency: 'PKR',
    transactionType: 'TRANSFER',
    correlationId: uuidv7(),
    idempotencyKey: uuidv7(),
    postings: [
      {
        accountId: debitAccountId,
        side: 'DEBIT',
        amountMinor: 1_250n,
      },
      {
        accountId: creditAccountId,
        side: 'CREDIT',
        amountMinor: 1_250n,
      },
    ],
    ...overrides,
  };
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  const state: { done?: () => void } = {};

  const promise = new Promise<void>((done) => {
    state.done = done;
  });

  return {
    promise,
    resolve: () => {
      if (!state.done) {
        throw new Error('Deferred promise was not initialized');
      }

      state.done();
    },
  };
}

async function journalCount(tenant: string): Promise<string> {
  const response = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM ledger.journals
    WHERE tenant_id = ${tenant}::uuid
  `.execute(testDatabase());

  const row = response.rows[0];

  if (!row) {
    throw new Error('Journal count query returned no rows');
  }

  return row.count;
}

beforeAll(async () => {
  if (!connectionString) {
    throw new Error('LEDGER_TEST_DATABASE_URL is required for ledger integration tests');
  }

  if (!/^fintech_ledger_test(?:_[a-z0-9_]+)?$/.test(databaseName)) {
    throw new Error(
      'Refusing ledger integration tests: database must be named fintech_ledger_test (or fintech_ledger_test_*)',
    );
  }

  const pool = new Pool({
    connectionString,
    max: 4,
  });

  db = new Kysely<Record<string, never>>({
    dialect: new PostgresDialect({ pool }),
  });

  // Apply the existing compiled database migrations.
  // Do not create separate test-only ledger tables.
  //
  // Build @fintech/database before running this suite.
  const migrationFolder = fileURLToPath(
    new URL('../../../../packages/database/dist/migrations/', import.meta.url),
  );

  const migrator = new Migrator({
    db: testDatabase(),
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder,

      // Node.js ESM requires file:// URLs for absolute
      // Windows paths. Works on Linux and Windows.
      import: async (migrationFile: string): Promise<unknown> => {
        const migrationModule: unknown = await import(pathToFileURL(migrationFile).href);

        return migrationModule;
      },
    }),
  });

  const migrationResult = await migrator.migrateToLatest();

  if (migrationResult.error) {
    throw new Error('Ledger test DB migrations failed', {
      cause: migrationResult.error,
    });
  }

  repository = new KyselyLedgerPostingRepository(testDatabase());

  postJournal = createPostJournalService(repository);
}, 30_000);

afterAll(async () => {
  if (db) {
    await db.destroy();
  }
});

beforeEach(async () => {
  // Each test receives fresh tenant and account UUIDs.
  // Ledger records are immutable: use a throwaway database.
  tenantId = uuidv7();
  debitAccountId = uuidv7();
  creditAccountId = uuidv7();

  await addAccount(debitAccountId, tenantId);
  await addAccount(creditAccountId, tenantId);
});

describe('Atomic journal posting against PostgreSQL', () => {
  it('commits the journal and both postings together', async () => {
    const input = command();
    const result = await postJournal(input);

    expect(result.status).toBe('POSTED');
    expect(result.postingCount).toBe(2);
    expect(result.correlationId).toBe(input.correlationId);
    expect(uuidVersion(result.journalId)).toBe(7);
    expect(result.postedAt).toBeInstanceOf(Date);

    const journals = await sql<{
      status: string;
      correlation_id: string;
      posted_at: Date;
      effective_at: Date;
    }>`
      SELECT
        status,
        correlation_id::text AS correlation_id,
        posted_at,
        effective_at
      FROM ledger.journals
      WHERE id = ${result.journalId}::uuid
        AND tenant_id = ${tenantId}::uuid
    `.execute(testDatabase());

    expect(journals.rows).toHaveLength(1);
    expect(journals.rows[0]?.status).toBe('POSTED');
    expect(journals.rows[0]?.correlation_id).toBe(input.correlationId);
    expect(journals.rows[0]?.posted_at).toBeInstanceOf(Date);
    expect(journals.rows[0]?.effective_at).toBeInstanceOf(Date);

    const postings = await sql<{
      line_no: number;
      side: string;
      amount_minor: string;
      account_id: string;
    }>`
      SELECT
        line_no,
        side,
        amount_minor::text AS amount_minor,
        account_id::text AS account_id
      FROM ledger.postings
      WHERE journal_id = ${result.journalId}::uuid
        AND tenant_id = ${tenantId}::uuid
      ORDER BY line_no
    `.execute(testDatabase());

    expect(postings.rows).toEqual([
      {
        line_no: 1,
        side: 'DEBIT',
        amount_minor: '1250',
        account_id: debitAccountId,
      },
      {
        line_no: 2,
        side: 'CREDIT',
        amount_minor: '1250',
        account_id: creditAccountId,
      },
    ]);
  });

  it('supports valid three-line journals', async () => {
    const thirdAccount = uuidv7();

    await addAccount(thirdAccount, tenantId);

    const result = await postJournal(
      command({
        postings: [
          {
            accountId: debitAccountId,
            side: 'DEBIT',
            amountMinor: 1_250n,
          },
          {
            accountId: creditAccountId,
            side: 'CREDIT',
            amountMinor: 750n,
          },
          {
            accountId: thirdAccount,
            side: 'CREDIT',
            amountMinor: 500n,
          },
        ],
      }),
    );

    expect(result.postingCount).toBe(3);
    expect(result.status).toBe('POSTED');
  });

  it('rejects a missing account without persisting a journal', async () => {
    const before = await journalCount(tenantId);

    await expect(
      postJournal(
        command({
          postings: [
            {
              accountId: debitAccountId,
              side: 'DEBIT',
              amountMinor: 1_250n,
            },
            {
              accountId: uuidv7(),
              side: 'CREDIT',
              amountMinor: 1_250n,
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(LedgerAccountUnavailableError);

    expect(await journalCount(tenantId)).toBe(before);
  });

  it('rejects suspended accounts without persisting a journal', async () => {
    await sql`
      UPDATE ledger.accounts
      SET status = 'SUSPENDED'
      WHERE id = ${creditAccountId}::uuid
    `.execute(testDatabase());

    const before = await journalCount(tenantId);

    await expect(postJournal(command())).rejects.toBeInstanceOf(LedgerAccountUnavailableError);

    expect(await journalCount(tenantId)).toBe(before);
  });

  it('does not reveal or use an account belonging to another tenant', async () => {
    const otherTenant = uuidv7();
    const otherAccount = uuidv7();

    await addAccount(otherAccount, otherTenant);

    const before = await journalCount(tenantId);

    await expect(
      postJournal(
        command({
          postings: [
            {
              accountId: debitAccountId,
              side: 'DEBIT',
              amountMinor: 1_250n,
            },
            {
              accountId: otherAccount,
              side: 'CREDIT',
              amountMinor: 1_250n,
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(LedgerAccountUnavailableError);

    expect(await journalCount(tenantId)).toBe(before);
  });

  it('rejects incompatible account currency and rolls back', async () => {
    const usdAccount = uuidv7();

    await addAccount(usdAccount, tenantId, 'USD');

    const before = await journalCount(tenantId);

    await expect(
      postJournal(
        command({
          postings: [
            {
              accountId: debitAccountId,
              side: 'DEBIT',
              amountMinor: 1_250n,
            },
            {
              accountId: usdAccount,
              side: 'CREDIT',
              amountMinor: 1_250n,
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(LedgerAccountUnavailableError);

    expect(await journalCount(tenantId)).toBe(before);
  });

  it('rolls back all rows if deferred balance trigger rejects COMMIT', async () => {
    const before = await journalCount(tenantId);

    const idempotencyKey = uuidv7();

    // Deliberately bypass application/domain validation.
    // This verifies PostgreSQL's independent financial integrity.
    const malformedDraft: PreparedJournal = {
      tenantId,
      currency: 'PKR',
      debitTotalMinor: 100n,
      creditTotalMinor: 99n,
      postings: [
        {
          lineNo: 1,
          accountId: debitAccountId,
          side: 'DEBIT',
          amountMinor: 100n,
        },
        {
          lineNo: 2,
          accountId: creditAccountId,
          side: 'CREDIT',
          amountMinor: 99n,
        },
      ],
    };

    await expect(
      repository.postPreparedJournal({
        draft: malformedDraft,
        transactionType: 'TRANSFER',
        correlationId: uuidv7(),

        // Required by the Task 13E repository contract.
        idempotencyKey,
        requestHash: '0'.repeat(64),
      }),
    ).rejects.toThrow('Posted journal must contain balanced debit and credit entries');

    // Verify the failed transaction committed no journal.
    expect(await journalCount(tenantId)).toBe(before);

    // Verify that the idempotency claim also rolled back.
    const records = await sql<{ count: string }>`
    SELECT COUNT(*)::text AS count
    FROM ledger.idempotency_records
    WHERE tenant_id = ${tenantId}::uuid
      AND operation_type = 'POST_JOURNAL'
      AND idempotency_key = ${idempotencyKey}
  `.execute(testDatabase());

    expect(records.rows[0]?.count).toBe('0');
  });

  it('does not post against an account being suspended concurrently', async () => {
    const statusLocked = deferred();
    const mayCommitStatus = deferred();

    const updatingAccount = testDatabase()
      .transaction()
      .execute(async (trx) => {
        await sql`
          UPDATE ledger.accounts
          SET status = 'SUSPENDED'
          WHERE id = ${creditAccountId}::uuid
        `.execute(trx);

        statusLocked.resolve();

        await mayCommitStatus.promise;
      });

    await statusLocked.promise;

    const postAttempt = postJournal(command());

    const assertion = expect(postAttempt).rejects.toBeInstanceOf(LedgerAccountUnavailableError);

    mayCommitStatus.resolve();

    await updatingAccount;
    await assertion;

    expect(await journalCount(tenantId)).toBe('0');
  });

  it('supports concurrent independent postings to active accounts', async () => {
    const [first, second] = await Promise.all([postJournal(command()), postJournal(command())]);

    expect(first.status).toBe('POSTED');
    expect(second.status).toBe('POSTED');
    expect(first.journalId).not.toBe(second.journalId);

    expect(await journalCount(tenantId)).toBe('2');
  });

  it('replays the original journal for the same command', async () => {
    const input = command();

    const first = await postJournal(input);
    const second = await postJournal(input);

    expect(second).toEqual(first);
    expect(second.journalId).toBe(first.journalId);
    expect(await journalCount(tenantId)).toBe('1');
  });

  it('rejects the same key with a different financial payload', async () => {
    const input = command();

    const original = await postJournal(input);

    await expect(
      postJournal({
        ...input,
        postings: input.postings.map((posting) => ({
          ...posting,
          amountMinor: posting.amountMinor + 1n,
        })),
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    expect(await journalCount(tenantId)).toBe('1');

    const replay = await postJournal(input);
    expect(replay.journalId).toBe(original.journalId);
  });

  it('coordinates concurrent requests with the same key', async () => {
    const input = command();

    const [first, second] = await Promise.all([postJournal(input), postJournal(input)]);

    expect(first.journalId).toBe(second.journalId);
    expect(first).toEqual(second);
    expect(await journalCount(tenantId)).toBe('1');
  });

  it('returns the original correlation ID on replay', async () => {
    const input = command();

    const first = await postJournal(input);

    const second = await postJournal({
      ...input,
      correlationId: uuidv7(),
    });

    expect(second.journalId).toBe(first.journalId);
    expect(second.correlationId).toBe(input.correlationId);
    expect(second.postedAt).toEqual(first.postedAt);

    expect(await journalCount(tenantId)).toBe('1');
  });

  it('allows different idempotency keys to post separate journals', async () => {
    const input = command();

    const first = await postJournal(input);

    const second = await postJournal({
      ...input,
      idempotencyKey: uuidv7(),
    });

    expect(first.journalId).not.toBe(second.journalId);
    expect(await journalCount(tenantId)).toBe('2');
  });

  it('rolls back the idempotency claim after a failed financial commit', async () => {
    const idempotencyKey = uuidv7();

    const malformedDraft: PreparedJournal = {
      tenantId,
      currency: 'PKR',
      debitTotalMinor: 100n,
      creditTotalMinor: 99n,
      postings: [
        {
          lineNo: 1,
          accountId: debitAccountId,
          side: 'DEBIT',
          amountMinor: 100n,
        },
        {
          lineNo: 2,
          accountId: creditAccountId,
          side: 'CREDIT',
          amountMinor: 99n,
        },
      ],
    };

    await expect(
      repository.postPreparedJournal({
        draft: malformedDraft,
        transactionType: 'TRANSFER',
        correlationId: uuidv7(),
        idempotencyKey,
        requestHash: '0'.repeat(64),
      }),
    ).rejects.toThrow();

    const claims = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM ledger.idempotency_records
    WHERE tenant_id = ${tenantId}::uuid
      AND operation_type = 'POST_JOURNAL'
      AND idempotency_key = ${idempotencyKey}
  `.execute(testDatabase());

    expect(claims.rows[0]?.count).toBe('0');
    expect(await journalCount(tenantId)).toBe('0');

    // The failed claim must not poison the key.
    const result = await postJournal(command({ idempotencyKey }));

    expect(result.status).toBe('POSTED');
    expect(await journalCount(tenantId)).toBe('1');
  });

  it('prevents mutation of a committed idempotency record', async () => {
    const input = command();

    await postJournal(input);

    await expect(
      sql`
      UPDATE ledger.idempotency_records
      SET request_hash = ${'f'.repeat(64)}
      WHERE tenant_id = ${tenantId}::uuid
        AND operation_type = 'POST_JOURNAL'
        AND idempotency_key = ${input.idempotencyKey}
    `.execute(testDatabase()),
    ).rejects.toThrow();

    // The failed UPDATE must not corrupt replay behavior.
    const replay = await postJournal(input);

    expect(replay.status).toBe('POSTED');
    expect(await journalCount(tenantId)).toBe('1');
  });
});
