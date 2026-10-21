import { sql, type Kysely } from 'kysely';

import type { DatabaseSchema } from '../database.js';

/**
 * Ledger foundation.
 *
 * The ledger schema already exists from migration 000001.
 * Migrations are forward-only; never rewrite applied history.
 */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  // 1. Financial accounts belong to one tenant and one currency.
  await sql`
    CREATE TABLE ledger.accounts (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      account_type TEXT NOT NULL
        CHECK (account_type IN (
          'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'
        )),
      currency VARCHAR(3) NOT NULL
        CHECK (currency ~ '^[A-Z]{3}$'),
      status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT accounts_tenant_id_currency_unique
        UNIQUE (tenant_id, id, currency)
    )
  `.execute(db);

  // 2. A journal represents one financial accounting event.
  await sql`
    CREATE TABLE ledger.journals (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      currency VARCHAR(3) NOT NULL
        CHECK (currency ~ '^[A-Z]{3}$'),
      transaction_type VARCHAR(80) NOT NULL
        CHECK (length(btrim(transaction_type)) > 0),
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'POSTED', 'CANCELLED')),
      correlation_id UUID NOT NULL,
      reversal_of_journal_id UUID,
      effective_at TIMESTAMPTZ,
      posted_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT journals_state_consistency CHECK (
        (
          status = 'PENDING'
          AND posted_at IS NULL
          AND effective_at IS NULL
          AND cancelled_at IS NULL
        )
        OR
        (
          status = 'POSTED'
          AND posted_at IS NOT NULL
          AND effective_at IS NOT NULL
          AND cancelled_at IS NULL
        )
        OR
        (
          status = 'CANCELLED'
          AND posted_at IS NULL
          AND effective_at IS NULL
          AND cancelled_at IS NOT NULL
        )
      ),

      CONSTRAINT journals_tenant_id_unique
        UNIQUE (tenant_id, id),

      CONSTRAINT journals_tenant_id_currency_unique
        UNIQUE (tenant_id, id, currency),

      CONSTRAINT journals_reversal_reference_unique
        UNIQUE (tenant_id, reversal_of_journal_id),

      CONSTRAINT journals_no_self_reversal
        CHECK (
          reversal_of_journal_id IS NULL
          OR reversal_of_journal_id <> id
        ),

      CONSTRAINT journals_reversal_tenant_fk
        FOREIGN KEY (tenant_id, reversal_of_journal_id)
        REFERENCES ledger.journals (tenant_id, id)
    )
  `.execute(db);

  // 3. Postings are debit/credit lines within one journal.
  await sql`
    CREATE TABLE ledger.postings (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      journal_id UUID NOT NULL,
      account_id UUID NOT NULL,
      currency VARCHAR(3) NOT NULL
        CHECK (currency ~ '^[A-Z]{3}$'),
      line_no INTEGER NOT NULL CHECK (line_no > 0),
      side TEXT NOT NULL
        CHECK (side IN ('DEBIT', 'CREDIT')),
      amount_minor BIGINT NOT NULL
        CHECK (amount_minor > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT postings_unique_journal_line
        UNIQUE (tenant_id, journal_id, line_no),

      CONSTRAINT postings_journal_tenant_currency_fk
        FOREIGN KEY (tenant_id, journal_id, currency)
        REFERENCES ledger.journals (tenant_id, id, currency),

      CONSTRAINT postings_account_tenant_currency_fk
        FOREIGN KEY (tenant_id, account_id, currency)
        REFERENCES ledger.accounts (tenant_id, id, currency)
    )
  `.execute(db);

  // 4. Indexes for tenant-scoped journals and account history.
  await sql`
    CREATE INDEX journals_tenant_history_idx
    ON ledger.journals (tenant_id, created_at DESC, id DESC)
  `.execute(db);

  await sql`
    CREATE INDEX postings_account_history_idx
    ON ledger.postings (
      tenant_id, account_id, created_at DESC, id DESC
    )
  `.execute(db);

  // 5. Account identity, currency and type are immutable.
  await sql`
    CREATE FUNCTION ledger.guard_account_write()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Ledger accounts cannot be deleted'
          USING ERRCODE = '23514';
      END IF;

      IF (
        NEW.id, NEW.tenant_id, NEW.currency,
        NEW.account_type, NEW.created_at
      ) IS DISTINCT FROM (
        OLD.id, OLD.tenant_id, OLD.currency,
        OLD.account_type, OLD.created_at
      ) THEN
        RAISE EXCEPTION 'Ledger account identity is immutable'
          USING ERRCODE = '23514';
      END IF;

      IF OLD.status = 'CLOSED' AND NEW.status <> 'CLOSED' THEN
        RAISE EXCEPTION 'Closed ledger accounts cannot be reopened'
          USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $fn$
  `.execute(db);

  await sql`
    CREATE TRIGGER accounts_write_guard
    BEFORE UPDATE OR DELETE ON ledger.accounts
    FOR EACH ROW EXECUTE FUNCTION ledger.guard_account_write()
  `.execute(db);

  // 6. Journal lifecycle and posted-history immutability.
  await sql`
    CREATE FUNCTION ledger.guard_journal_write()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      original_status TEXT;
      original_currency TEXT;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Ledger journals cannot be deleted'
          USING ERRCODE = '23514';
      END IF;

      IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PENDING' THEN
          RAISE EXCEPTION 'New journals must start PENDING'
            USING ERRCODE = '23514';
        END IF;

        IF NEW.reversal_of_journal_id IS NOT NULL THEN
          SELECT j.status, j.currency
          INTO original_status, original_currency
          FROM ledger.journals j
          WHERE j.tenant_id = NEW.tenant_id
            AND j.id = NEW.reversal_of_journal_id
          FOR SHARE;

          IF original_status IS DISTINCT FROM 'POSTED'
             OR original_currency IS DISTINCT FROM NEW.currency
          THEN
            RAISE EXCEPTION
              'Reversal must reference a posted journal in the same currency'
              USING ERRCODE = '23514';
          END IF;
        END IF;

        RETURN NEW;
      END IF;

      IF OLD.status <> 'PENDING' THEN
        RAISE EXCEPTION 'Finalized journals are immutable'
          USING ERRCODE = '23514';
      END IF;

      IF (
        NEW.id, NEW.tenant_id, NEW.currency,
        NEW.transaction_type, NEW.correlation_id,
        NEW.reversal_of_journal_id, NEW.created_at
      ) IS DISTINCT FROM (
        OLD.id, OLD.tenant_id, OLD.currency,
        OLD.transaction_type, OLD.correlation_id,
        OLD.reversal_of_journal_id, OLD.created_at
      ) THEN
        RAISE EXCEPTION 'Journal identity and metadata are immutable'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.status = 'POSTED' THEN
        NEW.posted_at := clock_timestamp();
        NEW.effective_at := COALESCE(
          NEW.effective_at, NEW.posted_at
        );
        NEW.cancelled_at := NULL;
      ELSIF NEW.status = 'CANCELLED' THEN
        NEW.cancelled_at := clock_timestamp();
        NEW.posted_at := NULL;
        NEW.effective_at := NULL;
      ELSE
        RAISE EXCEPTION 'Invalid journal state transition'
          USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $fn$
  `.execute(db);

  await sql`
    CREATE TRIGGER journals_write_guard
    BEFORE INSERT OR UPDATE OR DELETE ON ledger.journals
    FOR EACH ROW EXECUTE FUNCTION ledger.guard_journal_write()
  `.execute(db);

  // 7. New postings are allowed only against pending journals
  // and active accounts. Locking the parent journal serializes
  // posting insertion against journal finalization.
  await sql`
    CREATE FUNCTION ledger.guard_posting_write()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      journal_status TEXT;
      account_status TEXT;
    BEGIN
      IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Ledger postings are immutable'
          USING ERRCODE = '23514';
      END IF;

      SELECT j.status INTO journal_status
      FROM ledger.journals j
      WHERE j.tenant_id = NEW.tenant_id
        AND j.id = NEW.journal_id
        AND j.currency = NEW.currency
      FOR UPDATE;

      IF journal_status IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'Postings require a pending journal'
          USING ERRCODE = '23514';
      END IF;

      SELECT a.status INTO account_status
      FROM ledger.accounts a
      WHERE a.tenant_id = NEW.tenant_id
        AND a.id = NEW.account_id
        AND a.currency = NEW.currency
      FOR SHARE;

      IF account_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'Postings require an active account'
          USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $fn$
  `.execute(db);

  await sql`
    CREATE TRIGGER postings_write_guard
    BEFORE INSERT OR UPDATE OR DELETE ON ledger.postings
    FOR EACH ROW EXECUTE FUNCTION ledger.guard_posting_write()
  `.execute(db);

  // 8. Deferred verification checks the FINAL transaction state.
  // Pending/cancelled journals cannot retain committed postings.
  // Posted journals require at least two balanced postings.
  await sql`
    CREATE FUNCTION ledger.assert_journal_integrity()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      target_journal_id UUID;
      journal_status TEXT;
      posting_count BIGINT;
      debit_total NUMERIC;
      credit_total NUMERIC;
    BEGIN
      IF TG_TABLE_NAME = 'postings' THEN
        target_journal_id := NEW.journal_id;
      ELSE
        target_journal_id := NEW.id;
      END IF;

      SELECT j.status INTO journal_status
      FROM ledger.journals j
      WHERE j.tenant_id = NEW.tenant_id
        AND j.id = target_journal_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal missing during integrity verification'
          USING ERRCODE = '23514';
      END IF;

      SELECT
        COUNT(*),
        COALESCE(
          SUM(p.amount_minor::numeric)
            FILTER (WHERE p.side = 'DEBIT'), 0
        ),
        COALESCE(
          SUM(p.amount_minor::numeric)
            FILTER (WHERE p.side = 'CREDIT'), 0
        )
      INTO posting_count, debit_total, credit_total
      FROM ledger.postings p
      WHERE p.tenant_id = NEW.tenant_id
        AND p.journal_id = target_journal_id;

      IF journal_status = 'POSTED' THEN
        IF posting_count < 2 OR debit_total <> credit_total THEN
          RAISE EXCEPTION
            'Posted journal must contain balanced debit and credit entries'
            USING ERRCODE = '23514';
        END IF;
      ELSIF posting_count <> 0 THEN
        RAISE EXCEPTION
          'Unposted journal cannot commit financial postings'
          USING ERRCODE = '23514';
      END IF;

      RETURN NULL;
    END;
    $fn$
  `.execute(db);

  await sql`
    CREATE CONSTRAINT TRIGGER journals_integrity_check
    AFTER INSERT OR UPDATE ON ledger.journals
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION ledger.assert_journal_integrity()
  `.execute(db);

  await sql`
    CREATE CONSTRAINT TRIGGER postings_integrity_check
    AFTER INSERT ON ledger.postings
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION ledger.assert_journal_integrity()
  `.execute(db);
}
