import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AdminActionResult, BanDuration, BanPreview, CreditsPreview, DeletePreview, GrantQuote, WearCode } from '../../shared/api.js';
import { revokeAllSessions } from '../auth/sessions.js';
import { db, type DbOrTx, type Tx } from '../db/client.js';
import {
  activity,
  auctions,
  caseOpenings,
  crateItems,
  friendships,
  items,
  ledger,
  marketPrices,
  sessions,
  showcase,
  skins,
  staffNotes,
  trades,
  users,
} from '../db/schema.js';
import { freeCaseState } from '../game/dailyCrate.js';
import { PATTERN_COUNT, type Tier } from '../game/economy.js';
import { recycleValue } from '../game/value.js';
import { WEARS, wearOf } from '../game/wear.js';
import { cr, fmt, plural, signedCr, utcDateTime } from '../format.js';
import { banInfo, fail, isBanned, type UserRow } from '../http.js';
import { deleteGuest } from '../services/accounts.js';
import { lockUsers } from '../services/locks.js';
import { cancelAuctionByStaff, dropLeadingBid, heldInBids } from '../services/market.js';
import { release } from '../services/trades.js';
import { playerStats } from '../services/social.js';
import { Wallets } from '../services/wallet.js';
import { playerLabel } from './labels.js';
import { handleOpenFor } from './market.js';
import { reasonSchema, writeAdminLog } from './log.js';
import { banDuration, freePlayerName, liveSessions, loadPlayer } from './players.js';
import type { StaffMember } from './staff.js';

const MAX_CREDITS = 999_999_999;

/** Locks one player for an action; deleted accounts can't be changed. */
async function lockPlayer(tx: Tx, id: string): Promise<{ user: UserRow; players: Map<string, UserRow> }> {
  await loadPlayer(tx, id);
  const players = await lockUsers(tx, [id]);
  const user = players.get(id)!;
  if (user.deletedAt) fail(409, 'conflict', 'This account was deleted.');
  return { user, players };
}

const target = (u: UserRow) => ({ type: 'player' as const, id: u.id, label: playerLabel(u) });

// ── Credits ─────────────────────────────────────────────────────────────────

export const creditsSchema = z.object({
  mode: z.enum(['add', 'remove']),
  amount: z.number().int().min(1).max(MAX_CREDITS),
  reason: reasonSchema,
});
export const creditsPreviewSchema = z.object({ mode: z.enum(['add', 'remove']), amount: z.number().int().min(0).max(MAX_CREDITS) });

/** A balance never goes below 0: "vex only has 4,870 CR. Remove 4,870 CR or less." */
const tooLow = (u: UserRow, amount: number) =>
  amount > u.balance ? `${playerLabel(u)} only has ${cr(u.balance)}. Remove ${cr(u.balance)} or less.` : null;

export async function previewCredits(id: string, body: z.infer<typeof creditsPreviewSchema>): Promise<CreditsPreview> {
  const user = await loadPlayer(db(), id);
  const delta = body.mode === 'add' ? body.amount : -body.amount;
  const blocked = body.mode === 'remove' ? tooLow(user, body.amount) : null;
  return { before: user.balance, after: user.balance + delta, held: await heldInBids(user.id), blocked, max: user.balance };
}

export async function adjustCredits(staff: StaffMember, id: string, body: z.infer<typeof creditsSchema>): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const { user, players } = await lockPlayer(tx, id);
    if (body.mode === 'remove') {
      const blocked = tooLow(user, body.amount);
      if (blocked) fail(409, 'balance_too_low', blocked);
    }
    const amount = body.mode === 'add' ? body.amount : -body.amount;
    const request = randomUUID();
    const wallets = new Wallets(players);
    wallets.move(user.id, body.mode === 'add' ? 'admin_grant' : 'admin_remove', amount, { refId: request });
    const ledgerIds = await wallets.save(tx);
    const held = cr(await heldInBids(user.id, tx));
    await writeAdminLog(tx, staff, {
      action: `credits.${body.mode}`,
      target: target(user),
      change: signedCr(amount),
      before: { balance: cr(user.balance), held },
      after: { balance: cr(wallets.get(user.id)), held },
      reason: body.reason,
      details: { request, ledger: ledgerIds },
    });
    const label = playerLabel(user);
    return { toast: body.mode === 'add' ? `Added ${cr(body.amount)} to ${label} · logged` : `Removed ${cr(body.amount)} from ${label} · logged` };
  });
}

