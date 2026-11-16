import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { QueryResults } from '../types';
import { serializeResult, type CopyFormat } from './serialize';

interface CopyMessage {
  type: 'copy';
  format: CopyFormat;
  index: number;
}

interface ReadyMessage {
  type: 'ready';
}

type WebviewMessage = CopyMessage | ReadyMessage;

export class ResultsView implements vscode.WebviewViewProvider {
  public static readonly viewId = 'sqlient.results';

  private view: vscode.WebviewView | undefined;
  private latest: QueryResults | undefined;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = this.buildHtml(view.webview);
    view.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(message);
    });
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
      }
    });
  }

  public async showResults(results: QueryResults): Promise<void> {
    this.latest = results;

    if (this.view) {
      // Reveal the panel without moving keyboard focus off the editor.
      if (!this.view.visible) {
        this.view.show(true);
      }
    } else {
      // First reveal in a fresh window: the webview does not exist yet.
      try {
        await vscode.commands.executeCommand(`${ResultsView.viewId}.focus`);
      } catch {
        // The view may not be available yet; it will pick up the payload when it resolves.
      }
    }

    this.postResults(results);
  }

  private postResults(results: QueryResults): void {
    void this.view?.webview.postMessage({ type: 'render', results });
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'ready') {
      if (this.latest) {
        this.postResults(this.latest);
      }
      return;
    }

    if (message.type === 'copy') {
      const statement = this.latest?.statements.find((entry) => entry.index === message.index);
      if (!statement) {
        return;
      }
      const text = serializeResult(statement, message.format);
      await vscode.env.clipboard.writeText(text);
      vscode.window.setStatusBarMessage(
        `SQLient: copied statement ${message.index} as ${message.format.toUpperCase()}`,
        2500,
      );
    }
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('hex');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>SQLient Results</title>
</head>
<body>
  <div id="toolbar">
    <span id="target" class="target"></span>
    <span id="meta" class="meta"></span>
    <span class="spacer"></span>
    <select id="format" title="Clipboard format">
      <option value="csv">CSV</option>
      <option value="json">JSON</option>
      <option value="tsv">TSV</option>
    </select>
    <button id="copy" title="Copy the active result to the clipboard">Copy</button>
  </div>
  <div id="tabs" role="tablist"></div>
  <div id="content" role="tabpanel"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
