import { and, asc, count, countDistinct, desc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm';
import type { FeedEntry, Item, Profile } from '../../shared/api.js';
import { db } from '../db/client.js';
import { activity, caseOpenings, items, showcase, trades, users } from '../db/schema.js';
import { fail } from '../http.js';
import { utcDateTime } from '../format.js';
import { listAlbums } from './albums.js';
import { ranksOf } from './leaderboard.js';
import { findItems, selectItems, toItem } from './items.js';
import { friendIds, friendshipBetween, playerRef, playerStats, relationFrom } from './social.js';

export const SHOWCASE_SIZE = 5;

export async function showcaseOf(userId: string): Promise<Item[]> {
  const rows = await selectItems(db())
    .innerJoin(showcase, eq(showcase.itemId, items.id))
    .where(eq(showcase.userId, userId))
    .orderBy(asc(showcase.position));
  return rows.map(toItem);
}

/**
 * Replaces the whole showcase (1 to 5 items, in order; position 1 is the main item).
 * Only your own items that still exist; recycling one removes it (services/recycle.ts).
 */
export async function setShowcase(userId: string, itemIds: string[]): Promise<Item[]> {
  const ids = [...new Set(itemIds)];
  if (ids.length > SHOWCASE_SIZE) fail(400, 'bad_request', `A showcase holds ${SHOWCASE_SIZE} items.`);
  await db().transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    if (ids.length) {
      const [mine] = await tx
        .select({ n: count() })
        .from(items)
        .where(and(inArray(items.id, ids), eq(items.ownerId, userId), ne(items.status, 'destroyed')));
      if ((mine?.n ?? 0) !== ids.length) fail(409, 'items_unavailable', 'Only your own items can go in your showcase.');
      // Staff took it out of a showcase: it stays out for 24 h.
      const [blocked] = await tx
        .select({ until: items.showcaseBlockedUntil })
        .from(items)
        .where(and(inArray(items.id, ids), gt(items.showcaseBlockedUntil, sql`now()`)))
        .limit(1);
      if (blocked?.until) fail(409, 'items_unavailable', `This item can’t go back in a showcase until ${utcDateTime(blocked.until)} UTC.`);
    }
    await tx.delete(showcase).where(eq(showcase.userId, userId));
    if (ids.length) await tx.insert(showcase).values(ids.map((itemId, i) => ({ userId, itemId, position: i + 1 })));
  });
  return showcaseOf(userId);
}

/** Public profile: showcase, stats and best albums for everyone; inventory and album details for friends. */
export async function profileOf(viewerId: string | null, username: string): Promise<Profile | null> {
  const [user] = await db().select().from(users).where(and(eq(users.username, username), eq(users.isGuest, false)));
  if (!user) return null;
  const link = viewerId && viewerId !== user.id ? await friendshipBetween(db(), viewerId, user.id) : undefined;
  const relation = viewerId === user.id ? 'self' : viewerId ? relationFrom(link, viewerId) : 'none';

  const owned = and(eq(items.ownerId, user.id), ne(items.status, 'destroyed'));
  const [shown, stats, [opened], [skins], [traded], albums, ranks] = await Promise.all([
    showcaseOf(user.id),
    playerStats([user.id]),
    db().select({ n: count() }).from(caseOpenings).where(eq(caseOpenings.userId, user.id)),
    db().select({ n: countDistinct(items.skinId) }).from(items).where(owned),
    db()
      .select({ n: count() })
      .from(trades)
      .where(and(eq(trades.status, 'accepted'), or(eq(trades.senderId, user.id), eq(trades.recipientId, user.id)))),
    listAlbums(user.id),
    ranksOf(user.id),
  ]);
  const s = stats.get(user.id)!;
  return {
    player: playerRef(user),
    relation,
    joinedAt: user.createdAt.toISOString(),
    friendsSince: relation === 'friend' ? (link?.acceptedAt ?? link?.createdAt ?? null)?.toISOString() ?? null : null,
    showcase: shown,
    stats: { casesOpened: opened?.n ?? 0, inventoryValue: s.inventoryValue, tradesCompleted: traded?.n ?? 0, skinsCollected: skins?.n ?? 0, albumsPct: s.albumsPct },
    albums: albums.filter((a) => a.owned > 0).slice(0, 6),
    canViewCollection: relation === 'self' || relation === 'friend',
    ranks,
  };
}

/** Friends' activity: their unboxings from Classified, newest first (items stay listed after a recycle). */
export async function friendsFeed(viewerId: string, limit = 20): Promise<FeedEntry[]> {
  const ids = await friendIds(viewerId);
  if (!ids.length) return [];
  const entries = await db()
    .select({ activity, user: users })
    .from(activity)
    .innerJoin(users, eq(users.id, activity.userId))
    .where(inArray(activity.userId, ids))
    .orderBy(desc(activity.createdAt), desc(activity.id))
    .limit(limit);
  if (!entries.length) return [];
  const found = await findItems(db(), inArray(items.id, entries.map((e) => e.activity.itemId)));
  const byId = new Map(found.map((i) => [i.id, i]));
  return entries
    .filter((e) => byId.has(e.activity.itemId))
    .map((e) => ({
      id: e.activity.id,
      type: e.activity.type,
      player: playerRef(e.user),
      item: byId.get(e.activity.itemId)!,
      price: e.activity.price,
      createdAt: e.activity.createdAt.toISOString(),
    }));
}
