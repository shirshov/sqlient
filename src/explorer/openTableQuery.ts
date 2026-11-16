import * as vscode from 'vscode';
import { directiveForDatabase } from '../project';
import type { DbObjectInfo } from './types';

export async function openTableQuery(dbPath: string, object: DbObjectInfo): Promise<void> {
  const identifier = quoteIdentifier(object.name);
  const columns = object.columns
    .filter((column) => !column.hidden)
    .map((column) => quoteIdentifier(column.name));
  const projection = columns.length > 0 ? columns.join(', ') : '*';
  const content = `${directiveForDatabase(dbPath)}\nSELECT ${projection} from ${identifier};\n`;
  const document = await vscode.workspace.openTextDocument({ language: 'sql', content });
  await vscode.window.showTextDocument(document, { preview: false });
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
