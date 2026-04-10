import { describe, expect, it } from 'vitest';
import { createEvent } from '../envelope';

describe('createEvent', () => {
  it('defaults to event_version 1', () => {
    const event = createEvent(
      'message.persisted',
      'Message',
      'msg_1',
      { messageId: 'msg_1' },
    );

    expect(event.event_version).toBe(1);
    expect(event.version).toBe(1);
  });

  it('keeps aggregate version separate from event_version', () => {
    const event = createEvent(
      'conversation.status.changed',
      'Conversation',
      'conv_1',
      { conversationId: 'conv_1' },
      { version: 7, eventVersion: 3 },
    );

    expect(event.version).toBe(7);
    expect(event.event_version).toBe(3);
  });
});
