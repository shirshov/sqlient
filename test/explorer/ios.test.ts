import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { findSqliteFiles, parseBootedDevices, parseListapps } from '../../src/explorer/iosScan';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlient-ios-'));
  tempDirs.push(dir);
  return dir;
}

function createDatabase(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec('create table t(a)');
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseBootedDevices', () => {
  it('keeps available booted iOS devices only', () => {
    const devices = parseBootedDevices({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
          { udid: 'A', name: 'iPhone 16', state: 'Booted', isAvailable: true },
          { udid: 'B', name: 'iPhone 16 Plus', state: 'Shutdown', isAvailable: true },
          { udid: 'C', name: 'Broken', state: 'Booted', isAvailable: false },
        ],
        'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [
          { udid: 'D', name: 'Watch', state: 'Booted', isAvailable: true },
        ],
      },
    });

    expect(devices).toEqual([{ udid: 'A', name: 'iPhone 16' }]);
  });

  it('handles unexpected input', () => {
    expect(parseBootedDevices(null)).toEqual([]);
    expect(parseBootedDevices({ devices: [] })).toEqual([]);
  });
});

describe('parseListapps', () => {
  it('reads bundle ids, data containers, and group containers', () => {
    const apps = parseListapps({
      'com.example.app': {
        CFBundleIdentifier: 'com.example.app',
        CFBundleDisplayName: 'Example',
        DataContainer:
          'file:///Users/alex/Library/Developer/CoreSimulator/Devices/X/data/Containers/Data/Application/Y/',
        GroupContainers: {
          'group.com.example.app':
            'file:///Users/alex/Library/Developer/CoreSimulator/Devices/X/data/Containers/Shared/AppGroup/Z/',
        },
      },
    });

    expect(apps).toHaveLength(1);
    expect(apps[0]?.bundleId).toBe('com.example.app');
    expect(apps[0]?.displayName).toBe('Example');
    expect(apps[0]?.dataPath?.endsWith('/Application/Y')).toBe(true);
    expect(apps[0]?.groupContainers).toEqual([
      {
        id: 'group.com.example.app',
        path: '/Users/alex/Library/Developer/CoreSimulator/Devices/X/data/Containers/Shared/AppGroup/Z',
      },
    ]);
  });
});

describe('findSqliteFiles', () => {
  it('finds SQLite databases, skips caches and non-database files', async () => {
    const root = tempDir();

    createDatabase(path.join(root, 'Documents', 'app.db'));
    createDatabase(path.join(root, 'Library', 'Application Support', 'real.sqlite3'));
    createDatabase(path.join(root, 'Library', 'Caches', 'cache.sqlite'));

    fs.writeFileSync(path.join(root, 'Documents', 'not-a-database.db'), 'plain text');
    fs.writeFileSync(path.join(root, 'Documents', 'notes.txt'), 'SQLite format 3\0');

    const { files, truncated } = await findSqliteFiles(root);
    const relative = files.map((file) => path.relative(root, file).split(path.sep).join('/'));

    expect(truncated).toBe(false);

    expect(relative).toEqual(['Documents/app.db', 'Library/Application Support/real.sqlite3']);
  });

  it('returns an empty list for a missing directory', async () => {
    expect(await findSqliteFiles(path.join(tempDir(), 'missing'))).toEqual({ files: [], truncated: false });
  });

  it('reports truncation when a container holds more than the cap', async () => {
    const root = tempDir();
    const documents = path.join(root, 'Documents');
    fs.mkdirSync(documents, { recursive: true });
    for (let index = 0; index < 205; index += 1) {
      fs.writeFileSync(path.join(documents, `store-${index}.db`), 'SQLite format 3\0');
    }

    const { files, truncated } = await findSqliteFiles(root);
    expect(files).toHaveLength(200);
    expect(truncated).toBe(true);
  });
});
