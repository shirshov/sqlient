import type { DatabaseEntry } from './types';

export interface DoNamespaceGroup {
  namespace: string;
  className: string;
  workerName?: string;
  bindings: string[];
  databases: DatabaseEntry[];
}

export function groupDoDatabases(databases: readonly DatabaseEntry[]): DoNamespaceGroup[] {
  const groups = new Map<string, DatabaseEntry[]>();

  for (const entry of databases) {
    const info = entry.do;
    if (!info) {
      continue;
    }
    const entries = groups.get(info.namespace) ?? [];
    entries.push(entry);
    groups.set(info.namespace, entries);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([namespace, entries]) => {
      const first = entries[0]?.do;
      const bindings = [...new Set(entries.flatMap((entry) => entry.do?.bindings ?? []))].sort();

      return {
        namespace,
        className: first?.className ?? namespace,
        workerName: first?.workerName,
        bindings,
        databases: [...entries].sort((left, right) =>
          (left.do?.objectName ?? left.do?.objectId ?? left.label).localeCompare(
            right.do?.objectName ?? right.do?.objectId ?? right.label,
          ),
        ),
      };
    });
}
