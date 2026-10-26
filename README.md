# Fintech Money Movement Platform

A ledger-first fintech infrastructure platform built with **TypeScript, Node.js, Express.js, PostgreSQL and Kysely**.

The project focuses on financial correctness, transaction integrity, auditability, concurrency safety and resilient money-movement infrastructure.

> **Development status (Task 13E):** Exact monetary primitives, ledger domain validation, PostgreSQL-enforced double-entry accounting, **internal atomic journal posting**, and **durable command-level idempotency** are implemented and locally tested. Authenticated financial APIs, reversal processing, balance/overspending controls, transactional outbox, and observability infrastructure remain under development. This project uses **simulated financial data**, not real customer funds.

## Architecture approach

- **Modular monolith** with explicit domain, application, and infrastructure boundaries.
- **PostgreSQL** as the authoritative financial system of record.
- **Exact money representation** using TypeScript `bigint` minor units and canonical decimal-string serialization.
- **Defense in depth:** pure TypeScript validation plus independent PostgreSQL constraints, triggers, and commit-time checks.
- **Transaction-scoped writes:** financial journal, postings, and idempotency claim commit or roll back together.
- **Future asynchronous infrastructure:** transactional outbox and workers; neither a cache nor a message broker is accounting truth.
- **Verification:** unit, property-based, real PostgreSQL integration, failure, and concurrency testing.

## Technology stack

| Area                         | Technology                                                                 |
| ---------------------------- | -------------------------------------------------------------------------- |
| Language/runtime             | TypeScript / Node.js 24                                                    |
| HTTP foundation              | Express.js                                                                 |
| Database                     | PostgreSQL 17                                                              |
| Query builder / migrations   | Kysely                                                                     |
| Configuration and validation | Zod                                                                        |
| Monetary representation      | `bigint` minor units                                                       |
| Testing                      | Vitest, fast-check, PostgreSQL integration tests                           |
| Local infrastructure         | Docker Compose                                                             |
| CI/CD                        | GitHub Actions                                                             |
| Observability                | **Planned mandatory milestone:** OpenTelemetry, Prometheus, Tempo, Grafana |

## Repository structure

```text
apps/
  api/                 Express API foundation
  worker/              Background worker foundation
modules/
  ledger/              Ledger domain, application service, and persistence adapter
packages/
  money/               Exact monetary representation and arithmetic
  database/            PostgreSQL connections, migrations, and database utilities
infrastructure/
  docker/              Local PostgreSQL infrastructure
docs/
  adr/                 Architecture Decision Records
  architecture/        Architecture documents and diagrams
  runbooks/            Operational procedures
```

## Local development

**Requirements:** Node.js 24, pnpm, and Docker.

From the repository root (Windows CMD):

```cmd
pnpm install --frozen-lockfile
```

If `.env` does not already exist, copy `.env.example` to `.env` and configure local development credentials. **Do not commit `.env`.**

Build the workspaces before running the compiled database migration CLI or typechecking consumers; Ledger imports the compiled declarations from `@fintech/money`:

```cmd
pnpm build
docker compose --env-file .env -f infrastructure/docker/compose.yaml up -d postgres
pnpm --filter @fintech/database migrate:up
pnpm check
```

Database integration tests require the appropriate disposable PostgreSQL test database and credentials. Ledger posting integration tests use `LEDGER_TEST_DATABASE_URL` pointing to **`fintech_ledger_test`**, never the development or a production database. For example, in the current CMD terminal:

```cmd
set "LEDGER_TEST_DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@127.0.0.1:5433/fintech_ledger_test"
pnpm --filter @fintech/database test:integration
pnpm --filter @fintech/ledger test:integration
```

The example connection string uses placeholders; keep actual credentials private. Existing test-database setup and guards must be respected.

## Implemented capabilities

