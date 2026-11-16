import * as path from 'node:path';
import * as vscode from 'vscode';
import { DirectiveError, resolveTarget, type DbTarget } from '../directive';
import { ConnectionManager, fileKey, memoryKey } from '../db/connectionManager';
import { executeStatements } from '../db/execute';
import { splitStatements } from '../db/split';
import { projectRootForDocument } from '../project';
import type { ResultsView } from '../results/resultsView';

export interface RunQueryDeps {
  connections: ConnectionManager;
  results: ResultsView;
  output: vscode.OutputChannel;
}

let running = false;

export async function runQuery(deps: RunQueryDeps): Promise<void> {
  if (running) {
    vscode.window.setStatusBarMessage('SQLient: a query is already running', 2000);
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showErrorMessage('SQLient: open an SQL file and run the command again.');
    return;
  }

  const document = editor.document;
  if (document.languageId !== 'sql') {
    void vscode.window.showErrorMessage('SQLient: the active editor must use the SQL language mode.');
    return;
  }

  running = true;
  try {
    await executeEditor(deps, editor);
  } finally {
    running = false;
  }
}

async function executeEditor(deps: RunQueryDeps, editor: vscode.TextEditor): Promise<void> {
  const document = editor.document;
  const documentText = document.getText();
  const documentPath = document.uri.scheme === 'file' ? document.uri.fsPath : undefined;
  const projectRoot = projectRootForDocument(document);

  let target: DbTarget;
  try {
    target = resolveTarget(documentText, { documentPath, workspaceFolder: projectRoot });
  } catch (error) {
    const message =
      error instanceof DirectiveError
        ? `SQLient: ${error.message}`
        : `SQLient: could not resolve the database path (${String(error)}).`;
    void vscode.window.showErrorMessage(message);
    return;
  }

  const selectionText = document.getText(editor.selection);
  const useSelection = selectionText.trim().length > 0;
  const sql = useSelection ? selectionText : documentText;
  const lineOffset = useSelection ? editor.selection.start.line : 0;
  const statements = splitStatements(sql, lineOffset);

  if (statements.length === 0) {
    void vscode.window.showInformationMessage('SQLient: there is no SQL to run.');
    return;
  }

  const configuration = vscode.workspace.getConfiguration('sqlient');
  const readOnly = configuration.get<boolean>('readOnly', false);
  const maxRows = Math.max(1, Math.floor(configuration.get<number>('maxRows', 1000)));

  const spec = {
    key: target.kind === 'file' ? fileKey(target.path) : memoryKey(document.uri.toString()),
    filePath: target.kind === 'file' ? target.path : null,
    readOnly,
    busyTimeoutMs: 5000,
  };

  let db;
  try {
    db = deps.connections.acquire(spec);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.output.appendLine(`[open failed] ${spec.key}: ${message}`);
    void vscode.window.showErrorMessage(`SQLient: ${message}`);
    return;
  }

  const started = performance.now();
  const statementResults = executeStatements(db, statements, { maxRows });
  const totalMs = Math.round((performance.now() - started) * 10) / 10;

  const targetLabel = target.kind === 'file' ? path.basename(target.path) : ':memory:';
  const targetPath = target.kind === 'file' ? target.path : undefined;

  deps.output.appendLine(
    `[run] ${target.kind === 'file' ? target.path : ':memory:'} | ${statements.length} statement(s) | ${totalMs} ms`,
  );
  for (const result of statementResults) {
    if (result.status === 'error') {
      deps.output.appendLine(`  statement ${result.index} (line ${result.line}) failed: ${result.error?.message ?? ''}`);
    } else if (result.status === 'rows') {
      deps.output.appendLine(`  statement ${result.index}: ${result.rows?.length ?? 0} row(s)${result.truncated ? ' (truncated)' : ''}`);
    } else {
      deps.output.appendLine(`  statement ${result.index}: ${result.changes ?? 0} change(s)`);
    }
  }

  await deps.results.showResults({
    targetLabel,
    targetPath,
    totalMs,
    maxRows,
    statements: statementResults,
  });

  const failure = statementResults.find((result) => result.status === 'error');
  if (failure) {
    void vscode.window.showErrorMessage(
      `SQLient: statement ${failure.index} failed: ${failure.error?.message ?? 'unknown error'}`,
    );
  }
}
