import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { normalizeError } from '../db/driver';
import { discoverDatabases, type ExplorerDiscovery } from './discovery';
import { groupDoDatabases } from './doTree';
import { groupIosDatabases } from './iosTree';
import { readSchema } from './schema';
import type { ColumnInfo, DatabaseEntry, DbObjectInfo, DbSchema } from './types';

type SectionId = 'tables' | 'views' | 'indexes' | 'triggers';

export type ExplorerNode =
  | { kind: 'message'; label: string; description?: string; tooltip?: string; icon?: string; error?: boolean }
  | {
      kind: 'group';
      id: 'd1' | 'do' | 'ios';
      label: string;
      description?: string;
      icon: string;
      children: ExplorerNode[];
    }
  | {
      kind: 'container';
      label: string;
      description?: string;
      tooltip?: string;
      icon: string;
      contextValue: string;
      children: ExplorerNode[];
    }
  | { kind: 'database'; entry: DatabaseEntry }
  | { kind: 'section'; entry: DatabaseEntry; section: SectionId; objects: DbObjectInfo[] }
  | { kind: 'object'; entry: DatabaseEntry; object: DbObjectInfo }
  | { kind: 'column'; column: ColumnInfo };

const SECTION_TITLES: Record<SectionId, string> = {
  tables: 'Tables',
  views: 'Views',
  indexes: 'Indexes',
  triggers: 'Triggers',
};

const SECTION_ICONS: Record<SectionId, string> = {
  tables: 'table',
  views: 'eye',
  indexes: 'list-flat',
  triggers: 'zap',
};

const OBJECT_ICONS: Record<string, string> = {
  table: 'table',
  view: 'eye',
  index: 'list-flat',
  trigger: 'zap',
};

