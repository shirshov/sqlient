import { describe, expect, it } from 'vitest';
import { iosFileName, iosGrouping } from '../../src/explorer/iosLayout';

describe('iosGrouping', () => {
  it('groups Application Support databases by their subfolders', () => {
    expect(iosGrouping('Library/Application Support/com.acme.app/app.sqlite', 'app data')).toEqual({
      folder: 'com.acme.app',
      location: 'Library/Application Support',
    });

    expect(iosGrouping('Library/Application Support/com.acme.app/data/app.sqlite', 'app data')).toEqual({
      folder: 'com.acme.app/data',
      location: 'Library/Application Support',
    });
  });

  it('keeps databases directly in Application Support at the app level', () => {
    expect(iosGrouping('Library/Application Support/app.sqlite', 'app data')).toEqual({
      folder: '',
      location: 'Library/Application Support',
    });
  });

  it('uses the containing folder elsewhere', () => {
    expect(iosGrouping('Documents/app.db', 'app data')).toEqual({ folder: 'Documents', location: 'Documents' });
    expect(iosGrouping('Library/Preferences/prefs.db', 'app data')).toEqual({
      folder: 'Library/Preferences',
      location: 'Library/Preferences',
    });
  });

  it('uses the container label for files at the container root', () => {
    expect(iosGrouping('app.sqlite', 'app data')).toEqual({ folder: '', location: 'app data' });
    expect(iosGrouping('app.sqlite', 'group.com.acme')).toEqual({ folder: '', location: 'group.com.acme' });
  });
});

describe('iosFileName', () => {
  it('returns the last path segment', () => {
    expect(iosFileName('Library/Application Support/com.acme.app/app.sqlite')).toBe('app.sqlite');
    expect(iosFileName('app.sqlite')).toBe('app.sqlite');
  });
});
