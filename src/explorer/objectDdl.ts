import type { DbObjectInfo, DbObjectType } from './types';

/**
 * Returns the object's stored CREATE statement, made idempotent with `IF NOT EXISTS`.
 */
export function buildCreateStatement(object: DbObjectInfo): string {
  const quoted = quoteIdentifier(object.name);

  if (!object.sql) {
    return `-- The stored definition of ${object.type} ${quoted} is not available.\n`;
  }

  const create = addIfNotExists(object.sql, object.type);
  return `${create.endsWith(';') ? create : `${create};`}\n`;
}

/** Returns a `DROP ... IF EXISTS` statement for the object. */
export function buildDropStatement(object: DbObjectInfo): string {
  return `DROP ${object.type.toUpperCase()} IF EXISTS ${quoteIdentifier(object.name)};\n`;
}

function addIfNotExists(sql: string, type: DbObjectType): string {
  const trimmed = sql.trim();

  switch (type) {
    case 'table': {
      const pattern = /^(CREATE\s+(?:(?:TEMP|TEMPORARY)\s+)?(?:VIRTUAL\s+)?TABLE)\s+/i;
      if (/^CREATE\s+(?:(?:TEMP|TEMPORARY)\s+)?(?:VIRTUAL\s+)?TABLE\s+IF\s+NOT\s+EXISTS\b/i.test(trimmed)) {
        return trimmed;
      }
      return trimmed.replace(pattern, '$1 IF NOT EXISTS ');
    }
    case 'index': {
      if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/i.test(trimmed)) {
        return trimmed;
      }
      return trimmed.replace(/^(CREATE\s+(?:UNIQUE\s+)?INDEX)\s+/i, '$1 IF NOT EXISTS ');
    }
    case 'view': {
      if (/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?VIEW\s+IF\s+NOT\s+EXISTS\b/i.test(trimmed)) {
        return trimmed;
      }
      return trimmed.replace(/^(CREATE\s+(?:TEMP(?:ORARY)?\s+)?VIEW)\s+/i, '$1 IF NOT EXISTS ');
    }
    case 'trigger': {
      if (/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\s+IF\s+NOT\s+EXISTS\b/i.test(trimmed)) {
        return trimmed;
      }
      return trimmed.replace(/^(CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER)\s+/i, '$1 IF NOT EXISTS ');
    }
    default:
      return trimmed;
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