// ── Grant an item ───────────────────────────────────────────────────────────

const WEAR_CODES = WEARS.map((w) => w.code) as [WearCode, ...WearCode[]];

export const grantQuoteSchema = z.object({
  skinId: z.string().min(1).max(200),
  wear: z.enum(WEAR_CODES).nullable(),
  float: z.number().nullable(),
  stattrak: z.boolean(),
});
export const grantSchema = grantQuoteSchema.extend({
  pattern: z.number().int().min(0).max(PATTERN_COUNT - 1).nullable(),
  reason: reasonSchema,
});

/** Float bounds of a wear, as the Grant dialog states them ("FT is 0.15 to 0.38"). */
const wearBounds = (code: WearCode): [number, number] => {
  const i = WEARS.findIndex((w) => w.code === code);
  return [i === 0 ? 0 : WEARS[i - 1]!.below, Number.isFinite(WEARS[i]!.below) ? WEARS[i]!.below : 1];
};
const f2 = (n: number) => n.toFixed(2);

async function grantable(tx: DbOrTx, body: z.infer<typeof grantQuoteSchema>) {
  const [skin] = await tx.select().from(skins).where(eq(skins.id, body.skinId));
  if (!skin) return fail(404, 'not_found', 'Unknown skin.');
  const [tierRow] = await tx.select({ tier: crateItems.tier }).from(crateItems).where(eq(crateItems.skinId, skin.id)).limit(1);
  if (!tierRow) return fail(409, 'conflict', 'This skin is in no case.');
  let error: string | null = null;
  let float = body.float;
  if (skin.minFloat === null || skin.maxFloat === null) {
    float = null;
  } else if (float === null || !Number.isFinite(float) || float < 0 || float > 1) {
    error = 'Type a float between 0 and 1.';
  } else if (body.wear) {
    const [lo, hi] = wearBounds(body.wear);
    if (float < lo || float >= hi + (hi === 1 ? 1e-9 : 0)) error = `${body.wear} floats go from ${f2(lo)} to ${f2(hi)}. Pick another wear or change the float.`;
  }
  if (!error && float !== null && (float < skin.minFloat! || float > skin.maxFloat!)) {
    error = `This skin's floats go from ${f2(skin.minFloat!)} to ${f2(skin.maxFloat!)}.`;
  }
  if (!error && body.stattrak && !skin.stattrakAvailable) error = 'This skin has no StatTrak™ version.';
  return { skin, tier: tierRow.tier, float, error };
}

/** Displayed value of an item that doesn't exist yet: market price of its skin, StatTrak and wear, else recycle value. */
async function valueOf(tx: DbOrTx, skinId: string, tier: Tier, stattrak: boolean, float: number | null) {
  const wear = wearOf(float)?.code ?? null;
  const [price] = await tx
    .select({ avg: marketPrices.avgPrice })
    .from(marketPrices)
    .where(and(eq(marketPrices.skinId, skinId), eq(marketPrices.stattrak, stattrak), wear ? eq(marketPrices.wear, wear) : isNull(marketPrices.wear)));
  return price?.avg ?? recycleValue({ tier, stattrak, float });
}

export async function quoteGrant(id: string, body: z.infer<typeof grantQuoteSchema>): Promise<GrantQuote> {
  const user = await loadPlayer(db(), id);
  const g = await grantable(db(), body);
  const value = g.error ? 0 : await valueOf(db(), g.skin.id, g.tier, body.stattrak, g.float);
  const before = (await playerStats([user.id])).get(user.id)!.inventoryValue;
  return { error: g.error, value, inventoryBefore: before, inventoryAfter: before + value };
}

