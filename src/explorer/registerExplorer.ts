import * as vscode from 'vscode';
import { buildCreateStatement, buildDropStatement } from './objectDdl';
import { openNewQuery } from './openNewQuery';
import { openObjectStatement } from './openObjectStatement';
import { openTableQuery } from './openTableQuery';
import { ExplorerProvider, type ExplorerNode } from './treeProvider';

export function registerExplorer(context: vscode.ExtensionContext): ExplorerProvider {
  const provider = new ExplorerProvider();
  const view = vscode.window.createTreeView('sqlient.databases', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    provider,
    view,
    vscode.commands.registerCommand('sqlient.refreshDatabases', () => provider.refresh()),
    vscode.commands.registerCommand('sqlient.newCreateQuery', (node?: ExplorerNode) => {
      if (node?.kind === 'object') {
        return openObjectStatement(node.entry.path, buildCreateStatement(node.object));
      }
      return undefined;
    }),
    vscode.commands.registerCommand('sqlient.newDropQuery', (node?: ExplorerNode) => {
      if (node?.kind === 'object') {
        return openObjectStatement(node.entry.path, buildDropStatement(node.object));
      }
      return undefined;
    }),
    vscode.commands.registerCommand('sqlient.newQueryFromDatabase', (node?: ExplorerNode) => {
      if (node?.kind === 'database' || (node?.kind === 'section' && node.section === 'tables')) {
        return openNewQuery(node.entry.path);
      }
      return undefined;
    }),
    vscode.commands.registerCommand('sqlient.newQueryFromTable', (node?: ExplorerNode) => {
      if (node?.kind === 'object' && node.object.type === 'table') {
        return openTableQuery(node.entry.path, node.object);
      }
      return undefined;
    }),
  );

  let watchers: vscode.Disposable[] = [];
  const refreshSoon = debounce(() => provider.refresh(), 750);

  const installWatchers = (): void => {
    for (const watcher of watchers) {
      watcher.dispose();
    }
    watchers = [];

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      for (const pattern of [
        '**/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite',
        '**/.cloudflare/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite',
        '**/.wrangler/state/v3/do/*/*.sqlite',
        '**/.cloudflare/state/v3/do/*/*.sqlite',
        '**/wrangler.{json,jsonc}',
      ]) {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, pattern));
        watcher.onDidCreate(refreshSoon);
        watcher.onDidChange(refreshSoon);
        watcher.onDidDelete(refreshSoon);
        watchers.push(watcher);
      }
    }
  };

  installWatchers();

  context.subscriptions.push(
    new vscode.Disposable(() => {
      for (const watcher of watchers) {
        watcher.dispose();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      installWatchers();
      provider.refresh();
    }),
  );

  return provider;
}

function debounce(callback: () => void, delayMs: number): () => void {
  let timer: NodeJS.Timeout | undefined;
  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(callback, delayMs);
  };
}
