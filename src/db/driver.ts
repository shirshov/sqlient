import { createRequire } from 'node:module';
import * as path from 'node:path';

type SqliteModule = typeof import('node:sqlite');

let sqliteModule: SqliteModule | undefined;
let unavailableReason: string | undefined;
let bootstrapBase: string | undefined;

/**
 * Records the directory that the bootstrap file is resolved against. Without this the
 * resolution would depend on the working directory of the extension host process.
 */
export function setSqliteBootstrapBase(basePath: string): void {
  if (!sqliteModule) {
    bootstrapBase = basePath;
  }
}

export class SqliteUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SqliteUnavailableError';
  }
}

/**
 * Loads the Node.js built-in SQLite driver lazily so the extension can start on a
 * VS Code build without it and report a useful error instead of failing activation.
 */
export function loadSqlite(): SqliteModule {
  if (sqliteModule) {
    return sqliteModule;
  }

  if (unavailableReason) {
    throw new SqliteUnavailableError(unavailableReason);
  }

  try {
    // The file itself never needs to exist; the path only anchors module resolution, and
    // `node:sqlite` is a built-in. Preferring the extension directory keeps this independent
    // of the extension host's working directory (which is not the project directory).
    const base = bootstrapBase ?? (typeof __dirname === 'string' ? __dirname : process.cwd());
    const requireFromExtension = createRequire(path.join(base, 'sqlient-bootstrap.cjs'));
    sqliteModule = requireFromExtension('node:sqlite') as SqliteModule;
    return sqliteModule;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    unavailableReason =
      'SQLient needs the built-in SQLite support of Node.js 24 or newer, which this VS Code build ' +
      `does not provide (${detail}). Update VS Code to use SQLient.`;
    throw new SqliteUnavailableError(unavailableReason);
  }
}

export interface NormalizedError {
  message: string;
  code?: string;
}

export function normalizeError(error: unknown): NormalizedError {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const code = (error as { code?: unknown }).code;
  const hint = hintFor(error.message);
  const message = hint ? `${error.message} (${hint})` : error.message;

  return typeof code === 'string' ? { message, code } : { message };
}

function hintFor(message: string): string | undefined {
  if (/database is locked|SQLITE_BUSY/i.test(message)) {
    return 'the database is locked by another process';
  }
  if (/attempt to write a readonly database|SQLITE_READONLY/i.test(message)) {
    return 'the database is open read-only';
  }
  if (/file is not a database|SQLITE_NOTADB/i.test(message)) {
    return 'this file is not an SQLite database';
  }
  if (/unable to open database file|SQLITE_CANTOPEN/i.test(message)) {
    return 'the database file could not be opened';
  }
  return undefined;
}
