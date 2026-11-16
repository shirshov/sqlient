import * as vscode from 'vscode';
import { scanD1State, type D1Discovery } from './d1Scan';
import { scanDoState, type DoDiscovery } from './doScan';
import { discoverIos, type IosDiscovery } from './iosDiscovery';
import { configuredPersistPaths } from './persistPaths';
import { findWranglerConfigs, type WranglerConfigInput } from './wranglerConfigFiles';

export interface ExplorerDiscovery {
  d1: D1Discovery;
  do: DoDiscovery;
  ios: IosDiscovery;
}

export async function discoverDatabases(): Promise<ExplorerDiscovery> {
  const folders = vscode.workspace.workspaceFolders ?? [];

  if (folders.length === 0) {
    return {
      d1: { databases: [], notices: ['Open a folder to discover databases.'], hasConfigs: false },
      do: { databases: [], notices: [], hasConfigs: false, configured: false },
      ios: { databases: [], notices: [], hasProject: false },
    };
  }

  // One workspace scan for wrangler configuration files serves both the D1 and the
  // Durable Object sections.
  const [configs, ios] = await Promise.all([
    findWranglerConfigs(folders).catch((): WranglerConfigInput[] => []),
    discoverIosSafe(folders),
  ]);

  const roots = folders.map((folder) => folder.uri.fsPath);
  const extra = configuredPersistPaths(folders);

  return {
    d1: scanD1Safe(configs, roots, extra),
    do: scanDoSafe(configs, roots, extra),
    ios,
  };
}

function scanD1Safe(
  configs: readonly WranglerConfigInput[],
  roots: readonly string[],
  extra: readonly string[],
): D1Discovery {
  try {
    return scanD1State(configs, roots, extra);
  } catch (error) {
    return {
      databases: [],
      notices: [`Could not discover local D1 databases: ${error instanceof Error ? error.message : String(error)}`],
      hasConfigs: configs.length > 0,
    };
  }
}

function scanDoSafe(
  configs: readonly WranglerConfigInput[],
  roots: readonly string[],
  extra: readonly string[],
): DoDiscovery {
  try {
    return scanDoState(configs, roots, extra);
  } catch (error) {
    return {
      databases: [],
      notices: [`Could not discover Durable Object databases: ${error instanceof Error ? error.message : String(error)}`],
      hasConfigs: configs.length > 0,
      configured: false,
    };
  }
}

async function discoverIosSafe(folders: readonly vscode.WorkspaceFolder[]): Promise<IosDiscovery> {
  try {
    return await discoverIos(folders);
  } catch (error) {
    return {
      databases: [],
      notices: [`Could not discover iOS simulator databases: ${error instanceof Error ? error.message : String(error)}`],
      hasProject: true,
    };
  }
}
