import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { loadSqlite } from '../db/driver';

/**
 * Runs a short read-only operation against a database. If the database cannot be opened
 * in place (for example while a local worker holds it), a temporary snapshot is used.
 */
export function withReadOnlyDatabase<T>(dbPath: string, action: (db: DatabaseSync) => T): T {
  try {
    return openAndRun(dbPath, action);
  } catch (firstError) {
    try {
      return withSnapshot(dbPath, action);
    } catch {
      throw firstError;
    }
  }
}

function openAndRun<T>(dbPath: string, action: (db: DatabaseSync) => T): T {
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return action(db);
  } finally {
    try {
      db.close();
    } catch {
      // The connection may already be closed after a read failure.
    }
  }
}

function withSnapshot<T>(dbPath: string, action: (db: DatabaseSync) => T): T {
  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlient-snapshot-'));
  try {
    const copyPath = path.join(snapshotDir, path.basename(dbPath));
    fs.copyFileSync(dbPath, copyPath);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${dbPath}${suffix}`;
      if (fs.existsSync(sidecar)) {
        fs.copyFileSync(sidecar, `${copyPath}${suffix}`);
      }
    }
    return openAndRun(copyPath, action);
  } finally {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
}
