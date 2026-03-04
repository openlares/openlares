/**
 * Database client — creates and manages the SQLite connection.
 *
 * Usage:
 *   import { createDb } from '@openlares/db';
 *   const db = createDb('/path/to/openlares.db');
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type OpenlareDb = BetterSQLite3Database<typeof schema>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Create a new database connection. Runs WAL mode for performance and
 * applies migrations via Drizzle Kit (creates/alters tables as needed).
 */
export function createDb(filepath: string): OpenlareDb {
  const sqlite = new Database(filepath);

  // WAL mode for concurrent reads + single writer performance
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  // Run pending migrations (creates tables on first run, applies ALTERs on updates)
  migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') });

  return db;
}
