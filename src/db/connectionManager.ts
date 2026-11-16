import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { loadSqlite } from './driver';

export interface ConnectionSpec {
  key: string;
  /** Absolute database path, or null for an in-memory database. */
  filePath: string | null;
  readOnly: boolean;
  busyTimeoutMs: number;
}

interface ConnectionEntry {
  db: DatabaseSync;
  spec: ConnectionSpec;
}

export class ConnectionManager {
  private readonly entries = new Map<string, ConnectionEntry>();

  public acquire(spec: ConnectionSpec): DatabaseSync {
    const existing = this.entries.get(spec.key);
    if (existing && existing.spec.readOnly === spec.readOnly) {
      return existing.db;
    }
    if (existing) {
      this.release(spec.key);
    }

    const db = this.open(spec);
    this.entries.set(spec.key, { db, spec });
    return db;
  }

  public closeDocument(uri: string): void {
    this.release(memoryKey(uri));
  }

  public disposeAll(): void {
    for (const key of [...this.entries.keys()]) {
      this.release(key);
    }
  }

  /** Closes file connections (used when connection options change) but keeps in-memory databases. */
  public disposeFiles(): void {
    for (const [key, entry] of [...this.entries.entries()]) {
      if (entry.spec.filePath !== null) {
        this.release(key);
      }
    }
  }

  public dispose(): void {
    this.disposeAll();
  }

  private open(spec: ConnectionSpec): DatabaseSync {
    const { DatabaseSync } = loadSqlite();

    if (spec.filePath === null) {
      const db = new DatabaseSync(':memory:');
      this.applySessionSetup(db, spec);
      return db;
    }

    const directory = path.dirname(spec.filePath);
    if (!fs.existsSync(directory)) {
      throw new Error(`Directory does not exist: ${directory}`);
    }

    if (spec.readOnly && !fs.existsSync(spec.filePath)) {
      throw new Error(
        `Database file does not exist: ${spec.filePath}. SQLient is in read-only mode, so it will not create it.`,
      );
    }

    const db = spec.readOnly
      ? new DatabaseSync(spec.filePath, { readOnly: true, timeout: spec.busyTimeoutMs })
      : new DatabaseSync(spec.filePath, { timeout: spec.busyTimeoutMs });
    this.applySessionSetup(db, spec);
    return db;
  }

  private applySessionSetup(db: DatabaseSync, spec: ConnectionSpec): void {
    try {
      db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(spec.busyTimeoutMs))}`);
    } catch {
      // A busy timeout is a convenience; failing to set it must not block the connection.
    }
  }

  private release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    this.entries.delete(key);
    try {
      entry.db.close();
    } catch {
      // Closing a connection that is already gone is harmless.
    }
  }
}

export function fileKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  // macOS and Windows default file systems resolve paths case-insensitively.
  const normalized = process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved;
  return `file:${normalized}`;
}

export function memoryKey(uri: string): string {
  return `mem:${uri}`;
}
