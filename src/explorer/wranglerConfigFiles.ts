import * as fs from 'node:fs';
import * as vscode from 'vscode';

export interface WranglerConfigInput {
  path: string;
  text: string;
}

export async function findWranglerConfigs(
  folders: readonly vscode.WorkspaceFolder[],
): Promise<WranglerConfigInput[]> {
  const configPaths = new Set<string>();

  for (const folder of folders) {
    try {
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, '**/wrangler.{json,jsonc}'),
        '**/{node_modules,dist,build,.git,.wrangler,.cloudflare,.tmp}/**',
        200,
      );
      for (const uri of found) {
        configPaths.add(uri.fsPath);
      }
    } catch {
      // A folder that cannot be scanned must not block the rest of the explorer.
    }
  }

  const configs: WranglerConfigInput[] = [];
  for (const configPath of configPaths) {
    try {
      configs.push({ path: configPath, text: await fs.promises.readFile(configPath, 'utf8') });
    } catch {
      // Ignore unreadable config files.
    }
  }

  return configs;
}
