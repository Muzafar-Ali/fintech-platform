import { metrics, trace } from '@opentelemetry/api';

export type LedgerPostingOutcome = 'posted' | 'replayed' | 'conflict' | 'failed';

type LedgerInstruments = {
  readonly attempts: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']>;
  readonly duration: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']>;
};

let instruments: LedgerInstruments | undefined;

function getLedgerInstruments(): LedgerInstruments {
  if (instruments) {
    return instruments;
  }

  const meter = metrics.getMeter('fintech-ledger');

  instruments = {
    attempts: meter.createCounter('fintech.ledger.post.attempts', {
      description: 'Ledger posting attempts by outcome',
      unit: '{attempt}',
    }),

    duration: meter.createHistogram('fintech.ledger.post.duration', {
      description: 'Ledger posting operation duration',
      unit: 's',
    }),
  };

  return instruments;
}

/**
 * Only bounded outcome values are used as metric attributes.
 *
 * Never use tenant IDs, journal IDs, amounts or idempotency
 * keys as Prometheus labels.
 */
export function recordLedgerOutcome(outcome: LedgerPostingOutcome, durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    return;
  }

  // Metrics must not turn a successful financial commit
  // into a failed business operation.
  try {
    const { attempts, duration } = getLedgerInstruments();

    attempts.add(1, { outcome });
    duration.record(durationSeconds, { outcome });
  } catch {
    // Telemetry is best-effort, never financial authority.
    return;
  }
}

/**
 * Annotate the currently active Ledger transaction span.
 *
 * Outcome is assigned only after the PostgreSQL transaction
 * settles, so a failed COMMIT is never marked as posted.
 *
 * Only bounded, non-sensitive attributes are recorded.
 * Telemetry failures must not affect financial operations.
 */
export function annotateLedgerOutcome(outcome: LedgerPostingOutcome, postingCount?: number): void {
  try {
    const span = trace.getActiveSpan();

    if (!span) {
      return;
    }

    span.setAttribute('ledger.operation', 'post_journal');
    span.setAttribute('ledger.outcome', outcome);
    span.setAttribute('db.system.name', 'postgresql');

    if (postingCount !== undefined && Number.isSafeInteger(postingCount) && postingCount >= 0) {
      span.setAttribute('ledger.posting_count', postingCount);
    }
  } catch {
    // Best-effort telemetry: never affect financial results.
  }
}
