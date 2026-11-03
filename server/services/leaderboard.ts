import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { GlobalDrop, Leaderboard, LeaderboardBoard, LeaderboardEntry, LeaderboardScope } from '../../shared/api.js';
import { db } from '../db/client.js';
import { activity, items, skins, users } from '../db/schema.js';
import { GLOBAL_DROP_TIERS, LEADERBOARD_SIZE } from '../game/economy.js';
import type { UserRow } from '../http.js';
import { catalog, skinCard } from './catalog.js';
import { findItems, itemValueExpr } from './items.js';
import { friendIds, playerRef } from './social.js';

interface Ranked {
  user: UserRow;
  metric: number;
  completeAlbums: number;
}

/**
 * Every account of the scope, best first. Value board: inventory value (market price, else recycle
 * value, the same `itemValueExpr()` as the inventory). Albums board: normal case skins collected,
 * then albums complete. Ties: the older account first. Guests are never ranked.
 */
async function rankings(board: LeaderboardBoard, scope: string[] | null): Promise<Ranked[]> {
  const accounts = await db()
    .select()
    .from(users)
    .where(and(eq(users.isGuest, false), isNull(users.deletedAt), scope ? inArray(users.id, scope) : undefined));
  if (!accounts.length) return [];
  const ids = accounts.map((u) => u.id);
  const owned = and(inArray(items.ownerId, ids), ne(items.status, 'destroyed'));
  const metric = new Map<string, number>();
  const complete = new Map<string, number>();
  if (board === 'value') {
    const rows = await db()
      .select({ ownerId: items.ownerId, value: sql<number>`COALESCE(SUM(${itemValueExpr()}), 0)`.mapWith(Number) })
      .from(items)
      .where(owned)
      .groupBy(items.ownerId);
    for (const r of rows) metric.set(r.ownerId, r.value);
  } else {
    const [rows, cat] = await Promise.all([db().selectDistinct({ ownerId: items.ownerId, skinId: items.skinId }).from(items).where(owned), catalog()]);
    const byOwner = new Map<string, Set<string>>();
    for (const r of rows) if (cat.normalSkinIds.has(r.skinId)) byOwner.set(r.ownerId, (byOwner.get(r.ownerId) ?? new Set()).add(r.skinId));
    const albums = [...cat.crates.values()].map((c) => c.entries.filter((e) => e.tier !== 'gold').map((e) => e.skin.id));
    for (const [owner, set] of byOwner) {
      metric.set(owner, set.size);
      complete.set(owner, albums.filter((skinIds) => skinIds.length > 0 && skinIds.every((id) => set.has(id))).length);
    }
  }
  return accounts
    .map((user) => ({ user, metric: metric.get(user.id) ?? 0, completeAlbums: complete.get(user.id) ?? 0 }))
    .sort((a, b) => b.metric - a.metric || b.completeAlbums - a.completeAlbums || a.user.createdAt.getTime() - b.user.createdAt.getTime() || a.user.id.localeCompare(b.user.id));
}

/** Most valuable item of each player (value board). */
async function bestItems(ownerIds: string[]) {
  if (!ownerIds.length) return new Map<string, LeaderboardEntry['best']>();
  const rows = await db()
    .selectDistinctOn([items.ownerId], { ownerId: items.ownerId, tier: items.tier, skin: skins })
    .from(items)
    .innerJoin(skins, eq(skins.id, items.skinId))
    .where(and(inArray(items.ownerId, ownerIds), ne(items.status, 'destroyed')))
    .orderBy(items.ownerId, desc(itemValueExpr()), desc(items.obtainedAt));
  return new Map(rows.map((r) => [r.ownerId, skinCard(r.skin, r.tier)]));
}

export async function leaderboard(viewer: UserRow, board: LeaderboardBoard, scope: LeaderboardScope): Promise<Leaderboard> {
  const friends = viewer.isGuest ? [] : await friendIds(viewer.id);
  const ranked = await rankings(board, scope === 'friends' ? [viewer.id, ...friends] : null);
  const youIndex = ranked.findIndex((r) => r.user.id === viewer.id);
  const shown = ranked.slice(0, LEADERBOARD_SIZE);
  const best = board === 'value' ? await bestItems([...shown, ...(youIndex >= 0 ? [ranked[youIndex]!] : [])].map((r) => r.user.id)) : new Map();
  const friendSet = new Set(friends);
  const entry = (r: Ranked, i: number): LeaderboardEntry => ({
    rank: i + 1,
    player: playerRef(r.user),
    metric: r.metric,
    best: best.get(r.user.id) ?? null,
    completeAlbums: r.completeAlbums,
    isYou: r.user.id === viewer.id,
    isFriend: friendSet.has(r.user.id),
  });
  return { board, scope, entries: shown.map(entry), you: youIndex >= 0 ? entry(ranked[youIndex]!, youIndex) : null };
}

/** Places of a player among everyone, for the profile ("#18 by inventory value · #7 by albums"). */
export async function ranksOf(userId: string): Promise<{ value: number; albums: number }> {
  const [value, albums] = await Promise.all([rankings('value', null), rankings('albums', null)]);
  return { value: value.findIndex((r) => r.user.id === userId) + 1, albums: albums.findIndex((r) => r.user.id === userId) + 1 };
}

/** The latest knife or gloves unboxed by anyone, however old (global banner). */
export async function latestDrop(): Promise<GlobalDrop | null> {
  const [row] = await db()
    .select({ activity, user: users })
    .from(activity)
    .innerJoin(items, eq(items.id, activity.itemId))
    .innerJoin(users, eq(users.id, activity.userId))
    .where(and(eq(activity.type, 'unbox'), inArray(items.tier, [...GLOBAL_DROP_TIERS]), isNull(activity.hiddenAt)))
    .orderBy(desc(activity.createdAt), desc(activity.id))
    .limit(1);
  if (!row) return null;
  const [item] = await findItems(db(), eq(items.id, row.activity.itemId));
  if (!item) return null;
  return { id: row.activity.id, player: row.user.isGuest || row.user.deletedAt ? null : playerRef(row.user), item, createdAt: row.activity.createdAt.toISOString() };
}
