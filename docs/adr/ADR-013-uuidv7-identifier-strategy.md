# ADR-0013 — UUIDv7 policy for platform-generated identifiers

**Status:** Accepted as identifier policy; application adoption in progress  
**Date:** 2026-10-22  
**Scope:** Platform-generated IDs, including planned ledger account, journal, posting and outbox event IDs

## Context

The financial platform needs unique identifiers generated without a centralized allocation service. The selected PostgreSQL version is 17, and the database schema uses native `UUID` columns with B-tree indexes. Random UUIDv4 identifiers can scatter primary-key inserts through B-tree pages. Time-ordered UUIDv7 may improve index locality for insert-heavy tables.

## Decision

1. Prefer RFC 9562 UUIDv7 for **new platform-generated entity IDs**.
2. Preserve PostgreSQL `UUID` column types; no separate textual ID storage or schema migration is needed solely for UUIDv7.
3. Generate UUIDv7 at the TypeScript application boundary using a maintained UUIDv7 implementation, not `node:crypto` `randomUUID()` (which generates UUIDv4).
4. Do not rewrite externally supplied tenant identifiers, correlation identifiers, imported references, or existing IDs merely to satisfy UUIDv7.
5. Do not treat UUID ordering as the authoritative financial transaction sequence. Use explicit timestamps and, where strict ordering is needed, database-controlled ordering mechanisms.
6. Validate UUID version at application ID-generation boundaries, with targeted tests. PostgreSQL `UUID` storage by itself does **not** enforce version 7.

## Rationale

- UUIDv7 places time-related data in the most significant bits, generally providing better B-tree insertion locality than fully random UUIDv4.
- IDs can still be generated in distributed applications without database round trips.
- Native PostgreSQL UUID indexing, equality and joins continue to work.

## Alternatives and limitations

| Option                     | Consideration                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| UUIDv4                     | Widely supported; random insertion patterns may be less cache-friendly                                    |
| Database sequence / BIGINT | Excellent compact index locality, but centralized allocation and more complicated distributed ID strategy |
| UUIDv7                     | Better typical locality, not a guaranteed global ordering or strict monotonic sequence                    |

Clock skew, same-millisecond ID generation, and implementation-specific monotonicity affect observed ordering. Tenant-first composite index behavior may not receive the same locality improvement as the primary-key index. Benchmark with real write workloads rather than assuming a fixed performance gain.

## Implementation status

- `ledger.accounts.id`, `ledger.journals.id`, `ledger.postings.id` are native UUID columns without database-generated defaults.
- Ledger integration fixtures use UUIDv7 identifiers.
- Shared application ID-generation utility and domain-level callers will be implemented when account/journal command services are added.
- Version-enforcing database constraints are **not** currently in place.

## Verification plan

Add tests for generated version bits, uniqueness within practical samples, serialization compatibility and application command contracts; do not assert strict global temporal ordering across machines.
