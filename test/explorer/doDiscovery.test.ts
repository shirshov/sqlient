import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { scanDoState } from '../../src/explorer/doScan';

const OBJECT_ID = '0fef0c37966f6eb5249c15e1503954e7a8fae56de05f640fe56c2724e870c853';
const OBJECT_NAME = '01M7H5T9DZRMWYJBTTNK5FKENJ';
const OTHER_OBJECT_ID = 'aa'.repeat(32);

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlient-do-'));
  tempDirs.push(dir);
  return dir;
}

function doDir(base: string, state: '.wrangler' | '.cloudflare', namespace: string): string {
  return path.join(base, state, 'state', 'v3', 'do', namespace);
}

function createDoDatabase(file: string, objectName?: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(
      'create table __miniflare_do_name (id integer primary key, name text); create table changes (id integer primary key)',
    );
    if (objectName) {
      db.prepare('insert into __miniflare_do_name (id, name) values (1, ?)').run(objectName);
    }
  } finally {
    db.close();
  }
}

const configText = JSON.stringify({
  name: 'sila-sync',
  durable_objects: { bindings: [{ name: 'DATASETS', class_name: 'SpreadsheetDataset' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['SpreadsheetDataset'] }],
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('scanDoState', () => {
  it('discovers Durable Object stores by worker and class', () => {
    const root = tempDir();
    const configPath = path.join(root, 'server', 'wrangler.jsonc');
    const namespaceDir = doDir(path.join(root, 'server'), '.wrangler', 'sila-sync-SpreadsheetDataset');
    const file = path.join(namespaceDir, `${OBJECT_ID}.sqlite`);

    createDoDatabase(file, OBJECT_NAME);
    createDoDatabase(path.join(namespaceDir, 'metadata.sqlite'), 'ignored');

    const result = scanDoState([{ path: configPath, text: configText }], [root]);

    expect(result.hasConfigs).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.databases).toHaveLength(1);

    const entry = result.databases[0];
    expect(entry?.kind).toBe('do');
    expect(entry?.label).toBe(OBJECT_NAME);
    expect(entry?.description).toBe(OBJECT_ID.slice(0, 8));
    expect(entry?.detail).toContain('class: SpreadsheetDataset');
    expect(entry?.detail).toContain('bindings: DATASETS');
    expect(entry?.do).toMatchObject({
      namespace: 'sila-sync-SpreadsheetDataset',
      workerName: 'sila-sync',
      className: 'SpreadsheetDataset',
      bindings: ['DATASETS'],
      objectId: OBJECT_ID,
      objectName: OBJECT_NAME,
    });
  });

  it('falls back to the object id and parses the namespace without config', () => {
    const root = tempDir();
    const file = path.join(doDir(root, '.wrangler', 'my-worker-Widget'), `${OTHER_OBJECT_ID}.sqlite`);
    createDoDatabase(file);

    const result = scanDoState(
      [{ path: path.join(root, 'wrangler.json'), text: JSON.stringify({ name: 'my-worker' }) }],
      [root],
    );

    const entry = result.databases[0];
    expect(entry?.label).toBe(`${OTHER_OBJECT_ID.slice(0, 8)}…`);
    expect(entry?.description).toBeUndefined();
    expect(entry?.do).toMatchObject({
      className: 'Widget',
      workerName: 'my-worker',
      bindings: [],
      objectId: OTHER_OBJECT_ID,
    });
    expect(result.configured).toBe(false);
  });

  it('dedupes copies across state directories and searches custom persist roots', () => {
    const root = tempDir();
    const configPath = path.join(root, 'wrangler.jsonc');
    const newer = path.join(doDir(root, '.wrangler', 'sila-sync-SpreadsheetDataset'), `${OBJECT_ID}.sqlite`);
    const older = path.join(doDir(root, '.cloudflare', 'sila-sync-SpreadsheetDataset'), `${OBJECT_ID}.sqlite`);
    createDoDatabase(newer, OBJECT_NAME);
    createDoDatabase(older, OBJECT_NAME);
    fs.utimesSync(older, new Date(2026, 0, 1), new Date(2026, 0, 1));
    fs.utimesSync(newer, new Date(2026, 0, 2), new Date(2026, 0, 2));

    const customRoot = path.join(root, '.tmp', 'wrangler-state');
    const customFile = path.join(customRoot, 'v3', 'do', 'sila-sync-SpreadsheetDataset', `${OTHER_OBJECT_ID}.sqlite`);
    createDoDatabase(customFile, 'CUSTOM_OBJECT');

    const result = scanDoState([{ path: configPath, text: configText }], [root], [customRoot]);

    expect(result.databases).toHaveLength(2);
    const deduped = result.databases.find((entry) => entry.do?.objectId === OBJECT_ID);
    expect(deduped?.path).toBe(newer);
    expect(deduped?.detail).toContain(older);

    const custom = result.databases.find((entry) => entry.do?.objectId === OTHER_OBJECT_ID);
    expect(custom?.path).toBe(customFile);
    expect(custom?.label).toBe('CUSTOM_OBJECT');
  });

  it('explains when configured Durable Objects have no local state', () => {
    const root = tempDir();
    const result = scanDoState(
      [{ path: path.join(root, 'wrangler.jsonc'), text: configText }],
      [root],
    );

    expect(result.databases).toEqual([]);
    expect(result.notices.join('\n')).toMatch(/No local Durable Object databases found/);
  });

  it('reports truncation when a namespace exceeds the object cap', () => {
    const root = tempDir();
    const namespaceDir = doDir(root, '.wrangler', 'sila-sync-SpreadsheetDataset');
    fs.mkdirSync(namespaceDir, { recursive: true });
    for (let index = 0; index < 502; index += 1) {
      fs.writeFileSync(path.join(namespaceDir, `${(index + 1).toString().padStart(4, '0')}.sqlite`), 'x');
    }

    const result = scanDoState([{ path: path.join(root, 'wrangler.jsonc'), text: configText }], [root]);

    expect(result.databases).toHaveLength(500);
    expect(result.notices.join('\n')).toMatch(/more than 500 objects/);
  });
});
