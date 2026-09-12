import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initTestTracing,
  withSpan,
  injectTraceContext,
  extractTraceContext,
  withExtractedContext,
  correlationAttributes,
  safeAttributes,
  getTracer,
} from '../index';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

describe('tracing (OpenTelemetry)', () => {
  let testTracing: ReturnType<typeof initTestTracing>;

  beforeAll(() => {
    testTracing = initTestTracing();
  });

  afterAll(async () => {
    await testTracing.shutdown();
  });

  it('creates child spans linked to parent', async () => {
    await withSpan('parent-op', async () => {
      await withSpan('child-op', async () => {});
    });

    const spans = testTracing.getSpans();
    const parent = spans.find((s) => s.name === 'parent-op');
    const child = spans.find((s) => s.name === 'child-op');
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext.spanId);
    expect(child?.spanContext.traceId).toBe(parent?.spanContext.traceId);
  });

  it('propagates W3C traceparent across process boundary', async () => {
    let outgoing: Record<string, string> = {};
    await withSpan('sender-op', async () => {
      outgoing = injectTraceContext({ 'x-custom': 'keep-me' });
    });

    expect(outgoing.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    expect(outgoing['x-custom']).toBe('keep-me');

    const extracted = extractTraceContext(outgoing);
    const remoteCtx = trace.getSpanContext(extracted);
    expect(remoteCtx?.traceId).toBeDefined();

    await context.with(extracted, async () => {
      await withSpan('receiver-op', async () => {});
    });

    const spans = testTracing.getSpans();
    const sender = spans.find((s) => s.name === 'sender-op');
    const receiver = spans.find((s) => s.name === 'receiver-op');
    expect(receiver?.spanContext.traceId).toBe(sender?.spanContext.traceId);
  });

  it('withExtractedContext continues the incoming trace', async () => {
    let headers: Record<string, string> = {};
    await withSpan('entry-op', async () => {
      headers = injectTraceContext();
    });

    await withExtractedContext(headers, async () => {
      await withSpan('downstream-op', async () => {});
    });

    const spans = testTracing.getSpans();
    const entry = spans.find((s) => s.name === 'entry-op');
    const downstream = spans.find((s) => s.name === 'downstream-op');
    expect(downstream?.spanContext.traceId).toBe(entry?.spanContext.traceId);
    expect(downstream?.parentSpanContext?.spanId).toBe(entry?.spanContext.spanId);
  });

  it('records error status on exceptions', async () => {
    await expect(
      withSpan('failing-op', async () => {
        throw new Error('kaboom');
      }),
    ).rejects.toThrow('kaboom');

    const spans = testTracing.getSpans();
    const failing = spans.find((s) => s.name === 'failing-op');
    expect(failing?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('preserves event correlation attributes', async () => {
    await withSpan(
      'correlated-op',
      async () => {},
      correlationAttributes({
        correlation_id: 'corr-1',
        causation_id: 'cause-1',
        event_id: 'evt-1',
        message_id: 'm-1',
        conversation_id: 'c-1',
      }),
    );

    const spans = testTracing.getSpans();
    const span = spans.find((s) => s.name === 'correlated-op');
    expect(span?.attributes.correlation_id).toBe('corr-1');
    expect(span?.attributes.event_id).toBe('evt-1');
    expect(span?.attributes.conversation_id).toBe('c-1');
  });

  it('never records secrets in span attributes (redaction intact)', async () => {
    const attrs = safeAttributes({
      authorization: 'Bearer secret',
      api_key: 'key',
      webhook_secret: 's',
      event_id: 'evt-1',
      retry_count: 2,
    });
    expect(attrs.authorization).toBeUndefined();
    expect(attrs.api_key).toBeUndefined();
    expect(attrs.webhook_secret).toBeUndefined();
    expect(attrs.event_id).toBe('evt-1');
    expect(attrs.retry_count).toBe(2);

    await withSpan('guarded-op', async () => {}, {
      authorization: 'Bearer secret',
      event_id: 'evt-2',
    });
    const spans = testTracing.getSpans();
    const span = spans.find((s) => s.name === 'guarded-op');
    expect(span?.attributes.authorization).toBeUndefined();
    expect(span?.attributes.event_id).toBe('evt-2');
  });

  it('tracer is available without explicit init (noop-safe)', () => {
    expect(() => getTracer('probe')).not.toThrow();
  });
});
