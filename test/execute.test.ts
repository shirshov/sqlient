import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { executeStatements } from '../src/db/execute';
import { splitStatements } from '../src/db/split';
import type { StatementResult } from '../src/types';

const databases: DatabaseSync[] = [];

function memoryDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  return db;
}

function run(db: DatabaseSync, sql: string, maxRows = 100): StatementResult[] {
  return executeStatements(db, splitStatements(sql), { maxRows });
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    try {
      db.close();
    } catch {
      // Already closed by a test.
    }
  }
});

describe('executeStatements', () => {
  it('returns rows with typed cells', () => {
    const [result] = run(memoryDatabase(), "select 1 as a, 'x' as b, null as c, 1.5 as d");
    expect(result?.status).toBe('rows');
    expect(result?.columns).toEqual(['a', 'b', 'c', 'd']);
    expect(result?.rows).toEqual([[1, 'x', null, 1.5]]);
    expect(result?.truncated).toBe(false);
  });

  it('preserves duplicate column names', () => {
    const [result] = run(memoryDatabase(), 'select 1 as a, 2 as a');
    expect(result?.columns).toEqual(['a', 'a#2']);
    expect(result?.rows).toEqual([[1, 2]]);
  });

  it('keeps integers outside the safe range as tagged values', () => {
    const [result] = run(memoryDatabase(), 'select 9007199254740993 as big, 42 as small');
    expect(result?.rows?.[0]).toEqual([
      { $type: 'bigint', value: '9007199254740993' },
      42,
    ]);
  });

  it('reports blobs with a byte count and hex preview', () => {
    const [result] = run(memoryDatabase(), "select x'00ff' as b");
    expect(result?.rows?.[0]?.[0]).toEqual({ $type: 'blob', bytes: 2, hex: '00ff', truncated: false });
  });

  it('reports changes and last insert rowid for non-reader statements', () => {
    const results = run(
      memoryDatabase(),
      'create table t(a); insert into t values (1); insert into t values (2), (3); update t set a = a + 10;',
    );
    expect(results.map((result) => result.status)).toEqual(['change', 'change', 'change', 'change']);
    expect(results[1]?.changes).toBe(1);
    expect(results[2]?.lastInsertRowid).toBe('3');
    expect(results[3]?.changes).toBe(3);
  });

  it('stops at the first failing statement', () => {
    const results = run(memoryDatabase(), 'select 1; select * from missing; select 3;');
    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe('rows');
    expect(results[1]?.status).toBe('error');
    expect(results[1]?.error?.message).toMatch(/no such table: missing/);
    expect(results[1]?.index).toBe(2);
  });

  it('caps rows and marks truncated results', () => {
    const db = memoryDatabase();
    run(db, 'create table t(a); insert into t values (1), (2), (3);');
    const [result] = run(db, 'select * from t', 2);
    expect(result?.rows).toHaveLength(2);
    expect(result?.truncated).toBe(true);

    const [exact] = run(db, 'select * from t', 3);
    expect(exact?.rows).toHaveLength(3);
    expect(exact?.truncated).toBe(false);
  });

  it('rejects parameterized statements with a clear message', () => {
    const [result] = run(memoryDatabase(), 'select ? as a');
    expect(result?.status).toBe('error');
    expect(result?.error?.message).toMatch(/parameters are not supported/i);
  });

  it('executes pragmas that return rows', () => {
    const [result] = run(memoryDatabase(), 'pragma user_version');
    expect(result?.status).toBe('rows');
    expect(result?.columns).toEqual(['user_version']);
    expect(result?.rows).toEqual([[0]]);
  });

  it('executes transaction statements', () => {
    const results = run(memoryDatabase(), 'begin; select 1; commit;');
    expect(results.map((result) => result.status)).toEqual(['change', 'rows', 'change']);
  });

  it('executes trigger definitions with semicolons in their bodies', () => {
    const db = memoryDatabase();
    const results = run(
      db,
      `create table t(a);
       create table log(msg);
       create trigger tr after insert on t begin
         insert into log values ('row');
         insert into log values ('more');
       end;
       insert into t values (1);`,
    );
    expect(results.some((result) => result.status === 'error')).toBe(false);

    const [count] = run(db, 'select count(*) as c from log');
    expect(count?.rows).toEqual([[2]]);
  });

  it('returns rows from INSERT ... RETURNING', () => {
    const db = memoryDatabase();
    run(db, 'create table t(a);');
    const [result] = run(db, 'insert into t values (5) returning a');
    expect(result?.status).toBe('rows');
    expect(result?.columns).toEqual(['a']);
    expect(result?.rows).toEqual([[5]]);
  });

  it('summarizes statements by their leading keyword', () => {
    const results = run(memoryDatabase(), '-- comment\ncreate table t(a); with c as (select 1) select * from c;');
    expect(results[0]?.keyword).toBe('CREATE');
    expect(results[1]?.keyword).toBe('WITH');
  });
});
