import { asc, inArray } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { users } from '../db/schema.js';
import type { UserRow } from '../http.js';

/**
 * Locks players always in id order, after the trade or auction row and before items:
 * trade/auction → users → items everywhere, so two operations never wait on each other in a loop.
 */
export async function lockUsers(tx: Tx, userIds: string[]): Promise<Map<string, UserRow>> {
  const unique = [...new Set(userIds)];
  const rows = await tx.select().from(users).where(inArray(users.id, unique)).orderBy(asc(users.id)).for('update');
  return new Map(rows.map((u) => [u.id, u]));
}
