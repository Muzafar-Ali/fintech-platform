import { loadEnvFile } from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDatabase, formatPgInt8, parsePgInt8 } from '../../src/index.js';

// Load local development credentials from the repository root.
// Run this suite from the @fintech/database workspace.
loadEnvFile('../../.env');

function requiredEnv(name: 'POSTGRES_USER' | 'POSTGRES_PASSWORD' | 'POSTGRES_DB'): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const config = {
  host: process.env['POSTGRES_HOST'] ?? '127.0.0.1',
  port: Number(process.env['POSTGRES_PORT'] ?? '5433'),
  user: requiredEnv('POSTGRES_USER'),
  password: requiredEnv('POSTGRES_PASSWORD'),
  database: requiredEnv('POSTGRES_DB'),
};

describe('PostgreSQL database integration', () => {
  const db = createDatabase(config);

  afterAll(async () => {
    await db.destroy();
  });

  it('connects to PostgreSQL and executes SQL', async () => {
    const result = await sql<{ answer: number }>`
      SELECT 1::integer AS answer
    `.execute(db);

    expect(result.rows[0]?.answer).toBe(1);
  });

  it('connects to the configured database and user', async () => {
    const result = await sql<{
      database_name: string;
      user_name: string;
    }>`
      SELECT
        current_database() AS database_name,
        current_user AS user_name
    `.execute(db);

    expect(result.rows[0]?.database_name).toBe(config.database);
    expect(result.rows[0]?.user_name).toBe(config.user);
  });

  it('preserves PostgreSQL BIGINT values beyond JavaScript safe integers', async () => {
    const result = await sql<{ amount: unknown }>`
      SELECT 9007199254740993::bigint AS amount
    `.execute(db);

    const rawAmount = result.rows[0]?.amount;

    // The pg driver should return INT8 as an exact decimal string.
    expect(rawAmount).toBe('9007199254740993');

    const amount = parsePgInt8(rawAmount);

    expect(amount).toBe(9007199254740993n);
  });

  it('round-trips a bigint through a parameterized SQL query', async () => {
    const original = 9223372036854775807n;

    const result = await sql<{ amount: unknown }>`
      SELECT ${formatPgInt8(original)}::bigint AS amount
    `.execute(db);

    const restored = parsePgInt8(result.rows[0]?.amount);

    expect(restored).toBe(original);
  });
});
