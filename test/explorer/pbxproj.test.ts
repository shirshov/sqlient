import { describe, expect, it } from 'vitest';
import { extractBundleIdentifiers } from '../../src/explorer/pbxproj';

const pbxproj = `
  PRODUCT_BUNDLE_IDENTIFIER = com.example.app;
  PRODUCT_BUNDLE_IDENTIFIER = "com.example.app.dev";
  PRODUCT_BUNDLE_IDENTIFIER = "$(PRODUCT_NAME:rfc1034identifier)";
  PRODUCT_BUNDLE_IDENTIFIER = com.example.$(SUFFIX);
  PRODUCT_BUNDLE_IDENTIFIER = com.example.app;
`;

describe('extractBundleIdentifiers', () => {
  it('collects literal identifiers and ignores build-setting variables', () => {
    expect(extractBundleIdentifiers(pbxproj)).toEqual(['com.example.app', 'com.example.app.dev']);
  });

  it('returns an empty list when no identifier is present', () => {
    expect(extractBundleIdentifiers('OTHER_SETTING = 1;')).toEqual([]);
  });
});
