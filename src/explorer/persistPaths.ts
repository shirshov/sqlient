import * as path from 'node:path';
import * as vscode from 'vscode';

export function configuredPersistPaths(folders: readonly vscode.WorkspaceFolder[]): string[] {
  const configuration = vscode.workspace.getConfiguration('sqlient');
  const current = configuration.get<string[]>('persistPaths') ?? [];
  const legacy = configuration.get<string[]>('d1.persistPaths') ?? [];
  const configured = current.length > 0 ? current : legacy;

  const paths: string[] = [];
  for (const folder of folders) {
    for (const entry of configured) {
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }
      paths.push(path.isAbsolute(trimmed) ? trimmed : path.resolve(folder.uri.fsPath, trimmed));
    }
  }
  return paths;
}
