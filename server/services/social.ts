import { and, count, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import type { FriendCard, FriendsOverview, PlayerCard, PlayerRef, PlayerStats, Relation, Tier } from '../../shared/api.js';
import { db, type DbOrTx } from '../db/client.js';
import { friendships, items, showcase, users } from '../db/schema.js';
import { fail, type UserRow } from '../http.js';
import { avatarUrl } from './accounts.js';
import { catalog } from './catalog.js';
import { itemValueExpr } from './items.js';

export const MAX_FRIENDS = 200;
export const MAX_PENDING_SENT = 50;

type FriendshipRow = typeof friendships.$inferSelect;

/** Rows are stored once per pair, smallest uuid first. */
export const pairOf = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

const pairWhere = (a: string, b: string) => {
  const [low, high] = pairOf(a, b);
  return and(eq(friendships.userLow, low), eq(friendships.userHigh, high));
};

const involving = (userId: string) => or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId));
const otherOf = (row: FriendshipRow, me: string) => (row.userLow === me ? row.userHigh : row.userLow);

export function relationFrom(row: FriendshipRow | undefined, me: string): Relation {
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friend';
  return row.requesterId === me ? 'outgoing' : 'incoming';
}

export async function friendshipBetween(tx: DbOrTx, a: string, b: string): Promise<FriendshipRow | undefined> {
  const [row] = await tx.select().from(friendships).where(pairWhere(a, b));
  return row;
}

export async function relationBetween(viewerId: string | null, ownerId: string): Promise<Relation> {
  if (!viewerId) return 'none';
  if (viewerId === ownerId) return 'self';
  return relationFrom(await friendshipBetween(db(), viewerId, ownerId), viewerId);
}

export const areFriends = async (a: string, b: string) => (await relationBetween(a, b)) === 'friend';

export const playerRef = (u: Pick<UserRow, 'id' | 'username' | 'displayName' | 'discordId' | 'avatarHash'>): PlayerRef => ({
  id: u.id,
  username: u.username ?? 'Guest',
  displayName: u.displayName,
  avatarUrl: avatarUrl(u),
});

/** Inventory value and album percentage of several players at once. */
export async function playerStats(userIds: string[]): Promise<Map<string, PlayerStats>> {
  const result = new Map<string, PlayerStats>(userIds.map((id) => [id, { inventoryValue: 0, albumsPct: 0 }]));
  if (!userIds.length) return result;
  const owned = and(inArray(items.ownerId, userIds), ne(items.status, 'destroyed'));
  const [values, skins, cat] = await Promise.all([
    db().select({ ownerId: items.ownerId, value: sql<number>`COALESCE(SUM(${itemValueExpr()}), 0)`.mapWith(Number) }).from(items).where(owned).groupBy(items.ownerId),
    db().selectDistinct({ ownerId: items.ownerId, skinId: items.skinId }).from(items).where(owned),
    catalog(),
  ]);
  for (const v of values) result.get(v.ownerId)!.inventoryValue = v.value;
  const collected = new Map<string, number>();
  for (const s of skins) if (cat.normalSkinIds.has(s.skinId)) collected.set(s.ownerId, (collected.get(s.ownerId) ?? 0) + 1);
  for (const [id, n] of collected) result.get(id)!.albumsPct = Math.round((n / Math.max(1, cat.normalSkinIds.size)) * 100);
  return result;
}

async function cards(ids: string[], relationOf: (id: string) => Relation): Promise<PlayerCard[]> {
  if (!ids.length) return [];
  const [rows, stats] = await Promise.all([db().select().from(users).where(inArray(users.id, ids)), playerStats(ids)]);
  const byId = new Map(rows.map((u) => [u.id, u]));
  return ids.filter((id) => byId.has(id)).map((id) => ({ ...playerRef(byId.get(id)!), stats: stats.get(id)!, relation: relationOf(id) }));
}

/** "Add a friend": accounts whose name contains the query (prefix matches first), never guests or yourself. */
export async function searchPlayers(me: string, query: string): Promise<PlayerCard[]> {
  const q = query.trim().replace(/[\\%_]/g, (m) => `\\${m}`);
  if (q.length < 2) return [];
  const rows = await db()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isGuest, false), ne(users.id, me), ilike(users.username, `%${q}%`)))
    .orderBy(sql`${users.username} ILIKE ${`${q}%`} DESC`, users.username)
    .limit(10);
  const ids = rows.map((r) => r.id);
  const links = ids.length ? await db().select().from(friendships).where(and(involving(me), or(inArray(friendships.userLow, ids), inArray(friendships.userHigh, ids)))) : [];
  const byOther = new Map(links.map((l) => [otherOf(l, me), l]));
  return cards(ids, (id) => relationFrom(byOther.get(id), me));
}

