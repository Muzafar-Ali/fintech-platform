import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.integration.test.ts'],
    maxWorkers: 1,

    // Telemetry is opt-in and never required by normal CI.
    setupFiles:
      process.env['LEDGER_TELEMETRY_SMOKE'] === '1'
        ? ['tests/integration/otel-smoke.setup.ts']
        : [],
  },
});
