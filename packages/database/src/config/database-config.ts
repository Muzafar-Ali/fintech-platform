import { z } from 'zod';
import type { DatabaseConfig } from '../database.js';
import { InvalidDatabaseConfigError } from '../errors/invalid-database-config.error.js';

// Only canonical positive decimal integers; reject trailing characters.
const POSITIVE_DECIMAL_INTEGER_PATTERN = /^[1-9][0-9]*(?![\s\S])/;

// Required non-blank strings.
// Preserve the original values without silently trimming them.
const requiredStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);

// Validate decimal integer strings before converting them to numbers.
// Restrict input length to avoid unnecessarily processing oversized values.
function decimalIntegerSchema(maxValue: number, maxLength: number) {
  return z
    .string()
    .max(maxLength)
    .regex(POSITIVE_DECIMAL_INTEGER_PATTERN)
    .transform((value) => Number(value))
    .pipe(z.number().int().min(1).max(maxValue));
}

// PostgreSQL accepts TCP ports between 1 and 65535.
const portSchema = decimalIntegerSchema(65535, 5);

// Start with a controlled connection pool limit.
const maxConnectionsSchema = decimalIntegerSchema(100, 3).default(10);

// Validate environment variables at the application boundary.
const databaseEnvironmentSchema = z.object({
  POSTGRES_HOST: requiredStringSchema,
  POSTGRES_PORT: portSchema,
  POSTGRES_USER: requiredStringSchema,
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: requiredStringSchema,
  POSTGRES_MAX_CONNECTIONS: maxConnectionsSchema,
});

// Convert untrusted environment variables into validated DatabaseConfig.
export function loadDatabaseConfig(env: NodeJS.ProcessEnv): DatabaseConfig {
  const result = databaseEnvironmentSchema.safeParse(env);

  if (!result.success) {
    // Report only field names; never expose input values or secrets.
    const invalidFields = [
      ...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? 'environment'))),
    ];

    throw new InvalidDatabaseConfigError(invalidFields);
  }

  const config = result.data;

  return {
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    database: config.POSTGRES_DB,
    maxConnections: config.POSTGRES_MAX_CONNECTIONS,
  };
}
