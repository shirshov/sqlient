import type { Cell, StatementResult } from '../types';

export type CopyFormat = 'csv' | 'json' | 'tsv';

export function serializeResult(result: StatementResult, format: CopyFormat): string {
  if (result.status === 'error') {
    return `-- Error: ${result.error?.message ?? 'unknown error'}`;
  }

  if (result.status === 'change') {
    return `-- ${result.changes ?? 0} row(s) affected, last insert rowid ${result.lastInsertRowid ?? '0'}`;
  }

  const columns = result.columns ?? [];
  const rows = result.rows ?? [];

  if (format === 'json') {
    const records = rows.map((row) => {
      const record: Record<string, string | number | null> = {};
      columns.forEach((column, index) => {
        record[column] = jsonValue(row[index] ?? null);
      });
      return record;
    });
    return JSON.stringify(records, null, 2);
  }

  if (format === 'tsv') {
    const lines = [columns.map(escapeTsv).join('\t')];
    for (const row of rows) {
      lines.push(columns.map((_, index) => escapeTsv(cellText(row[index] ?? null))).join('\t'));
    }
    return lines.join('\n');
  }

  const lines = [columns.map(escapeCsv).join(',')];
  for (const row of rows) {
    lines.push(columns.map((_, index) => escapeCsv(cellText(row[index] ?? null))).join(','));
  }
  return lines.join('\n');
}

export function cellText(cell: Cell): string {
  if (cell === null) {
    return '';
  }
  if (typeof cell === 'string') {
    return cell;
  }
  if (typeof cell === 'number') {
    return String(cell);
  }
  if (cell.$type === 'bigint') {
    return cell.value;
  }
  return `0x${cell.hex}${cell.truncated ? '…' : ''}`;
}

function jsonValue(cell: Cell): string | number | null {
  if (cell === null) {
    return null;
  }
  if (typeof cell === 'string') {
    return cell;
  }
  if (typeof cell === 'number') {
    return cell;
  }
  return cell.$type === 'bigint' ? cell.value : `0x${cell.hex}${cell.truncated ? '…' : ''}`;
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeTsv(value: string): string {
  return value.replace(/\r\n/g, '\\n').replace(/[\r\n]/g, '\\n').replace(/\t/g, '\\t');
}
