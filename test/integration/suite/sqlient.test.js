const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

suite('SQLient integration', () => {
  let tempDir;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlient-it-'));
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('activates and registers its commands', async () => {
    const extension = vscode.extensions.getExtension('alex.sqlient');
    assert.ok(extension, 'extension alex.sqlient should be discoverable');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('sqlient.runQuery'));
    assert.ok(commands.includes('sqlient.browseDatabase'));
  });

  test('runs statements against a file database', async () => {
    const dbPath = path.join(tempDir, 'app.db');
    const sqlPath = path.join(tempDir, 'query.sql');
    fs.writeFileSync(
      sqlPath,
      `--#db ${dbPath}\ncreate table t(a);\ninsert into t values (1), (2);\nselect * from t;\n`,
    );

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(sqlPath));
    await vscode.languages.setTextDocumentLanguage(document, 'sql');
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('sqlient.runQuery');

    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const rows = db.prepare('select a from t order by a').all();
    db.close();

    assert.deepStrictEqual(JSON.parse(JSON.stringify(rows)), [{ a: 1 }, { a: 2 }]);
  });

  test('runs an in-memory query without a directive', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'sql', content: 'select 1 as value;' });
    await vscode.window.showTextDocument(document);

    await assert.doesNotReject(() => vscode.commands.executeCommand('sqlient.runQuery'));
  });
});