| Area                   | Implementation                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact money            | `@fintech/money`: `bigint` minor units, canonical serialization, currency validation, signed PostgreSQL `BIGINT` compatibility                          |
| Database foundation    | PostgreSQL 17, Kysely connection factory, Zod-validated configuration, forward-only migrations                                                          |
| Ledger schema          | `ledger.accounts`, `ledger.journals`, `ledger.postings`, and `ledger.idempotency_records`                                                               |
| Domain validation      | Pure `prepareBalancedJournal()` with exact balancing, typed errors, immutable result, and deterministic posting lines                                   |
| Financial integrity    | Database checks, composite tenant/currency foreign keys, lifecycle guards, immutable posting/history constraints, deferred commit-time balancing        |
| Atomic journal posting | Internal `createPostJournalService()` and `KyselyLedgerPostingRepository` commit journal and postings in one transaction                                |
| UUIDv7                 | Journal/posting identifiers generated by the internal posting adapter using UUIDv7                                                                      |
| Account safety         | Active-account validation and deterministic account lock ordering inside posting transactions                                                           |
| Durable idempotency    | Tenant/operation/key uniqueness, SHA-256 financial fingerprint, same-key replay, conflict detection, concurrent claim coordination, and atomic rollback |

### Ledger database architecture

```mermaid
erDiagram
    ACCOUNTS ||--o{ POSTINGS : receives
    JOURNALS ||--o{ POSTINGS : contains
    JOURNALS o|--o| JOURNALS : reversal_reference
    JOURNALS ||--o| IDEMPOTENCY_RECORDS : command_identity

    ACCOUNTS {
        uuid id PK
        uuid tenant_id
        text account_type
        varchar currency
        text status
        timestamptz created_at
    }
    JOURNALS {
        uuid id PK
        uuid tenant_id
        varchar currency
        text transaction_type
        text status
        uuid correlation_id
        uuid reversal_of_journal_id FK
        timestamptz posted_at
    }
    POSTINGS {
        uuid id PK
        uuid tenant_id
        uuid journal_id FK
        uuid account_id FK
        varchar currency
        integer line_no
        text side
        bigint amount_minor
    }
    IDEMPOTENCY_RECORDS {
        uuid tenant_id PK
        varchar operation_type PK
        varchar idempotency_key PK
        varchar request_hash
        uuid journal_id FK
        timestamptz created_at
    }
```

_Conceptual ERD only._ The actual migrations include composite foreign keys, unique keys, check constraints, indexes, and PostgreSQL triggers. See the [detailed ledger persistence architecture](docs/architecture/ledger-persistence.md).

### Financial invariants and enforcement

| Invariant                                                                                               | Enforcement                                                     | Verification                      |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------- |
| Posted journal contains at least two postings                                                           | Deferred PostgreSQL integrity trigger                           | Integration-tested                |
| Exact debit total equals credit total                                                                   | Domain `bigint` arithmetic and PostgreSQL `NUMERIC` aggregation | Unit/property + integration tests |
| Pending/cancelled journals cannot commit postings                                                       | Deferred PostgreSQL trigger                                     | Integration-tested                |
| Every posting amount is positive and within supported range                                             | Money/domain validation and PostgreSQL `BIGINT`/`CHECK`         | Unit/property + integration tests |
| Posting journal/account share tenant and currency                                                       | Composite foreign keys and write guards                         | Integration-tested                |
| Only active accounts accept new postings                                                                | Transactional account checks and PostgreSQL trigger             | Integration-tested                |
| Posting history and finalized journals are immutable                                                    | PostgreSQL triggers                                             | Integration-tested                |
| Account identity is immutable; closed accounts cannot reopen                                            | PostgreSQL trigger                                              | Integration-tested                |
| Reversal reference points to a posted journal in the same tenant/currency; duplicate references blocked | PostgreSQL checks and uniqueness                                | Integration-tested                |
| Same tenant/operation/idempotency key cannot create two committed command identities                    | PostgreSQL primary key and transaction claim                    | Integration-tested                |
| Idempotency record cannot commit unless its journal is posted                                           | Deferred trigger and foreign key                                | Integration-tested                |
| Idempotency records cannot be changed or deleted                                                        | PostgreSQL trigger                                              | Integration-tested                |

