export interface SqlStatement {
  sql: string;
  line: number;
  hasParameters: boolean;
}

type ScanState = 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'lineComment' | 'blockComment';

const WORD_START = /[A-Za-z_]/;
const WORD_PART = /[A-Za-z0-9_$]/;
const WHITESPACE = /\s/;

/**
 * Splits a SQLite script into individual statements.
 *
 * The splitter is string, identifier, comment and trigger aware: semicolons inside
 * literals, quoted identifiers, comments, or a `CREATE TRIGGER ... BEGIN ... END` body
 * do not terminate a statement.
 */
export function splitStatements(text: string, lineOffset = 0): SqlStatement[] {
  const statements: SqlStatement[] = [];
  const length = text.length;
  let state: ScanState = 'normal';
  let line = 1 + lineOffset;
  let contentStart = -1;
  let contentLine = line;
  let hasParameters = false;
  let isTrigger = false;
  let beginDepth = 0;
  let word = '';
  let wordCount = 0;

  const markContent = (index: number): void => {
    if (contentStart === -1) {
      contentStart = index;
      contentLine = line;
    }
  };

  const flushWord = (): void => {
    if (!word) {
      return;
    }

    const upper = word.toUpperCase();
    const position = wordCount + 1;
    if (upper === 'TRIGGER' && position <= 3) {
      isTrigger = true;
    }
    if (isTrigger) {
      if (upper === 'BEGIN' || upper === 'CASE') {
        beginDepth += 1;
      } else if (upper === 'END' && beginDepth > 0) {
        beginDepth -= 1;
      }
    }

    wordCount = position;
    word = '';
  };

  const emit = (endExclusive: number): void => {
    if (contentStart !== -1) {
      const sql = text.slice(contentStart, endExclusive).trim();
      if (sql) {
        statements.push({ sql, line: contentLine, hasParameters });
      }
    }
    contentStart = -1;
    hasParameters = false;
    isTrigger = false;
    beginDepth = 0;
    word = '';
    wordCount = 0;
  };

  let index = 0;
  while (index < length) {
    const ch = text[index] as string;
    const next = index + 1 < length ? (text[index + 1] as string) : '';

    if (state === 'lineComment') {
      if (ch === '\n') {
        state = 'normal';
        line += 1;
      }
      index += 1;
      continue;
    }

    if (state === 'blockComment') {
      if (ch === '*' && next === '/') {
        state = 'normal';
        index += 2;
        continue;
      }
      if (ch === '\n') {
        line += 1;
      }
      index += 1;
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'backtick') {
      const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      if (ch === quote) {
        if (next === quote) {
          index += 2;
          continue;
        }
        state = 'normal';
        index += 1;
        continue;
      }
      if (ch === '\n') {
        line += 1;
      }
      index += 1;
      continue;
    }

    if (state === 'bracket') {
      if (ch === ']') {
        state = 'normal';
      }
      if (ch === '\n') {
        line += 1;
      }
      index += 1;
      continue;
    }

    if (ch === '-' && next === '-') {
      flushWord();
      state = 'lineComment';
      index += 2;
      continue;
    }

    if (ch === '/' && next === '*') {
      flushWord();
      state = 'blockComment';
      index += 2;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      flushWord();
      markContent(index);
      state = ch === "'" ? 'single' : ch === '"' ? 'double' : 'backtick';
      index += 1;
      continue;
    }

    if (ch === '[') {
      flushWord();
      markContent(index);
      state = 'bracket';
      index += 1;
      continue;
    }

    if (ch === ';') {
      flushWord();
      if (contentStart !== -1 && !(isTrigger && beginDepth > 0)) {
        emit(index);
      }
      index += 1;
      continue;
    }

    if (ch === '?') {
      flushWord();
      markContent(index);
      hasParameters = true;
      index += 1;
      continue;
    }

    if ((ch === ':' || ch === '@' || ch === '$') && WORD_START.test(next)) {
      flushWord();
      markContent(index);
      hasParameters = true;
      index += 1;
      continue;
    }

    if (WORD_START.test(ch)) {
      markContent(index);
      word += ch;
      index += 1;
      continue;
    }

    if (word && WORD_PART.test(ch)) {
      word += ch;
      index += 1;
      continue;
    }

    flushWord();
    if (!WHITESPACE.test(ch)) {
      markContent(index);
    } else if (ch === '\n') {
      line += 1;
    }
    index += 1;
  }

  flushWord();
  if (contentStart !== -1) {
    emit(length);
  }

  return statements;
}
