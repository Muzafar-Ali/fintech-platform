import { sql, type Kysely } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { IdempotencyConflictError } from '../../application/errors/idempotency-conflict.error.js';
import { LedgerAccountUnavailableError } from '../../application/errors/ledger-account-unavailable.error.js';
import type {
  LedgerPostingRepository,
  PersistPreparedJournalInput,
  PostedJournalResult,
} from '../../application/ports/ledger-posting-repository.js';

interface ExistingJournalRow {
  readonly request_hash: string;
  readonly journal_id: string;
  readonly tenant_id: string;
  readonly correlation_id: string;
  readonly currency: string;
  readonly transaction_type: string;
  readonly status: string;
  readonly posted_at: Date | null;
  readonly posting_count: number;
}

const OPERATION_TYPE = 'POST_JOURNAL' as const;

/**
 * PostgreSQL implementation of durable financial idempotency.
 *
 * The unique idempotency key coordinates concurrent requests.
 * The claim and all financial writes share one transaction.
 */
export class KyselyLedgerPostingRepository<DB> implements LedgerPostingRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async postPreparedJournal(input: PersistPreparedJournalInput): Promise<PostedJournalResult> {
    const { draft, transactionType, correlationId, idempotencyKey, requestHash } = input;

    const journalId = uuidv7();

    return this.db.transaction().execute(async (trx) => {
      /**
       * STEP 1: Claim command identity.
       *
       * The primary key serializes concurrent requests using
       * the same tenant + operation + idempotency key.
       *
       * The journal FK is deferred, so this claim may
       * reference the journal we will insert below.
       */
      const claim = await sql<{ journal_id: string }>`
        INSERT INTO ledger.idempotency_records (
          tenant_id,
          operation_type,
          idempotency_key,
          request_hash,
          journal_id
        ) VALUES (
          ${draft.tenantId}::uuid,
          ${OPERATION_TYPE},
          ${idempotencyKey},
          ${requestHash},
          ${journalId}::uuid
        )
        ON CONFLICT (
          tenant_id,
          operation_type,
          idempotency_key
        )
        DO NOTHING
        RETURNING journal_id::text AS journal_id
      `.execute(trx);

      /**
       * STEP 2: Existing key.
       *
       * We must query in a separate SQL statement.
       * Under READ COMMITTED, that statement can see
       * the transaction whose key claim just committed.
       */
      if (claim.rows.length === 0) {
        const existing = await sql<ExistingJournalRow>`
          SELECT
            r.request_hash,
            j.id::text AS journal_id,
            j.tenant_id::text AS tenant_id,
            j.correlation_id::text AS correlation_id,
            j.currency,
            j.transaction_type,
            j.status,
            j.posted_at,
            (
              SELECT COUNT(*)::integer
              FROM ledger.postings p
              WHERE p.tenant_id = j.tenant_id
                AND p.journal_id = j.id
            ) AS posting_count
          FROM ledger.idempotency_records r
          JOIN ledger.journals j
            ON j.tenant_id = r.tenant_id
           AND j.id = r.journal_id
          WHERE r.tenant_id = ${draft.tenantId}::uuid
            AND r.operation_type = ${OPERATION_TYPE}
            AND r.idempotency_key = ${idempotencyKey}
        `.execute(trx);

        const original = existing.rows[0];

        if (!original) {
          throw new Error('Committed idempotency claim has no associated journal');
        }

        if (original.request_hash !== requestHash) {
          throw new IdempotencyConflictError();
        }

        if (original.status !== 'POSTED' || !(original.posted_at instanceof Date)) {
          throw new Error('Committed idempotency claim references an invalid journal');
        }

        // Replay the ORIGINAL committed financial result.
        // Do not use the retry request's correlation ID.
        return Object.freeze({
          journalId: original.journal_id,
          tenantId: original.tenant_id,
          correlationId: original.correlation_id,
          currency: original.currency,
          transactionType: original.transaction_type,
          status: 'POSTED' as const,
          postingCount: original.posting_count,
          postedAt: original.posted_at,
        });
      }

      /**
       * STEP 3: First claim owner.
       *
       * Acquire account locks in deterministic order
       * and verify active tenant/currency-compatible accounts.
       */
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

      /**
       * STEP 4: Insert the PENDING journal.
       */
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

      /**
       * STEP 5: Insert postings.
       * Every line is part of the same transaction.
       */
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

      /**
       * STEP 6: Finalize.
       * PostgreSQL triggers generate posting timestamps.
       */
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

      /**
       * STEP 7: Commit is managed by Kysely.
       *
       * Deferred checks verify:
       * - Balanced journal
       * - Referential integrity
       * - Idempotency record points to POSTED journal
       *
       * A failed commit rolls back the claim and journal.
       */
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
