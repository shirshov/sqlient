import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { executeStatements } from '../src/db/execute';
import { splitStatements } from '../src/db/split';
import { serializeResult } from '../src/results/serialize';

function run(sql: string, maxRows = 100) {
  const db = new DatabaseSync(':memory:');
  try {
    return executeStatements(db, splitStatements(sql), { maxRows });
  } finally {
    db.close();
  }
}

describe('serializeResult', () => {
  it('writes RFC 4180 CSV', () => {
    const [result] = run(`select 'a,b' as c1, 'x"y' as c2, 'line
break' as c3`);
    expect(serializeResult(result!, 'csv')).toBe('c1,c2,c3\n"a,b","x""y","line\nbreak"');
  });

  it('writes JSON records', () => {
    const [result] = run("select 1 as id, 'x' as name union all select 2, null");
    expect(JSON.parse(serializeResult(result!, 'json'))).toEqual([
      { id: 1, name: 'x' },
      { id: 2, name: null },
    ]);
  });

  it('writes TSV with escaped control characters', () => {
    const [result] = run("select 'a\tb' as c1, 'x\ny' as c2");
    expect(serializeResult(result!, 'tsv')).toBe('c1\tc2\na\\tb\tx\\ny');
  });

  it('summarizes change statements', () => {
    const results = run('create table t(a); insert into t values (1), (2);');
    expect(serializeResult(results[1]!, 'csv')).toContain('2 row(s) affected');
  });

  it('summarizes errors', () => {
    const [result] = run('select * from missing');
    expect(serializeResult(result!, 'csv')).toMatch(/^-- Error: no such table/);
  });
});
