export const APPLICATION_SUPPORT = 'Library/Application Support';

export interface IosGrouping {
  folder: string;
  location: string;
}

/**
 * Splits a container-relative database path into the folder used for grouping and the
 * location shown as muted text on the database node.
 */
export function iosGrouping(relativePath: string, containerLabel: string): IosGrouping {
  const directory = directoryOf(relativePath);

  if (directory === APPLICATION_SUPPORT) {
    return { folder: '', location: APPLICATION_SUPPORT };
  }

  if (directory.startsWith(`${APPLICATION_SUPPORT}/`)) {
    return { folder: directory.slice(APPLICATION_SUPPORT.length + 1), location: APPLICATION_SUPPORT };
  }

  if (!directory) {
    return { folder: '', location: containerLabel };
  }

  return { folder: directory, location: directory };
}

export function iosFileName(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf('/') + 1);
}

function directoryOf(relativePath: string): string {
  const index = relativePath.lastIndexOf('/');
  return index === -1 ? '' : relativePath.slice(0, index);
}
