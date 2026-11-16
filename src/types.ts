export type Cell =
  | null
  | string
  | number
  | { $type: 'bigint'; value: string }
  | { $type: 'blob'; bytes: number; hex: string; truncated: boolean };

export interface StatementError {
  message: string;
  code?: string;
}

export interface StatementResult {
  index: number;
  keyword: string;
  sql: string;
  line: number;
  status: 'rows' | 'change' | 'error';
  columns?: string[];
  rows?: Cell[][];
  truncated?: boolean;
  changes?: number;
  lastInsertRowid?: string;
  error?: StatementError;
  durationMs: number;
}

export interface QueryResults {
  targetLabel: string;
  targetPath?: string;
  totalMs: number;
  maxRows: number;
  statements: StatementResult[];
}
