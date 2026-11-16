import { describe, expect, it } from 'vitest';
import { databaseObjectId } from '../../src/explorer/objectId';

describe('databaseObjectId', () => {
  it('matches the local D1 file names created by wrangler', () => {
    expect(databaseObjectId('67d7e0aa-aefb-40e2-895f-51fe16585e01')).toBe(
      'b882100a3f1bb53c613ff7d9cc3515734d0725535dfb7325966f51cafc2bc085',
    );
    expect(databaseObjectId('e6d46615-a4af-4c37-8f2a-73ade40ed892')).toBe(
      '3d990cb284d9b7280af4a9daf88515b7126fa5ddf4486076c643f13b188b46f4',
    );
  });
});
