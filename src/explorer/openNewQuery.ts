import * as vscode from 'vscode';
import { directiveForDatabase } from '../project';

export async function openNewQuery(dbPath: string): Promise<void> {
  const content = `${directiveForDatabase(dbPath)}\n`;
  const document = await vscode.workspace.openTextDocument({ language: 'sql', content });
  await vscode.window.showTextDocument(document, { preview: false });
}