export class ExplorerProvider implements vscode.TreeDataProvider<ExplorerNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ExplorerNode | undefined>();
  private discovery: Promise<ExplorerDiscovery> | undefined;
  private readonly schemaCache = new Map<string, { mtimeMs: number; schema: DbSchema }>();

  public readonly onDidChangeTreeData = this.changed.event;

  public refresh(): void {
    this.discovery = undefined;
    this.schemaCache.clear();
    this.changed.fire(undefined);
  }

  public dispose(): void {
    this.changed.dispose();
  }

  public getTreeItem(node: ExplorerNode): vscode.TreeItem {
    if (node.kind === 'message') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(node.icon ?? (node.error ? 'error' : 'info'));
      item.description = node.description;
      item.tooltip = node.tooltip ?? node.description ?? node.label;
      item.contextValue = 'message';
      return item;
    }

    if (node.kind === 'group') {
      const item = new vscode.TreeItem(
        node.label,
        node.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.description = node.description;
      item.contextValue = `group.${node.id}`;
      return item;
    }

    if (node.kind === 'container') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.description = node.description;
      item.tooltip = node.tooltip;
      item.contextValue = node.contextValue;
      return item;
    }

    if (node.kind === 'database') {
      const item = new vscode.TreeItem(node.entry.label, vscode.TreeItemCollapsibleState.Collapsed);
      const icon =
        node.entry.kind === 'd1' ? 'cloud' : node.entry.kind === 'do' ? 'symbol-class' : 'device-mobile';
      item.iconPath = new vscode.ThemeIcon(icon);
      item.description = node.entry.description;
      item.tooltip = node.entry.detail;
      item.contextValue = `database.${node.entry.kind}`;
      return item;
    }

    if (node.kind === 'section') {
      const item = new vscode.TreeItem(
        `${SECTION_TITLES[node.section]} (${node.objects.length})`,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = new vscode.ThemeIcon(SECTION_ICONS[node.section]);
      item.contextValue = `section.${node.section}`;
      return item;
    }

    if (node.kind === 'object') {
      const object = node.object;
      const hasChildren = object.type === 'table' || object.type === 'view' ? object.columns.length > 0 : false;
      const item = new vscode.TreeItem(
        object.name,
        hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon(OBJECT_ICONS[object.type] ?? 'symbol-field');
      item.contextValue = `object.${object.type}`;
      item.tooltip = object.sql ?? object.name;

      if (object.type === 'table') {
        item.description = `${object.columns.length} column${object.columns.length === 1 ? '' : 's'}`;
      } else if (object.type === 'view') {
        item.description = `${object.columns.length} column${object.columns.length === 1 ? '' : 's'}`;
      } else if (object.tableName) {
        item.description = `on ${object.tableName}`;
      }

      return item;
    }

    const item = new vscode.TreeItem(node.column.name, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(node.column.primaryKey ? 'key' : 'symbol-field');
    item.description = describeColumn(node.column);
    item.tooltip = columnTooltip(node.column);
    item.contextValue = 'column';
    return item;
  }

  public async getChildren(node?: ExplorerNode): Promise<ExplorerNode[]> {
    if (!node) {
      return this.rootNodes();
    }

    switch (node.kind) {
      case 'group':
        return node.children;
      case 'container':
        return node.children;
      case 'database':
        return this.databaseNodes(node.entry);
      case 'section':
        return node.objects.map((object) => ({ kind: 'object', entry: node.entry, object }));
      case 'object':
        return this.objectNodes(node.object);
      default:
        return [];
    }
  }

  public getParent(): undefined {
    return undefined;
  }

  private async rootNodes(): Promise<ExplorerNode[]> {
    const result = await this.ensureDiscovery();
    const nodes: ExplorerNode[] = [];

    if (result.d1.hasConfigs || result.d1.databases.length > 0) {
      nodes.push({
        kind: 'group',
        id: 'd1',
        label: 'D1',
        description: countLabel(result.d1.databases.length, 'database'),
        icon: 'cloud',
        children: this.sourceChildren(result.d1.databases, result.d1.notices),
      });
    }

    if (result.do.configured || result.do.databases.length > 0) {
      nodes.push({
        kind: 'group',
        id: 'do',
        label: 'Durable Objects',
        description: countLabel(result.do.databases.length, 'database'),
        icon: 'server',
        children: this.doChildren(result.do.databases, result.do.notices),
      });
    }

    if (result.ios.hasProject) {
      nodes.push({
        kind: 'group',
        id: 'ios',
        label: 'iOS Simulator',
        description: countLabel(result.ios.databases.length, 'database'),
        icon: 'device-mobile',
        children: this.iosChildren(result.ios.databases, result.ios.notices),
      });
    }

    if (nodes.length === 0) {
      nodes.push({
        kind: 'message',
        label: 'No databases discovered',
        description: 'Open a Cloudflare D1 or iOS project',
        tooltip:
          'SQLient looks for local D1 databases in wrangler state directories and for SQLite files in the booted iOS simulator containers of the project app.',
        icon: 'info',
      });
    }

    return nodes;
  }

  private iosChildren(databases: readonly DatabaseEntry[], notices: readonly string[]): ExplorerNode[] {
    const children: ExplorerNode[] = [];

    for (const device of groupIosDatabases(databases)) {
      const appNodes: ExplorerNode[] = device.apps.map((app) => {
        const folderNodes: ExplorerNode[] = app.folders.map((folder) => ({
          kind: 'container',
          label: folder.name,
          icon: 'folder',
          contextValue: 'ios-folder',
          children: folder.databases.map((entry) => ({ kind: 'database', entry })),
        }));
        const directNodes: ExplorerNode[] = app.databases.map((entry) => ({ kind: 'database', entry }));

        return {
          kind: 'container',
          label: app.name,
          icon: 'symbol-namespace',
          tooltip: app.bundleIds.join(', ') || undefined,
          contextValue: 'ios-app',
          children: [...folderNodes, ...directNodes],
        };
      });

      children.push({
        kind: 'container',
        label: device.name,
        icon: 'device-mobile',
        description: countLabel(device.apps.length, 'app'),
        contextValue: 'ios-device',
        children: appNodes,
      });
    }

    for (const notice of notices) {
      children.push({ kind: 'message', label: notice, icon: 'info' });
    }

    return children;
  }

  private doChildren(databases: readonly DatabaseEntry[], notices: readonly string[]): ExplorerNode[] {
    const children: ExplorerNode[] = groupDoDatabases(databases).map((namespace): ExplorerNode => {
      const tooltip = [
        `namespace: ${namespace.namespace}`,
        namespace.workerName ? `worker: ${namespace.workerName}` : undefined,
        namespace.bindings.length > 0 ? `bindings: ${namespace.bindings.join(', ')}` : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n');

      return {
        kind: 'container',
        label: namespace.className,
        description: namespace.workerName,
        tooltip: tooltip || undefined,
        icon: 'symbol-class',
        contextValue: 'do-namespace',
        children: namespace.databases.map((entry): ExplorerNode => ({ kind: 'database', entry })),
      };
    });

    for (const notice of notices) {
      children.push({ kind: 'message', label: notice, icon: 'info' });
    }

    return children;
  }

  private sourceChildren(databases: readonly DatabaseEntry[], notices: readonly string[]): ExplorerNode[] {
    const children: ExplorerNode[] = databases.map((entry) => ({ kind: 'database', entry }));
    for (const notice of notices) {
      children.push({ kind: 'message', label: notice, icon: 'info' });
    }
    return children;
  }

  private async databaseNodes(entry: DatabaseEntry): Promise<ExplorerNode[]> {
    let schema: DbSchema;
    try {
      schema = this.loadSchema(entry);
    } catch (error) {
      const normalized = normalizeError(error);
      return [
        {
          kind: 'message',
          label: 'Could not open database',
          description: normalized.message,
          tooltip: normalized.message,
          error: true,
          icon: 'error',
        },
      ];
    }

    return [
      { kind: 'section', entry, section: 'tables', objects: schema.tables },
      { kind: 'section', entry, section: 'views', objects: schema.views },
      { kind: 'section', entry, section: 'indexes', objects: schema.indexes },
      { kind: 'section', entry, section: 'triggers', objects: schema.triggers },
    ];
  }

  private objectNodes(object: DbObjectInfo): ExplorerNode[] {
    if (object.type !== 'table' && object.type !== 'view') {
      return [];
    }
    if (object.columns.length === 0) {
      return [{ kind: 'message', label: 'No columns', icon: 'info' }];
    }
    return object.columns.map((column) => ({ kind: 'column', column }));
  }

  private loadSchema(entry: DatabaseEntry): DbSchema {
    let mtimeMs = fs.statSync(entry.path).mtimeMs;
    try {
      mtimeMs = Math.max(mtimeMs, fs.statSync(`${entry.path}-wal`).mtimeMs);
    } catch {
      // A missing WAL file is normal.
    }

    const cached = this.schemaCache.get(entry.path);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.schema;
    }

    const schema = readSchema(entry.path);
    this.schemaCache.set(entry.path, { mtimeMs, schema });
    return schema;
  }

  private ensureDiscovery(): Promise<ExplorerDiscovery> {
    if (!this.discovery) {
      this.discovery = discoverDatabases().catch((error) => ({
        d1: {
          databases: [],
          notices: [`Could not discover databases: ${error instanceof Error ? error.message : String(error)}`],
          hasConfigs: false,
        },
        do: { databases: [], notices: [], hasConfigs: false, configured: false },
        ios: { databases: [], notices: [], hasProject: false },
      }));
    }
    return this.discovery;
  }
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function describeColumn(column: ColumnInfo): string {
  const parts: string[] = [];
  if (column.type) {
    parts.push(column.type);
  }
  if (column.primaryKey) {
    parts.push('PK');
  }
  if (column.notNull) {
    parts.push('NOT NULL');
  }
  if (column.generated) {
    parts.push('generated');
  }
  if (column.hidden) {
    parts.push('hidden');
  }
  if (column.defaultValue !== null) {
    parts.push(`default ${column.defaultValue}`);
  }
  return parts.join(' · ');
}

function columnTooltip(column: ColumnInfo): string {
  const lines = [column.type ? `${column.name} ${column.type}` : column.name];
  if (column.primaryKey) {
    lines.push('primary key');
  }
  if (column.notNull) {
    lines.push('not null');
  }
  if (column.defaultValue !== null) {
    lines.push(`default: ${column.defaultValue}`);
  }
  if (column.generated) {
    lines.push('generated column');
  }
  if (column.hidden) {
    lines.push('hidden column');
  }
  return lines.join('\n');
}
