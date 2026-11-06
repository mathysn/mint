import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { RecycleQuote, RecycleResult } from '../../shared/api.js';
import { db, type DbOrTx } from '../db/client.js';
import { items, ledger, showcase, users } from '../db/schema.js';
import { RECYCLE_CONFIRM_TIERS, RECYCLE_MAX_ITEMS } from '../game/economy.js';
import { recycleValue } from '../game/value.js';
import { fail } from '../http.js';

export const recycleIdsSchema = z.object({
  itemIds: z.array(z.uuid()).min(1).max(RECYCLE_MAX_ITEMS),
  confirm: z.boolean().default(false),
});

type ItemRow = typeof items.$inferSelect;

async function ownedItems(tx: DbOrTx, userId: string, ids: string[], lock: boolean): Promise<ItemRow[]> {
  const query = tx
    .select()
    .from(items)
    .where(and(inArray(items.id, ids), eq(items.ownerId, userId)))
    .orderBy(items.id);
  return lock ? query.for('update') : query;
}

function summarise(ids: string[], rows: ItemRow[]) {
  const recyclable = rows.filter((r) => r.status === 'available');
  const ok = new Set(recyclable.map((r) => r.id));
  return {
    recyclable,
    unavailable: ids.filter((id) => !ok.has(id)),
    total: recyclable.reduce((sum, r) => sum + recycleValue(r), 0),
    requiresConfirmation: recyclable.some((r) => RECYCLE_CONFIRM_TIERS.includes(r.tier)),
  };
}

/** What the selection bar shows ("3 selected · ≈ 3,250 CR"): the client never adds values up itself. */
export async function quoteRecycle(userId: string, itemIds: string[]): Promise<RecycleQuote> {
  const ids = [...new Set(itemIds)];
  const s = summarise(ids, await ownedItems(db(), userId, ids, false));
  return { count: s.recyclable.length, total: s.total, requiresConfirmation: s.requiresConfirmation, unavailable: s.unavailable };
}

/**
 * Destroys the items and credits their recycle value, in one transaction:
 * player row locked, then the items. All or nothing: one item not yours or not available
 * (listed, in a trade, already destroyed) and nothing is recycled.
 */
export async function recycleItems(userId: string, itemIds: string[], confirm: boolean): Promise<RecycleResult> {
  const ids = [...new Set(itemIds)];
  return db().transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user) return fail(401, 'unauthorized', 'Sign in or start a guest session first.');
    const s = summarise(ids, await ownedItems(tx, user.id, ids, true));
    if (s.unavailable.length) return fail(409, 'items_unavailable', 'Some of these items are no longer available (listed, in a trade or gone).');
    if (s.requiresConfirmation && !confirm) return fail(409, 'confirmation_required', 'Recycling Classified or better needs a confirmation.');

    const now = new Date();
    await tx
      .update(items)
      .set({ status: 'destroyed', destroyedAt: now })
      .where(and(inArray(items.id, ids), ne(items.status, 'destroyed')));

    let balance = user.balance;
    const entries = s.recyclable.map((item) => {
      const amount = recycleValue(item);
      balance += amount;
      return { userId: user.id, type: 'recycle' as const, amount, balanceAfter: balance, itemId: item.id, crateId: item.sourceCrateId };
    });
    await tx.insert(ledger).values(entries);
    // A destroyed item leaves the showcase (positions keep their gaps; the profile shows the rest in order).
    await tx.delete(showcase).where(inArray(showcase.itemId, ids));
    await tx.update(users).set({ balance }).where(eq(users.id, user.id));
    return { count: entries.length, credited: s.total, balance };
  });
}
