import { sql, type Kysely } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { LedgerAccountUnavailableError } from '../../application/errors/ledger-account-unavailable.error.js';
import type {
  LedgerPostingRepository,
  PersistPreparedJournalInput,
  PostedJournalResult,
} from '../../application/ports/ledger-posting-repository.js';

/**
 * Raw, parameterized SQL matches the existing ledger migration.
 *
 * Generic DB lets the composition root provide Kysely<DatabaseSchema>
 * without coupling the Ledger module to database package exports.
 */
export class KyselyLedgerPostingRepository<DB> implements LedgerPostingRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async postPreparedJournal(input: PersistPreparedJournalInput): Promise<PostedJournalResult> {
    const { draft, transactionType, correlationId } = input;

    const journalId = uuidv7();

    // This promise resolves only after COMMIT succeeds.
    // Any exception, including a deferred trigger failure,
    // rolls the transaction back.
    return this.db.transaction().execute(async (trx) => {
      // Acquire account locks in deterministic order.
      // PostgreSQL triggers independently verify account status.
      const sortedAccountIds = [
        ...new Set(draft.postings.map((posting) => posting.accountId)),
      ].sort();

      for (const accountId of sortedAccountIds) {
        const accounts = await sql<{ status: string }>`
          SELECT status
          FROM ledger.accounts
          WHERE tenant_id = ${draft.tenantId}::uuid
            AND id = ${accountId}::uuid
            AND currency = ${draft.currency}
          FOR SHARE
        `.execute(trx);

        if (accounts.rows[0]?.status !== 'ACTIVE') {
          throw new LedgerAccountUnavailableError();
        }
      }

      // New journals must begin in PENDING state.
      await sql`
        INSERT INTO ledger.journals (
          id,
          tenant_id,
          currency,
          transaction_type,
          correlation_id
        ) VALUES (
          ${journalId}::uuid,
          ${draft.tenantId}::uuid,
          ${draft.currency},
          ${transactionType},
          ${correlationId}::uuid
        )
      `.execute(trx);

      // Insert all financial postings in the same transaction.
      for (const posting of draft.postings) {
        await sql`
          INSERT INTO ledger.postings (
            id,
            tenant_id,
            journal_id,
            account_id,
            currency,
            line_no,
            side,
            amount_minor
          ) VALUES (
            ${uuidv7()}::uuid,
            ${draft.tenantId}::uuid,
            ${journalId}::uuid,
            ${posting.accountId}::uuid,
            ${draft.currency},
            ${posting.lineNo},
            ${posting.side},
            ${posting.amountMinor.toString()}::bigint
          )
        `.execute(trx);
      }

      // PostgreSQL trigger sets posted_at and effective_at.
      // Do not generate those timestamps in TypeScript.
      const updated = await sql<{ posted_at: Date }>`
        UPDATE ledger.journals
        SET status = 'POSTED'
        WHERE tenant_id = ${draft.tenantId}::uuid
          AND id = ${journalId}::uuid
          AND status = 'PENDING'
        RETURNING posted_at
      `.execute(trx);

      const row = updated.rows[0];

      if (!row) {
        throw new Error('Journal finalization affected no rows');
      }

      return Object.freeze({
        journalId,
        tenantId: draft.tenantId,
        correlationId,
        currency: draft.currency,
        transactionType,
        status: 'POSTED' as const,
        postingCount: draft.postings.length,
        postedAt: row.posted_at,
      });
    });
  }
}
