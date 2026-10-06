# ADR-011: Monetary Amount Representation

## Status

Accepted

## Context

The platform processes financial values across the ledger, accounts,
payments, refunds, payouts, reconciliation, APIs, events, and PostgreSQL.

Financial amounts must be represented exactly.

JavaScript `number` cannot safely represent arbitrary integer monetary values
because integers larger than `Number.MAX_SAFE_INTEGER` lose precision.

JavaScript `bigint` provides exact integer arithmetic but cannot be serialized
directly by JSON.

PostgreSQL provides the signed 64-bit `BIGINT` type.

## Decision

The platform will represent monetary amounts using integer minor units.

### Domain representation

TypeScript financial arithmetic will use `bigint`.

Example:

```ts
250000n;
```
