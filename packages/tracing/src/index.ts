import {
  context,
  propagation,
  trace,
  SpanStatusCode,
  type Attributes,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  InMemorySpanExporter,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * OpenTelemetry end-to-end (Final-2).
 *
 * - `initTracing()`: lê OTEL_* do ambiente. Desabilitado por padrão em
 *   dev/test (Noop); OTLP quando `OTEL_EXPORTER_OTLP_ENDPOINT` definido.
 * - `initTestTracing()`: provider em memória para testes.
 * - Propagação W3C (`traceparent`/`tracestate`) + correlação de domínio
 *   (correlation_id, event_id, message_id, conversation_id) como attributes.
 * - NUNCA attributes com segredos/PII (ver `safeAttributes`).
 */

export interface TracingInit {
  provider: NodeTracerProvider | null;
  shutdown: () => Promise<void>;
}

let initialized = false;

function serviceName(): string {
  return process.env.OTEL_SERVICE_NAME || 'cvg-connect-desk';
}

function resourceAttributes(): Record<string, string> {
  const attrs: Record<string, string> = {};
  const raw = process.env.OTEL_RESOURCE_ATTRIBUTES || '';
  for (const pair of raw.split(',')) {
    const [key, ...rest] = pair.split('=');
    if (key && rest.length > 0) attrs[key.trim()] = rest.join('=').trim();
  }
  return attrs;
}

export function isTracingEnabled(): boolean {
  return (process.env.OTEL_ENABLED || '').toLowerCase() === 'true';
}

export async function initTracing(): Promise<TracingInit> {
  if (initialized) {
    return { provider: null, shutdown: async () => {} };
  }
  initialized = true;

  if (!isTracingEnabled()) {
    return { provider: null, shutdown: async () => {} };
  }

  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http').then(
    (m) => ({ OTLPTraceExporter: m.OTLPTraceExporter }),
    () => ({ OTLPTraceExporter: null as never }),
  );

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const headers: Record<string, string> = {};
  for (const pair of (process.env.OTEL_EXPORTER_OTLP_HEADERS || '').split(',')) {
    const [key, ...rest] = pair.split('=');
    if (key && rest.length > 0) headers[key.trim()] = rest.join('=').trim();
  }

  const provider = new NodeTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: serviceName(),
      ...resourceAttributes(),
    }),
    spanProcessors: endpoint && OTLPTraceExporter
      ? [new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint, headers }))]
      : [],
  });
  provider.register();
  return {
    provider,
    shutdown: async () => {
      await provider.shutdown();
    },
  };
}

export function initTestTracing(): { shutdown: () => Promise<void>; getSpans: () => ReadableSpan[] } {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    resource: new Resource({ [ATTR_SERVICE_NAME]: 'cvg-test' }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();
  return {
    getSpans: () => exporter.getFinishedSpans(),
    shutdown: async () => {
      await provider.shutdown();
    },
  };
}

export function getTracer(name = 'cvg-connect-desk'): Tracer {
  return trace.getTracer(name);
}

const SENSITIVE_ATTR_KEYS = new Set([
  'authorization', 'cookie', 'token', 'api_key', 'apikey', 'secret',
  'password', 'webhook_secret', 'signature', 'set-cookie',
]);

/** Remove chaves sensíveis de attributes (nunca logar segredos em spans). */
export function safeAttributes(attrs: Record<string, unknown>): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attrs)) {
    const normalized = key.toLowerCase().replace(/[-_]/g, '');
    if ([...SENSITIVE_ATTR_KEYS].some((s) => normalized.includes(s.replace(/[-_]/g, '')))) {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (value !== undefined && value !== null) {
      out[key] = String(value).slice(0, 512);
    }
  }
  return out;
}

export interface CorrelationAttributes {
  correlation_id?: string;
  causation_id?: string;
  event_id?: string;
  message_id?: string;
  conversation_id?: string;
  event_type?: string;
  consumer_id?: string;
  retry_count?: number;
}

/** Attributes de correlação de domínio (sem PII). */
export function correlationAttributes(input: CorrelationAttributes): Attributes {
  return safeAttributes({ ...input });
}

/** Executa fn dentro de um span ativo; marca erro e sempre encerra. */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes: Record<string, unknown> = {},
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, { attributes: safeAttributes(attributes) }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Injeta W3C trace context (traceparent/tracestate) nos headers de saída. */
export function injectTraceContext(headers: Record<string, string> = {}): Record<string, string> {
  const out = { ...headers };
  propagation.inject(context.active(), out);
  return out;
}

/** Extrai W3C trace context de headers de entrada → contexto ativo. */
export function extractTraceContext(headers: Record<string, string | string[] | undefined>): ReturnType<typeof context.active> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') flat[key.toLowerCase()] = value;
    else if (Array.isArray(value) && value.length > 0) flat[key.toLowerCase()] = value[0];
  }
  return propagation.extract(context.active(), flat);
}

/** Roda fn com o contexto extraído dos headers (continuação de trace). */
export async function withExtractedContext<T>(
  headers: Record<string, string | string[] | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx = extractTraceContext(headers);
  return context.with(ctx, fn);
}
