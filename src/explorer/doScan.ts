import * as fs from 'node:fs';
import * as path from 'node:path';
import { withReadOnlyDatabase } from './readOnlyDatabase';
import { readWranglerConfig, type WranglerDoBinding } from './wranglerConfig';
import type { WranglerConfigInput } from './wranglerConfigFiles';
import type { DatabaseEntry } from './types';

export interface DoDiscovery {
  databases: DatabaseEntry[];
  notices: string[];
  hasConfigs: boolean;
  configured: boolean;
}

interface DoConfigInfo {
  workerName?: string;
  bindings: WranglerDoBinding[];
  classes: string[];
  configPath: string;
}

interface NamespaceMatch {
  workerName?: string;
  className: string;
  bindings: string[];
  configPath?: string;
}

interface DoCandidate {
  path: string;
  namespace: string;
  objectId: string;
  mtimeMs: number;
  size: number;
}

const MAX_OBJECTS_PER_NAMESPACE = 500;
const MAX_CACHED_NAMES = 4096;

const objectNameCache = new Map<string, { mtimeMs: number; size: number; name: string | undefined }>();

export function scanDoState(
  configs: readonly WranglerConfigInput[],
  workspaceRoots: readonly string[],
  extraPaths: readonly string[] = [],
): DoDiscovery {
  const notices: string[] = [];
  const configInfos: DoConfigInfo[] = [];

  for (const config of configs) {
    const parsed = readWranglerConfig(config.text, config.path);
    if (parsed.error) {
      notices.push(parsed.error);
    }
    if (parsed.durableObjects.length === 0 && parsed.doClasses.length === 0) {
      continue;
    }
    configInfos.push({
      workerName: parsed.workerName,
      bindings: parsed.durableObjects,
      classes: parsed.doClasses,
      configPath: config.path,
    });
  }

  const configured = configInfos.length > 0;
  const stateRoots = new Set<string>();

  for (const config of configs) {
    for (const root of doRoots(path.dirname(config.path))) {
      stateRoots.add(root);
    }
  }
  for (const workspaceRoot of workspaceRoots) {
    for (const root of doRoots(workspaceRoot)) {
      stateRoots.add(root);
    }
  }
  for (const extra of extraPaths) {
    for (const root of doRootVariants(extra)) {
      stateRoots.add(root);
    }
  }

  const candidates: DoCandidate[] = [];
  const truncatedNamespaces = new Set<string>();
  for (const stateRoot of stateRoots) {
    let namespaces: fs.Dirent[];
    try {
      namespaces = fs.readdirSync(stateRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const namespace of namespaces) {
      if (!namespace.isDirectory()) {
        continue;
      }

      const namespaceDir = path.join(stateRoot, namespace.name);
      let files: fs.Dirent[];
      try {
        files = fs.readdirSync(namespaceDir, { withFileTypes: true });
      } catch {
        continue;
      }

      let count = 0;
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.sqlite') || file.name === 'metadata.sqlite') {
          continue;
        }
        if (count >= MAX_OBJECTS_PER_NAMESPACE) {
          truncatedNamespaces.add(namespace.name);
          break;
        }

        const filePath = path.join(namespaceDir, file.name);
        try {
          const stat = fs.statSync(filePath);
          candidates.push({
            path: filePath,
            namespace: namespace.name,
            objectId: file.name.slice(0, -'.sqlite'.length),
            mtimeMs: stat.mtimeMs,
            size: stat.size,
          });
          count += 1;
        } catch {
          // Ignore files that disappear while scanning.
        }
      }
    }
  }

  const groups = new Map<string, DoCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.namespace}\u0000${candidate.objectId}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const databases: DatabaseEntry[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (left, right) =>
        right.mtimeMs - left.mtimeMs ||
        right.size - left.size ||
        left.path.localeCompare(right.path),
    );

    const best = sorted[0] as DoCandidate;
    const duplicates = sorted.slice(1).map((candidate) => candidate.path);
    const match = matchNamespace(best.namespace, configInfos, best.path);
    const objectName = readObjectName(best.path, best.mtimeMs, best.size);
    const label = objectName ?? `${best.objectId.slice(0, 8)}…`;
    const detailLines = [`file: ${best.path}`, `namespace: ${best.namespace}`, `class: ${match.className}`];

    if (match.workerName) {
      detailLines.push(`worker: ${match.workerName}`);
    }
    if (match.bindings.length > 0) {
      detailLines.push(`bindings: ${match.bindings.join(', ')}`);
    }
    detailLines.push(`object id: ${best.objectId}`);
    if (objectName) {
      detailLines.push(`object name: ${objectName}`);
    }
    if (match.configPath) {
      detailLines.push(`config: ${match.configPath}`);
    }
    if (duplicates.length > 0) {
      detailLines.push('other copies:', ...duplicates.map((duplicate) => `  ${duplicate}`));
    }

    databases.push({
      path: best.path,
      kind: 'do',
      label,
      description: objectName ? best.objectId.slice(0, 8) : undefined,
      detail: detailLines.join('\n'),
      do: {
        namespace: best.namespace,
        workerName: match.workerName,
        className: match.className,
        bindings: match.bindings,
        objectId: best.objectId,
        objectName,
      },
    });
  }

  databases.sort(
    (left, right) =>
      (left.do?.className ?? '').localeCompare(right.do?.className ?? '') ||
      (left.do?.workerName ?? '').localeCompare(right.do?.workerName ?? '') ||
      (left.do?.objectName ?? left.do?.objectId ?? left.label).localeCompare(
        right.do?.objectName ?? right.do?.objectId ?? right.label,
      ),
  );

  for (const namespace of truncatedNamespaces) {
    notices.push(
      `The namespace "${namespace}" contains more than ${MAX_OBJECTS_PER_NAMESPACE} objects; ` +
        `only the first ${MAX_OBJECTS_PER_NAMESPACE} are shown.`,
    );
  }

  if (configs.length === 0) {
    notices.push('No wrangler.jsonc or wrangler.json was found in this workspace.');
  } else if (configured) {
    if (databases.length === 0) {
      notices.push('No local Durable Object databases found. Run the Worker locally with wrangler to create them.');
    } else {
      const foundClasses = new Set(
        databases
          .map((entry) => entry.do?.className)
          .filter((name): name is string => Boolean(name)),
      );
      const missing = [...new Set(configInfos.flatMap((config) => config.classes))].filter(
        (name) => !foundClasses.has(name),
      );
      if (missing.length > 0) {
        notices.push(`No local Durable Object state found for ${missing.join(', ')}.`);
      }
    }
  }

  return { databases, notices, hasConfigs: configs.length > 0, configured };
}

