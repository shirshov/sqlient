export interface WranglerD1Binding {
  binding: string;
  databaseName?: string;
  databaseId: string;
  environment?: string;
  configPath: string;
}

export interface WranglerDoBinding {
  binding: string;
  className: string;
  scriptName?: string;
  environment?: string;
  configPath: string;
}

export interface WranglerConfigInfo {
  workerName?: string;
  bindings: WranglerD1Binding[];
  durableObjects: WranglerDoBinding[];
  doClasses: string[];
  error?: string;
}

export function readWranglerConfig(text: string, configPath: string): WranglerConfigInfo {
  let root: unknown;
  try {
    root = parseJsonc(text);
  } catch (error) {
    return {
      bindings: [],
      durableObjects: [],
      doClasses: [],
      error: `${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!isRecord(root)) {
    return {
      bindings: [],
      durableObjects: [],
      doClasses: [],
      error: `${configPath}: expected a JSON object`,
    };
  }

  const bindings: WranglerD1Binding[] = [];
  const durableObjects: WranglerDoBinding[] = [];
  const doClasses = new Set<string>();
  collectBindings(root, configPath, undefined, bindings);
  collectDurableObjects(root, configPath, undefined, durableObjects, doClasses);

  const environments = root.env;
  if (isRecord(environments)) {
    for (const [name, scope] of Object.entries(environments)) {
      if (isRecord(scope)) {
        collectBindings(scope, configPath, name, bindings);
        collectDurableObjects(scope, configPath, name, durableObjects, doClasses);
      }
    }
  }

  return {
    workerName: typeof root.name === 'string' ? root.name : undefined,
    bindings,
    durableObjects,
    doClasses: [...doClasses].sort(),
  };
}

export function parseJsonc(text: string): unknown {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON.parse(stripTrailingCommas(stripComments(withoutBom)));
}

export function stripComments(input: string): string {
  let output = '';
  let index = 0;
  let inString = false;

  while (index < input.length) {
    const char = input[index] as string;
    const next = input[index + 1];

    if (inString) {
      output += char;
      if (char === '\\') {
        output += next ?? '';
        index += 2;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < input.length && input[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

export function stripTrailingCommas(input: string): string {
  let output = '';
  let inString = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] as string;

    if (inString) {
      output += char;
      if (char === '\\') {
        output += input[index + 1] ?? '';
        index += 1;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === ',') {
      let lookahead = index + 1;
      while (lookahead < input.length && /\s/.test(input[lookahead] as string)) {
        lookahead += 1;
      }
      if (input[lookahead] === '}' || input[lookahead] === ']') {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function collectBindings(
  scope: Record<string, unknown>,
  configPath: string,
  environment: string | undefined,
  bindings: WranglerD1Binding[],
): void {
  const databases = scope.d1_databases;
  if (!Array.isArray(databases)) {
    return;
  }

  for (const entry of databases) {
    if (!isRecord(entry) || typeof entry.database_id !== 'string' || !entry.database_id.trim()) {
      continue;
    }

    const binding =
      typeof entry.binding === 'string' && entry.binding.trim()
        ? entry.binding.trim()
        : typeof entry.database_name === 'string' && entry.database_name.trim()
          ? entry.database_name.trim()
          : 'DB';

    bindings.push({
      binding,
      databaseName: typeof entry.database_name === 'string' ? entry.database_name : undefined,
      databaseId: entry.database_id.trim(),
      environment,
      configPath,
    });
  }
}

function collectDurableObjects(
  scope: Record<string, unknown>,
  configPath: string,
  environment: string | undefined,
  durableObjects: WranglerDoBinding[],
  doClasses: Set<string>,
): void {
  const durable = scope.durable_objects;
  if (isRecord(durable) && Array.isArray(durable.bindings)) {
    for (const entry of durable.bindings) {
      if (!isRecord(entry) || typeof entry.class_name !== 'string' || !entry.class_name.trim()) {
        continue;
      }

      const className = entry.class_name.trim();
      doClasses.add(className);
      durableObjects.push({
        binding: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : className,
        className,
        scriptName:
          typeof entry.script_name === 'string' && entry.script_name.trim() ? entry.script_name.trim() : undefined,
        environment,
        configPath,
      });
    }
  }

  const migrations = scope.migrations;
  if (Array.isArray(migrations)) {
    for (const migration of migrations) {
      if (!isRecord(migration)) {
        continue;
      }

      collectClasses(migration.new_sqlite_classes, doClasses);
      collectClasses(migration.new_classes, doClasses);

      const renamed = migration.renamed_classes;
      if (Array.isArray(renamed)) {
        for (const item of renamed) {
          if (isRecord(item) && typeof item.to === 'string' && item.to.trim()) {
            doClasses.add(item.to.trim());
          }
        }
      }
    }
  }
}

function collectClasses(value: unknown, classes: Set<string>): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      classes.add(item.trim());
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
