import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schemaModule from './schema';
import { webhookReplayLog } from './webhook-replay';

const connectionString = process.env.DATABASE_URL || 'postgresql://connect_desk:root@localhost:5432/connect_desk_db';

const pool = new Pool({ connectionString });
const fullSchema = { ...schemaModule, webhookReplayLog };
export const db = drizzle(pool, { schema: fullSchema });
export const schema = fullSchema;

export * from './schema';
export * from './webhook-replay';
