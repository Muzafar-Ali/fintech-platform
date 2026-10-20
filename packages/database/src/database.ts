import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

// Connection configuration supplied by the application's composition root.
export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly maxConnections?: number;
}

// Temporary schema placeholder.
// Replace with explicit generated/maintained table types
// when our first database migrations are introduced.
export type DatabaseSchema = Record<string, never>;

// Create an isolated database connection pool and Kysely instance.
// The caller owns the instance and must call db.destroy() on shutdown.
export function createDatabase(config: DatabaseConfig): Kysely<DatabaseSchema> {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,

    max: config.maxConnections ?? 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool,
    }),
  });
}
