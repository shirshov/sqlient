import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanD1State } from '../../src/explorer/d1Scan';

const DATABASE_ID = '67d7e0aa-aefb-40e2-895f-51fe16585e01';
const OBJECT_ID = 'b882100a3f1bb53c613ff7d9cc3515734d0725535dfb7325966f51cafc2bc085';
const OTHER_OBJECT_ID = 'c2ad4d4fbfa442042763198ec05f8b63b9972ee590aa318ea0bc56875ed7b9c4';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlient-d1-'));
  tempDirs.push(dir);
  return dir;
}

function writeFile(file: string, size = 4096): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size));
}

function objectDir(base: string, state: '.wrangler' | '.cloudflare'): string {
  return path.join(base, state, 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('scanD1State', () => {
  it('maps configured database ids to local files and dedupes copies', () => {
    const root = tempDir();
    const configPath = path.join(root, 'wrangler.jsonc');
    const configText = JSON.stringify({
      name: 'cashflow',
      d1_databases: [{ binding: 'DB', database_name: 'cashflow-db', database_id: DATABASE_ID }],
    });

    const newer = path.join(objectDir(root, '.wrangler'), `${OBJECT_ID}.sqlite`);
    const older = path.join(objectDir(root, '.cloudflare'), `${OBJECT_ID}.sqlite`);
    writeFile(newer, 8192);
    writeFile(older, 4096);
    fs.utimesSync(older, new Date(2026, 0, 1), new Date(2026, 0, 1));
    fs.utimesSync(newer, new Date(2026, 0, 2), new Date(2026, 0, 2));

    writeFile(path.join(objectDir(root, '.wrangler'), `${OTHER_OBJECT_ID}.sqlite`));
    writeFile(path.join(objectDir(root, '.wrangler'), 'metadata.sqlite'));

    const result = scanD1State([{ path: configPath, text: configText }], [root]);

    expect(result.hasConfigs).toBe(true);
    expect(result.databases).toHaveLength(2);

    const matched = result.databases[0];
    expect(matched?.label).toBe('DB · cashflow-db');
    expect(matched?.path).toBe(newer);
    expect(matched?.description).toBe('wrangler.jsonc');
    expect(matched?.detail).toContain('database id: ' + DATABASE_ID);
    expect(matched?.detail).toContain(older);

    const unmatched = result.databases[1];
    expect(unmatched?.label).toBe(`D1 · ${OTHER_OBJECT_ID.slice(0, 8)}…`);
    expect(unmatched?.description).toBe('unmatched local database');

    expect(result.notices).toEqual([]);
  });

  it('searches custom persist roots', () => {
    const root = tempDir();
    const configPath = path.join(root, 'wrangler.json');
    const customRoot = path.join(root, '.tmp', 'wrangler-state');
    const customFile = path.join(customRoot, 'v3', 'd1', 'miniflare-D1DatabaseObject', `${OTHER_OBJECT_ID}.sqlite`);
    writeFile(customFile);

    const result = scanD1State(
      [{ path: configPath, text: JSON.stringify({ d1_databases: [] }) }],
      [root],
      [customRoot],
    );

    expect(result.databases).toHaveLength(1);
    expect(result.databases[0]?.path).toBe(customFile);
  });

  it('explains when no D1 binding is configured', () => {
    const root = tempDir();
    const result = scanD1State([{ path: path.join(root, 'wrangler.json'), text: '{}' }], [root]);
    expect(result.databases).toEqual([]);
    expect(result.notices.join('\n')).toMatch(/No D1 databases are configured/);
  });

  it('reports missing local files for configured databases', () => {
    const root = tempDir();
    const result = scanD1State(
      [
        {
          path: path.join(root, 'wrangler.jsonc'),
          text: JSON.stringify({
            d1_databases: [{ binding: 'DB', database_name: 'app-db', database_id: DATABASE_ID }],
          }),
        },
      ],
      [root],
    );

    expect(result.databases).toEqual([]);
    expect(result.notices.join('\n')).toMatch(/No local D1 database files found/);
  });
});
