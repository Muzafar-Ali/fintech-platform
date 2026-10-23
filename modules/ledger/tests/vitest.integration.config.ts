import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.integration.test.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    maxWorkers: 1,
  },
});
