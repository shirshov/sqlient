import type { DatabaseEntry } from './types';

export interface IosFolderGroup {
  name: string;
  databases: DatabaseEntry[];
}

export interface IosAppGroup {
  name: string;
  bundleIds: string[];
  folders: IosFolderGroup[];
  databases: DatabaseEntry[];
}

export interface IosDeviceGroup {
  name: string;
  apps: IosAppGroup[];
}

export function groupIosDatabases(databases: readonly DatabaseEntry[]): IosDeviceGroup[] {
  const devices = new Map<string, Map<string, DatabaseEntry[]>>();

  for (const entry of databases) {
    const info = entry.ios;
    if (!info) {
      continue;
    }

    let apps = devices.get(info.deviceName);
    if (!apps) {
      apps = new Map();
      devices.set(info.deviceName, apps);
    }

    const appEntries = apps.get(info.appName) ?? [];
    appEntries.push(entry);
    apps.set(info.appName, appEntries);
  }

  return sortedEntries(devices).map(([deviceName, apps]) => ({
    name: deviceName,
    apps: sortedEntries(apps).map(([appName, entries]) => {
      const folders = new Map<string, DatabaseEntry[]>();
      const direct: DatabaseEntry[] = [];

      for (const entry of entries) {
        const folder = entry.ios?.folder ?? '';
        if (folder) {
          const folderEntries = folders.get(folder) ?? [];
          folderEntries.push(entry);
          folders.set(folder, folderEntries);
        } else {
          direct.push(entry);
        }
      }

      const bundleIds = [
        ...new Set(
          entries
            .map((entry) => entry.ios?.appBundleId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ].sort();

      return {
        name: appName,
        bundleIds,
        folders: sortedEntries(folders).map(([name, folderEntries]) => ({
          name,
          databases: sortDatabases(folderEntries),
        })),
        databases: sortDatabases(direct),
      };
    }),
  }));
}

function sortedEntries<T>(map: Map<string, T>): Array<[string, T]> {
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function sortDatabases(databases: DatabaseEntry[]): DatabaseEntry[] {
  return [...databases].sort((left, right) =>
    (left.ios?.relativePath ?? left.label).localeCompare(right.ios?.relativePath ?? right.label),
  );
}
