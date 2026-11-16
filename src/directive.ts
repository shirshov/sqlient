import * as os from 'node:os';
import * as path from 'node:path';

export const DIRECTIVE_HEADER_LINES = 10;

const DIRECTIVE_PATTERN = /^\s*--\s*#db(?:\s*:|\s+|$)\s*(.*?)\s*$/i;

export interface DirectiveMatch {
  line: number;
  raw: string;
  value: string;
}

export type DbTarget =
  | { kind: 'memory' }
  | { kind: 'file'; path: string; value: string; line: number };

export interface ResolveContext {
  documentPath?: string;
  /** Directory that relative directives are resolved against. */
  workspaceFolder?: string;
}

export class DirectiveError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DirectiveError';
  }
}

export function findDirective(text: string): DirectiveMatch | undefined {
  if (!text) {
    return undefined;
  }

  const lines = text.split(/\r?\n/);
  const limit = Math.min(lines.length, DIRECTIVE_HEADER_LINES);

  for (let index = 0; index < limit; index += 1) {
    const line = lines[index] ?? '';
    const match = DIRECTIVE_PATTERN.exec(line);
    if (match) {
      return { line: index, raw: line, value: unquote(match[1] ?? '') };
    }
  }

  return undefined;
}

export function unquote(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

export function expandHome(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function resolveTarget(text: string, context: ResolveContext = {}): DbTarget {
  const directive = findDirective(text);
  if (!directive) {
    return { kind: 'memory' };
  }

  if (!directive.value) {
    throw new DirectiveError(
      'The "--#db" comment needs a database file path. Remove the line to use an in-memory database.',
    );
  }

  const expanded = expandHome(directive.value);

  if (path.isAbsolute(expanded)) {
    return { kind: 'file', path: path.normalize(expanded), value: directive.value, line: directive.line };
  }

  const base = context.workspaceFolder ?? (context.documentPath ? path.dirname(context.documentPath) : undefined);
  if (!base) {
    throw new DirectiveError(
      'Relative "--#db" paths need an open project folder. Open the SQL file inside a workspace or use an absolute path.',
    );
  }

  return {
    kind: 'file',
    path: path.resolve(base, expanded),
    value: directive.value,
    line: directive.line,
  };
}

/**
 * Formats a database path for a directive: relative to the project root when the file is
 * inside it, otherwise absolute.
 */
export function formatDirectivePath(projectRoot: string | undefined, dbPath: string): string {
  const absolute = path.resolve(dbPath);
  if (!projectRoot) {
    return absolute;
  }

  const relative = path.relative(projectRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return absolute;
  }

  const normalized = relative.split(path.sep).join('/');
  return normalized.startsWith('./') ? normalized : `./${normalized}`;
}

export function directiveLine(value: string): string {
  return `--#db ${value}`;
}
