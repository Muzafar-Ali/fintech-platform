import { loadDatabaseConfig } from '../config/database-config.js';
import { createDatabase } from '../database.js';
import { createMigrator } from '../migration/create-migrator.js';

async function main(): Promise<void> {
  const command = process.argv[2];

  if (process.argv.length !== 3 || (command !== 'up' && command !== 'status')) {
    throw new Error('Usage: migrate <up|status>');
  }

  // Fail fast before establishing a database connection.
  const config = loadDatabaseConfig(process.env);

  const db = createDatabase(config);

  try {
    const migrator = createMigrator(db);

    const migrations = await migrator.getMigrations();

    // Never silently succeed when migration files are missing
    // from a deployment build.
    if (migrations.length === 0) {
      throw new Error('No compiled migration files found');
    }

    if (command === 'status') {
      for (const migration of migrations) {
        const status = migration.executedAt === undefined ? 'PENDING' : 'APPLIED';

        console.log(`${status}: ${migration.name}`);
      }

      return;
    }

    const { error, results } = await migrator.migrateToLatest();

    // A migration result can contain an error without throwing.
    if (error !== undefined) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error('Database migration failed', {
        cause: error,
      });
    }

    if (!results?.length) {
      console.log('No pending migrations');
      return;
    }

    for (const result of results) {
      if (result.status !== 'Success') {
        throw new Error(`Unexpected migration status: ${result.migrationName}`);
      }

      console.log(`Applied migration: ${result.migrationName}`);
    }
  } finally {
    // Always release the connection pool.
    await db.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown migration error';

  console.error(`Migration command failed: ${message}`);

  process.exitCode = 1;
});
