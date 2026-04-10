/**
 * Behavioral Fan-Out Tests - CVG Connect Desk
 *
 * These tests validate fan-out behavior using the real PostgreSQL database
 * through the workspace database client. They stay at the persistence layer
 * and do not instantiate the consumer reader class.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { CONSUMER_IDS } from '../outbox-reader';
import {
  clearOutboxTestData,
  getConsumerAck,
  insertOutboxEvent,
  isEventVisibleToConsumer,
  probeRealDatabase,
  recordConsumerFailure,
  recordConsumerSuccess,
} from './real-db-test-utils';

const realDb = await probeRealDatabase();
const describeRealDb = realDb.available ? describe : describe.skip;

if (!realDb.available) {
  console.warn(`[events] skipping outbox fan-out behavioral tests: ${realDb.reason}`);
}

describeRealDb('Fan-Out Behavioral Tests', () => {
  beforeAll(async () => {
    await clearOutboxTestData(['fanout-test-']);
  });

  beforeEach(async () => {
    await clearOutboxTestData(['fanout-test-']);
  });

  afterEach(async () => {
    await clearOutboxTestData(['fanout-test-']);
  });

  afterAll(async () => {
    await clearOutboxTestData(['fanout-test-']);
  });

  describe('Case 1 - Same event visible to multiple consumers', () => {
    it('both worker and realtime see the same pending event', async () => {
      await insertOutboxEvent({ eventId: 'fanout-test-001' });

      expect(await isEventVisibleToConsumer('fanout-test-001', CONSUMER_IDS.WORKER)).toBe(true);
      expect(await isEventVisibleToConsumer('fanout-test-001', CONSUMER_IDS.REALTIME)).toBe(true);
    });
  });

  describe('Case 2 - Ack from one consumer does not hide from another', () => {
    it('worker ack does not hide event from realtime', async () => {
      await insertOutboxEvent({ eventId: 'fanout-test-002' });

      await recordConsumerSuccess('fanout-test-002', CONSUMER_IDS.WORKER);

      expect(await isEventVisibleToConsumer('fanout-test-002', CONSUMER_IDS.WORKER)).toBe(false);
      expect(await isEventVisibleToConsumer('fanout-test-002', CONSUMER_IDS.REALTIME)).toBe(true);
    });

    it('realtime ack does not hide event from worker', async () => {
      await insertOutboxEvent({ eventId: 'fanout-test-002b' });

      await recordConsumerSuccess('fanout-test-002b', CONSUMER_IDS.REALTIME);

      expect(await isEventVisibleToConsumer('fanout-test-002b', CONSUMER_IDS.REALTIME)).toBe(false);
      expect(await isEventVisibleToConsumer('fanout-test-002b', CONSUMER_IDS.WORKER)).toBe(true);
    });
  });

  describe('Case 3 - Failure keeps retry for same consumer', () => {
    it('acknowledgeWithError keeps processedAt NULL and increments retryCount', async () => {
      await insertOutboxEvent({ eventId: 'fanout-test-003' });

      await recordConsumerFailure('fanout-test-003', CONSUMER_IDS.WORKER, 'Connection timeout');

      const ack = await getConsumerAck('fanout-test-003', CONSUMER_IDS.WORKER);
      expect(ack).not.toBeNull();
      expect(ack!.processedAt).toBeNull();
      expect(ack!.retryCount).toBe(1);
      expect(ack!.lastError).toBe('Connection timeout');
      expect(await isEventVisibleToConsumer('fanout-test-003', CONSUMER_IDS.WORKER)).toBe(true);
    });

    it('multiple failures increment retryCount correctly', async () => {
      await insertOutboxEvent({ eventId: 'fanout-test-003b' });

      await recordConsumerFailure('fanout-test-003b', CONSUMER_IDS.WORKER, 'Error 1');
      await recordConsumerFailure('fanout-test-003b', CONSUMER_IDS.WORKER, 'Error 2');

      const ack = await getConsumerAck('fanout-test-003b', CONSUMER_IDS.WORKER);
      expect(ack!.retryCount).toBe(2);
      expect(ack!.lastError).toBe('Error 2');
      expect(ack!.processedAt).toBeNull();
      expect(await isEventVisibleToConsumer('fanout-test-003b', CONSUMER_IDS.WORKER)).toBe(true);
    });
  });

  describe('Case 4 - Permanent failure does not block other consumers', () => {
    it('worker permanently failed does not block realtime reader', async () => {
      await insertOutboxEvent({ eventId: 'fanout-test-004' });

      await recordConsumerFailure('fanout-test-004', CONSUMER_IDS.WORKER, 'Retry 1');
      await recordConsumerFailure('fanout-test-004', CONSUMER_IDS.WORKER, 'Retry 2');
      await recordConsumerFailure('fanout-test-004', CONSUMER_IDS.WORKER, 'Retry 3');

      expect(await isEventVisibleToConsumer('fanout-test-004', CONSUMER_IDS.WORKER)).toBe(false);
      expect(await isEventVisibleToConsumer('fanout-test-004', CONSUMER_IDS.REALTIME)).toBe(true);
    });

    it('realtime failure does not block worker reader', async () => {
      await insertOutboxEvent({ eventId: 'fanout-test-004b' });

      await recordConsumerFailure('fanout-test-004b', CONSUMER_IDS.REALTIME, 'Retry 1');
      await recordConsumerFailure('fanout-test-004b', CONSUMER_IDS.REALTIME, 'Retry 2');
      await recordConsumerFailure('fanout-test-004b', CONSUMER_IDS.REALTIME, 'Retry 3');

      expect(await isEventVisibleToConsumer('fanout-test-004b', CONSUMER_IDS.REALTIME)).toBe(false);
      expect(await isEventVisibleToConsumer('fanout-test-004b', CONSUMER_IDS.WORKER)).toBe(true);
    });
  });

  describe('Case 5 - Success only closes that consumer', () => {
    it('success on one consumer does not affect third consumer', async () => {
      await insertOutboxEvent({ eventId: 'fanout-test-005' });

      await recordConsumerSuccess('fanout-test-005', CONSUMER_IDS.WORKER);

      expect(await isEventVisibleToConsumer('fanout-test-005', CONSUMER_IDS.WORKER)).toBe(false);
      expect(await isEventVisibleToConsumer('fanout-test-005', CONSUMER_IDS.REALTIME)).toBe(true);
      expect(await isEventVisibleToConsumer('fanout-test-005', CONSUMER_IDS.HTTP_POLL)).toBe(true);
    });
  });
});
