# ADR-0012 — Ledger persistence and financial invariants

**Status:** Accepted for the implemented PostgreSQL schema foundation (Task 13B)  
**Date:** 2026-10-22  
**Scope:** Database layer, not a completed ledger command service

## Context

The platform requires a PostgreSQL-backed double-entry ledger whose financial records remain auditable and resistant to accidental or invalid writes. Application-only checks are insufficient: direct SQL, concurrency, retries and future maintenance paths must not silently produce unbalanced posted journals. The platform initially handles simulated/test funds.

## Decision

1. Keep PostgreSQL as the authoritative ledger store; persist accounts, journals and postings in a dedicated `ledger` schema.
2. Use exact positive `BIGINT` minor-unit posting amounts with explicit currency and side (`DEBIT` / `CREDIT`). An accounting direction is separate from the sign of an amount.
3. Use a `PENDING` → `POSTED` / `CANCELLED` journal lifecycle; only posted journals have committed financial effects. Finalized journal rows and all posting rows are immutable.
4. Use composite tenant/currency FKs to ensure a posting references a journal and account of the same tenant and currency. Tenant authorization remains a separate application/security responsibility.
5. Check at **transaction commit** that each posted journal has at least two postings and `SUM(DEBIT) = SUM(CREDIT)`. PostgreSQL deferred constraint triggers enforce this across rows.
6. Prevent late postings by locking the pending parent journal row with `FOR UPDATE`. Check account status using a row lock compatible with concurrency policy.
7. Keep journal/account identity protected by write guards; reversals will use new linked journals rather than editing the original history.
8. Apply schema changes through versioned, forward-only Kysely migrations and PostgreSQL-backed integration tests.
9. Do not add a mutable authoritative account balance column in this milestone. Derived account balances and safe projections will be implemented and tested later.

## Why these choices?

- Row-level `CHECK` constraints cannot aggregate postings across journal rows. A deferred trigger can inspect the **final transaction state** instead of failing on temporary intermediate rows.
- Immutable accounting history preserves auditability and permits future reversal and reconciliation workflows.
- Tenant/currency composite FKs guard against cross-tenant or wrong-currency references even if application input validation fails.
- Transactional DDL and migration history ensure repeatable database evolution with failure rollback.
- Locked journal finalization prevents a race between inserting another posting and marking the journal final.

## Alternatives considered

| Alternative                                  | Why it was not selected initially                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Validate totals only in TypeScript           | Direct SQL and bypass paths could create invalid journals                                |
| PostgreSQL `CHECK` for `SUM` across postings | `CHECK` is row-scoped; it cannot safely implement cross-row balance aggregation          |
| Maintain only mutable wallet/account balance | Loses an independently auditable sequence of accounting effects                          |
| Delete/edit posted entries for correction    | Destroys original transaction history                                                    |
| Use one table without journals               | Makes atomic posting event identity, lifecycle and reversal references harder to enforce |

## Consequences / trade-offs

- Trigger logic increases database complexity and must be covered by real PostgreSQL integration tests.
- Deferred checks mean some invalid commands fail **at commit time**; callers must handle transaction failures as business errors without falsely reporting success.
- Database locks can serialize concurrent writers to the same journal and may affect throughput. Lock ordering and timeout/retry policies need later performance and failure testing.
- PostgreSQL owners/superusers can change triggers and constraints. Runtime services require a limited database role to meaningfully enforce immutability operationally.
- `BIGINT` represents each posting within signed 64-bit bounds; aggregate balance results may exceed this range and need explicit checked conversion/policy.

## Evidence / implementation

- `packages/database/src/migrations/20261021_000001_create_ledger_schema.ts`
- `packages/database/src/migrations/20261021_000002_create_ledger_tables.ts`
- `packages/database/tests/integration/ledger-schema.integration.test.ts` — 23 passing tests locally
- `packages/database/tests/integration/migrations.integration.test.ts` — transactional migration tests

## Not yet implemented

- Account creation and journal posting domain/application services; HTTP API.
- Full reversal correctness (equal and opposite entries), idempotency, outbox and asynchronous publication.
- Account balance query/projection, wallet holds, concurrent spend policy.
- Separate migration/runtime database identities, tenant authentication and authorization.
- Updated ledger invariant CI coverage must be confirmed on the post-change GitHub run.