These are guarantees within the implemented **internal ledger posting boundary**. They do **not** establish tenant authentication, sufficient available funds, complete reversals, a public posting API, or end-to-end exactly-once external payment processing. PostgreSQL runtime least-privilege roles and operational hardening remain pending.

### Ledger domain validation

`prepareBalancedJournal()` creates an immutable, validated draft **without** database or network calls. It checks positive amounts, the presence of at least one debit and credit, minimum posting count, exact balancing, and generates one-based posting line numbers.

The domain validates financial structure; it does **not** prove account existence, tenant authorization, or persistence success. Those concerns belong to the application, trusted caller, and PostgreSQL layers.

**Evidence:** 27 domain unit tests and 7 property-based tests, configured for 2,100 generated property cases. See [ADR-014](docs/adr/ADR-014-journal-domain-validation.md).

### Journal lifecycle

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> POSTED: valid balanced postings in transaction
    PENDING --> CANCELLED: cancel
    POSTED --> [*]: immutable final state
    CANCELLED --> [*]: immutable final state
```

New journals begin in `PENDING` state. On posting, PostgreSQL populates the finalization timestamps and independently verifies commit-time invariants.

### Atomic journal posting — implemented internal service

The application service `createPostJournalService()` validates the command and delegates persistence through `LedgerPostingRepository` to `KyselyLedgerPostingRepository`.

```mermaid
flowchart TD
    A[Internal postJournal command] --> B[Prepare and validate balanced journal]
    B --> C[Validate UUIDs, transaction type, and idempotency key]
    C --> D[Create financial request fingerprint]
    D --> E[BEGIN PostgreSQL transaction]
    E --> F{Idempotency claim is new?}
    F -->|Yes| G[Lock and verify active accounts in ID order]
    G --> H[Insert PENDING journal and postings]
    H --> I[Mark journal POSTED]
    I --> J[Deferred integrity verification at COMMIT]
    J -->|Valid| K[COMMIT and return posted result]
    J -->|Invalid| L[ROLLBACK claim, journal, and postings]
    F -->|No| M{Same financial fingerprint?}
    M -->|Yes| N[Replay original committed result]
    M -->|No| O[Reject idempotency conflict]
