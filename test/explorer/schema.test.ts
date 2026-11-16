import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { readSchema } from '../../src/explorer/schema';

const tempDirs: string[] = [];

function tempDatabase(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlient-schema-'));
  tempDirs.push(dir);
  return path.join(dir, 'app.db');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('readSchema', () => {
  it('reads tables, views, indexes, triggers, and column metadata', () => {
    const file = tempDatabase();
    const db = new DatabaseSync(file);
    try {
      db.exec(`
        create table users (
          id integer primary key,
          email text not null,
          name text default 'anon'
        );
        create table posts (
          id integer primary key,
          user_id integer not null references users(id),
          body text
        );
        create index idx_posts_user on posts(user_id);
        create view user_emails as select id, email from users;
        create trigger trg_posts_after_insert after insert on posts
        begin
          update users set email = email;
        end;
      `);
    } finally {
      db.close();
    }

    const schema = readSchema(file);

    expect(schema.tables.map((table) => table.name)).toEqual(['posts', 'users']);
    expect(schema.views.map((view) => view.name)).toEqual(['user_emails']);
    expect(schema.indexes.map((index) => index.name)).toEqual(['idx_posts_user']);
    expect(schema.triggers.map((trigger) => trigger.name)).toEqual(['trg_posts_after_insert']);

    expect(schema.indexes[0]?.tableName).toBe('posts');
    expect(schema.triggers[0]?.tableName).toBe('posts');
    expect(schema.views[0]?.columns.map((column) => column.name)).toEqual(['id', 'email']);

    const users = schema.tables.find((table) => table.name === 'users');
    expect(users?.columns.map((column) => column.name)).toEqual(['id', 'email', 'name']);

    const id = users?.columns[0];
    expect(id).toMatchObject({ name: 'id', type: 'INTEGER', primaryKey: true, notNull: false });

    const email = users?.columns[1];
    expect(email).toMatchObject({ name: 'email', type: 'TEXT', notNull: true, defaultValue: null });

    const name = users?.columns[2];
    expect(name?.defaultValue).toBe("'anon'");
  });

  it('marks generated columns', () => {
    const file = tempDatabase();
    const db = new DatabaseSync(file);
    try {
      db.exec('create table numbers (a integer, doubled integer generated always as (a * 2) stored)');
    } finally {
      db.close();
    }

    const schema = readSchema(file);
    const doubled = schema.tables[0]?.columns.find((column) => column.name === 'doubled');
    expect(doubled?.generated).toBe(true);
  });

  it('hides Miniflare Durable Object metadata tables', () => {
    const file = tempDatabase();
    const db = new DatabaseSync(file);
    try {
      db.exec(
        'create table __miniflare_do_name (id integer primary key, name text); create table changes (id integer primary key)',
      );
    } finally {
      db.close();
    }

    const schema = readSchema(file);
    expect(schema.tables.map((table) => table.name)).toEqual(['changes']);
  });

  it('throws for a file that is not a database', () => {
    const file = tempDatabase();
    fs.writeFileSync(file, 'not a database');
    expect(() => readSchema(file)).toThrow();
  });
});
