import { describe, expect, it } from 'vitest';
import {
  getContentType,
  getMetrics,
  recordError,
  recordHandoff,
  recordHttpRequest,
  recordInboundMessage,
  recordOutboundMessage,
  recordWebhookDelivery,
  setActiveConversations,
} from '../metrics';

describe('Prometheus metrics helpers', () => {
  it('records custom desk metrics and exposes Prometheus output', async () => {
    recordInboundMessage('whatsapp', 'sector-1');
    recordInboundMessage('whatsapp');
    recordOutboundMessage('whatsapp', 'sector-1');
    recordOutboundMessage('whatsapp');
    recordHandoff('sector-1');
    recordHandoff();
    recordError('validation', '/messages');
    recordWebhookDelivery('inbound', 'success');
    setActiveConversations('open', 'sector-1', 7);
    recordHttpRequest('GET', '/health', 200);

    const metrics = await getMetrics();

    expect(getContentType()).toContain('text/plain');
    expect(metrics).toContain('desk_inbound_messages_total');
    expect(metrics).toContain('channel="whatsapp",sector_id="sector-1"');
    expect(metrics).toContain('sector_id="unknown"');
    expect(metrics).toContain('desk_active_conversations');
    expect(metrics).toContain('status_code="200"');
  });
});
