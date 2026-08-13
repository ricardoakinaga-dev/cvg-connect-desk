import { beforeEach, describe, expect, it, vi } from 'vitest';

const telemetryMock = vi.hoisted(() => {
  const span = {
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
    setAttribute: vi.fn(),
    addEvent: vi.fn(),
  };
  const sdkShutdown = vi.fn().mockResolvedValue(undefined);

  return {
    span,
    sdkShutdown,
    sdkStart: vi.fn(),
    nodeSdkConstructor: vi.fn(function NodeSDKMock(this: unknown) {
      return {
        start: telemetryMock.sdkStart,
        shutdown: telemetryMock.sdkShutdown,
      };
    }),
    resourceFromAttributes: vi.fn((attributes: unknown) => ({ attributes })),
    traceExporter: vi.fn((config: unknown) => ({ config })),
    getTracer: vi.fn(() => ({
      startSpan: vi.fn(() => span),
    })),
    active: vi.fn(() => ({ active: true })),
    withContext: vi.fn((_context: unknown, fn: () => unknown) => fn()),
    setSpan: vi.fn((context: unknown) => ({ ...context, span })),
    getActiveSpan: vi.fn(() => span),
    inject: vi.fn((_context: unknown, carrier: Record<string, string>) => {
      carrier.traceparent = '00-traceid-spanid-01';
    }),
  };
});

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: telemetryMock.nodeSdkConstructor,
}));

vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: telemetryMock.resourceFromAttributes,
}));

vi.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_SERVICE_NAME: 'service.name',
  ATTR_SERVICE_VERSION: 'service.version',
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: telemetryMock.traceExporter,
}));

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: telemetryMock.getTracer,
    setSpan: telemetryMock.setSpan,
    getActiveSpan: telemetryMock.getActiveSpan,
  },
  context: {
    active: telemetryMock.active,
    with: telemetryMock.withContext,
  },
  SpanStatusCode: {
    OK: 1,
    ERROR: 2,
  },
  propagation: {
    inject: telemetryMock.inject,
  },
}));

const {
  addSpanEvent,
  createSpan,
  extractCorrelationId,
  getCurrentSpan,
  getTracer,
  injectCorrelationId,
  initializeTracing,
  setSpanAttribute,
  shutdownTracing,
  withSpan,
} = await import('../tracing');

describe('tracing helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips initialization when tracing is disabled', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    initializeTracing({ serviceName: 'desk-api', enabled: false });

    expect(telemetryMock.nodeSdkConstructor).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[Tracing] OpenTelemetry disabled by configuration');
    log.mockRestore();
  });

  it('initializes and shuts down OpenTelemetry SDK', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    initializeTracing({
      serviceName: 'desk-api',
      serviceVersion: '2.0.0',
      exporterUrl: 'http://otel:4318/v1/traces',
      enabled: true,
    });
    await shutdownTracing();

    expect(telemetryMock.resourceFromAttributes).toHaveBeenCalledWith({
      'service.name': 'desk-api',
      'service.version': '2.0.0',
    });
    expect(telemetryMock.traceExporter).toHaveBeenCalledWith({ url: 'http://otel:4318/v1/traces' });
    expect(telemetryMock.sdkStart).toHaveBeenCalled();
    expect(telemetryMock.sdkShutdown).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[Tracing] OpenTelemetry initialized for service: desk-api');
    log.mockRestore();
  });

  it('creates spans, records success and records failures', async () => {
    expect(getTracer('custom')).toEqual(expect.objectContaining({ startSpan: expect.any(Function) }));
    expect(createSpan('operation', { userId: 'user-1' })).toBe(telemetryMock.span);

    await expect(withSpan('ok-operation', async (span) => {
      expect(span).toBe(telemetryMock.span);
      return 'ok';
    })).resolves.toBe('ok');
    expect(telemetryMock.span.setStatus).toHaveBeenCalledWith({ code: 1 });
    expect(telemetryMock.span.end).toHaveBeenCalled();

    const error = new Error('failed');
    await expect(withSpan('failed-operation', async () => {
      throw error;
    })).rejects.toThrow('failed');
    expect(telemetryMock.span.setStatus).toHaveBeenCalledWith({ code: 2, message: 'failed' });
    expect(telemetryMock.span.recordException).toHaveBeenCalledWith(error);
  });

  it('extracts and injects correlation ids and mutates active span metadata', () => {
    expect(extractCorrelationId({ traceparent: '00-abc123-span-01' })).toBe('abc123');
    expect(extractCorrelationId({ 'x-correlation-id': 'corr-1' })).toBe('corr-1');
    expect(extractCorrelationId({ traceparent: 'invalid' })).toBeUndefined();

    expect(injectCorrelationId()).toEqual({ traceparent: '00-traceid-spanid-01' });
    expect(getCurrentSpan()).toBe(telemetryMock.span);

    setSpanAttribute('http.status_code', 200);
    addSpanEvent('query.finished', { rows: 1 });

    expect(telemetryMock.span.setAttribute).toHaveBeenCalledWith('http.status_code', 200);
    expect(telemetryMock.span.addEvent).toHaveBeenCalledWith('query.finished', { rows: 1 });
  });
});
