import { SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('fintech-platform');

/**
 * Execute an asynchronous business operation in an active trace span.
 *
 * Guarantees:
 * - The operation executes once.
 * - Original return value is preserved.
 * - Original thrown value is preserved.
 * - Span status and attributes exclude sensitive payloads.
 * - Telemetry reporting failures are best-effort.
 *
 * Do not attach journal amounts, tenant identifiers,
 * idempotency keys, request bodies, or SQL parameters.
 */
export function traceOperation<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(operationName, async (span): Promise<T> => {
    try {
      const result = await operation();

      try {
        span.setStatus({
          code: SpanStatusCode.OK,
        });
      } catch {
        // Telemetry must not invalidate business success.
      }

      return result;
    } catch (error: unknown) {
      try {
        span.setStatus({
          code: SpanStatusCode.ERROR,
        });

        span.setAttribute('error.type', error instanceof Error ? error.name : 'NonErrorThrown');
      } catch {
        // Do not replace the original business error.
      }

      throw error;
    } finally {
      try {
        span.end();
      } catch {
        // Do not replace the business result/error.
      }
    }
  });
}
