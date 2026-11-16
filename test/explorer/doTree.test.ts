import { describe, expect, it } from 'vitest';
import { groupDoDatabases } from '../../src/explorer/doTree';
import type { DatabaseEntry } from '../../src/explorer/types';

function entry(namespace: string, className: string, objectId: string, objectName?: string): DatabaseEntry {
  return {
    path: `/tmp/${objectId}.sqlite`,
    kind: 'do',
    label: objectName ?? objectId.slice(0, 8),
    detail: '',
    do: {
      namespace,
      workerName: 'worker',
      className,
      bindings: ['BIND'],
      objectId,
      objectName,
    },
  };
}

describe('groupDoDatabases', () => {
  it('groups by namespace and sorts objects by name', () => {
    const groups = groupDoDatabases([
      entry('worker-Beta', 'Beta', 'bbbb', 'B2'),
      entry('worker-Alpha', 'Alpha', 'aaaa', 'A2'),
      entry('worker-Alpha', 'Alpha', 'cccc', 'A1'),
    ]);

    expect(groups.map((group) => group.namespace)).toEqual(['worker-Alpha', 'worker-Beta']);
    expect(groups[0]?.className).toBe('Alpha');
    expect(groups[0]?.workerName).toBe('worker');
    expect(groups[0]?.bindings).toEqual(['BIND']);
    expect(groups[0]?.databases.map((database) => database.label)).toEqual(['A1', 'A2']);
    expect(groups[1]?.databases.map((database) => database.label)).toEqual(['B2']);
  });

  it('ignores entries without Durable Object metadata', () => {
    expect(
      groupDoDatabases([
        {
          path: '/tmp/db.sqlite',
          kind: 'd1',
          label: 'db',
          detail: '',
        },
      ]),
    ).toEqual([]);
  });
});
