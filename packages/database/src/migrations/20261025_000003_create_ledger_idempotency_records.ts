import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../database.js';

/**
 * Durable financial command idempotency.
 *
 * Invariants:
 * 1. One committed key per tenant and operation.
 * 2. Each key references exactly one journal.
 * 3. Referenced journal must be POSTED at commit.
 * 4. Idempotency records are immutable.
 *
 * Forward-only migration. Never rewrite applied migrations.
 */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    CREATE TABLE ledger.idempotency_records (
      tenant_id UUID NOT NULL,

      operation_type VARCHAR(80) NOT NULL
        CHECK (length(btrim(operation_type)) > 0),

      idempotency_key VARCHAR(128) NOT NULL
        CHECK (idempotency_key ~ '^[!-~]{1,128}$'),

      request_hash VARCHAR(64) NOT NULL
        CHECK (request_hash ~ '^[0-9a-f]{64}$'),

      journal_id UUID NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT idempotency_records_pk
        PRIMARY KEY (
          tenant_id,
          operation_type,
          idempotency_key
        ),

      CONSTRAINT idempotency_records_journal_unique
        UNIQUE (tenant_id, journal_id),

      CONSTRAINT idempotency_records_journal_fk
        FOREIGN KEY (tenant_id, journal_id)
        REFERENCES ledger.journals (tenant_id, id)
        DEFERRABLE INITIALLY DEFERRED
    )
  `.execute(db);

  // Idempotency history must never be rewritten or deleted.
  await sql`
    CREATE FUNCTION ledger.guard_idempotency_record_write()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      RAISE EXCEPTION
        'Committed idempotency records are immutable'
        USING ERRCODE = '23514';

      RETURN NULL;
    END;
    $fn$
  `.execute(db);

  await sql`
    CREATE TRIGGER idempotency_records_write_guard
    BEFORE UPDATE OR DELETE
    ON ledger.idempotency_records
    FOR EACH ROW
    EXECUTE FUNCTION ledger.guard_idempotency_record_write()
  `.execute(db);

  // A claim cannot commit unless its referenced journal
  // exists and has reached POSTED state.
  //
  // Deferred execution permits the claim to be inserted
  // before the financial journal within one transaction.
  await sql`
    CREATE FUNCTION ledger.assert_idempotency_target_posted()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      target_status TEXT;
    BEGIN
      SELECT j.status INTO target_status
      FROM ledger.journals j
      WHERE j.tenant_id = NEW.tenant_id
        AND j.id = NEW.journal_id;

      IF target_status IS DISTINCT FROM 'POSTED' THEN
        RAISE EXCEPTION
          'Idempotency record requires a posted journal'
          USING ERRCODE = '23514';
      END IF;

      RETURN NULL;
    END;
    $fn$
  `.execute(db);

  await sql`
    CREATE CONSTRAINT TRIGGER idempotency_records_posted_check
    AFTER INSERT ON ledger.idempotency_records
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION ledger.assert_idempotency_target_posted()
  `.execute(db);
}
