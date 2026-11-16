import { describe, expect, it } from 'vitest';
import { buildCreateStatement, buildDropStatement } from '../../src/explorer/objectDdl';
import type { DbObjectInfo } from '../../src/explorer/types';

function object(partial: Partial<DbObjectInfo> & Pick<DbObjectInfo, 'name' | 'type'>): DbObjectInfo {
  return { columns: [], ...partial };
}

describe('buildCreateStatement', () => {
  it('makes index definitions idempotent', () => {
    expect(
      buildCreateStatement(
        object({ name: 'idx_posts_user', type: 'index', tableName: 'posts', sql: 'CREATE INDEX idx_posts_user ON posts(user_id)' }),
      ),
    ).toBe('CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);\n');

    expect(
      buildCreateStatement(object({ name: 'uidx', type: 'index', sql: 'CREATE UNIQUE INDEX uidx ON t(lower(email))' })),
    ).toBe('CREATE UNIQUE INDEX IF NOT EXISTS uidx ON t(lower(email));\n');
  });

  it('makes view, trigger, and table definitions idempotent', () => {
    expect(
      buildCreateStatement(object({ name: 'user_emails', type: 'view', sql: 'CREATE VIEW user_emails AS SELECT id FROM users' })),
    ).toBe('CREATE VIEW IF NOT EXISTS user_emails AS SELECT id FROM users;\n');

    expect(
      buildCreateStatement(
        object({
          name: 'trg_posts',
          type: 'trigger',
          tableName: 'posts',
          sql: 'CREATE TRIGGER trg_posts AFTER INSERT ON posts BEGIN UPDATE users SET email = email; END',
        }),
      ),
    ).toBe('CREATE TRIGGER IF NOT EXISTS trg_posts AFTER INSERT ON posts BEGIN UPDATE users SET email = email; END;\n');

    expect(
      buildCreateStatement(object({ name: 'users', type: 'table', sql: 'CREATE TABLE users (id integer primary key)' })),
    ).toBe('CREATE TABLE IF NOT EXISTS users (id integer primary key);\n');

    expect(
      buildCreateStatement(
        object({ name: 'docs', type: 'table', sql: 'CREATE VIRTUAL TABLE docs USING fts5(body)' }),
      ),
    ).toBe('CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(body);\n');
  });

  it('does not duplicate IF NOT EXISTS or trailing semicolons', () => {
    expect(
      buildCreateStatement(object({ name: 'idx', type: 'index', sql: 'CREATE INDEX IF NOT EXISTS idx ON t(a);' })),
    ).toBe('CREATE INDEX IF NOT EXISTS idx ON t(a);\n');
  });

  it('explains when the stored definition is unavailable', () => {
    expect(buildCreateStatement(object({ name: 'idx', type: 'index' }))).toBe(
      '-- The stored definition of index "idx" is not available.\n',
    );
  });
});

describe('buildDropStatement', () => {
  it('builds DROP ... IF EXISTS for every object type', () => {
    expect(buildDropStatement(object({ name: 'users', type: 'table' }))).toBe('DROP TABLE IF EXISTS "users";\n');
    expect(buildDropStatement(object({ name: 'v', type: 'view' }))).toBe('DROP VIEW IF EXISTS "v";\n');
    expect(buildDropStatement(object({ name: 'idx', type: 'index' }))).toBe('DROP INDEX IF EXISTS "idx";\n');
    expect(buildDropStatement(object({ name: 'trg', type: 'trigger' }))).toBe('DROP TRIGGER IF EXISTS "trg";\n');
  });

  it('quotes identifiers with embedded quotes', () => {
    expect(buildDropStatement(object({ name: 'a"b', type: 'table' }))).toBe('DROP TABLE IF EXISTS "a""b";\n');
  });
});
