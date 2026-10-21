import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../database.js';

// The ledger module owns its PostgreSQL schema.
// Do not silently ignore an existing schema.
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await db.schema.createSchema('ledger').execute();
}
