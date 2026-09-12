import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schemaModule from './schema';
import { webhookReplayLog } from './webhook-replay';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const fullSchema = { ...schemaModule, webhookReplayLog };
export const db = drizzle(pool, { schema: fullSchema });
export const schema = fullSchema;
export * from './webhook-replay';
