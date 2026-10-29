import { recordLedgerOutcome, startObservability, traceOperation } from './index.js';

const sdk = startObservability({
  serviceName: 'fintech-observability-smoke',
});

try {
  await traceOperation('fintech.observability.smoke', async () => {
    await Promise.resolve();

    recordLedgerOutcome('posted', 0.012);
  });

  // Allow the periodic metric reader to perform an export.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 6_000);
  });

  console.log('Smoke telemetry generated');
} finally {
  await sdk.shutdown();
}
