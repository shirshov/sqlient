const BUNDLE_IDENTIFIER = /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*("([^"\\]|\\.)*"|[^;\n]+)\s*;/g;

export function extractBundleIdentifiers(pbxproj: string): string[] {
  const identifiers = new Set<string>();

  for (const match of pbxproj.matchAll(BUNDLE_IDENTIFIER)) {
    let value = (match[1] ?? '').trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\(.)/g, '$1');
    }
    value = value.trim();

    if (!value || value.includes('$(') || value.includes('${')) {
      continue;
    }

    if (/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value)) {
      identifiers.add(value);
    }
  }

  return [...identifiers].sort();
}
