import * as vscode from 'vscode';
import { directiveForDatabase } from '../project';

export async function openObjectStatement(dbPath: string, statement: string): Promise<void> {
  const content = `${directiveForDatabase(dbPath)}\n${statement}`;
  const document = await vscode.workspace.openTextDocument({ language: 'sql', content });
  await vscode.window.showTextDocument(document, { preview: false });
}
