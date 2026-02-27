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

// Persist DB connection across HMR in dev mode
const g = globalThis as unknown as { __openlareDb?: OpenlareDb };
const _getDb = () => g.__openlareDb ?? null;
const _setDb = (db: OpenlareDb) => {
  g.__openlareDb = db;
};

export function getDb(): OpenlareDb {
  if (_getDb()) return _getDb()!;

  const dataDir = path.join(os.homedir(), '.openlares', 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'openlares.db');
  const db = createDb(dbPath);
  _setDb(db);
  const _db = db;

  // Seed default dashboard if none exists
  seedDefaultDashboard(_db);

  return _db;
}
