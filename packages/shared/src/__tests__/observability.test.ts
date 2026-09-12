import { describe, it, expect } from 'vitest';
import { redactObject, maskPhone, REDACTED } from '../redact';
import { MetricsRegistry } from '../metrics';

describe('redactObject (LGPD)', () => {
  it('redacts secrets by key (case-insensitive)', () => {
    const out = redactObject({
      Authorization: 'Bearer abc',
      password: 'hunter2',
      nested: { api_key: 'key', safe: 'ok' },
    });
    expect(out).toMatchObject({
      Authorization: REDACTED,
      password: REDACTED,
      nested: { api_key: REDACTED, safe: 'ok' },
    });
  });

  it('masks phone-like PII by default', () => {
    const out = redactObject({ phone: '+5511999999999', recipient: '5511888888888' });
    expect(out.phone).toContain('[PHONE]');
    expect(out.phone).not.toContain('999999999');
    expect(out.recipient).toContain('[PHONE]');
  });

  it('does not mutate the original object', () => {
    const input = { token: 'abc', list: [{ secret: 's' }] };
    const out = redactObject(input);
    expect(input.token).toBe('abc');
    expect((out.list[0] as { secret: string }).secret).toBe(REDACTED);
  });

  it('handles circular references', () => {
    const input: Record<string, unknown> = { a: 1 };
    input.self = input;
    expect(() => redactObject(input)).not.toThrow();
  });
});

describe('maskPhone', () => {
  it('keeps only DDI prefix and last digits', () => {
    expect(maskPhone('+5511999999999')).toBe('[PHONE]:55***99');
    expect(maskPhone('abc')).toBe('[PHONE]');
  });
});

describe('MetricsRegistry (Prometheus exposition)', () => {
  it('renders counters with labels', () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter('test_total', 'Test counter');
    counter.inc({ route: '/health', status: 200 }, 2);
    const text = registry.render();
    expect(text).toContain('# HELP test_total Test counter');
    expect(text).toContain('# TYPE test_total counter');
    expect(text).toContain('test_total{route="/health",status="200"} 2');
  });

  it('renders histograms with cumulative buckets', () => {
    const registry = new MetricsRegistry();
    const histogram = registry.histogram('test_seconds', 'Test histogram', [0.1, 1]);
    histogram.observe(0.05);
    histogram.observe(0.5);
    const text = registry.render();
    expect(text).toContain('test_seconds_bucket{le="0.1"} 1');
    expect(text).toContain('test_seconds_bucket{le="1"} 2');
    expect(text).toContain('test_seconds_bucket{le="+Inf"} 2');
    expect(text).toContain('test_seconds_count 2');
  });

  it('gauges support set/inc/dec', () => {
    const registry = new MetricsRegistry();
    const gauge = registry.gauge('test_gauge', 'Test gauge');
    gauge.set(5);
    gauge.inc();
    gauge.dec({}, 2);
    expect(gauge.get()).toBe(4);
  });
});
