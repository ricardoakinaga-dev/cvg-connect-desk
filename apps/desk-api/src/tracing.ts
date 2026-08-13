/**
 * OpenTelemetry Tracing Setup
 * O2: OpenTelemetry Tracing - correlation_id propagation across services
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace, context, SpanStatusCode, propagation, type Span } from '@opentelemetry/api';

let sdk: NodeSDK | null = null;

export interface TracingConfig {
  serviceName: string;
  serviceVersion?: string;
  exporterUrl?: string;
  enabled?: boolean;
}

export function initializeTracing(config: TracingConfig): void {
  if (!config.enabled) {
    console.log('[Tracing] OpenTelemetry disabled by configuration');
    return;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion || '1.0.0',
  });

  const traceExporter = config.exporterUrl
    ? new OTLPTraceExporter({ url: config.exporterUrl })
    : undefined;

  sdk = new NodeSDK({
    resource,
    traceExporter,
  });

  sdk.start();
  console.log(`[Tracing] OpenTelemetry initialized for service: ${config.serviceName}`);
}

export function shutdownTracing(): Promise<void> {
  if (sdk) {
    return sdk.shutdown();
  }
  return Promise.resolve();
}

export function getTracer(name: string = 'desk-api') {
  return trace.getTracer(name);
}

export function createSpan(
  operationName: string,
  attributes?: Record<string, string | number | boolean>
): Span {
  const tracer = getTracer();
  return tracer.startSpan(operationName, {
    attributes,
  });
}

export function withSpan<T>(
  operationName: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const span = createSpan(operationName, attributes);

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}

export function extractCorrelationId(headers: Record<string, string | string[] | undefined>): string | undefined {
  const traceparent = headers['traceparent'] as string | undefined;
  if (traceparent) {
    const parts = traceparent.split('-');
    if (parts.length >= 2) {
      return parts[1];
    }
  }
  return headers['x-correlation-id'] as string | undefined;
}

export function injectCorrelationId(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

export function getCurrentSpan(): Span | undefined {
  return trace.getActiveSpan();
}

export function setSpanAttribute(key: string, value: string | number | boolean): void {
  const span = getCurrentSpan();
  if (span) {
    span.setAttribute(key, value);
  }
}

export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
  const span = getCurrentSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}