export async function grantItem(staff: StaffMember, id: string, body: z.infer<typeof grantSchema>): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const { user, players } = await lockPlayer(tx, id);
    const g = await grantable(tx, body);
    if (g.error) fail(400, 'bad_request', g.error);
    const pattern = body.pattern ?? Math.floor(Math.random() * PATTERN_COUNT);
    const [item] = await tx
      .insert(items)
      .values({
        skinId: g.skin.id,
        ownerId: user.id,
        originalOwnerId: user.id,
        float: g.float,
        pattern,
        stattrak: body.stattrak,
        tier: g.tier,
        source: 'admin',
        acquiredVia: 'admin',
      })
      .returning();
    const request = randomUUID();
    const wallets = new Wallets(players);
    wallets.move(user.id, 'admin_item_grant', 0, { refId: request, itemId: item!.id });
    const ledgerIds = await wallets.save(tx);
    const wear = wearOf(g.float);
    const label = wear ? `${g.skin.name} (${wear.code} ${g.float!.toFixed(4)})` : g.skin.name;
    await writeAdminLog(tx, staff, {
      action: 'item.grant',
      target: target(user),
      change: `+ ${label}`,
      before: { items: fmt(await countItems(tx, user.id) - 1) },
      after: { items: fmt(await countItems(tx, user.id)), granted: `${body.stattrak ? 'StatTrak™ ' : ''}${label} · pattern ${pattern}` },
      reason: body.reason,
      details: { request, ledger: ledgerIds, items: [item!.id] },
    });
    return { toast: `Granted ${label} to ${playerLabel(user)} · logged` };
  });
}

async function countItems(tx: DbOrTx, userId: string) {
  const [row] = await tx.select({ n: count() }).from(items).where(and(eq(items.ownerId, userId), ne(items.status, 'destroyed')));
  return row?.n ?? 0;
}

// ── Free case, sessions, rename, notes ──────────────────────────────────────

export const reasonOnly = z.object({ reason: reasonSchema });

export async function resetFreeCase(staff: StaffMember, id: string, reason: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const { user } = await lockPlayer(tx, id);
    const state = freeCaseState(user.lastFreeCaseAt, new Date());
    await tx.update(users).set({ lastFreeCaseAt: null }).where(eq(users.id, user.id));
    await writeAdminLog(tx, staff, {
      action: 'player.free_case',
      target: target(user),
      change: 'free case reset',
      before: { 'next free case': state.available ? 'available' : `${utcDateTime(state.nextAt!)} UTC` },
      after: { 'next free case': 'available' },
      reason,
    });
    return { toast: `Reset ${playerLabel(user)}’s free case · logged` };
  });
}

export async function signOutEverywhere(staff: StaffMember, id: string, reason: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const { user } = await lockPlayer(tx, id);
    const ended = await revokeAllSessions(tx, user.id, 'admin');
    await writeAdminLog(tx, staff, {
      action: 'player.signout',
      target: target(user),
      change: plural(ended, 'session') + ' ended',
      before: { sessions: fmt(ended) },
      after: { sessions: '0 (revoked)' },
      reason,
    });
    return { toast: `Signed ${playerLabel(user)} out of ${plural(ended, 'session')} · logged` };
  });
}

export const renameSchema = z.object({ name: z.string().regex(/^player_[a-z0-9]{3,12}$/), reason: reasonSchema });

export async function renamePlayer(staff: StaffMember, id: string, body: z.infer<typeof renameSchema>): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const { user } = await lockPlayer(tx, id);
    if (user.isGuest) fail(409, 'conflict', 'Guests have no name.');
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.username, body.name));
    if (taken) fail(409, 'conflict', `${body.name} was just taken. Reopen Rename for another name.`);
    await tx.update(users).set({ username: body.name, nameResetAt: new Date() }).where(eq(users.id, user.id));
    await handleOpenFor(tx, user.id, staff.name, `renamed to ${body.name}`, false);
    await writeAdminLog(tx, staff, {
      action: 'player.rename',
      target: { ...target(user), label: body.name },
      change: 'name reset',
      before: { name: user.username },
      after: { name: body.name },
      reason: body.reason,
    });
    return { toast: `Renamed ${user.username} to ${body.name} · logged` };
  });
}

export const noteSchema = z.object({ text: z.string().trim().min(1).max(2000) });

export async function addNote(staff: StaffMember, id: string, text: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const user = await loadPlayer(tx, id);
    await tx.insert(staffNotes).values({ userId: user.id, staffName: staff.name, text });
    await writeAdminLog(tx, staff, { action: 'player.note', target: target(user), change: 'note added', before: {}, after: { note: text }, reason: text });
    return { toast: `Added a note on ${playerLabel(user)} · logged` };
  });
}

// ── Ban ─────────────────────────────────────────────────────────────────────

const DURATION_MS: Record<Exclude<BanDuration, 'permanent'>, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };
const DURATION_TEXT: Record<BanDuration, string> = { '24h': 'for 24 hours', '7d': 'for 7 days', '30d': 'for 30 days', permanent: 'permanently' };
const DURATION_CHANGE: Record<BanDuration, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', permanent: 'permanent' };

