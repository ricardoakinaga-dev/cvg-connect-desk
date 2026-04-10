import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Message Worker Structure', () => {
  const workerPath = resolve(__dirname, '../index.ts');
  const content = readFileSync(workerPath, 'utf-8');

  it('imports events module with consumer-aware outbox', () => {
    expect(content).toContain("@cvg/events");
  });

  it('imports alerts module', () => {
    expect(content).toContain("@cvg/alerts");
  });

  it('uses ConsumerAwareOutboxReader from events', () => {
    expect(content).toContain("ConsumerAwareOutboxReader");
  });

  it('uses CONSUMER_IDS for worker identification', () => {
    expect(content).toContain("CONSUMER_IDS");
    expect(content).toContain("WORKER");
  });

  it('processes events via outbox pattern', () => {
    expect(content).toContain("fetchPendingEvents");
  });

  it('acknowledges events after handling via consumer-aware method', () => {
    expect(content).toContain("workerReader.acknowledge");
  });

  it('acknowledges with error for failed processing', () => {
    expect(content).toContain("acknowledgeWithError");
  });
});
