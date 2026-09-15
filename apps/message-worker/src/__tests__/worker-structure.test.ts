import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function source(name: string): string {
  return readFileSync(resolve(__dirname, `../${name}`), 'utf-8');
}

describe('Message Worker Structure', () => {
  const index = source('index.ts');
  const handlers = source('handlers.ts');
  const processor = source('processor.ts');
  const contract = source('contract.ts');

  it('imports events module with consumer-aware outbox', () => {
    expect(index).toContain('@cvg/events');
  });

  it('imports alerts module through the handler factory', () => {
    expect(handlers).toContain('@cvg/alerts');
    expect(handlers).toContain('createAlert');
  });

  it('uses ConsumerAwareOutboxReader from events', () => {
    expect(index).toContain('ConsumerAwareOutboxReader');
  });

  it('uses CONSUMER_IDS for worker identification', () => {
    expect(index).toContain('CONSUMER_IDS');
    expect(index).toContain('WORKER');
  });

  it('claims events via outbox pattern with atomic lease and explicit contract', () => {
    expect(index).toContain('workerReader.claim(');
    expect(index).toContain('eventTypes');
    expect(contract).toContain('WORKER_EVENT_CONTRACT');
  });

  it('acknowledges events after handling with fencing token', () => {
    expect(index).toContain('workerReader.acknowledge(');
  });

  it('nacks failed processing with fencing token (bounded retry/DLQ)', () => {
    expect(index).toContain('workerReader.nack(');
    expect(processor).toContain('permanent');
    expect(processor).toContain('dead-letter');
  });

  it('applies alert effects idempotently per (eventId, consumer, effect)', () => {
    expect(handlers).toContain('idempotency');
    expect(handlers).toContain('effectType');
  });

  it('observes ACK/NACK result instead of reporting stale as completed', () => {
    expect(processor).toContain('ACK rejected');
    expect(processor).toContain('ack_result');
  });

  it('runs durable inbound media recovery in the same no-overlap worker loop', () => {
    expect(index).toContain('recoverPendingInboundMedia(');
    expect(index).toContain('MEDIA_RECOVERY_OWNER');
    expect(index).toContain('waitForInboundMediaProcessing(');
  });
});
