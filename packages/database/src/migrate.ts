import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './client';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// __dirname é .../packages/database/src, subir para .../packages/database
const baseDir = dirname(__dirname);

async function runMigrations() {
  console.log('Running migrations...');
  
  try {
    // Pasta de migrations está em <pacote>/supabase/migrations
    await migrate(db, { migrationsFolder: join(baseDir, 'supabase', 'migrations') });
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

runMigrations();
