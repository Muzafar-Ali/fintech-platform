import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../database.js';

// Resolve compiled migrations relative to this module.
// fileURLToPath ensures correct filesystem paths on Windows.
const MIGRATION_FOLDER = fileURLToPath(new URL('../migrations/', import.meta.url));

// The caller owns the database instance and its lifecycle.
export function createMigrator(db: Kysely<DatabaseSchema>): Migrator {
  return new Migrator({
    db,

    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: MIGRATION_FOLDER,

      // Convert Windows filesystem paths into valid ESM import URLs.
      import: (modulePath) => import(pathToFileURL(modulePath).href),
    }),

    // Kysely stores its own metadata separately from business tables.
    migrationTableSchema: 'platform',

    // Reject migrations inserted before already executed migrations.
    allowUnorderedMigrations: false,
  });
}
