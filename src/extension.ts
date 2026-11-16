import * as vscode from 'vscode';
import { browseDatabase } from './commands/browse';
import { runQuery } from './commands/runQuery';
import { ConnectionManager } from './db/connectionManager';
import { loadSqlite, setSqliteBootstrapBase } from './db/driver';
import { registerExplorer } from './explorer/registerExplorer';
import { ResultsView } from './results/resultsView';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('SQLient');
  const connections = new ConnectionManager();
  const results = new ResultsView(context.extensionUri);

  const explorer = registerExplorer(context);

  let runtimeError: string | undefined;
  try {
    setSqliteBootstrapBase(context.extensionUri.fsPath);
    loadSqlite();
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : String(error);
    output.appendLine(runtimeError);
  }

  const guarded = (run: () => Promise<void>) => async (): Promise<void> => {
    if (runtimeError) {
      void vscode.window.showErrorMessage(runtimeError);
      return;
    }
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[error] ${message}`);
      void vscode.window.showErrorMessage(`SQLient: ${message}`);
    }
  };

  context.subscriptions.push(
    output,
    { dispose: () => connections.dispose() },
    vscode.window.registerWebviewViewProvider(ResultsView.viewId, results, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand(
      'sqlient.runQuery',
      guarded(() => runQuery({ connections, results, output })),
    ),
    vscode.commands.registerCommand(
      'sqlient.browseDatabase',
      guarded(() => browseDatabase()),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('sqlient.readOnly')) {
        connections.disposeFiles();
      }
      if (
        event.affectsConfiguration('sqlient.persistPaths') ||
        event.affectsConfiguration('sqlient.d1.persistPaths')
      ) {
        explorer.refresh();
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      connections.closeDocument(document.uri.toString());
    }),
  );

  output.appendLine(`SQLient activated (VS Code ${vscode.version}, Node ${process.versions.node}).`);
}

export function deactivate(): void {
  // Connections are released through the disposables registered in activate().
}
