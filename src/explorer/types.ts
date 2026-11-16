export type DatabaseSourceKind = 'd1' | 'ios' | 'do';

export interface IosEntryInfo {
  deviceName: string;
  appName: string;
  appBundleId: string;
  containerLabel: string;
  relativePath: string;
  folder: string;
}

export interface DoEntryInfo {
  namespace: string;
  workerName?: string;
  className: string;
  bindings: string[];
  objectId: string;
  objectName?: string;
}

export interface DatabaseEntry {
  path: string;
  kind: DatabaseSourceKind;
  label: string;
  description?: string;
  detail: string;
  ios?: IosEntryInfo;
  do?: DoEntryInfo;
}

export interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
  generated: boolean;
  hidden: boolean;
}

export type DbObjectType = 'table' | 'view' | 'index' | 'trigger';

export interface DbObjectInfo {
  name: string;
  type: DbObjectType;
  tableName?: string;
  sql?: string;
  columns: ColumnInfo[];
}

export interface DbSchema {
  tables: DbObjectInfo[];
  views: DbObjectInfo[];
  indexes: DbObjectInfo[];
  triggers: DbObjectInfo[];
}
