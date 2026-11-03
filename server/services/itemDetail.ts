import { and, eq, ne } from 'drizzle-orm';
import type { ItemDetail } from '../../shared/api.js';
import { db } from '../db/client.js';
import { collections, items, showcase, users } from '../db/schema.js';
import { econ } from '../game/economy.js';
import { wearMultiplier } from '../game/value.js';
import { wearOf } from '../game/wear.js';
import type { UserRow } from '../http.js';
import { selectItems, toItem } from './items.js';
import { openListingOf, salesHistory } from './market.js';
import { areFriends } from './social.js';

/**
 * Item page. Visible to its owner, to the owner's friends, and to everyone when it is in the
 * owner's showcase ("visible to every player"). Destroyed items are gone.
 */
export async function itemDetail(viewer: UserRow | null, itemId: string): Promise<ItemDetail | null> {
  const viewerId = viewer?.id ?? null;
  const [row] = await selectItems(db()).where(and(eq(items.id, itemId), ne(items.status, 'destroyed')));
  if (!row) return null;
  const ownerId = row.item.ownerId;
  const isYou = viewerId === ownerId;
  const [shown] = await db().select({ position: showcase.position }).from(showcase).where(eq(showcase.itemId, itemId));
  if (!isYou && !shown && !(viewerId && (await areFriends(viewerId, ownerId)))) return null;

  const [collection] = row.skin.collectionId
    ? await db().select({ id: collections.id, name: collections.name }).from(collections).where(eq(collections.id, row.skin.collectionId))
    : [];
  const person = (id: string) =>
    db().select({ id: users.id, username: users.username, displayName: users.displayName }).from(users).where(eq(users.id, id)).then((r) => r[0]);
  const owner = await person(ownerId);
  const original = row.item.originalOwnerId ? (row.item.originalOwnerId === ownerId ? owner : await person(row.item.originalOwnerId)) : undefined;
  const wear = wearOf(row.item.float);
  const [listing, sales] = await Promise.all([
    row.item.status === 'listed' ? openListingOf(itemId) : null,
    salesHistory(row.skin.id, row.item.stattrak, wear?.code ?? null, 'window'),
  ]);

  return {
    ...toItem(row),
    serial: row.item.serial,
    collection: collection ?? null,
    source: row.item.source,
    originalOwner: original ? { name: original.displayName ?? original.username ?? 'Guest', isYou: original.id === viewerId } : null,
    owner: { username: owner?.username ?? null, isYou },
    canRecycle: isYou && row.item.status === 'available',
    canList: isYou && !viewer!.isGuest && row.item.status === 'available',
    listing,
    sales,
    inShowcase: Boolean(shown),
    acquiredVia: row.item.acquiredVia,
    recycleBreakdown: {
      base: econ().recycle[row.item.tier],
      stattrakMultiplier: row.item.stattrak ? econ().stattrakMultiplier : null,
      wear: wear ? { code: wear.code, multiplier: wearMultiplier(row.item.float) } : null,
    },
  };
}
