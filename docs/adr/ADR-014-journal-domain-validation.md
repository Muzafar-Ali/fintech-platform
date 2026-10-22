# ADR-014: Pure Domain Validation for Double-Entry Journal Drafts

- **Status:** Accepted
- **Date:** 2026-10-22
- **Scope:** Ledger domain model

## Context

The platform stores financial journals and postings in
PostgreSQL. Database constraints and deferred triggers protect
persisted financial integrity.

However, database constraints alone do not provide an
application-level domain contract for preparing and rejecting
invalid journal instructions before persistence.

The platform needs an independently testable way to validate
double-entry accounting instructions without coupling financial
domain rules to Express, Kysely or PostgreSQL.

## Decision

Implement a pure domain operation named
`prepareBalancedJournal()` within the Ledger module.

It accepts a draft containing a tenant identifier, currency
and postings, then returns an immutable `PreparedJournal`
if the financial structure is valid.

The operation will:

1. Require at least two postings.
2. Require at least one debit and one credit.
3. Validate posting side and amount at runtime.
4. Require each amount to be a positive `bigint`.
5. Reuse `@fintech/money` to validate individual monetary
   amounts against the supported signed 64-bit range.
6. Accumulate debit and credit totals using exact `bigint`
   arithmetic, without converting values to `number`.
7. Reject mismatched debit/credit totals.
8. Assign deterministic, one-based posting line numbers.
9. Return frozen journal and posting records.
10. Report expected validation failures through typed
    `InvalidJournalDraftError` codes.

The operation performs no database queries, network calls,
side effects or input mutation.

## Separation of responsibilities

The domain operation verifies journal structure and arithmetic.

It does not verify account existence, tenant ownership,
account status or database transaction commit success.

These checks are owned by the future application service,
repositories and PostgreSQL constraints.

The domain currently validates identifier presence, not full
UUID syntax or authorization.

Runtime API request validation will be handled separately
at the presentation boundary.

## Financial precision

Each individual posting amount must fit the monetary range
supported by the Money package and PostgreSQL `BIGINT`.

Debit and credit aggregates are computed using native
`bigint` arithmetic and may exceed that individual amount
range.

This is intentional: a journal may contain many valid
postings whose combined amount is larger than a signed
64-bit integer.

No JavaScript floating-point arithmetic is used to compute
financial totals.

## Defense in depth

Domain validation and PostgreSQL validation serve
different purposes.

Domain validation provides deterministic errors and rejects
invalid instructions early.

PostgreSQL independently protects committed financial
records from invalid writes, including those originating
outside the intended application service.

A domain-valid draft is not automatically a valid or
authorized database transaction.

## Alternatives considered

### Validate only in PostgreSQL

Rejected because it couples business validation feedback to
persistence and prevents isolated pure domain testing.

### Validate only in the application

Rejected because application validation cannot protect
against all direct SQL writes, implementation defects or
untrusted transaction paths.

### Use JavaScript Number for totals

Rejected because binary floating-point arithmetic is not
suitable for exact monetary accounting.

### Treat a prepared draft as a posted journal

Rejected because preparation does not create an atomic,
persisted or finalized accounting transaction.

## Consequences

### Benefits

- Financial rules are testable without PostgreSQL.
- Invalid commands fail before persistence.
- The Money package remains the common source for monetary
  amount validation.
- Domain code is reusable by future application workflows.
- Tests can exercise large monetary values and generated
  journal structures.
- Database and domain correctness form separate safeguards.

### Trade-offs

- Some financial checks exist at both domain and database
  layers and must remain semantically aligned.
- A prepared journal is not proof of tenant authorization or
  successful persistence.
- Object freezing protects the returned JavaScript objects,
  but does not replace persisted immutability constraints.

## Verification evidence

At acceptance:

- 27 domain unit tests passed.
- 7 property-based tests passed.
- 2,100 generated property-test cases executed.
- TypeScript typechecking passed.
- ESLint passed.
- Repository quality checks and build passed locally.

The test suite covers balanced and unbalanced journals,
multiple posting structures, invalid runtime data,
amount boundaries, large aggregates, deterministic ordering
and immutable prepared results.

## Follow-up implementation

The next application-layer milestone will integrate the
validated journal draft with PostgreSQL transactions.

Planned work includes account and tenant verification,
journal posting orchestration, transaction rollback behavior,
idempotency and subsequent outbox integration.

These capabilities are not claimed as delivered by this ADR.

## Related decisions

- [ADR-012: Ledger persistence and invariants](ADR-012-ledger-persistence-and-invariants.md)
- [ADR-013: UUIDv7 identifier policy](ADR-013-uuidv7-identifier-strategy.md)
