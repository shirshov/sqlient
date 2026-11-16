import type { DatabaseSync } from 'node:sqlite';
import { normalizeError } from './driver';
import type { SqlStatement } from './split';
import type { Cell, StatementError, StatementResult } from '../types';

export interface ExecuteOptions {
  maxRows: number;
}

const BLOB_PREVIEW_BYTES = 256;

export function executeStatements(
  db: DatabaseSync,
  statements: SqlStatement[],
  options: ExecuteOptions,
): StatementResult[] {
  const results: StatementResult[] = [];
  const rowLimit = Math.max(1, Math.floor(options.maxRows));

  for (let position = 0; position < statements.length; position += 1) {
    const statement = statements[position] as SqlStatement;
    const index = position + 1;
    const started = performance.now();

    if (statement.hasParameters) {
      results.push({
        index,
        keyword: firstKeyword(statement.sql),
        sql: statement.sql,
        line: statement.line,
        status: 'error',
        error: {
          message:
            'Query parameters are not supported yet. Inline the values instead of using ?, :name, @name, or $name.',
        },
        durationMs: elapsed(started),
      });
      break;
    }

    let prepared: ReturnType<DatabaseSync['prepare']>;
    try {
      prepared = db.prepare(statement.sql);
    } catch (error) {
      results.push(errorResult(index, statement, started, normalizeError(error)));
      break;
    }

    try {
      const columnMetadata = prepared.columns();

      if (columnMetadata.length === 0) {
        const info = prepared.run();
        results.push({
          index,
          keyword: firstKeyword(statement.sql),
          sql: statement.sql,
          line: statement.line,
          status: 'change',
          changes: Number(info.changes),
          lastInsertRowid: String(info.lastInsertRowid),
          durationMs: elapsed(started),
        });
        continue;
      }

      prepared.setReturnArrays(true);
      prepared.setReadBigInts(true);

      const rows: Cell[][] = [];
      let truncated = false;
      const iterator = prepared.iterate();

      try {
        for (;;) {
          const next = iterator.next();
          if (next.done) {
            break;
          }
          if (rows.length >= rowLimit) {
            truncated = true;
            break;
          }
          const values = next.value as unknown as unknown[];
          rows.push(values.map(toCell));
        }
      } finally {
        if (typeof iterator.return === 'function') {
          try {
            iterator.return();
          } catch {
            // Ignore: the statement is closed below anyway.
          }
        }
      }

      results.push({
        index,
        keyword: firstKeyword(statement.sql),
        sql: statement.sql,
        line: statement.line,
        status: 'rows',
        columns: displayColumns(columnMetadata.map((column) => column.name)),
        rows,
        truncated,
        durationMs: elapsed(started),
      });
    } catch (error) {
      results.push(errorResult(index, statement, started, normalizeError(error)));
      break;
    } finally {
      closeStatement(prepared);
    }
  }

  return results;
}

export function firstKeyword(sql: string): string {
  let text = sql.trimStart();
  for (;;) {
    if (text.startsWith('--')) {
      const end = text.indexOf('\n');
      text = end === -1 ? '' : text.slice(end + 1).trimStart();
      continue;
    }
    if (text.startsWith('/*')) {
      const end = text.indexOf('*/');
      text = end === -1 ? '' : text.slice(end + 2).trimStart();
      continue;
    }
    break;
  }
  const match = /^[A-Za-z_]+/.exec(text);
  return (match?.[0] ?? 'SQL').toUpperCase();
}

function elapsed(started: number): number {
  return Math.round((performance.now() - started) * 10) / 10;
}

function closeStatement(statement: ReturnType<DatabaseSync['prepare']>): void {
  const close = (statement as unknown as { close?: () => void }).close;
  if (typeof close !== 'function') {
    return;
  }
  try {
    close.call(statement);
  } catch {
    // Ignore close failures; the connection owns the remaining lifetime.
  }
}

function errorResult(
  index: number,
  statement: SqlStatement,
  started: number,
  error: StatementError,
): StatementResult {
  return {
    index,
    keyword: firstKeyword(statement.sql),
    sql: statement.sql,
    line: statement.line,
    status: 'error',
    error,
    durationMs: elapsed(started),
  };
}

function toCell(value: unknown): Cell {
  if (value === null || value === undefined) {
    return null;
  }

  switch (typeof value) {
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'string':
      return value;
    case 'bigint':
      return isSafeInteger(value) ? Number(value) : { $type: 'bigint', value: value.toString() };
    case 'boolean':
      return value ? 1 : 0;
    default:
      break;
  }

  if (value instanceof Uint8Array) {
    const bytes = value.byteLength;
    const preview = value.subarray(0, BLOB_PREVIEW_BYTES);
    return {
      $type: 'blob',
      bytes,
      hex: Buffer.from(preview).toString('hex'),
      truncated: bytes > BLOB_PREVIEW_BYTES,
    };
  }

  return String(value);
}

function isSafeInteger(value: bigint): boolean {
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER);
}

function displayColumns(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((rawName) => {
    const name = rawName.trim() || '(unnamed)';
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}#${count + 1}`;
  });
}
