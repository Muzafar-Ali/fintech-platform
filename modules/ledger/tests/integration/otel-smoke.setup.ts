import { startObservability, traceOperation } from '@fintech/observability';
import { afterAll, beforeAll } from 'vitest';

/**
 * Opt-in integration telemetry setup.
 *
 * This file is loaded only when
 * LEDGER_TELEMETRY_SMOKE=1.
 *
 * No production or financial transaction logic is changed.
 */
const sdk = startObservability({
  serviceName: 'fintech-ledger-integration',
});

beforeAll(async () => {
  await traceOperation('ledger.telemetry_setup_probe', () => Promise.resolve());

  console.info('[13F] Ledger integration telemetry setup ACTIVE');
});

afterAll(async () => {
  // Flush and shut down telemetry only after tests finish.
  await sdk.shutdown();

  console.info('[13F] OpenTelemetry SDK shutdown completed');
});
