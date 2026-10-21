import { describe, expect, it } from 'vitest';
import { InvalidDatabaseConfigError, loadDatabaseConfig } from '../../src/index.js';

// Valid baseline used by every test.
const VALID_ENV: NodeJS.ProcessEnv = {
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '5433',
  POSTGRES_USER: 'fintech_local',
  POSTGRES_PASSWORD: 'local-secret',
  POSTGRES_DB: 'fintech_local',
  POSTGRES_MAX_CONNECTIONS: '10',
};

// Build an isolated environment without modifying process.env.
function makeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...VALID_ENV,
    ...overrides,
  };
}

// Require the exact expected error type, not just any exception.
function getConfigError(env: NodeJS.ProcessEnv): InvalidDatabaseConfigError {
  try {
    loadDatabaseConfig(env);
  } catch (error: unknown) {
    if (error instanceof InvalidDatabaseConfigError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected InvalidDatabaseConfigError');
}

describe('loadDatabaseConfig', () => {
  describe('valid configuration', () => {
    it('converts environment variables into DatabaseConfig', () => {
      const result = loadDatabaseConfig(makeEnv());

      expect(result).toEqual({
        host: '127.0.0.1',
        port: 5433,
        user: 'fintech_local',
        password: 'local-secret',
        database: 'fintech_local',
        maxConnections: 10,
      });
    });

    it('converts numeric environment strings into numbers', () => {
      const result = loadDatabaseConfig(
        makeEnv({
          POSTGRES_PORT: '5433',
          POSTGRES_MAX_CONNECTIONS: '20',
        }),
      );

      expect(result.port).toBe(5433);
      expect(result.maxConnections).toBe(20);

      expect(typeof result.port).toBe('number');
      expect(typeof result.maxConnections).toBe('number');
    });

    it('uses 10 connections when pool size is missing', () => {
      const result = loadDatabaseConfig(
        makeEnv({
          POSTGRES_MAX_CONNECTIONS: undefined,
        }),
      );

      expect(result.maxConnections).toBe(10);
    });

    it('preserves password characters without trimming', () => {
      const password = '  secret with spaces  ';

      const result = loadDatabaseConfig(
        makeEnv({
          POSTGRES_PASSWORD: password,
        }),
      );

      expect(result.password).toBe(password);
    });

    it('ignores unrelated environment variables', () => {
      const result = loadDatabaseConfig(
        makeEnv({
          NODE_ENV: 'test',
          SOME_UNRELATED_VARIABLE: 'value',
        }),
      );

      expect(result).toEqual({
        host: '127.0.0.1',
        port: 5433,
        user: 'fintech_local',
        password: 'local-secret',
        database: 'fintech_local',
        maxConnections: 10,
      });
    });

    it('does not mutate the supplied environment object', () => {
      const env = makeEnv();
      const snapshot = { ...env };

      loadDatabaseConfig(env);

      expect(env).toEqual(snapshot);
    });
  });

  describe('required configuration', () => {
    it.each([
      ['POSTGRES_HOST', undefined],
      ['POSTGRES_HOST', ''],
      ['POSTGRES_HOST', '   '],

      ['POSTGRES_USER', undefined],
      ['POSTGRES_USER', ''],
      ['POSTGRES_USER', '   '],

      ['POSTGRES_DB', undefined],
      ['POSTGRES_DB', ''],
      ['POSTGRES_DB', '   '],

      ['POSTGRES_PASSWORD', undefined],
      ['POSTGRES_PASSWORD', ''],
    ])('rejects invalid %s value %s', (field, value) => {
      const error = getConfigError(
        makeEnv({
          [field]: value,
        }),
      );

      expect(error.fields).toContain(field);
    });

    it('rejects missing PostgreSQL port', () => {
      const error = getConfigError(
        makeEnv({
          POSTGRES_PORT: undefined,
        }),
      );

      expect(error.fields).toContain('POSTGRES_PORT');
    });

    it('reports multiple invalid fields together', () => {
      const error = getConfigError(
        makeEnv({
          POSTGRES_HOST: '',
          POSTGRES_USER: undefined,
          POSTGRES_PASSWORD: '',
        }),
      );

      expect(error.fields).toEqual(['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD']);
    });
  });

  describe('PostgreSQL port validation', () => {
    it.each([
      ['1', 1],
      ['5432', 5432],
      ['5433', 5433],
      ['65535', 65535],
    ])('accepts valid port %s', (port, expected) => {
      const result = loadDatabaseConfig(
        makeEnv({
          POSTGRES_PORT: port,
        }),
      );

      expect(result.port).toBe(expected);
    });

    it.each([
      '0',
      '65536',
      '-1',
      '1.5',
      '1e3',
      '+5433',
      ' 5433',
      '5433 ',
      '05433',
      '5433\n',
      '5\n',
      '5433abc',
      '',
      ' ',
      'NaN',
      'Infinity',
    ])('rejects invalid port "%s"', (port) => {
      const error = getConfigError(
        makeEnv({
          POSTGRES_PORT: port,
        }),
      );

      expect(error.fields).toContain('POSTGRES_PORT');
    });

    it('rejects excessively long port strings', () => {
      const error = getConfigError(
        makeEnv({
          POSTGRES_PORT: '9'.repeat(100_000),
        }),
      );

      expect(error.fields).toContain('POSTGRES_PORT');
    });
  });

  describe('connection pool validation', () => {
    it.each([
      ['1', 1],
      ['10', 10],
      ['50', 50],
      ['100', 100],
    ])('accepts pool size %s', (value, expected) => {
      const result = loadDatabaseConfig(
        makeEnv({
          POSTGRES_MAX_CONNECTIONS: value,
        }),
      );

      expect(result.maxConnections).toBe(expected);
    });

    it.each([
      '0',
      '101',
      '-1',
      '1.5',
      '1e1',
      '+10',
      '01',
      ' 10',
      '10 ',
      '10\n',
      '',
      ' ',
      'NaN',
      'Infinity',
    ])('rejects invalid pool size "%s"', (value) => {
      const error = getConfigError(
        makeEnv({
          POSTGRES_MAX_CONNECTIONS: value,
        }),
      );

      expect(error.fields).toContain('POSTGRES_MAX_CONNECTIONS');
    });

    it('rejects excessively long pool-size strings', () => {
      const error = getConfigError(
        makeEnv({
          POSTGRES_MAX_CONNECTIONS: '9'.repeat(100_000),
        }),
      );

      expect(error.fields).toContain('POSTGRES_MAX_CONNECTIONS');
    });
  });

  describe('error handling and security', () => {
    it('throws the dedicated configuration error', () => {
      const error = getConfigError(
        makeEnv({
          POSTGRES_PORT: 'invalid',
        }),
      );

      expect(error).toBeInstanceOf(InvalidDatabaseConfigError);

      expect(error.name).toBe('InvalidDatabaseConfigError');
    });

    it('reports invalid field names in the error message', () => {
      const error = getConfigError(
        makeEnv({
          POSTGRES_PORT: 'invalid',
        }),
      );

      expect(error.message).toContain('POSTGRES_PORT');
      expect(error.fields).toContain('POSTGRES_PORT');
    });

    it('never exposes password values in validation errors', () => {
      const secret = 'my-sensitive-fintech-password';

      const error = getConfigError(
        makeEnv({
          POSTGRES_PORT: 'invalid',
          POSTGRES_PASSWORD: secret,
        }),
      );

      expect(error.message).not.toContain(secret);
      expect(JSON.stringify(error.fields)).not.toContain(secret);
    });

    it('does not expose invalid configuration input values', () => {
      const invalidPort = 'SECRET_SHOULD_NOT_BE_LOGGED';

      const error = getConfigError(
        makeEnv({
          POSTGRES_PORT: invalidPort,
        }),
      );

      expect(error.message).not.toContain(invalidPort);
      expect(error.message).toContain('POSTGRES_PORT');
    });
  });
});
