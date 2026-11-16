import { createHash, createHmac } from 'node:crypto';

const D1_UNIQUE_KEY = 'miniflare-D1DatabaseObject';

/**
 * Computes the Durable Object id Miniflare uses as the local D1 database filename.
 *
 * Mirrors workerd's ActorIdFactoryImpl::idFromName: HMAC-SHA256 keyed with
 * SHA-256(uniqueKey) over the name, then a second HMAC over the first 16 bytes.
 */
export function databaseObjectId(databaseId: string): string {
  const key = createHash('sha256').update(D1_UNIQUE_KEY).digest();
  const first = createHmac('sha256', key).update(databaseId).digest().subarray(0, 16);
  const mac = createHmac('sha256', key).update(first).digest().subarray(0, 16);
  return Buffer.concat([first, mac]).toString('hex');
}
