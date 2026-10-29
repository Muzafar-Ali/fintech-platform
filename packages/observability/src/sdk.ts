import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

export interface ObservabilityOptions {
  readonly serviceName: string;
  readonly otlpEndpoint?: string;
}

/**
 * Initialize telemetry once per Node.js process.
 *
 * The exporter sends traces and metrics asynchronously.
 * Financial transaction success must not depend on
 * telemetry backend availability.
 */
export function startObservability(options: ObservabilityOptions): NodeSDK {
  if (options.serviceName.trim().length === 0) {
    throw new Error('OpenTelemetry service name is required');
  }

  const endpoint = (options.otlpEndpoint ?? 'http://127.0.0.1:4318').replace(/\/+$/, '');

  const sdk = new NodeSDK({
    serviceName: options.serviceName,

    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),

    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${endpoint}/v1/metrics`,
        }),
        exportIntervalMillis: 5_000,
      }),
    ],
  });

  sdk.start();

  return sdk;
}
