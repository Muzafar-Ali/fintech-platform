import { InvalidPgInt8Error } from './errors/invalid-pg-int8.error.js';

// PostgreSQL BIGINT is a signed 64-bit integer.
const MIN_INT8 = -9223372036854775808n;
const MAX_INT8 = 9223372036854775807n;

// The longest valid signed BIGINT contains 20 characters.
const MAX_INT8_STRING_LENGTH = 20;

// Accept only canonical decimal integer strings.
// The final lookahead enforces the absolute end of input.
const CANONICAL_INT8_PATTERN = /^(?:0|-?[1-9][0-9]*)(?![\s\S])/;

// Centralize the supported PostgreSQL BIGINT range invariant.
function isWithinInt8Range(value: bigint): boolean {
  return value >= MIN_INT8 && value <= MAX_INT8;
}

// Convert an untrusted PostgreSQL BIGINT representation into
// an exact TypeScript bigint without passing through Number.
export function parsePgInt8(value: unknown): bigint {
  if (
    typeof value !== 'string' ||
    value.length > MAX_INT8_STRING_LENGTH ||
    !CANONICAL_INT8_PATTERN.test(value)
  ) {
    throw new InvalidPgInt8Error();
  }

  const parsed = BigInt(value);

  if (!isWithinInt8Range(parsed)) {
    throw new InvalidPgInt8Error();
  }

  return parsed;
}

// Convert a TypeScript bigint into a canonical decimal string
// suitable for binding to a PostgreSQL BIGINT parameter.
export function formatPgInt8(value: bigint): string {
  if (typeof value !== 'bigint' || !isWithinInt8Range(value)) {
    throw new InvalidPgInt8Error();
  }

  return value.toString();
}
