import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schemaModule from './schema';

const connectionString = process.env.DATABASE_URL || 'postgresql://connect_desk:root@localhost:5432/connect_desk_db';

const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema: schemaModule });
export { schemaModule as schema };

export * from './schema';
export * from './operational-stores';
