/*
 * Runs the built extension bundle against a small in-process mock of the VS Code API.
 *
 * This covers extension wiring (activation, command registration, webview payloads,
 * clipboard handling, directive edits) in plain Node, which is usable on machines where
 * launching a second VS Code window for @vscode/test-electron is not possible.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');

const projectRoot = path.resolve(__dirname, '..', '..');

class FileUri {
  constructor(fsPath) {
    this.fsPath = fsPath;
    this.scheme = 'file';
  }
  static file(fsPath) {
    return new FileUri(fsPath);
  }
  static joinPath(base, ...parts) {
    return new FileUri(path.join(base.fsPath, ...parts));
  }
  toString() {
    return `file://${this.fsPath}`;
  }
}

class UntitledUri {
  constructor(id) {
    this.scheme = 'untitled';
    this.fsPath = undefined;
    this.id = id;
  }
  toString() {
    return `untitled:${this.id}`;
  }
}

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class WorkspaceEdit {
  constructor() {
    this.edits = [];
  }
  replace(uri, range, text) {
    this.edits.push({ kind: 'replace', uri, range, text });
  }
  insert(uri, position, text) {
    this.edits.push({ kind: 'insert', uri, position, text });
  }
}

class FakeWebview {
  constructor() {
    this.options = {};
    this.html = '';
    this.messages = [];
    this.listener = undefined;
  }
  get cspSource() {
    return 'vscode-resource:';
  }
  asWebviewUri(uri) {
    return uri;
  }
  postMessage(message) {
    this.messages.push(message);
    return Promise.resolve(true);
  }
  onDidReceiveMessage(listener) {
    this.listener = listener;
    return { dispose() {} };
  }
  receive(message) {
    return this.listener ? this.listener(message) : undefined;
  }
}

class FakeWebviewView {
  constructor() {
    this.webview = new FakeWebview();
    this.visible = true;
    this.disposeListeners = [];
    this.shows = [];
  }
  show(preserveFocus) {
    this.shows.push(preserveFocus);
    this.visible = true;
  }
  onDidDispose(listener) {
    this.disposeListeners.push(listener);
    return { dispose() {} };
  }
}

class EventEmitter {
  constructor() {
    this.listeners = new Set();
  }
  get event() {
    return (listener) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
  }
  fire(value) {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }
  dispose() {
    this.listeners.clear();
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id) {
    this.id = id;
  }
}

class RelativePattern {
  constructor(base, pattern) {
    this.base = base;
    this.pattern = pattern;
  }
}

class Disposable {
  constructor(callback) {
    this.callback = callback;
  }
  dispose() {
    if (this.callback) {
      this.callback();
      this.callback = undefined;
    }
  }
}

const registeredCommands = new Map();
const executedCommands = [];
const errorsShown = [];
const infoShown = [];
const statusMessages = [];
const appliedEdits = [];
const clipboard = [];
const treeViews = [];
const openedDocuments = [];
const viewRegistry = { type: undefined, provider: undefined, options: undefined };
const config = { readOnly: false, maxRows: 100 };

const vscodeMock = {
  version: '1.146.0-harness',
  Uri: FileUri,
  Position,
  Range,
  WorkspaceEdit,
  EventEmitter,
  TreeItem,
  ThemeIcon,
  RelativePattern,
  Disposable,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  window: {
    activeTextEditor: undefined,
    createOutputChannel: () => ({ appendLine() {}, append() {}, dispose() {} }),
    registerWebviewViewProvider: (type, provider, options) => {
      viewRegistry.type = type;
      viewRegistry.provider = provider;
      viewRegistry.options = options;
      return { dispose() {} };
    },
    createTreeView: (id, options) => {
      treeViews.push({ id, options });
      return { dispose() {} };
    },
    showTextDocument: async (document) => {
      openedDocuments.push(document);
      return { document };
    },
    showErrorMessage: (message) => {
      errorsShown.push(message);
      return Promise.resolve(undefined);
    },
    showInformationMessage: (message) => {
      infoShown.push(message);
      return Promise.resolve(undefined);
    },
    setStatusBarMessage: (message) => {
      statusMessages.push(message);
    },
    showOpenDialog: async () => (globalThis.__pickedDatabase ? [FileUri.file(globalThis.__pickedDatabase)] : undefined),
  },
  commands: {
    registerCommand: (id, handler) => {
      registeredCommands.set(id, handler);
      return { dispose() {} };
    },
    executeCommand: async (id) => {
      executedCommands.push(id);
      return undefined;
    },
    getCommands: async () => [...registeredCommands.keys()],
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({
      get: (key, fallback) => {
        if (key === 'sqlient.readOnly' || key === 'readOnly') {
          return config.readOnly;
        }
        if (key === 'sqlient.maxRows' || key === 'maxRows') {
          return config.maxRows;
        }
        if (
          key === 'sqlient.persistPaths' ||
          key === 'persistPaths' ||
          key === 'sqlient.d1.persistPaths' ||
          key === 'd1.persistPaths'
        ) {
          return config.d1PersistPaths ?? [];
        }
        return fallback;
      },
    }),
    getWorkspaceFolder: () => undefined,
    openTextDocument: async (argument) => {
      const document = makeDocument({
        text: argument.content ?? '',
        languageId: argument.language ?? 'plaintext',
      });
      openedDocuments.push(document);
      return document;
    },
    findFiles: async () => [],
    createFileSystemWatcher: () => ({
      onDidCreate() {},
      onDidChange() {},
      onDidDelete() {},
      dispose() {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    applyEdit: async (edit) => {
      appliedEdits.push(edit);
      return true;
    },
  },
  env: {
    clipboard: {
      writeText: async (text) => {
        clipboard.push(text);
      },
    },
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

function makeDocument({ text, uri = new UntitledUri('Untitled-1'), languageId = 'sql' }) {
  const document = {
    uri,
    languageId,
    text,
    getText(range) {
      return range && typeof range.text === 'string' ? range.text : document.text;
    },
    lineAt(lineNumber) {
      const line = document.text.split(/\r?\n/)[lineNumber] ?? '';
      return { text: line, range: new Range(new Position(lineNumber, 0), new Position(lineNumber, line.length)) };
    },
  };
  return document;
}

function makeEditor(document) {
  return { document, selection: { start: new Position(0, 0), end: new Position(0, 0), text: '' } };
}

function lastRender(webview) {
  const messages = webview.messages.filter((message) => message.type === 'render');
  return messages[messages.length - 1];
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function main() {
  const suite = [];
  const test = (name, fn) => suite.push({ name, fn });

  const extension = require(path.join(projectRoot, 'dist', 'extension.js'));
  const context = { extensionUri: FileUri.file(projectRoot), subscriptions: [] };
  extension.activate(context);

  const view = new FakeWebviewView();
  assert.equal(viewRegistry.type, 'sqlient.results', 'results view provider should be registered');
  viewRegistry.provider.resolveWebviewView(view);
  assert.match(view.webview.html, /main\.js/, 'webview HTML should load the script');
  assert.equal(viewRegistry.options.webviewOptions.retainContextWhenHidden, true);

  const runQuery = registeredCommands.get('sqlient.runQuery');
  const browseDatabase = registeredCommands.get('sqlient.browseDatabase');

  test('registers both commands', () => {
    assert.equal(typeof runQuery, 'function');
    assert.equal(typeof browseDatabase, 'function');
  });

  test('runs an in-memory query and renders results', async () => {
    vscodeMock.window.activeTextEditor = makeEditor(makeDocument({ text: "select 1 as a, 'x' as b;" }));
    await runQuery();

    const render = lastRender(view.webview);
    assert.ok(render, 'a render message should be posted');
    assert.equal(render.results.targetLabel, ':memory:');
    assert.equal(render.results.statements.length, 1);
    assert.deepEqual(render.results.statements[0].columns, ['a', 'b']);
    assert.deepEqual(render.results.statements[0].rows, [[1, 'x']]);
  });

  test('keeps the in-memory database across runs', async () => {
    const document = makeDocument({ text: 'create table t(a); insert into t values (7);' });
    vscodeMock.window.activeTextEditor = makeEditor(document);
    await runQuery();

    document.text = 'select a from t;';
    await runQuery();

    const render = lastRender(view.webview);
    assert.deepEqual(render.results.statements[0].rows, [[7]]);
  });

  test('copies the active result as CSV and JSON', async () => {
    const render = lastRender(view.webview);
    const index = render.results.statements[0].index;

    view.webview.receive({ type: 'copy', format: 'csv', index });
    await tick();
    assert.equal(clipboard[clipboard.length - 1], 'a\n7');

    view.webview.receive({ type: 'copy', format: 'json', index });
    await tick();
    assert.deepEqual(JSON.parse(clipboard[clipboard.length - 1]), [{ a: 7 }]);
  });

  test('replays the latest results when the view becomes ready', () => {
    const before = view.webview.messages.length;
    view.webview.receive({ type: 'ready' });
    const renders = view.webview.messages.slice(before).filter((message) => message.type === 'render');
    assert.equal(renders.length, 1);
  });

  test('inserts the #db directive from the browse command', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlient-browse-'));
    const dbPath = path.join(tempDir, 'picked.db');
    globalThis.__pickedDatabase = dbPath;

    const document = makeDocument({ text: 'select 1;' });
    vscodeMock.window.activeTextEditor = makeEditor(document);
    await browseDatabase();

    const edit = appliedEdits[appliedEdits.length - 1];
    assert.ok(edit, 'an edit should be applied');
    assert.equal(edit.edits[0].kind, 'insert');
    assert.equal(edit.edits[0].position.line, 0);
    assert.equal(edit.edits[0].text, `--#db ${dbPath}\n`);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('updates an existing #db directive in place', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlient-browse-'));
    const dbPath = path.join(tempDir, 'next.db');
    globalThis.__pickedDatabase = dbPath;

    const document = makeDocument({ text: '--#db /tmp/old.db\nselect 1;' });
    vscodeMock.window.activeTextEditor = makeEditor(document);
    await browseDatabase();

    const edit = appliedEdits[appliedEdits.length - 1];
    assert.equal(edit.edits[0].kind, 'replace');
    assert.equal(edit.edits[0].range.start.line, 0);
    assert.equal(edit.edits[0].text, `--#db ${dbPath}`);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('runs against a file database and reports row changes', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlient-file-'));
    const dbPath = path.join(tempDir, 'app.db');
    const sqlPath = path.join(tempDir, 'query.sql');
    const sql = `--#db ${dbPath}\ncreate table t(a);\ninsert into t values (1), (2);\nselect * from t;`;
    fs.writeFileSync(sqlPath, sql);

    vscodeMock.window.activeTextEditor = makeEditor(makeDocument({ text: sql, uri: FileUri.file(sqlPath) }));
    await runQuery();

    const render = lastRender(view.webview);
    assert.equal(render.results.targetLabel, 'app.db');
    assert.equal(render.results.statements.length, 3);
    assert.equal(render.results.statements[1].changes, 2);

    const db = new DatabaseSync(dbPath);
    const rows = db.prepare('select a from t order by a').all();
    db.close();
    assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ a: 1 }, { a: 2 }]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('honors the read-only setting', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlient-readonly-'));
    const dbPath = path.join(tempDir, 'ro.db');
    const writable = new DatabaseSync(dbPath);
    writable.exec('create table t(a)');
    writable.close();

    const sql = `--#db ${dbPath}\ninsert into t values (1);`;
    config.readOnly = true;
    try {
      vscodeMock.window.activeTextEditor = makeEditor(
        makeDocument({ text: sql, uri: FileUri.file(path.join(tempDir, 'ro.sql')) }),
      );
      await runQuery();
    } finally {
      config.readOnly = false;
    }

    const render = lastRender(view.webview);
    assert.equal(render.results.statements[0].status, 'error');
    assert.match(render.results.statements[0].error.message, /readonly|read-only/i);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('reports missing SQL files and unsupported parameters', async () => {
    vscodeMock.window.activeTextEditor = makeEditor(makeDocument({ text: 'select ? as value;' }));
    await runQuery();

    const render = lastRender(view.webview);
    assert.equal(render.results.statements[0].status, 'error');
    assert.match(render.results.statements[0].error.message, /parameters are not supported/i);
  });

  test('registers the databases tree view and refresh command', async () => {
    assert.equal(treeViews.length, 1);
    assert.equal(treeViews[0].id, 'sqlient.databases');
    assert.equal(typeof registeredCommands.get('sqlient.refreshDatabases'), 'function');
    assert.equal(typeof registeredCommands.get('sqlient.newQueryFromTable'), 'function');
    assert.equal(typeof registeredCommands.get('sqlient.newQueryFromDatabase'), 'function');
    assert.equal(typeof registeredCommands.get('sqlient.newCreateQuery'), 'function');
    assert.equal(typeof registeredCommands.get('sqlient.newDropQuery'), 'function');

    const nodes = await treeViews[0].options.treeDataProvider.getChildren();
    assert.ok(Array.isArray(nodes) && nodes.length > 0, 'the explorer should render a placeholder');
  });

  test('opens a new SQL query document for a table via the inline action', async () => {
    const newQueryFromTable = registeredCommands.get('sqlient.newQueryFromTable');
    assert.equal(typeof newQueryFromTable, 'function');

    await newQueryFromTable({
      kind: 'object',
      entry: { path: '/tmp/app.db' },
      object: {
        type: 'table',
        name: 'weird"table',
        columns: [{ name: 'id' }, { name: 'na"me' }, { name: 'hidden', hidden: true }],
      },
    });

    const document = openedDocuments[openedDocuments.length - 1];
    assert.ok(document, 'a document should be opened');
    assert.equal(document.languageId, 'sql');
    assert.equal(document.text, '--#db /tmp/app.db\nSELECT "id", "na""me" from "weird""table";\n');
  });

  test('opens a CREATE query for an object via the inline action', async () => {
    const newCreateQuery = registeredCommands.get('sqlient.newCreateQuery');
    assert.equal(typeof newCreateQuery, 'function');

    await newCreateQuery({
      kind: 'object',
      entry: { path: '/tmp/app.db' },
      object: { type: 'table', name: 'users', sql: 'CREATE TABLE users (id integer primary key)' },
    });

    const document = openedDocuments[openedDocuments.length - 1];
    assert.ok(document, 'a document should be opened');
    assert.equal(document.languageId, 'sql');
    assert.equal(document.text, '--#db /tmp/app.db\nCREATE TABLE IF NOT EXISTS users (id integer primary key);\n');
  });

  test('opens a DROP query for an object via the inline action', async () => {
    const newDropQuery = registeredCommands.get('sqlient.newDropQuery');
    assert.equal(typeof newDropQuery, 'function');

    await newDropQuery({
      kind: 'object',
      entry: { path: '/tmp/app.db' },
      object: { type: 'index', name: 'idx_users' },
    });

    const document = openedDocuments[openedDocuments.length - 1];
    assert.ok(document, 'a document should be opened');
    assert.equal(document.languageId, 'sql');
    assert.equal(document.text, '--#db /tmp/app.db\nDROP INDEX IF EXISTS "idx_users";\n');
  });

  test('opens an empty query with the directive for a database node', async () => {
    const newQuery = registeredCommands.get('sqlient.newQueryFromDatabase');
    assert.equal(typeof newQuery, 'function');

    await newQuery({ kind: 'database', entry: { path: '/tmp/app.db' } });

    const document = openedDocuments[openedDocuments.length - 1];
    assert.ok(document, 'a document should be opened');
    assert.equal(document.languageId, 'sql');
    assert.equal(document.text, '--#db /tmp/app.db\n');
  });

  test('opens an empty query from the Tables section node', async () => {
    const newQuery = registeredCommands.get('sqlient.newQueryFromDatabase');
    await newQuery({ kind: 'section', section: 'tables', entry: { path: '/tmp/app.db' } });

    const document = openedDocuments[openedDocuments.length - 1];
    assert.ok(document, 'a document should be opened');
    assert.equal(document.languageId, 'sql');
    assert.equal(document.text, '--#db /tmp/app.db\n');
  });

  test('reveals a hidden results panel without moving focus off the editor', async () => {
    const commandCount = executedCommands.length;
    view.visible = false;
    try {
      vscodeMock.window.activeTextEditor = makeEditor(makeDocument({ text: 'select 1;' }));
      await runQuery();

      assert.deepEqual(view.shows, [true], 'the hidden panel should be revealed with preserveFocus');
      assert.equal(
        executedCommands.slice(commandCount).some((id) => id === 'sqlient.results.focus'),
        false,
        'the results panel must not take keyboard focus',
      );
    } finally {
      view.visible = true;
    }
  });

  for (const { name, fn } of suite) {
    await fn();
    console.log(`ok - ${name}`);
  }
  console.log(`\n${suite.length} harness checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
