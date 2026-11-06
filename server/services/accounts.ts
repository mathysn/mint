import { and, count, eq, gt, ne, or, sql } from 'drizzle-orm';
import type { FreeCase, Me } from '../../shared/api.js';
import { db, type DbOrTx } from '../db/client.js';
import { friendships, ledger, users } from '../db/schema.js';
import { freeCaseStack } from '../game/dailyCrate.js';
import { econ } from '../game/economy.js';
import { banInfo, fail, type UserRow } from '../http.js';
import { staffRoleOf } from '../admin/staff.js';
import { caseOfDay, caseOfDayChangesAt, catalog } from './catalog.js';
import { heldInBids } from './market.js';
import { pendingReceived } from './trades.js';

/** Guests created per hashed IP per hour (a guest is a real row, so cap the spam). */
const GUESTS_PER_IP_PER_HOUR = 10;

export interface DiscordProfile {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export { clientIpHash } from '../auth/client.js';

/** New account with the starting balance, written to the ledger. */
async function insertAccount(tx: DbOrTx, values: Omit<typeof users.$inferInsert, 'balance'>): Promise<UserRow> {
  const start = econ().startingBalance;
  const [user] = await tx.insert(users).values({ ...values, balance: start }).returning();
  await tx.insert(ledger).values({ userId: user!.id, type: 'starting_balance', amount: start, balanceAfter: start });
  return user!;
}

export async function createGuest(tx: DbOrTx, ipHash: string | null): Promise<UserRow> {
  if (ipHash) {
    const [row] = await tx
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.createdIpHash, ipHash), eq(users.isGuest, true), gt(users.createdAt, sql`now() - interval '1 hour'`)));
    if ((row?.n ?? 0) >= GUESTS_PER_IP_PER_HOUR) fail(429, 'rate_limited', 'Too many guest sessions from this network. Try again later.');
  }
  return insertAccount(tx, { isGuest: true, createdIpHash: ipHash });
}

export async function createDiscordAccount(tx: DbOrTx, profile: DiscordProfile): Promise<UserRow> {
  return insertAccount(tx, { isGuest: false, ...discordFields(profile, await freeUsername(tx, profile.username)) });
}

/**
 * A guest is never turned into an account: its items and credits stay behind and the guest is
 * deleted when the browser signs in with Discord (anti-farm: a fresh guest is free to make).
 * Guests can't trade or sell, so nothing they own ever reached another player.
 */
export async function deleteGuest(tx: DbOrTx, guestId: string): Promise<void> {
  await tx.delete(users).where(and(eq(users.id, guestId), eq(users.isGuest, true)));
}

/** Keeps the Discord name and avatar fresh on every sign-in. */
export async function refreshDiscordProfile(tx: DbOrTx, user: UserRow, profile: DiscordProfile): Promise<UserRow> {
  const [updated] = await tx
    .update(users)
    .set({ displayName: profile.global_name, avatarHash: profile.avatar, lastSeenAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();
  return updated!;
}

function discordFields(profile: DiscordProfile, username: string) {
  return { discordId: profile.id, username, displayName: profile.global_name, avatarHash: profile.avatar };
}

/** Mint pseudo = Discord username; suffixed in the unlikely case it is already taken. */
async function freeUsername(tx: DbOrTx, wanted: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? wanted : `${wanted}${i + 1}`;
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.username, candidate)).limit(1);
    if (!taken) return candidate;
  }
  return `${wanted}-${Date.now().toString(36)}`;
}

export type FreeCaseFields = Pick<UserRow, 'freeCaseAnchor' | 'bonusFreeCases'>;

/** Free cases of the day: the stack (one every few minutes, up to the max) plus bonus cases from staff events. */
export async function freeCaseFor(user: FreeCaseFields, now = new Date()): Promise<FreeCase> {
  const cat = await catalog();
  const stack = freeCaseStack(user.freeCaseAnchor, now);
  const count = stack.count + user.bonusFreeCases;
  return {
    available: count > 0,
    count,
    max: stack.max,
    nextAt: stack.nextAt?.toISOString() ?? null,
    crateId: caseOfDay(cat, now),
    crateChangesAt: caseOfDayChangesAt(cat, now)?.toISOString() ?? null,
  };
}

export const avatarUrl = (user: Pick<UserRow, 'discordId' | 'avatarHash'>) =>
  user.discordId && user.avatarHash ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatarHash}.png?size=128` : null;

export async function toMe(user: UserRow): Promise<Me> {
  return {
    id: user.id,
    isGuest: user.isGuest,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: avatarUrl(user),
    balance: user.balance,
    freeCase: await freeCaseFor(user),
    friendRequests: user.isGuest ? 0 : await incomingRequestCount(user.id),
    tradeOffers: user.isGuest ? 0 : await pendingReceived(user.id),
    heldInBids: user.isGuest ? 0 : await heldInBids(user.id),
    ban: banInfo(user),
    mustPickName: !!user.nameResetAt,
    staffRole: await staffRoleOf(user),
  };
}

async function incomingRequestCount(userId: string): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(friendships)
    .where(and(eq(friendships.status, 'pending'), ne(friendships.requesterId, userId), or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId))));
  return row?.n ?? 0;
}
