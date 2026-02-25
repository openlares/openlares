/**
 * Database singleton for the Next.js app.
 *
 * Creates the SQLite database at ~/.openlares/data/openlares.db
 * and seeds the default dashboard on first use.
 */

import { createDb, seedDefaultDashboard, type OpenlareDb } from '@openlares/db';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

let _db: OpenlareDb | null = null;

export function getDb(): OpenlareDb {
  if (_db) return _db;

  const dataDir = path.join(os.homedir(), '.openlares', 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'openlares.db');
  _db = createDb(dbPath);

  // Seed default dashboard if none exists
  seedDefaultDashboard(_db);

  return _db;
}