```

Journal and posting identifiers use UUIDv7. Account checks and locks are transaction-scoped. Database failures propagate to callers; a successful result is returned only after the transaction commits. Account lock ordering reduces (but does not eliminate) deadlock risk.

**Evidence:** Atomic posting, failed-commit rollback, account-state conflicts, cross-tenant/currency rejection, and concurrent posting are covered by PostgreSQL integration tests. See [ADR-015](docs/adr/ADR-015-atomic-ledger-posting.md).

### Durable financial command idempotency — implemented

Every internal posting command includes an `idempotencyKey`. The application calculates a versioned SHA-256 fingerprint over **tenant, currency, transaction type, and ordered financial postings**, using exact decimal-string amounts. The correlation ID is **excluded**, because it represents tracing metadata rather than financial command identity.

PostgreSQL enforces the unique command scope `(tenant_id, operation_type, idempotency_key)`. The idempotency claim and financial writes share one transaction.

| Scenario                           | Actual behavior                                               |
| ---------------------------------- | ------------------------------------------------------------- |
| New key                            | Create one posted journal                                     |
| Same key, same financial intent    | Replay original posted result; no additional journal          |
| Same key, changed financial intent | Reject with `IdempotencyConflictError`                        |
| Concurrent same-key requests       | Coordinate through PostgreSQL uniqueness; one journal commits |
| Failed posting transaction         | Roll back claim, journal, and postings                        |
| Different key                      | May represent a separate financial operation                  |

Replay returns the **original** journal ID, original correlation ID, posting timestamp, and other persisted result fields. The current protocol targets PostgreSQL `READ COMMITTED` isolation.

Idempotency is limited to the same tenant/operation/key: two distinct keys can still create two different journals. It does not authorize tenants or provide end-to-end exactly-once external payment execution.

**Evidence:** 16 Ledger PostgreSQL integration tests passed locally, including same-key replay, changed-payload conflict, simultaneous retries, immutable claims, and transaction rollback. See [ADR-016](docs/adr/ADR-016-financial-command-idempotency.md).

## Testing and reproducibility

Latest **locally reported** results after Task 13E:

| Verification                                            |                                                           Result |
| ------------------------------------------------------- | ---------------------------------------------------------------: |
| Money unit/property tests                               |                                                        97 passed |
| Database unit tests                                     |                                                       100 passed |
| Ledger domain/application unit/property tests           |                                                        51 passed |
| PostgreSQL database integration tests                   |                                                        32 passed |
| PostgreSQL ledger posting/idempotency integration tests |                                                        16 passed |
| **Combined locally verified test cases**                |                                                          **296** |
| TypeScript, ESLint, Prettier, and builds                |                                                   Passed locally |
| Updated Task 13E GitHub Actions                         | **Verify after push; not yet confirmed in this README revision** |

The combined total aggregates separately executed suites; it does not represent one single test-run output.

From the repository root:

```cmd
pnpm build
pnpm check
pnpm --filter @fintech/ledger test
pnpm --filter @fintech/database test:integration
pnpm --filter @fintech/ledger test:integration
pnpm --filter @fintech/database migrate:status
```

Integration commands require their configured, disposable PostgreSQL test databases. The Ledger integration suite requires `LEDGER_TEST_DATABASE_URL`; its database-name safety guard must not be bypassed.

GitHub Actions workflows cover repository validation/build, database integration, and Ledger integration. Verify all relevant updated workflows are green for the Task 13E commit before claiming new CI coverage.

## Engineering decisions

- [ADR-012: PostgreSQL ledger persistence and financial invariants](docs/adr/ADR-012-ledger-persistence-and-invariants.md)
- [ADR-013: UUIDv7 identifier strategy](docs/adr/ADR-013-uuidv7-identifier-strategy.md)
- [ADR-014: Pure journal domain validation](docs/adr/ADR-014-journal-domain-validation.md)
- [ADR-015: Atomic ledger posting](docs/adr/ADR-015-atomic-ledger-posting.md)
- [ADR-016: Durable financial command idempotency](docs/adr/ADR-016-financial-command-idempotency.md)

See [`docs/architecture/ledger-persistence.md`](docs/architecture/ledger-persistence.md) for detailed architectural boundaries and transaction design.

## Known limitations / next milestones

1. **Authentication and tenant authorization:** Ledger posting currently accepts validated tenant identifiers but does not authenticate or authorize callers.
2. **Public HTTP APIs:** Authenticated financial ledger endpoints, external request contracts, and public error mapping are not implemented.
3. **Financial reversals:** Reversal references are constrained in PostgreSQL; complete inverse-posting reversal processing is pending.
4. **Balance and spending controls:** Derived balances, available-balance queries, holds, and concurrent overspending prevention are pending. A balanced journal does **not** establish sufficient funds.
5. **Transactional outbox and workers:** Atomic event records, reliable publishing, retry behavior, and end-to-end event delivery remain pending.
6. **Observability (mandatory):** OpenTelemetry SDK, Prometheus metrics, distributed traces, Grafana/Tempo, and trace/log correlation must be implemented; future API → Ledger → PostgreSQL/outbox → worker context propagation is part of the roadmap.
7. **Operational hardening:** Runtime least-privilege database roles, deployment, backup/recovery, and failure-response procedures are pending.
8. **Idempotency operations:** Same-key replay and conflict checks **are implemented**. Retention/archival, broader business-action deduplication, and other isolation-level behavior require additional design and testing.
9. **External payment execution:** No end-to-end exactly-once guarantee across payment processors, no licensed custody, and no live-money processing.
10. **Identifier policy:** Application-generated journal and posting IDs use UUIDv7, but PostgreSQL `UUID` columns do not universally enforce UUIDv7 for all records.

**This is a development-stage financial infrastructure platform using simulated data, not a fully deployed or regulated money-processing system.**
