import * as fs from 'node:fs';
import * as path from 'node:path';
import { databaseObjectId } from './objectId';
import { readWranglerConfig, type WranglerD1Binding } from './wranglerConfig';
import type { DatabaseEntry } from './types';

export interface D1ConfigInput {
  path: string;
  text: string;
}

export interface D1Discovery {
  databases: DatabaseEntry[];
  notices: string[];
  hasConfigs: boolean;
}

interface Candidate {
  path: string;
  mtimeMs: number;
  size: number;
}

const OBJECT_DIR_SUFFIXES = [
  path.join('v3', 'd1', 'miniflare-D1DatabaseObject'),
  path.join('d1', 'miniflare-D1DatabaseObject'),
  'miniflare-D1DatabaseObject',
];

export function scanD1State(
  configs: readonly D1ConfigInput[],
  workspaceRoots: readonly string[],
  extraPaths: readonly string[] = [],
): D1Discovery {
  const notices: string[] = [];
  const bindingsById = new Map<string, WranglerD1Binding[]>();
  const stateRoots = new Set<string>();
  let configCount = 0;

  for (const config of configs) {
    configCount += 1;
    const parsed = readWranglerConfig(config.text, config.path);
    if (parsed.error) {
      notices.push(parsed.error);
    }

    const configDir = path.dirname(config.path);
    for (const root of stateRootsForBase(configDir)) {
      stateRoots.add(root);
    }

    for (const binding of parsed.bindings) {
      const objectId = databaseObjectId(binding.databaseId);
      const list = bindingsById.get(objectId) ?? [];
      list.push(binding);
      bindingsById.set(objectId, list);
    }
  }

  for (const root of workspaceRoots) {
    for (const stateRoot of stateRootsForBase(root)) {
      stateRoots.add(stateRoot);
    }
  }

  for (const extra of extraPaths) {
    for (const stateRoot of objectDirVariants(extra)) {
      stateRoots.add(stateRoot);
    }
  }

  const groups = new Map<string, Candidate[]>();
  for (const stateRoot of stateRoots) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(stateRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.sqlite') || entry.name === 'metadata.sqlite') {
        continue;
      }

      const filePath = path.join(stateRoot, entry.name);
      try {
        const stat = fs.statSync(filePath);
        const objectId = entry.name.slice(0, -'.sqlite'.length);
        const candidates = groups.get(objectId) ?? [];
        candidates.push({ path: filePath, mtimeMs: stat.mtimeMs, size: stat.size });
        groups.set(objectId, candidates);
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  }

  const databases: DatabaseEntry[] = [];
  const matchedBindings = new Set<string>();

  for (const [objectId, candidates] of groups) {
    const sorted = [...candidates].sort((left, right) => {
      if (right.mtimeMs !== left.mtimeMs) {
        return right.mtimeMs - left.mtimeMs;
      }
      if (right.size !== left.size) {
        return right.size - left.size;
      }
      return left.path.localeCompare(right.path);
    });

    const best = sorted[0] as Candidate;
    const duplicates = sorted.slice(1).map((candidate) => candidate.path);
    const bindings = bindingsById.get(objectId) ?? [];
    const binding = chooseBinding(bindings, best.path, workspaceRoots);
    for (const item of bindings) {
      matchedBindings.add(item.databaseId);
    }

    const detailLines = [`file: ${best.path}`, `object id: ${objectId}`];
    if (binding) {
      detailLines.push(`binding: ${binding.binding}`);
      if (binding.databaseName) {
        detailLines.push(`database: ${binding.databaseName}`);
      }
      detailLines.push(`database id: ${binding.databaseId}`);
      detailLines.push(`config: ${binding.configPath}`);
      if (binding.environment) {
        detailLines.push(`environment: ${binding.environment}`);
      }
    }
    if (duplicates.length > 0) {
      detailLines.push('other copies:', ...duplicates.map((duplicate) => `  ${duplicate}`));
    }

    const description = binding
      ? configLabel(binding.configPath, workspaceRoots) +
        (binding.environment ? ` · env ${binding.environment}` : '')
      : 'unmatched local database';

    databases.push({
      path: best.path,
      kind: 'd1',
      label: binding ? `${binding.binding} · ${binding.databaseName ?? 'D1'}` : `D1 · ${objectId.slice(0, 8)}…`,
      description,
      detail: detailLines.join('\n'),
    });
  }

  databases.sort((left, right) => {
    const leftMatched = left.label.startsWith('D1 · ') ? 1 : 0;
    const rightMatched = right.label.startsWith('D1 · ') ? 1 : 0;
    if (leftMatched !== rightMatched) {
      return leftMatched - rightMatched;
    }
    return left.label.localeCompare(right.label);
  });

  if (configCount === 0) {
    notices.push('No wrangler.jsonc or wrangler.json was found in this workspace.');
  } else if (bindingsById.size === 0) {
    notices.push('No D1 databases are configured in wrangler configuration files.');
  } else {
    const missing = [...bindingsById.values()]
      .flat()
      .filter((binding) => !matchedBindings.has(binding.databaseId))
      .map((binding) => `${binding.binding} · ${binding.databaseName ?? 'D1'}`);

    if (databases.length === 0) {
      notices.push('No local D1 database files found. Run the Worker locally with wrangler to create them.');
    } else if (missing.length > 0) {
      notices.push(`No local file found for ${[...new Set(missing)].join(', ')}.`);
    }
  }

  return { databases, notices, hasConfigs: configCount > 0 };
}

function chooseBinding(
  bindings: readonly WranglerD1Binding[],
  databasePath: string,
  workspaceRoots: readonly string[],
): WranglerD1Binding | undefined {
  if (bindings.length === 0) {
    return undefined;
  }

  const ancestor = bindings.find((binding) => isInside(path.dirname(binding.configPath), databasePath));
  if (ancestor) {
    return ancestor;
  }

  const fromRoot = bindings.find((binding) =>
    workspaceRoots.some((root) => isInside(root, path.dirname(binding.configPath))),
  );
  return fromRoot ?? bindings[0];
}

function stateRootsForBase(base: string): string[] {
  return [
    path.join(base, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject'),
    path.join(base, '.cloudflare', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject'),
  ];
}

function objectDirVariants(base: string): string[] {
  const variants = new Set<string>([base]);
  for (const suffix of OBJECT_DIR_SUFFIXES) {
    variants.add(path.join(base, suffix));
  }
  for (const root of stateRootsForBase(base)) {
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

function configLabel(configPath: string, workspaceRoots: readonly string[]): string {
  const root = workspaceRoots.find((candidate) => isInside(candidate, configPath));
  if (!root) {
    return path.basename(configPath);
  }
  const relative = path.relative(root, configPath);
  return relative.split(path.sep).join('/');
}
