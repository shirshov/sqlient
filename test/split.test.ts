import { describe, expect, it } from 'vitest';
import { splitStatements } from '../src/db/split';

function sqlOf(text: string, lineOffset = 0): string[] {
  return splitStatements(text, lineOffset).map((statement) => statement.sql);
}

describe('splitStatements', () => {
  it('splits simple statements', () => {
    expect(sqlOf('select 1; select 2;')).toEqual(['select 1', 'select 2']);
    expect(sqlOf('select 1;;;select 2')).toEqual(['select 1', 'select 2']);
    expect(sqlOf('select 1')).toEqual(['select 1']);
  });

  it('returns nothing for empty or comment-only input', () => {
    expect(sqlOf('')).toEqual([]);
    expect(sqlOf('   \n-- nothing\n/* to see */\n')).toEqual([]);
  });

  it('ignores semicolons in literals, identifiers, and comments', () => {
    const script = `
      select ';' as a, "b;c" as b, [d;e] as c, \`f;g\` as d;
      -- a; comment
      select 2 /* ; */;
    `;
    expect(sqlOf(script)).toHaveLength(2);
  });

  it('keeps trigger bodies together', () => {
    const script = `
      create trigger trg after insert on t
      begin
        update t set a = 1;
        insert into t values (2);
      end;
      select 1;
    `;
    const statements = sqlOf(script);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('insert into t values (2);');
    expect(statements[0]?.endsWith('end')).toBe(true);
    expect(statements[1]).toBe('select 1');
  });

  it('handles CASE ... END inside trigger bodies', () => {
    const script = `
      create trigger trg after insert on t begin
        update t set a = case when 1 then 2 else 3 end;
        delete from t where a = 1;
      end;
      select 2;
    `;
    expect(sqlOf(script)).toHaveLength(2);
  });

  it('does not treat transaction statements as triggers', () => {
    expect(sqlOf('begin; select 1; commit;')).toEqual(['begin', 'select 1', 'commit']);
  });

  it('flags parameter placeholders outside literals and comments', () => {
    const [all] = splitStatements('select ?, :name, @x, $y;');
    expect(all?.hasParameters).toBe(true);

    const [literal] = splitStatements(`select '?' as a, ":name" as b, [@x] as c -- ? :name @x $y\n`);
    expect(literal?.hasParameters).toBe(false);

    const statements = splitStatements('select 1; -- ? :name @x $y\nselect 2;');
    expect(statements.every((statement) => !statement.hasParameters)).toBe(true);
  });

  it('reports statement line numbers', () => {
    const statements = splitStatements('select 1;\n\nselect 2;');
    expect(statements.map((statement) => statement.line)).toEqual([1, 3]);

    const offset = splitStatements('select 1;\n\nselect 2;', 4);
    expect(offset.map((statement) => statement.line)).toEqual([5, 7]);

    const leadingComment = splitStatements('-- header\n\nselect 1;');
    expect(leadingComment[0]?.line).toBe(3);
  });

  it('handles BOM and CRLF line endings', () => {
    const statements = splitStatements('\uFEFFselect 1;\r\nselect \';\';\r\n');
    expect(statements.map((statement) => statement.sql)).toEqual(['select 1', "select ';'"]);
    expect(statements.map((statement) => statement.line)).toEqual([1, 2]);
  });

  it('drops trailing comments after the last statement', () => {
    expect(sqlOf("select 1; -- done\n/* the end */")).toEqual(['select 1']);
  });
});
