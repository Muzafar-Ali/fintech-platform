# Ledger persistence architecture — Task 13B

**Scope:** PostgreSQL schema and database-enforced financial integrity. Not an implemented API or complete ledger engine.

## System boundaries

- `packages/database`: Kysely connections, migrations, PostgreSQL drivers, and exact `BIGINT` mapping.
- `modules/ledger`: future domain/application contracts, posting commands, persistence adapters; currently not the implemented posting engine.
- PostgreSQL: financial system of record. Redis and future event systems are not accounting truth.
- Tenant IDs are stored in ledger tables; an organization master-table relationship and tenant-aware authorization will be added with the identity/business modules.

## Database objects

Migration `20261021_000001_create_ledger_schema` creates namespace `ledger`. Migration `20261021_000002_create_ledger_tables` defines three tables:

- `ledger.accounts`: `id`, `tenant_id`, `account_type` (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`), `currency`, `status` (`ACTIVE`, `SUSPENDED`, `CLOSED`), `created_at`.
- `ledger.journals`: tenant/currency, transaction type, lifecycle status (`PENDING`, `POSTED`, `CANCELLED`), correlation/reversal references, effective/posted/cancelled timestamps.
- `ledger.postings`: tenant, journal, account, line number, debit/credit side, positive signed-64-bit minor-unit amount, currency and creation timestamp.

Postings have FKs to journal and account using **tenant and currency** together. Posting `amount_minor` is strictly positive and fits PostgreSQL `BIGINT`. Totals use exact PostgreSQL numeric aggregation, not JavaScript floating point.

```mermaid
erDiagram
    ACCOUNTS ||--o{ POSTINGS : contains
    JOURNALS ||--o{ POSTINGS : groups
    JOURNALS o|--o| JOURNALS : reversal_of

    ACCOUNTS {
       uuid id PK
       uuid tenant_id
       text account_type
       varchar currency
       text status
    }
    JOURNALS {
       uuid id PK
       uuid tenant_id
       varchar currency
       text status
       uuid reversal_of_journal_id FK
    }
    POSTINGS {
       uuid id PK
       uuid tenant_id
       uuid journal_id FK
       uuid account_id FK
       varchar currency
       text side
       bigint amount_minor
    }
```

## Financial invariants and enforcement

| Condition                                           | Mechanism                                                  |
| --------------------------------------------------- | ---------------------------------------------------------- |
| Posted journal has >= 2 postings                    | Deferred constraint triggers, validated at commit          |
| Sum of debit amounts equals sum of credit amounts   | Deferred trigger; aggregation on `NUMERIC`                 |
| No committed postings for pending/cancelled journal | Deferred trigger                                           |
| No zero/negative posting amounts                    | `CHECK (amount_minor > 0)`                                 |
| Account/journal tenant and currency match posting   | Composite FKs plus write guards                            |
| No posting to suspended/closed account              | Trigger checks account under `FOR SHARE` lock              |
| No posting after journal finalization               | Trigger locks parent journal `FOR UPDATE`                  |
| Account identity immutable / closed not reopened    | Account write trigger                                      |
| Finalized journal and any posting immutable         | Journal/posting write triggers                             |
| No duplicate reversal link for original journal     | Unique constraint on `(tenant_id, reversal_of_journal_id)` |

These database guards protect ordinary SQL DML under appropriate permissions. Superusers/table owners can change or disable schema enforcement: a separate least-privilege runtime role is still a required hardening milestone.

## Journal lifecycle

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> POSTED: balanced entries and valid accounts
    PENDING --> CANCELLED: cancellation
    POSTED --> [*]: finalized, immutable
    CANCELLED --> [*]: finalized, immutable
```

Pending journals may be inserted without postings. The initial schema requires a posting transaction to insert all lines and finalize the journal in **one transaction**; a commit with lines still pending is rejected. Posted journal balances cannot be edited: business corrections will create linked reversal journals in a later milestone.

## Transaction paths

### Verified database-only path

```mermaid
sequenceDiagram
    participant Test as Direct SQL integration test
    participant PG as PostgreSQL
    Test->>PG: BEGIN
    Test->>PG: INSERT debit and credit postings
    Test->>PG: UPDATE journal status = POSTED
    Test->>PG: COMMIT
    PG->>PG: Deferred journal integrity check
    alt balanced with valid references
        PG-->>Test: Commit succeeds
    else invariant violation
        PG-->>Test: Commit fails and transaction rolls back
    end
```

### Planned application workflow (not implemented yet)

```mermaid
sequenceDiagram
    participant API as API / Ledger command
    participant DB as PostgreSQL
    participant Worker as Outbox worker
    API->>DB: BEGIN
    API->>DB: Claim idempotency scope/key and compare request hash
    API->>DB: Lock journal/accounts as needed
    API->>DB: Insert balanced postings and mark journal POSTED
    API->>DB: Insert outbox event in same transaction
    API->>DB: COMMIT (deferred integrity verification)
    DB-->>API: Stable journal result
    Worker->>DB: Read committed outbox event
    Worker-->>Worker: Publish / retry idempotently
```

This planned sequence requires application services, idempotency and outbox migrations, and tests before it may be claimed implemented.

## Verification and known gaps

`packages/database/tests/integration/ledger-schema.integration.test.ts` runs against a disposable PostgreSQL database and validates 23 ledger schema cases, including successful posting, unbalanced rollback, tenant/currency mismatch, account status restrictions, immutability and reversal reference uniqueness. Existing connectivity and migration suites add 9 integration tests.

- Only database-level financial integrity is verified; no API posting service yet.
- Exact inverse reversal amounts are not yet enforced by a reversal service.
- Balance projection and overspending controls are not implemented.
- Foreign-key tenant scope protects references but does not replace authorization.
- PostgreSQL runtime/migration role separation and schema hardening are not yet complete.
- New primary IDs use the UUIDv7 **design policy**; tests use UUIDv7 fixtures, while application-level ID generation is future implementation.

## Related decisions

- [ADR-012: Ledger persistence and invariants](../adr/ADR-012-ledger-persistence-and-invariants.md)
- [ADR-013: UUIDv7 identifiers](../adr/ADR-013-uuidv7-identifier-strategy.md)

## Ledger domain validation

The Ledger module contains a pure journal preparation operation:

`modules/ledger/src/domain/services/prepare-balanced-journal.ts`

The operation accepts a journal draft containing tenant ID,
currency and debit/credit postings. It validates the financial
structure, calculates exact debit and credit totals, assigns
sequential posting line numbers and returns an immutable
`PreparedJournal`.

### Validation and persistence boundaries

```mermaid
flowchart TD
    A[Future application posting command] --> B[Ledger domain validation]
    B --> C{Valid and balanced?}
    C -->|No| D[Typed domain error]
    C -->|Yes| E[PreparedJournal]
    E --> F[Future application transaction service]
    F --> G[PostgreSQL ledger tables]
    G --> H[Database constraints and deferred triggers]
    H --> I{Commit valid?}
    I -->|No| J[Rollback]
    I -->|Yes| K[Commit]
```

The domain validation implementation exists today. The
application transaction service and end-to-end posting command
remain future scope.

### Responsibility separation

| Layer         | Responsibility                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Domain        | Posting count, positive amounts, balancing, deterministic line numbers                           |
| Money package | Monetary range validation and exact monetary representation                                      |
| Application   | Command orchestration, tenant authorization, idempotency and transaction boundaries              |
| Database      | Account existence, tenant/currency foreign keys, immutable persisted rows, commit-time balancing |
| Future outbox | Atomic business-event persistence and reliable asynchronous delivery                             |

The domain's prepared totals are not the authoritative persisted
balance. PostgreSQL revalidates journal postings independently.

### Verification

- 27 Ledger domain unit tests.
- 7 Ledger domain property tests.
- 300 generated cases per property, totaling 2,100 runs.
- Exact `bigint` arithmetic including aggregates larger than
  an individual PostgreSQL `BIGINT` value.
- Input immutability and deterministic output verification.

Architecture decision:
[ADR-014: Journal domain validation](../adr/ADR-014-journal-domain-validation.md).

## Atomic application-level posting

Task 13D implements internal journal posting through a
dedicated application service and repository abstraction.

### Components

- `createPostJournalService()` — validates and orchestrates commands.
- `LedgerPostingRepository` — application persistence contract.
- `KyselyLedgerPostingRepository` — transactional PostgreSQL adapter.
- `prepareBalancedJournal()` — existing financial domain validation.
- PostgreSQL ledger triggers — independent persistence integrity.

### Transaction boundary

All account checks, journal insertion, posting insertion and
journal finalization occur inside one database transaction.

The operation returns success only after a successful commit.

A failed commit causes rollback, including when a deferred
financial constraint rejects the transaction.

### Verified failure scenarios

The integration suite verifies missing accounts, suspended
accounts, cross-tenant access, incompatible currency,
commit-time financial imbalance and concurrent status changes.

### Remaining boundaries

The service is internal-only. Authentication/authorization,
idempotency, transactional outbox delivery, reversal processing
and overspending prevention are not yet implemented.

See [ADR-015](../adr/ADR-015-atomic-ledger-posting.md).
