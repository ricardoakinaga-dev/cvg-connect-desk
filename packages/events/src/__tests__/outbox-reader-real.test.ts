/**
 * ConsumerAwareOutboxReader - Real Class Behavioral Tests
 *
 * These tests directly exercise the ConsumerAwareOutboxReader class methods
 * against a real PostgreSQL database via the workspace database client.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { ConsumerAwareOutboxReader, CONSUMER_IDS } from '../outbox-reader';
import {
  clearOutboxTestData,
  getConsumerAck,
  insertOutboxEvent,
  probeRealDatabase,
  recordConsumerFailure,
  recordConsumerSuccess,
} from './real-db-test-utils';

const realDb = await probeRealDatabase();
const describeRealDb = realDb.available ? describe : describe.skip;

if (!realDb.available) {
  console.warn(`[events] skipping outbox reader real tests: ${realDb.reason}`);
}

const workerReader = new ConsumerAwareOutboxReader({
  consumerId: CONSUMER_IDS.WORKER,
  batchSize: 1000,
  maxRetries: 3,
});

const realtimeReader = new ConsumerAwareOutboxReader({
  consumerId: CONSUMER_IDS.REALTIME,
  batchSize: 1000,
  maxRetries: 3,
});

const httpPollReader = new ConsumerAwareOutboxReader({
  consumerId: CONSUMER_IDS.HTTP_POLL,
  batchSize: 1000,
  maxRetries: 3,
});

describeRealDb('ConsumerAwareOutboxReader - Real Class Behavioral Tests', () => {
  beforeAll(async () => {
    await clearOutboxTestData(['reader-test-']);
  });

  beforeEach(async () => {
    await clearOutboxTestData(['reader-test-']);
  });

  afterEach(async () => {
    await clearOutboxTestData(['reader-test-']);
  });

  afterAll(async () => {
    await clearOutboxTestData(['reader-test-']);
  });

  describe('Case 1 - Same event visible to multiple readers', () => {
    it('worker reader sees the event', async () => {
      await insertOutboxEvent({ eventId: 'reader-test-001' });

      const events = await workerReader.fetchPendingEvents();
      expect(events.map(event => event.eventId)).toContain('reader-test-001');
    });

    it('realtime reader sees the same event simultaneously', async () => {
      await insertOutboxEvent({ eventId: 'reader-test-001' });

      const workerEvents = await workerReader.fetchPendingEvents();
      const realtimeEvents = await realtimeReader.fetchPendingEvents();

      expect(workerEvents.map(event => event.eventId)).toContain('reader-test-001');
      expect(realtimeEvents.map(event => event.eventId)).toContain('reader-test-001');
    });

    it('http-poll reader also sees the same event', async () => {
      await insertOutboxEvent({ eventId: 'reader-test-001' });

      const pollEvents = await httpPollReader.fetchPendingEvents();
      expect(pollEvents.map(event => event.eventId)).toContain('reader-test-001');
    });
  });

  describe('Case 2 - Ack from one consumer does not hide from another', () => {
    it('worker ack hides from worker but not from realtime', async () => {
      await insertOutboxEvent({ eventId: 'reader-test-002' });

      await recordConsumerSuccess('reader-test-002', CONSUMER_IDS.WORKER);

      const workerAfter = await workerReader.fetchPendingEvents();
      const realtimeAfter = await realtimeReader.fetchPendingEvents();

      expect(workerAfter.map(event => event.eventId)).not.toContain('reader-test-002');
      expect(realtimeAfter.map(event => event.eventId)).toContain('reader-test-002');
    });

    it('realtime ack does not affect worker', async () => {
      await insertOutboxEvent({ eventId: 'reader-test-002b' });

      await recordConsumerSuccess('reader-test-002b', CONSUMER_IDS.REALTIME);

      const realtimeAfter = await realtimeReader.fetchPendingEvents();
      const workerAfter = await workerReader.fetchPendingEvents();

      expect(realtimeAfter.map(event => event.eventId)).not.toContain('reader-test-002b');
      expect(workerAfter.map(event => event.eventId)).toContain('reader-test-002b');
    });
  });

  describe('Case 3 - Failure keeps retry for same consumer', () => {
    it('acknowledgeWithError keeps processedAt NULL and increments retryCount', async () => {
      await insertOutboxEvent({ eventId: 'reader-test-003' });

      await recordConsumerFailure('reader-test-003', CONSUMER_IDS.WORKER, 'Connection timeout');

      const ack = await getConsumerAck('reader-test-003', CONSUMER_IDS.WORKER);
      expect(ack).not.toBeNull();
      expect(ack!.processedAt).toBeNull();
      expect(ack!.retryCount).toBe(1);
      expect(ack!.lastError).toBe('Connection timeout');

      const pendingEvents = await workerReader.fetchPendingEvents();
      expect(pendingEvents.map(event => event.eventId)).toContain('reader-test-003');
    });

    it('multiple failures increment retryCount correctly', async () => {
      await insertOutboxEvent({ eventId: 'reader-test-003b' });

      await recordConsumerFailure('reader-test-003b', CONSUMER_IDS.WORKER, 'Error 1');
      let ack = await getConsumerAck('reader-test-003b', CONSUMER_IDS.WORKER);
      expect(ack!.retryCount).toBe(1);

      await recordConsumerFailure('reader-test-003b', CONSUMER_IDS.WORKER, 'Error 2');
      ack = await getConsumerAck('reader-test-003b', CONSUMER_IDS.WORKER);
      expect(ack!.retryCount).toBe(2);
      expect(ack!.lastError).toBe('Error 2');
      expect(ack!.processedAt).toBeNull();

      const pendingEvents = await workerReader.fetchPendingEvents();
      expect(pendingEvents.map(event => event.eventId)).toContain('reader-test-003b');
    });
  });

  describe('Case 4 - Permanent failure does not block other consumers', () => {
    it('worker permanently failed does not block realtime reader', async () => {
      await insertOutboxEvent({ eventId: 'reader-test-004' });

      await recordConsumerFailure('reader-test-004', CONSUMER_IDS.WORKER, 'Retry 1');
      await recordConsumerFailure('reader-test-004', CONSUMER_IDS.WORKER, 'Retry 2');
      await recordConsumerFailure('reader-test-004', CONSUMER_IDS.WORKER, 'Retry 3 - Max exceeded');

      const ack = await getConsumerAck('reader-test-004', CONSUMER_IDS.WORKER);
      expect(ack!.retryCount).toBeGreaterThanOrEqual(3);
      expect(ack!.processedAt).toBeNull();

      const workerPending = await workerReader.fetchPendingEvents();
      const realtimePending = await realtimeReader.fetchPendingEvents();

      expect(workerPending.map(event => event.eventId)).not.toContain('reader-test-004');
      expect(realtimePending.map(event => event.eventId)).toContain('reader-test-004');
    });

    it('realtime failure does not block worker reader', async () => {
      await insertOutboxEvent({ eventId: 'reader-test-004b' });

      await recordConsumerFailure('reader-test-004b', CONSUMER_IDS.REALTIME, 'Retry 1');
      await recordConsumerFailure('reader-test-004b', CONSUMER_IDS.REALTIME, 'Retry 2');
      await recordConsumerFailure('reader-test-004b', CONSUMER_IDS.REALTIME, 'Retry 3');

      const realtimePending = await realtimeReader.fetchPendingEvents();
      const workerPending = await workerReader.fetchPendingEvents();

      expect(realtimePending.map(event => event.eventId)).not.toContain('reader-test-004b');
      expect(workerPending.map(event => event.eventId)).toContain('reader-test-004b');
    });
  });

  describe('Case 5 - Success only closes that consumer', () => {
    it('worker success hides from worker but not from realtime', async () => {
      await insertOutboxEvent({ eventId: 'reader-test-005' });

      await recordConsumerFailure('reader-test-005', CONSUMER_IDS.WORKER, 'Temporary failure');
      const ackWithFailure = await getConsumerAck('reader-test-005', CONSUMER_IDS.WORKER);
      expect(ackWithFailure!.retryCount).toBe(1);

      await recordConsumerSuccess('reader-test-005', CONSUMER_IDS.WORKER);

      const ackSuccess = await getConsumerAck('reader-test-005', CONSUMER_IDS.WORKER);
      expect(ackSuccess!.processedAt).not.toBeNull();
      expect(ackSuccess!.retryCount).toBe(0);

      const workerPending = await workerReader.fetchPendingEvents();
      const realtimePending = await realtimeReader.fetchPendingEvents();

      expect(workerPending.map(event => event.eventId)).not.toContain('reader-test-005');
      expect(realtimePending.map(event => event.eventId)).toContain('reader-test-005');
    });

    it('success on one consumer does not affect third consumer', async () => {
      await insertOutboxEvent({ eventId: 'reader-test-005b' });

      await recordConsumerSuccess('reader-test-005b', CONSUMER_IDS.WORKER);

      const workerPending = await workerReader.fetchPendingEvents();
      const realtimePending = await realtimeReader.fetchPendingEvents();
      const pollPending = await httpPollReader.fetchPendingEvents();

      expect(workerPending.map(event => event.eventId)).not.toContain('reader-test-005b');
      expect(realtimePending.map(event => event.eventId)).toContain('reader-test-005b');
      expect(pollPending.map(event => event.eventId)).toContain('reader-test-005b');
    });
  });
});

describeRealDb('ConsumerAwareOutboxReader - Integration with real outbox', () => {
  beforeEach(async () => {
    await clearOutboxTestData(['reader-test-', 'test-event-']);
  });

  afterEach(async () => {
    await clearOutboxTestData(['reader-test-', 'test-event-']);
  });

  afterAll(async () => {
    await clearOutboxTestData(['reader-test-', 'test-event-']);
  });

  it('toEventEnvelope converts ConsumerOutboxEvent to EventEnvelope correctly', async () => {
    await insertOutboxEvent({
      eventId: 'reader-test-env-001',
      eventType: 'test.published',
      aggregateType: 'Conversation',
      aggregateId: 'conv-001',
      payload: { content: 'test' },
    });

    const events = await workerReader.fetchPendingEvents();
    const ourEvent = events.find(event => event.eventId === 'reader-test-env-001');
    expect(ourEvent).toBeDefined();

    const envelope = workerReader.toEventEnvelope(ourEvent!);
    expect(envelope.event_type).toBe('test.published');
    expect(envelope.aggregate_type).toBe('Conversation');
    expect(envelope.aggregate_id).toBe('conv-001');
    expect(envelope.payload).toEqual({ content: 'test' });
    expect(envelope.version).toBe(1);
    expect(envelope.occurred_at).toBeDefined();
  });

  it('events survive multiple consumer interactions', async () => {
    await insertOutboxEvent({ eventId: 'reader-test-multi-001' });

    const workerInitial = await workerReader.fetchPendingEvents();
    expect(workerInitial.map(event => event.eventId)).toContain('reader-test-multi-001');
    await workerReader.acknowledge('reader-test-multi-001');

    const realtimeAfterWorker = await realtimeReader.fetchPendingEvents();
    expect(realtimeAfterWorker.map(event => event.eventId)).toContain('reader-test-multi-001');

    const pollAfterWorker = await httpPollReader.fetchPendingEvents();
    expect(pollAfterWorker.map(event => event.eventId)).toContain('reader-test-multi-001');

    await realtimeReader.acknowledge('reader-test-multi-001');

    const pollAfterRealtime = await httpPollReader.fetchPendingEvents();
    expect(pollAfterRealtime.map(event => event.eventId)).toContain('reader-test-multi-001');

    await httpPollReader.acknowledge('reader-test-multi-001');

    const workerFinal = await workerReader.fetchPendingEvents();
    const realtimeFinal = await realtimeReader.fetchPendingEvents();
    const pollFinal = await httpPollReader.fetchPendingEvents();

    expect(workerFinal.map(event => event.eventId)).not.toContain('reader-test-multi-001');
    expect(realtimeFinal.map(event => event.eventId)).not.toContain('reader-test-multi-001');
    expect(pollFinal.map(event => event.eventId)).not.toContain('reader-test-multi-001');
  });
});