function matchNamespace(
  namespace: string,
  configs: readonly DoConfigInfo[],
  databasePath: string,
): NamespaceMatch {
  const matches: Array<NamespaceMatch & { configDir: string }> = [];

  for (const config of configs) {
    const prefixes = new Set<string>();
    if (config.workerName) {
      prefixes.add(config.workerName);
    }
    for (const binding of config.bindings) {
      if (binding.scriptName) {
        prefixes.add(binding.scriptName);
      }
    }

    for (const className of config.classes) {
      for (const prefix of prefixes) {
        if (namespace !== `${prefix}-${className}`) {
          continue;
        }
        matches.push({
          workerName: prefix,
          className,
          bindings: config.bindings
            .filter((binding) => binding.className === className)
            .map((binding) => binding.binding)
            .sort(),
          configPath: config.configPath,
          configDir: path.dirname(config.configPath),
        });
      }
    }
  }

  if (matches.length > 0) {
    const chosen = matches.find((match) => isInside(match.configDir, databasePath)) ?? matches[0];
    if (chosen) {
      return {
        workerName: chosen.workerName,
        className: chosen.className,
        bindings: chosen.bindings,
        configPath: chosen.configPath,
      };
    }
  }

  const separator = namespace.lastIndexOf('-');
  if (separator > 0) {
    return {
      workerName: namespace.slice(0, separator),
      className: namespace.slice(separator + 1),
      bindings: [],
    };
  }

  return { className: namespace, bindings: [] };
}

function readObjectName(file: string, mtimeMs: number, size: number): string | undefined {
  // Re-opening every object database on each discovery pass is expensive; the name only
  // changes when the file does, so cache by modification time and size.
  const cached = objectNameCache.get(file);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    return cached.name;
  }

  const name = readObjectNameFromDisk(file);
  if (objectNameCache.size >= MAX_CACHED_NAMES) {
    objectNameCache.clear();
  }
  objectNameCache.set(file, { mtimeMs, size, name });
  return name;
}

function readObjectNameFromDisk(file: string): string | undefined {
  try {
    return withReadOnlyDatabase(file, (db) => {
      const row = db.prepare('select name from __miniflare_do_name limit 1').get() as
        | Record<string, unknown>
        | undefined;
      return typeof row?.name === 'string' && row.name.trim() ? row.name.trim() : undefined;
    });
  } catch {
    return undefined;
  }
}

function doRoots(base: string): string[] {
  return [
    path.join(base, '.wrangler', 'state', 'v3', 'do'),
    path.join(base, '.cloudflare', 'state', 'v3', 'do'),
  ];
}

function doRootVariants(base: string): string[] {
  const variants = new Set<string>([base]);
  variants.add(path.join(base, 'do'));
  variants.add(path.join(base, 'v3', 'do'));
  variants.add(path.join(base, 'state', 'v3', 'do'));
  for (const root of doRoots(base)) {
    variants.add(root);
  }
  return [...variants].filter(isDirectory);
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
