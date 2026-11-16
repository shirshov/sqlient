import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DirectiveError,
  directiveLine,
  findDirective,
  formatDirectivePath,
  resolveTarget,
} from '../src/directive';

describe('findDirective', () => {
  it('returns undefined without a directive', () => {
    expect(findDirective('select 1;')).toBeUndefined();
    expect(findDirective('')).toBeUndefined();
  });

  it('parses a #db directive in the header block', () => {
    expect(findDirective('--#db /tmp/app.db\nselect 1;')).toEqual({
      line: 0,
      raw: '--#db /tmp/app.db',
      value: '/tmp/app.db',
    });
  });

  it('accepts spacing, an optional colon, case, and quotes', () => {
    expect(findDirective('  -- #db   "/tmp/my db.sqlite"  ')?.value).toBe('/tmp/my db.sqlite');
    expect(findDirective('--#db: /tmp/x.db')?.value).toBe('/tmp/x.db');
    expect(findDirective("--#DB '/tmp/y.db'")?.value).toBe('/tmp/y.db');
  });

  it('does not treat longer markers as a directive', () => {
    expect(findDirective('--#dbname /tmp/x.db')).toBeUndefined();
  });

  it('only scans the header block', () => {
    const filler = Array.from({ length: 10 }, (_, index) => `-- line ${index}`).join('\n');
    expect(findDirective(`${filler}\n--#db /tmp/late.db`)).toBeUndefined();

    expect(findDirective(`${filler.split('\n').slice(0, 9).join('\n')}\n--#db /tmp/early.db`)).toBeDefined();
  });
});

describe('resolveTarget', () => {
  it('uses memory without a directive', () => {
    expect(resolveTarget('select 1;')).toEqual({ kind: 'memory' });
  });

  it('resolves absolute paths', () => {
    const target = resolveTarget('--#db /tmp/app.db', { documentPath: '/work/query.sql' });
    expect(target).toMatchObject({ kind: 'file', path: path.normalize('/tmp/app.db') });
  });

  it('resolves relative paths against the project directory', () => {
    const target = resolveTarget('--#db ./data/app.db', {
      documentPath: '/work/sql/query.sql',
      workspaceFolder: '/work/project',
    });
    expect(target).toMatchObject({ kind: 'file', path: path.resolve('/work/project/data/app.db') });
  });

  it('falls back to the SQL file directory without a project', () => {
    const target = resolveTarget('--#db ./data/app.db', { documentPath: '/work/sql/query.sql' });
    expect(target).toMatchObject({ kind: 'file', path: path.resolve('/work/sql/data/app.db') });
  });

  it('resolves parent segments from the project directory', () => {
    const target = resolveTarget('--#db ../shared/app.db', { workspaceFolder: '/work/project' });
    expect(target).toMatchObject({ kind: 'file', path: path.resolve('/work/shared/app.db') });
  });

  it('expands the home directory', () => {
    const target = resolveTarget('--#db ~/sqlient/app.db');
    expect(target).toMatchObject({ kind: 'file', path: path.join(os.homedir(), 'sqlient/app.db') });
  });

  it('rejects an empty path', () => {
    expect(() => resolveTarget('--#db')).toThrow(DirectiveError);
    expect(() => resolveTarget('--#db   ')).toThrow(DirectiveError);
  });

  it('rejects relative paths without a base', () => {
    expect(() => resolveTarget('--#db data/app.db')).toThrow(DirectiveError);
  });
});

describe('formatDirectivePath', () => {
  it('writes project-relative paths with a leading ./', () => {
    expect(formatDirectivePath('/work/project', '/work/project/assets/my_db.sqlite')).toBe('./assets/my_db.sqlite');
    expect(formatDirectivePath('/work/project', '/work/project/my_db.sqlite')).toBe('./my_db.sqlite');
    expect(formatDirectivePath('/work/project', '/work/project/.wrangler/state/db.sqlite')).toBe(
      './.wrangler/state/db.sqlite',
    );
  });

  it('keeps paths outside the project absolute', () => {
    expect(formatDirectivePath('/work/project', '/tmp/my_db.sqlite')).toBe('/tmp/my_db.sqlite');
  });

  it('uses an absolute path without a project', () => {
    expect(formatDirectivePath(undefined, '/tmp/my_db.sqlite')).toBe('/tmp/my_db.sqlite');
  });

  it('formats the directive line', () => {
    expect(directiveLine('./assets/my_db.sqlite')).toBe('--#db ./assets/my_db.sqlite');
  });
});
