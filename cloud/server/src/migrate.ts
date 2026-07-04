import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import 'dotenv/config';

// Standalone entrypoint (dist/migrate.js) so prod updates can run migrations
// with plain node — no tsx/drizzle-kit on the box.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

async function runMigrations(): Promise<void> {
  console.log('Running migrations...');
  const sql = postgres(connectionString!, { max: 1 });
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

void runMigrations();
