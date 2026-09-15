import { beforeEach, describe, expect, it } from 'vitest';
import { deadLetterStore, type EventEnvelope } from '@cvg/events';
import { RealtimeServer } from '../index.ts';

describe('RealtimeServer projection behavior', () => {
  beforeEach(() => {
    deadLetterStore.clear();
  });

  it('does not create dead-letter entries for non-projectable events', async () => {
    const server = new RealtimeServer(8081);
    const event = {
      event_id: 'evt_realtime_skip_001',
      event_type: 'integration.heartbeat',
      event_version: 1,
      aggregate_type: 'System',
      aggregate_id: 'system-1',
      occurred_at: '2026-04-10T15:00:00.000Z',
      payload: { ok: true },
      version: 1,
    } satisfies EventEnvelope;

    const result = await (server as unknown as { processEvent(event: EventEnvelope): Promise<boolean> }).processEvent(event);

    expect(result).toBe(false);
    expect(deadLetterStore.getStats()).toEqual({ total: 0, unresolved: 0, resolved: 0 });
  });
});
