import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from './index.js';
import * as schema from '../db/schema/index.js';

const connectionString = config.DATABASE_URL;

export const sql = postgres(connectionString, {
  max: config.DB_POOL_MAX,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: config.DB_SSL ? 'require' : false,
});

export const db = drizzle(sql, { schema });

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabaseConnection(): Promise<void> {
  await sql.end();
}
