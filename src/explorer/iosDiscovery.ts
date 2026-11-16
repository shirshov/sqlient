import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  findSqliteFiles,
  parseBootedDevices,
  parseListapps,
  type BootedDevice,
  type SimulatorApp,
} from './iosScan';
import { extractBundleIdentifiers } from './pbxproj';
import { iosFileName, iosGrouping } from './iosLayout';
import { runProcess } from './process';
import type { DatabaseEntry } from './types';

export type { BootedDevice, SimulatorApp } from './iosScan';

export interface IosDiscovery {
  databases: DatabaseEntry[];
  notices: string[];
  hasProject: boolean;
}

export async function discoverIos(folders: readonly vscode.WorkspaceFolder[]): Promise<IosDiscovery> {
  const pbxprojFiles = await findPbxprojFiles(folders);
  if (pbxprojFiles.length === 0) {
    return { databases: [], notices: [], hasProject: false };
  }

  const bundleIds = new Set<string>();
  for (const file of pbxprojFiles) {
    try {
      for (const identifier of extractBundleIdentifiers(await fs.promises.readFile(file, 'utf8'))) {
        bundleIds.add(identifier);
      }
    } catch {
      // Ignore unreadable project files.
    }
  }

  const notices: string[] = [];
  const wanted = [...bundleIds].sort();

  if (wanted.length === 0) {
    notices.push(
      'No literal PRODUCT_BUNDLE_IDENTIFIER was found in project.pbxproj. Bundle identifiers that use build-setting variables are ignored.',
    );
    return { databases: [], notices, hasProject: true };
  }

  if (process.platform !== 'darwin') {
    notices.push('iOS simulator discovery is available on macOS only.');
    return { databases: [], notices, hasProject: true };
  }

  const devices = await bootedIosDevices(notices);
  if (devices.length === 0) {
    notices.push('No booted iOS simulator found. Boot a simulator and run the app.');
    return { databases: [], notices, hasProject: true };
  }

  const wantedSet = new Set(wanted);
  const matchedApps: Array<{ device: BootedDevice; app: SimulatorApp }> = [];

  for (const device of devices) {
    try {
      const plist = await runProcess('/usr/bin/xcrun', ['simctl', 'listapps', device.udid], { timeoutMs: 20000 });
      const json = await runProcess('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], {
        input: plist,
        timeoutMs: 10000,
      });
      for (const app of parseListapps(JSON.parse(json))) {
        if (wantedSet.has(app.bundleId)) {
          matchedApps.push({ device, app });
        }
      }
    } catch (error) {
      notices.push(`${device.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (matchedApps.length === 0) {
    notices.push(`The app is not installed on a booted simulator (looking for ${wanted.join(', ')}).`);
    return { databases: [], notices, hasProject: true };
  }

  const databases: DatabaseEntry[] = [];
  const seen = new Set<string>();

  for (const { device, app } of matchedApps) {
    const containers: Array<{ label: string; path: string }> = [];
    if (app.dataPath) {
      containers.push({ label: 'app data', path: app.dataPath });
    }
    for (const group of app.groupContainers) {
      containers.push({ label: group.id, path: group.path });
    }

    for (const container of containers) {
      let scan: Awaited<ReturnType<typeof findSqliteFiles>>;
      try {
        scan = await findSqliteFiles(container.path);
      } catch (error) {
        notices.push(`${app.displayName}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      if (scan.truncated) {
        notices.push(
          `${app.displayName}: the "${container.label}" container holds many files; ` +
            'only the first databases found are listed.',
        );
      }

      for (const file of scan.files) {
        let realPath = file;
        try {
          realPath = await fs.promises.realpath(file);
        } catch {
          // Use the original path when realpath fails.
        }
        if (seen.has(realPath)) {
          continue;
        }
        seen.add(realPath);

        const relativePath = path.relative(container.path, file).split(path.sep).join('/');
        const grouping = iosGrouping(relativePath, container.label);
        databases.push({
          path: file,
          kind: 'ios',
          label: iosFileName(relativePath),
          description: grouping.location,
          detail: [
            `file: ${file}`,
            `app: ${app.displayName} (${app.bundleId})`,
            `simulator: ${device.name} (${device.udid})`,
            `container: ${container.label}`,
            `path: ${relativePath}`,
          ].join('\n'),
          ios: {
            deviceName: device.name,
            appName: app.displayName,
            appBundleId: app.bundleId,
            containerLabel: container.label,
            relativePath,
            folder: grouping.folder,
          },
        });
      }
    }
  }

  databases.sort(
    (left, right) =>
      (left.ios?.deviceName ?? '').localeCompare(right.ios?.deviceName ?? '') ||
      (left.ios?.appName ?? '').localeCompare(right.ios?.appName ?? '') ||
      (left.ios?.relativePath ?? left.label).localeCompare(right.ios?.relativePath ?? right.label),
  );

  if (databases.length === 0) {
    notices.push('No SQLite database files were found in the app containers.');
  }

  return { databases, notices, hasProject: true };
}

async function bootedIosDevices(notices: string[]): Promise<BootedDevice[]> {
  try {
    const json = await runProcess('/usr/bin/xcrun', ['simctl', 'list', 'devices', '--json'], { timeoutMs: 15000 });
    return parseBootedDevices(JSON.parse(json));
  } catch (error) {
    notices.push(`Could not query iOS simulators: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function findPbxprojFiles(folders: readonly vscode.WorkspaceFolder[]): Promise<string[]> {
  const files = new Set<string>();

  for (const folder of folders) {
    try {
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, '**/*.xcodeproj/project.pbxproj'),
        '**/{node_modules,dist,build,DerivedData,.git,.tmp}/**',
        50,
      );
      for (const uri of found) {
        files.add(uri.fsPath);
      }
    } catch {
      // Ignore folders that cannot be scanned.
    }
  }

  return [...files];
}
