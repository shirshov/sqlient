import type { DatabaseSync } from 'node:sqlite';
import { withReadOnlyDatabase } from './readOnlyDatabase';
import type { ColumnInfo, DbObjectInfo, DbSchema } from './types';

export function readSchema(dbPath: string): DbSchema {
  return withReadOnlyDatabase(dbPath, (db) => readFrom(db));
}

function readFrom(db: DatabaseSync): DbSchema {
  const rows = db
    .prepare(
      "select type, name, tbl_name, sql from sqlite_master where type in ('table','view','index','trigger') and name not like 'sqlite_%' and name <> '__miniflare_do_name' order by type, name",
    )
    .all() as Array<Record<string, unknown>>;

  const tables: DbObjectInfo[] = [];
  const views: DbObjectInfo[] = [];
  const indexes: DbObjectInfo[] = [];
  const triggers: DbObjectInfo[] = [];

  for (const row of rows) {
    const type = row.type;
    const name = row.name;
    if (typeof type !== 'string' || typeof name !== 'string') {
      continue;
    }

    const tableName = typeof row.tbl_name === 'string' ? row.tbl_name : undefined;
    const sql = typeof row.sql === 'string' ? row.sql : undefined;

    if (type === 'table' || type === 'view') {
      const object: DbObjectInfo = {
        name,
        type,
        sql,
        columns: readColumns(db, name),
      };
      if (type === 'table') {
        tables.push(object);
      } else {
        views.push(object);
      }
      continue;
    }

    const object: DbObjectInfo = { name, type: type === 'index' ? 'index' : 'trigger', tableName, sql, columns: [] };
    if (type === 'index') {
      indexes.push(object);
    } else {
      triggers.push(object);
    }
  }

  return { tables, views, indexes, triggers };
}

function readColumns(db: DatabaseSync, objectName: string): ColumnInfo[] {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = db.prepare(`pragma table_xinfo(${quoteIdentifier(objectName)})`).all() as Array<Record<string, unknown>>;
  } catch {
    return [];
  }

  return rows.map((row) => {
    const hidden = Number(row.hidden ?? 0);
    return {
      name: typeof row.name === 'string' ? row.name : '',
      type: typeof row.type === 'string' ? row.type : '',
      notNull: Number(row.notnull ?? 0) === 1,
      primaryKey: Number(row.pk ?? 0) > 0,
      defaultValue: row.dflt_value === null || row.dflt_value === undefined ? null : String(row.dflt_value),
      generated: hidden === 2 || hidden === 3,
      hidden: hidden === 1,
    };
  });
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
