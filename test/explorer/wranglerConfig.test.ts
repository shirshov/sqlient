import { describe, expect, it } from 'vitest';
import { parseJsonc, readWranglerConfig } from '../../src/explorer/wranglerConfig';

const config = `{
  // project name
  "name": "cashflow",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "cashflow-db",
      "database_id": "67d7e0aa-aefb-40e2-895f-51fe16585e01",
    },
  ],
  "vars": { "url": "https://example.com//not-a-comment" },
  "env": {
    "production": {
      "d1_databases": [
        {
          "database_name": "prod-db",
          "database_id": "e6d46615-a4af-4c37-8f2a-73ade40ed892"
        }
      ]
    }
  }
}`;

describe('readWranglerConfig', () => {
  it('parses JSONC with comments, trailing commas, and environment bindings', () => {
    const parsed = readWranglerConfig(config, '/work/wrangler.jsonc');

    expect(parsed.error).toBeUndefined();
    expect(parsed.workerName).toBe('cashflow');
    expect(parsed.bindings).toHaveLength(2);
    expect(parsed.bindings[0]).toMatchObject({
      binding: 'DB',
      databaseName: 'cashflow-db',
      databaseId: '67d7e0aa-aefb-40e2-895f-51fe16585e01',
      configPath: '/work/wrangler.jsonc',
    });
    expect(parsed.bindings[1]).toMatchObject({
      binding: 'prod-db',
      environment: 'production',
    });
  });

  it('does not treat comment markers inside strings as comments', () => {
    const parsed = readWranglerConfig('{ "url": "https://example.com//x" }', '/work/wrangler.json');
    expect(parsed.error).toBeUndefined();
  });

  it('reports invalid JSONC without throwing', () => {
    const parsed = readWranglerConfig('{ nope', '/work/wrangler.jsonc');
    expect(parsed.bindings).toEqual([]);
    expect(parsed.error).toMatch(/wrangler\.jsonc/);
  });

  it('ignores D1 entries without a database id', () => {
    const parsed = readWranglerConfig(
      '{ "d1_databases": [{ "binding": "DB", "database_name": "local-only" }] }',
      '/work/wrangler.json',
    );
    expect(parsed.bindings).toEqual([]);
  });

  it('parses plain JSON', () => {
    expect(parseJsonc('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads Durable Object bindings and migration classes', () => {
    const parsed = readWranglerConfig(
      JSON.stringify({
        name: 'sila-sync',
        durable_objects: {
          bindings: [{ name: 'DATASETS', class_name: 'SpreadsheetDataset' }],
        },
        migrations: [{ tag: 'v1', new_sqlite_classes: ['SpreadsheetDataset'] }],
      }),
      '/work/server/wrangler.jsonc',
    );

    expect(parsed.error).toBeUndefined();
    expect(parsed.workerName).toBe('sila-sync');
    expect(parsed.durableObjects).toEqual([
      {
        binding: 'DATASETS',
        className: 'SpreadsheetDataset',
        scriptName: undefined,
        environment: undefined,
        configPath: '/work/server/wrangler.jsonc',
      },
    ]);
    expect(parsed.doClasses).toEqual(['SpreadsheetDataset']);
  });
});
