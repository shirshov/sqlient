import * as fs from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BootedDevice {
  udid: string;
  name: string;
}

export interface SimulatorApp {
  bundleId: string;
  displayName: string;
  dataPath?: string;
  groupContainers: Array<{ id: string; path: string }>;
}

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
const SQLITE_EXTENSIONS = new Set(['.sqlite', '.sqlite3', '.db', '.db3', '.s3db']);
const SKIPPED_DIRECTORIES = new Set([
  'Caches',
  'WebKit',
  'tmp',
  'Logs',
  '.Trash',
  'Snapshots',
  'Saved Application State',
]);
const MAX_SCANNED_ENTRIES = 20000;
const MAX_DATABASES_PER_CONTAINER = 200;
const MAX_WALK_DEPTH = 8;

export function parseBootedDevices(value: unknown): BootedDevice[] {
  if (!isRecord(value) || !isRecord(value.devices)) {
    return [];
  }

  const devices: BootedDevice[] = [];
  for (const [runtime, entries] of Object.entries(value.devices)) {
    if (!runtime.startsWith('com.apple.CoreSimulator.SimRuntime.iOS') || !Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (
        isRecord(entry) &&
        typeof entry.udid === 'string' &&
        typeof entry.name === 'string' &&
        entry.state === 'Booted' &&
        entry.isAvailable !== false
      ) {
        devices.push({ udid: entry.udid, name: entry.name });
      }
    }
  }

  return devices;
}

export function parseListapps(value: unknown): SimulatorApp[] {
  if (!isRecord(value)) {
    return [];
  }

  const apps: SimulatorApp[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      continue;
    }

    const bundleId = typeof entry.CFBundleIdentifier === 'string' ? entry.CFBundleIdentifier : key;
    const displayName =
      typeof entry.CFBundleDisplayName === 'string'
        ? entry.CFBundleDisplayName
        : typeof entry.CFBundleName === 'string'
          ? entry.CFBundleName
          : bundleId;

    const groupContainers: Array<{ id: string; path: string }> = [];
    if (isRecord(entry.GroupContainers)) {
      for (const [id, url] of Object.entries(entry.GroupContainers)) {
        const groupPath = pathFromUrl(url);
        if (groupPath) {
          groupContainers.push({ id, path: groupPath });
        }
      }
    }

    apps.push({
      bundleId,
      displayName,
      dataPath: pathFromUrl(entry.DataContainer),
      groupContainers,
    });
  }

  return apps;
}

export interface SqliteFileScan {
  files: string[];
  truncated: boolean;
}

export async function findSqliteFiles(root: string): Promise<SqliteFileScan> {
  const results: string[] = [];
  let truncated = false;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let scanned = 0;

  while (queue.length > 0 && results.length < MAX_DATABASES_PER_CONTAINER && scanned < MAX_SCANNED_ENTRIES) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!entry) {
        continue;
      }

      scanned += 1;
      if (scanned > MAX_SCANNED_ENTRIES) {
        truncated = true;
        break;
      }

      const candidate = path.join(current.dir, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        if (entry.isDirectory() && current.depth < MAX_WALK_DEPTH && !SKIPPED_DIRECTORIES.has(entry.name)) {
          queue.push({ dir: candidate, depth: current.depth + 1 });
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!SQLITE_EXTENSIONS.has(extension)) {
        continue;
      }

      if (await hasSqliteHeader(candidate)) {
        results.push(candidate);
        if (results.length >= MAX_DATABASES_PER_CONTAINER) {
          // Entries after this one in the current directory, or directories still queued,
          // were not examined.
          if (index < entries.length - 1 || queue.length > 0) {
            truncated = true;
          }
          break;
        }
      }
    }
  }

  // A leftover queue means directories were still waiting to be searched when a cap stopped the walk.
  if (queue.length > 0) {
    truncated = true;
  }

  results.sort();
  return { files: results, truncated };
}

async function hasSqliteHeader(file: string): Promise<boolean> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.promises.open(file, 'r');
    const header = Buffer.alloc(SQLITE_MAGIC.length);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return bytesRead === SQLITE_MAGIC.length && header.equals(SQLITE_MAGIC);
  } catch {
    return false;
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
  }
}

function pathFromUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) {
    return undefined;
  }
  if (!value.startsWith('file:')) {
    return value;
  }
  try {
    return path.resolve(fileURLToPath(value));
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