export const banSchema = z.object({
  duration: z.enum(['24h', '7d', '30d', 'permanent']),
  reason: reasonSchema,
  confirmName: z.string().optional(),
});

/** What a ban (or a deletion) cancels: listings and leading bids, then pending offers both ways. */
async function heldBy(tx: DbOrTx, userId: string) {
  const liveAuctions = await tx
    .select({ auction: auctions, name: skins.name })
    .from(auctions)
    .innerJoin(items, eq(items.id, auctions.itemId))
    .innerJoin(skins, eq(skins.id, items.skinId))
    .where(and(eq(auctions.status, 'active'), or(eq(auctions.sellerId, userId), eq(auctions.leaderId, userId))))
    .orderBy(asc(auctions.id));
  const offers = await tx
    .select()
    .from(trades)
    .where(and(eq(trades.status, 'pending'), or(eq(trades.senderId, userId), eq(trades.recipientId, userId))))
    .orderBy(asc(trades.id));
  return { liveAuctions, offers };
}

export async function previewBan(id: string): Promise<BanPreview> {
  const user = await loadPlayer(db(), id);
  const { liveAuctions, offers } = await heldBy(db(), user.id);
  const leaders = await db().select({ id: users.id, username: users.username, isGuest: users.isGuest, deletedAt: users.deletedAt }).from(users).where(inArray(users.id, liveAuctions.map((a) => a.auction.leaderId ?? user.id)));
  const leaderName = new Map(leaders.map((l) => [l.id, playerLabel(l)]));
  const now = Date.now();
  return {
    sessions: await liveSessions(db(), user.id),
    listings: liveAuctions
      .filter((a) => a.auction.sellerId === user.id)
      .map((a) => ({ item: a.name, bids: a.auction.bidCount, leader: a.auction.leaderId ? (leaderName.get(a.auction.leaderId) ?? null) : null, leading: a.auction.currentBid })),
    bids: liveAuctions.filter((a) => a.auction.leaderId === user.id).map((a) => ({ item: a.name, amount: a.auction.currentBid ?? 0 })),
    offers: offers.length,
    until: {
      '24h': new Date(now + DURATION_MS['24h']).toISOString(),
      '7d': new Date(now + DURATION_MS['7d']).toISOString(),
      '30d': new Date(now + DURATION_MS['30d']).toISOString(),
    },
  };
}

/**
 * Cancels everything a player holds open (ban, deletion), in the lock order used everywhere:
 * auctions and offers (by id), then every player involved (by id), then items. Offers are released
 * first (they write balances themselves), then the wallets are read fresh for the auctions.
 */
async function cancelOpenDealings(tx: Tx, userId: string, reason: 'ban' | 'deleted', request: string) {
  const { liveAuctions } = await heldBy(tx, userId);
  const lockedAuctions = liveAuctions.length
    ? await tx.select().from(auctions).where(and(inArray(auctions.id, liveAuctions.map((a) => a.auction.id)), eq(auctions.status, 'active'))).orderBy(asc(auctions.id)).for('update')
    : [];
  const lockedOffers = await tx
    .select()
    .from(trades)
    .where(and(eq(trades.status, 'pending'), or(eq(trades.senderId, userId), eq(trades.recipientId, userId))))
    .orderBy(asc(trades.id))
    .for('update');
  const involved = [userId, ...lockedAuctions.flatMap((a) => [a.sellerId, a.leaderId ?? userId]), ...lockedOffers.flatMap((t) => [t.senderId, t.recipientId])];
  await lockUsers(tx, involved);
  for (const offer of lockedOffers) await release(tx, offer, 'cancelled', reason);
  const wallets = new Wallets(await lockUsers(tx, involved));
  const names = new Map(liveAuctions.map((a) => [a.auction.id, a.name]));
  const listings: string[] = [];
  const bidsCancelled: string[] = [];
  for (const auction of lockedAuctions) {
    if (auction.sellerId === userId) {
      const refund = await cancelAuctionByStaff(tx, auction, reason, wallets);
      listings.push(`${names.get(auction.id)} cancelled${refund ? `, ${cr(refund.amount)} refunded` : ''}`);
    } else {
      const refund = await dropLeadingBid(tx, auction, wallets);
      if (refund) bidsCancelled.push(`${names.get(auction.id)} · ${cr(refund.amount)} back`);
    }
  }
  // Wallet rows point at the auction (refId); the admin log keeps the request id.
  const ledgerIds = await wallets.save(tx);
  return { listings, bids: bidsCancelled, offers: lockedOffers.map((t) => `#${t.number} cancelled`), ledgerIds, request };
}

