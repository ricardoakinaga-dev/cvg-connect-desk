import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, probeRealDatabase, hasColumn } from './real-db-test-utils';

const realDb = await probeRealDatabase();
const describeRealDb = realDb.available ? describe : describe.skip;

if (!realDb.available) {
  console.warn(`[events] skipping schema check tests: ${realDb.reason}`);
}

describeRealDb('Schema Check', () => {
  beforeAll(async () => {
    const result = await db.execute(sql`select 1 as check`);
    expect(result).toBeDefined();
  });

  it('schema.outboxEvents exists in database', async () => {
    expect(await hasColumn('outbox_events', 'event_id')).toBe(true);
  });

  it('schema.outboxConsumerAcks exists in database', async () => {
    expect(await hasColumn('outbox_consumer_acks', 'event_id')).toBe(true);
  });

  it('db object is functional', () => {
    expect(db).toBeDefined();
  });
});
