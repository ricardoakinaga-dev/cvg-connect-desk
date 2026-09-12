import { describe, it, expect } from 'vitest';
import { InboundMessageV1Schema, parseInboundMessageV1 } from '../inbound';
import { OutboundMessageV1Schema } from '../outbound';
import { CanonicalEventEnvelopeV1Schema } from '../envelope';

describe('InboundMessageV1', () => {
  it('accepts a valid normalized inbound message', () => {
    const result = InboundMessageV1Schema.safeParse({
      specVersion: '1.0.0',
      externalMessageId: 'wamid.abc123',
      externalConversationId: 'inst_5511999999999',
      content: 'Olá',
      sender: '5511999999999',
      senderType: 'contact',
      sentAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing externalMessageId (canonical ID obrigatório)', () => {
    const parsed = parseInboundMessageV1({
      specVersion: '1.0.0',
      content: 'sem id',
      sender: '5511999999999',
      sentAt: new Date().toISOString(),
    });
    expect(parsed.ok).toBe(false);
  });

  it('rejects empty sender', () => {
    const parsed = parseInboundMessageV1({
      specVersion: '1.0.0',
      externalMessageId: 'x',
      content: 'hi',
      sender: '',
      sentAt: new Date().toISOString(),
    });
    expect(parsed.ok).toBe(false);
  });
});

describe('OutboundMessageV1', () => {
  it('accepts a valid outbound message with idempotency key', () => {
    const result = OutboundMessageV1Schema.safeParse({
      specVersion: '1.0.0',
      conversationId: '123e4567-e89b-12d3-a456-426614174000',
      content: 'Oi',
      recipient: '5511999999999',
      idempotencyKey: 'key-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-uuid conversationId', () => {
    const result = OutboundMessageV1Schema.safeParse({
      specVersion: '1.0.0',
      conversationId: 'not-a-uuid',
      content: 'Oi',
      recipient: '5511999999999',
    });
    expect(result.success).toBe(false);
  });
});

describe('CanonicalEventEnvelopeV1', () => {
  it('accepts a valid envelope with trace propagation fields', () => {
    const result = CanonicalEventEnvelopeV1Schema.safeParse({
      specVersion: '1.0.0',
      eventId: 'evt-1',
      eventType: 'message.persisted',
      occurredAt: new Date().toISOString(),
      source: 'desk-api',
      aggregateType: 'Message',
      aggregateId: '123e4567-e89b-12d3-a456-426614174000',
      correlationId: 'corr-1',
      traceId: 'trace-1',
      payload: { messageId: 'm-1' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects envelope without eventId', () => {
    const result = CanonicalEventEnvelopeV1Schema.safeParse({
      specVersion: '1.0.0',
      eventType: 'message.persisted',
      occurredAt: new Date().toISOString(),
      source: 'desk-api',
      aggregateType: 'Message',
      aggregateId: 'a',
      payload: {},
    });
    expect(result.success).toBe(false);
  });
});
