import * as path from 'node:path';
import * as vscode from 'vscode';
import { directiveLine, expandHome, findDirective, formatDirectivePath } from '../directive';
import { projectRootForDocument } from '../project';

export async function browseDatabase(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showErrorMessage('SQLient: open an SQL file to attach a database.');
    return;
  }

  const document = editor.document;
  if (document.languageId !== 'sql') {
    void vscode.window.showErrorMessage('SQLient: the active editor must use the SQL language mode.');
    return;
  }

  if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') {
    void vscode.window.showErrorMessage('SQLient: this editor cannot be edited.');
    return;
  }

  const selection = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Use database',
    title: 'Select an SQLite database',
    defaultUri: dialogStart(document),
    filters: {
      'SQLite databases': ['db', 'sqlite', 'sqlite3', 'db3', 's3db'],
      'All files': ['*'],
    },
  });

  const picked = selection?.[0];
  if (!picked) {
    return;
  }

  const existing = findDirective(document.getText());
  const edit = new vscode.WorkspaceEdit();
  const line = directiveLine(formatDirectivePath(projectRootForDocument(document), picked.fsPath));

  if (existing) {
    edit.replace(document.uri, document.lineAt(existing.line).range, line);
  } else {
    edit.insert(document.uri, new vscode.Position(0, 0), `${line}\n`);
  }

  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    void vscode.window.showErrorMessage('SQLient: could not update the SQL buffer.');
    return;
  }

  vscode.window.setStatusBarMessage(`SQLient: database set to ${path.basename(picked.fsPath)}`, 3000);
}

function dialogStart(document: vscode.TextDocument): vscode.Uri | undefined {
  const root = projectRootForDocument(document);
  const existing = findDirective(document.getText());
  if (existing) {
    const value = expandHome(existing.value);
    const resolved = path.isAbsolute(value) ? value : root ? path.resolve(root, value) : value;
    if (path.isAbsolute(resolved)) {
      return vscode.Uri.file(path.dirname(resolved));
    }
  }
  if (document.uri.scheme === 'file') {
    return vscode.Uri.file(path.dirname(document.uri.fsPath));
  }
  return root ? vscode.Uri.file(root) : undefined;
}
