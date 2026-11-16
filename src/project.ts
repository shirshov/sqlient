import * as path from 'node:path';
import * as vscode from 'vscode';
import { directiveLine, formatDirectivePath } from './directive';

export function projectRootForDocument(document: vscode.TextDocument): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (folder) {
    return folder.uri.fsPath;
  }
  if (document.uri.scheme === 'file') {
    return path.dirname(document.uri.fsPath);
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function projectRootForDatabase(dbPath: string): string | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const containing = folders.find((folder) => isInside(folder.uri.fsPath, dbPath));
  return containing?.uri.fsPath ?? folders[0]?.uri.fsPath;
}

export function directiveForDatabase(dbPath: string): string {
  return directiveLine(formatDirectivePath(projectRootForDatabase(dbPath), dbPath));
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