export async function banPlayer(staff: StaffMember, id: string, body: z.infer<typeof banSchema>): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const user = await loadPlayer(tx, id);
    const label = playerLabel(user);
    if (user.deletedAt) fail(409, 'conflict', 'This account was deleted.');
    if (body.duration === 'permanent' && body.confirmName?.trim() !== label) fail(400, 'confirm_name_mismatch', `Type ${label} to confirm a permanent ban.`);
    if (isBanned(user)) fail(409, 'conflict', `${label} is already banned.`);
    const sessionsBefore = await liveSessions(tx, user.id);
    const done = await cancelOpenDealings(tx, user.id, 'ban', randomUUID());
    // The player row is locked now: another staff member may have banned them meanwhile.
    if (isBanned((await lockUsers(tx, [user.id])).get(user.id)!)) fail(409, 'conflict', `${label} is already banned.`);
    await revokeAllSessions(tx, user.id, 'ban');
    const now = new Date();
    const until = body.duration === 'permanent' ? null : new Date(now.getTime() + DURATION_MS[body.duration]);
    const [banned] = await tx
      .update(users)
      .set({ bannedAt: now, banUntil: until, banReason: body.reason, bannedBy: staff.name })
      .where(eq(users.id, user.id))
      .returning();
    const sees = banInfo(banned!)!;
    await handleOpenFor(tx, user.id, staff.name, `${label} banned`, true);
    await writeAdminLog(tx, staff, {
      action: 'player.ban',
      target: target(user),
      change: DURATION_CHANGE[body.duration],
      before: { status: 'active', sessions: fmt(sessionsBefore) },
      after: {
        status: until ? `banned until ${utcDateTime(until)}` : 'banned permanently',
        sessions: '0 (revoked)',
        ...(done.listings.length ? { listings: done.listings.join(' / ') } : {}),
        ...(done.bids.length ? { bids: done.bids.join(' / ') } : {}),
        ...(done.offers.length ? { offers: done.offers.join(' / ') } : {}),
      },
      reason: body.reason,
      details: { request: done.request, ledger: done.ledgerIds, sees: `${sees.message} Reason: ${sees.reason}` },
    });
    return { toast: `Banned ${label} ${DURATION_TEXT[body.duration]} · logged` };
  });
}

export async function unbanPlayer(staff: StaffMember, id: string, reason: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const { user } = await lockPlayer(tx, id);
    const label = playerLabel(user);
    if (!isBanned(user)) fail(409, 'conflict', `${label} isn't banned.`);
    await tx.update(users).set({ bannedAt: null, banUntil: null, banReason: null, bannedBy: null }).where(eq(users.id, user.id));
    await writeAdminLog(tx, staff, {
      action: 'player.unban',
      target: target(user),
      change: 'ban lifted',
      before: { status: user.banUntil ? `banned until ${utcDateTime(user.banUntil)} (${banDuration(user)})` : 'banned permanently', reason: user.banReason },
      after: { status: 'active' },
      reason,
    });
    return { toast: `Unbanned ${label} · logged` };
  });
}

// ── Delete ──────────────────────────────────────────────────────────────────

export const deleteSchema = z.object({ confirmName: z.string(), reason: reasonSchema });

export async function previewDelete(id: string): Promise<DeletePreview> {
  const user = await loadPlayer(db(), id);
  const [stats, [itemCount], [friends], live, [tradeCount], [saleCount], [ledgerCount], dealings] = await Promise.all([
    playerStats([user.id]),
    db().select({ n: count() }).from(items).where(and(eq(items.ownerId, user.id), ne(items.status, 'destroyed'))),
    db().select({ n: count() }).from(friendships).where(and(eq(friendships.status, 'accepted'), or(eq(friendships.userLow, user.id), eq(friendships.userHigh, user.id)))),
    liveSessions(db(), user.id),
    db().select({ n: count() }).from(trades).where(or(eq(trades.senderId, user.id), eq(trades.recipientId, user.id))),
    db().select({ n: count() }).from(auctions).where(and(eq(auctions.sellerId, user.id), eq(auctions.status, 'sold'))),
    db().select({ n: count() }).from(ledger).where(eq(ledger.userId, user.id)),
    heldBy(db(), user.id),
  ]);
  const s = stats.get(user.id)!;
  const listing = dealings.liveAuctions.find((a) => a.auction.sellerId === user.id);
  const ownBids = dealings.liveAuctions.filter((a) => a.auction.leaderId === user.id);
  return {
    balance: user.balance,
    items: itemCount?.n ?? 0,
    itemsValue: s.inventoryValue,
    friends: friends?.n ?? 0,
    sessions: live,
    albumsPct: s.albumsPct,
    trades: tradeCount?.n ?? 0,
    sales: saleCount?.n ?? 0,
    ledgerEntries: ledgerCount?.n ?? 0,
    listing: listing ? { item: listing.name, bids: listing.auction.bidCount } : null,
    ownBid: ownBids.length ? ownBids.reduce((s2, a) => s2 + (a.auction.currentBid ?? 0), 0) : null,
  };
}

