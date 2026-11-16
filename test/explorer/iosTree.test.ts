import { describe, expect, it } from 'vitest';
import { groupIosDatabases } from '../../src/explorer/iosTree';
import type { DatabaseEntry } from '../../src/explorer/types';

function entry(
  deviceName: string,
  appName: string,
  relativePath: string,
  folder: string,
): DatabaseEntry {
  return {
    path: `/tmp/${deviceName}/${relativePath}`,
    kind: 'ios',
    label: relativePath.split('/').pop() ?? relativePath,
    description: 'Library/Application Support',
    detail: '',
    ios: {
      deviceName,
      appName,
      appBundleId: `com.example.${appName.toLowerCase()}`,
      containerLabel: 'app data',
      relativePath,
      folder,
    },
  };
}

describe('groupIosDatabases', () => {
  it('groups by device, app, and folder', () => {
    const groups = groupIosDatabases([
      entry('iPhone 15', 'BetaApp', 'Library/Application Support/Beta/app.db', 'Beta'),
      entry('iPhone 16', 'AlphaApp', 'Library/Application Support/Alpha/app.db', 'Alpha'),
      entry('iPhone 16', 'AlphaApp', 'Library/Application Support/Alpha/Nested/other.db', 'Alpha/Nested'),
      entry('iPhone 16', 'AlphaApp', 'Documents/notes.db', 'Documents'),
      entry('iPhone 16', 'AlphaApp', 'Library/Application Support/root.db', ''),
    ]);

    expect(groups.map((device) => device.name)).toEqual(['iPhone 15', 'iPhone 16']);

    const iphone16 = groups[1];
    expect(iphone16?.apps.map((app) => app.name)).toEqual(['AlphaApp']);

    const app = iphone16?.apps[0];
    expect(app?.folders.map((folder) => folder.name)).toEqual(['Alpha', 'Alpha/Nested', 'Documents']);
    expect(app?.folders[0]?.databases.map((database) => database.label)).toEqual(['app.db']);
    expect(app?.folders[1]?.databases.map((database) => database.label)).toEqual(['other.db']);
    expect(app?.folders[2]?.databases.map((database) => database.label)).toEqual(['notes.db']);
    expect(app?.databases.map((database) => database.label)).toEqual(['root.db']);
    expect(app?.bundleIds).toEqual(['com.example.alphaapp']);
  });
});
