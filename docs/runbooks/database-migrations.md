# Database Migration Runbook

## Ownership

- PostgreSQL is the authoritative transactional database.
- `platform` schema stores Kysely migration metadata.
- `ledger` schema is owned by the Ledger module.
- Additional module schemas are introduced when those modules are implemented.
- Application modules must not directly modify another module's tables.

## Migration rules

1. Every database change must use a versioned migration.
2. Applied migration files must not be edited, renamed, or deleted.
3. Migrations execute in deterministic alphabetical order.
4. PostgreSQL transactional migrations remain enabled.
5. Migration locking must remain enabled.
6. Database migrations are executed explicitly during deployment, not automatically when API or worker instances start.
7. Schema changes must support rolling deployments using an expand–migrate–contract approach where applicable.
8. Production rollback is performed through a corrective forward migration or a carefully planned recovery procedure, not automatic table drops.

## Local commands

From repository root:

```powershell
pnpm --filter @fintech/database migrate:status
pnpm --filter @fintech/database migrate:up
```

## Pre-deployment checklist

- Confirm database backup and recovery capability.
- Review migration SQL, indexes, constraints, and expected locks.
- Check compatibility with running API and worker versions.
- Test migration against a representative database snapshot.
- Confirm the migration role has required privileges.
- Review potential table rewrites, blocking operations, and deployment duration.

## Failure procedure

1. Stop further deployment steps.
2. Inspect migration error and database state.
3. Verify applied migration history.
4. Do not manually change Kysely migration history to make a deployment pass.
5. Correct the failure through a reviewed recovery plan.
6. Rerun migration verification before proceeding.

## Operational security

Use a dedicated migration role for schema changes and a less-privileged application role for runtime queries. Never store production database credentials in Git.