/**
 * Deletes an account for good but keeps the history ("Deleted player"): open dealings are
 * cancelled, items destroyed, the balance zeroed (ledger), friends, showcase, feed and sessions
 * removed, the Discord link and name cleared. The same Discord account can come back as new.
 * A guest is deleted outright, like the guest purge.
 */
export async function deleteAccount(staff: StaffMember, id: string, body: z.infer<typeof deleteSchema>): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const user = await loadPlayer(tx, id);
    const label = playerLabel(user);
    if (user.deletedAt) fail(409, 'conflict', 'This account was already deleted.');
    if (body.confirmName.trim() !== label) fail(400, 'confirm_name_mismatch', `Type ${label} to confirm.`);
    const stats = (await playerStats([user.id])).get(user.id)!;
    const itemsBefore = await countItems(tx, user.id);
    const sessionsBefore = await liveSessions(tx, user.id);
    const [friendsBefore] = await tx.select({ n: count() }).from(friendships).where(and(eq(friendships.status, 'accepted'), or(eq(friendships.userLow, user.id), eq(friendships.userHigh, user.id))));

    if (user.isGuest) {
      await lockUsers(tx, [user.id]);
      await deleteGuest(tx, user.id);
      await writeAdminLog(tx, staff, {
        action: 'player.delete',
        target: target(user),
        change: 'guest deleted',
        before: { balance: cr(user.balance), items: `${fmt(itemsBefore)} · ${cr(stats.inventoryValue)}` },
        after: { account: 'deleted' },
        reason: body.reason,
      });
      return { toast: `Deleted ${label}’s account · logged` };
    }

    await anonymizeAccount(tx, user, staff, body.reason, {
      stats,
      itemsBefore,
      sessionsBefore,
      friendsBefore: friendsBefore?.n ?? 0,
    });
    return { toast: `Deleted ${label}’s account · logged` };
  });
}

/**
 * The deletion itself, shared by staff and by the player ("Delete my account"): cancels open
 * dealings, destroys items, zeroes the balance, removes friends, showcase, feed and sessions,
 * clears the Discord link and name, then writes the admin log (`by` is the staff member, or
 * "player" when the player did it).
 */