export async function friendsOverview(me: string): Promise<FriendsOverview> {
  const rows = await db().select().from(friendships).where(involving(me)).orderBy(desc(friendships.acceptedAt), desc(friendships.createdAt));
  const friendRows = rows.filter((r) => r.status === 'accepted');
  const incomingIds = rows.filter((r) => r.status === 'pending' && r.requesterId !== me).map((r) => otherOf(r, me));
  const outgoingIds = rows.filter((r) => r.status === 'pending' && r.requesterId === me).map((r) => otherOf(r, me));
  const friendIds = friendRows.map((r) => otherOf(r, me));

  const [friendCards, incoming, outgoing, showcaseRows] = await Promise.all([
    cards(friendIds, () => 'friend'),
    cards(incomingIds, () => 'incoming'),
    cards(outgoingIds, () => 'outgoing'),
    friendIds.length
      ? db().select({ userId: showcase.userId, position: showcase.position, tier: items.tier }).from(showcase).innerJoin(items, eq(items.id, showcase.itemId)).where(inArray(showcase.userId, friendIds))
      : Promise.resolve([]),
  ]);
  const since = new Map(friendRows.map((r) => [otherOf(r, me), r.acceptedAt ?? r.createdAt]));
  const tiers = new Map<string, { position: number; tier: Tier }[]>();
  for (const s of showcaseRows) tiers.set(s.userId, [...(tiers.get(s.userId) ?? []), { position: s.position, tier: s.tier }]);

  const friends: FriendCard[] = friendCards.map((c) => ({
    ...c,
    since: since.get(c.id)!.toISOString(),
    showcase: (tiers.get(c.id) ?? []).sort((a, b) => a.position - b.position).map((s) => s.tier),
  }));
  return { friends, incoming, outgoing };
}

async function friendCount(tx: DbOrTx, userId: string) {
  const [row] = await tx.select({ n: count() }).from(friendships).where(and(involving(userId), eq(friendships.status, 'accepted')));
  return row?.n ?? 0;
}

/**
 * Sends a request by player name. If the other player already asked you, it becomes a friendship
 * (both asked each other). Guests cannot be found nor asked.
 */
export async function sendRequest(me: UserRow, username: string): Promise<Relation> {
  const [target] = await db().select().from(users).where(and(eq(users.username, username), eq(users.isGuest, false)));
  if (!target) return fail(404, 'not_found', `No player called “${username}”.`);
  if (target.id === me.id) return fail(403, 'forbidden', 'You can’t add yourself as a friend.');
  return db().transaction(async (tx) => {
    // Lock both players so two simultaneous requests are decided one after the other.
    await tx.select({ id: users.id }).from(users).where(inArray(users.id, pairOf(me.id, target.id))).orderBy(users.id).for('update');
    const existing = await friendshipBetween(tx, me.id, target.id);
    const relation = relationFrom(existing, me.id);
    if (relation === 'friend' || relation === 'outgoing') return relation;
    if (relation === 'incoming') return acceptIn(tx, me.id, target.id);

    const [sent] = await tx.select({ n: count() }).from(friendships).where(and(eq(friendships.requesterId, me.id), eq(friendships.status, 'pending')));
    if ((sent?.n ?? 0) >= MAX_PENDING_SENT) fail(409, 'limit_reached', `You already have ${MAX_PENDING_SENT} requests waiting.`);
    if ((await friendCount(tx, me.id)) >= MAX_FRIENDS) fail(409, 'limit_reached', `You can have up to ${MAX_FRIENDS} friends.`);
    const [low, high] = pairOf(me.id, target.id);
    await tx.insert(friendships).values({ userLow: low, userHigh: high, requesterId: me.id });
    return 'outgoing';
  });
}

async function acceptIn(tx: DbOrTx, me: string, other: string): Promise<Relation> {
  if ((await friendCount(tx, me)) >= MAX_FRIENDS) fail(409, 'limit_reached', `You can have up to ${MAX_FRIENDS} friends.`);
  if ((await friendCount(tx, other)) >= MAX_FRIENDS) fail(409, 'limit_reached', `This player already has ${MAX_FRIENDS} friends.`);
  const updated = await tx
    .update(friendships)
    .set({ status: 'accepted', acceptedAt: new Date() })
    .where(and(pairWhere(me, other), eq(friendships.status, 'pending'), eq(friendships.requesterId, other)))
    .returning();
  if (!updated.length) fail(404, 'not_found', 'This request no longer exists.');
  return 'friend';
}

export const acceptRequest = (me: string, other: string) =>
  db().transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(inArray(users.id, pairOf(me, other))).orderBy(users.id).for('update');
    return acceptIn(tx, me, other);
  });

/** Decline a request you received, or cancel one you sent. */
export async function dropRequest(me: string, other: string) {
  const deleted = await db().delete(friendships).where(and(pairWhere(me, other), eq(friendships.status, 'pending'))).returning();
  if (!deleted.length) fail(404, 'not_found', 'This request no longer exists.');
}

export async function removeFriend(me: string, other: string) {
  const deleted = await db().delete(friendships).where(and(pairWhere(me, other), eq(friendships.status, 'accepted'))).returning();
  if (!deleted.length) fail(404, 'not_found', 'You’re not friends with this player.');
}

export async function friendIds(me: string): Promise<string[]> {
  const rows = await db().select().from(friendships).where(and(involving(me), eq(friendships.status, 'accepted')));
  return rows.map((r) => otherOf(r, me));
}