async function anonymizeAccount(
  tx: Tx,
  user: UserRow,
  by: Pick<StaffMember, 'discordId' | 'name'>,
  reason: string,
  before: { stats: { inventoryValue: number }; itemsBefore: number; sessionsBefore: number; friendsBefore: number },
) {
  const label = playerLabel(user);
  const request = randomUUID();
  const done = await cancelOpenDealings(tx, user.id, 'deleted', request);
  const players = await lockUsers(tx, [user.id]);
  if (players.get(user.id)!.deletedAt) fail(409, 'conflict', 'This account was already deleted.');
  const owned = await tx.select({ id: items.id }).from(items).where(and(eq(items.ownerId, user.id), ne(items.status, 'destroyed'))).orderBy(asc(items.id)).for('update');
  const wallets = new Wallets(players);
  const balance = wallets.get(user.id);
  if (balance > 0) wallets.move(user.id, 'account_delete', -balance, { refId: request });
  for (const item of owned) wallets.move(user.id, 'account_delete', 0, { refId: request, itemId: item.id });
  const ledgerIds = await wallets.save(tx);
  const now = new Date();
  if (owned.length) await tx.update(items).set({ status: 'destroyed', destroyedAt: now }).where(inArray(items.id, owned.map((i) => i.id)));
  await tx.delete(showcase).where(eq(showcase.userId, user.id));
  await tx.delete(friendships).where(or(eq(friendships.userLow, user.id), eq(friendships.userHigh, user.id)));
  await tx.delete(activity).where(eq(activity.userId, user.id));
  await tx.delete(sessions).where(eq(sessions.userId, user.id));
  await tx
    .update(users)
    .set({ deletedAt: now, discordId: null, username: null, displayName: null, avatarHash: null, createdIpHash: null, nameResetAt: null, bannedAt: null, banUntil: null, banReason: null, bannedBy: null })
    .where(eq(users.id, user.id));
  await writeAdminLog(tx, by, {
    action: 'player.delete',
    target: target(user),
    change: 'account deleted',
    before: {
      name: label,
      discord: user.discordId,
      balance: cr(balance),
      items: `${fmt(before.itemsBefore)} · ${cr(before.stats.inventoryValue)}`,
      friends: fmt(before.friendsBefore),
      sessions: fmt(before.sessionsBefore),
    },
    after: {
      name: 'Deleted player',
      balance: '0 CR',
      items: '0',
      ...(done.listings.length ? { listings: done.listings.join(' / ') } : {}),
      ...(done.bids.length ? { bids: done.bids.join(' / ') } : {}),
      ...(done.offers.length ? { offers: done.offers.join(' / ') } : {}),
    },
    reason,
    details: { request, ledger: [...done.ledgerIds, ...ledgerIds], items: owned.map((i) => i.id) },
  });
}

/** The admin log names this actor for deletions a player asked for themselves. */
const SELF = { discordId: null as unknown as string, name: 'player' };

export const deleteOwnSchema = z.object({ confirmName: z.string() });

/**
 * "Delete my account" (privacy page): the same deletion as staff do, asked by the player, who types
 * their name to confirm. Guests have nothing to delete (their account is purged after 30 days).
 */
export async function deleteOwnAccount(userId: string, body: z.infer<typeof deleteOwnSchema>): Promise<void> {
  await db().transaction(async (tx) => {
    // Not locked yet: the lock order is auctions and offers first, then players (anonymizeAccount).
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    if (!user || user.deletedAt) return fail(409, 'conflict', 'This account was already deleted.');
    if (user.isGuest || !user.username) fail(403, 'account_required', 'Guests have no account to delete.');
    if (body.confirmName.trim().toLowerCase() !== user.username) fail(400, 'confirm_name_mismatch', `Type ${user.username} to confirm.`);
    const stats = (await playerStats([user.id])).get(user.id)!;
    const [friends] = await tx.select({ n: count() }).from(friendships).where(and(eq(friendships.status, 'accepted'), or(eq(friendships.userLow, user.id), eq(friendships.userHigh, user.id))));
    await anonymizeAccount(tx, user, SELF, 'Deleted by the player', {
      stats,
      itemsBefore: await countItems(tx, user.id),
      sessionsBefore: await liveSessions(tx, user.id),
      friendsBefore: friends?.n ?? 0,
    });
  });
}

// ── Guests, in bulk ─────────────────────────────────────────────────────────

export const guestsDeleteSchema = z.object({ ids: z.array(z.uuid()).min(1).max(200), reason: reasonSchema });

export async function deleteGuests(staff: StaffMember, body: z.infer<typeof guestsDeleteSchema>): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const ids = [...new Set(body.ids)];
    const rows = await tx.select().from(users).where(inArray(users.id, ids)).orderBy(asc(users.id)).for('update');
    if (rows.length !== ids.length || rows.some((u) => !u.isGuest)) fail(409, 'conflict', 'Only guests can be deleted in bulk.');
    const [cases] = await tx.select({ n: count() }).from(caseOpenings).where(inArray(caseOpenings.userId, ids));
    const balance = rows.reduce((s, u) => s + u.balance, 0);
    for (const u of rows) await deleteGuest(tx, u.id);
    await writeAdminLog(tx, staff, {
      action: 'guests.delete',
      target: { type: 'guests', id: null, label: plural(rows.length, 'guest') },
      change: `${fmt(rows.length)} deleted`,
      before: { guests: rows.map(playerLabel).join(', '), balance: cr(balance), cases: fmt(cases?.n ?? 0) },
      after: { guests: 'deleted' },
      reason: body.reason,
    });
    return { toast: `Deleted ${plural(rows.length, 'guest')} · logged` };
  });
}

