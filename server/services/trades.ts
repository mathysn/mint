import { afterTradeAccepted } from '../admin/monitors.js';
import { and, asc, desc, eq, inArray, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Item, TradeActionResult, TradeItem, TradeOffer, TradeOptions, TradeQuote } from '../../shared/api.js';
import { db, type DbOrTx, type Tx } from '../db/client.js';
import { items, ledger, showcase, tradeItems, trades, users } from '../db/schema.js';
import { econ } from '../game/economy.js';
import { assertNotBanned, fail, type UserRow } from '../http.js';
import { catalog } from './catalog.js';
import { findItems, itemValueExpr, selectItems, toItem } from './items.js';
import { lockUsers } from './locks.js';
import { areFriends, playerRef } from './social.js';

type TradeRow = typeof trades.$inferSelect;
type Status = TradeRow['status'];

const DAY_MS = 24 * 60 * 60 * 1000;

// Limits come from the economy in force when the request is validated.
const ids = z
  .array(z.uuid())
  .refine((a) => a.length <= econ().tradeMaxItems, { error: () => `An offer holds up to ${econ().tradeMaxItems} items per side.` })
  .default([]);
const credits = z.number().int().min(0).max(1_000_000_000).default(0);

export const createTradeSchema = z.object({
  to: z.string().trim().min(1).max(64),
  giveItemIds: ids,
  askItemIds: ids,
  giveCredits: credits,
  askCredits: credits,
  expiresInDays: z.number().int().refine((d) => econ().tradeExpiryDays.includes(d), { error: () => `Pick one of ${econ().tradeExpiryDays.join(', ')} days.` }),
  counterOf: z.uuid().optional(),
});
export type CreateTrade = z.infer<typeof createTradeSchema>;

export const quoteTradeSchema = createTradeSchema.omit({ expiresInDays: true, counterOf: true });


async function sides(tx: DbOrTx, tradeId: string) {
  const rows = await tx.select().from(tradeItems).where(eq(tradeItems.tradeId, tradeId));
  return {
    sender: rows.filter((r) => r.side === 'sender').map((r) => r.itemId),
    recipient: rows.filter((r) => r.side === 'recipient').map((r) => r.itemId),
  };
}

/**
 * Ends a pending trade without a swap (declined, cancelled, expired): the sender's items go back
 * to `available` and their held credits are refunded. The trade row must already be locked.
 * Writes the sender's balance itself: callers holding a `Wallets` must build it after this.
 */
export async function release(tx: Tx, trade: TradeRow, status: Exclude<Status, 'pending' | 'accepted'>, cancelReason: TradeRow['cancelReason'] = null, cancelledBy: string | null = null) {
  const { sender: senderItems } = await sides(tx, trade.id);
  const lockedUsers = await lockUsers(tx, [trade.senderId]);
  const sender = lockedUsers.get(trade.senderId)!;
  if (senderItems.length) {
    await tx
      .update(items)
      .set({ status: 'available' })
      .where(and(inArray(items.id, senderItems), eq(items.ownerId, trade.senderId), eq(items.status, 'in_trade')));
  }
  if (trade.senderCredits > 0) {
    const balance = sender.balance + trade.senderCredits;
    await tx.update(users).set({ balance }).where(eq(users.id, sender.id));
    await tx.insert(ledger).values({ userId: sender.id, type: 'trade_release', amount: trade.senderCredits, balanceAfter: balance, refId: trade.id });
  }
  await tx.update(trades).set({ status, respondedAt: new Date(), cancelReason, cancelledBy }).where(eq(trades.id, trade.id));
}

/**
 * Expires pending offers whose time is up. Called on reads (so players always see the right state
 * on Vercel Hobby, whose cron runs once a day) and by the daily cron for everything else.
 */
export async function expireDue(userIds?: string[]): Promise<number> {
  let total = 0;
  for (;;) {
    const done = await db().transaction(async (tx) => {
      const due = await tx
        .select()
        .from(trades)
        .where(
          and(
            eq(trades.status, 'pending'),
            lte(trades.expiresAt, sql`now()`),
            userIds ? or(inArray(trades.senderId, userIds), inArray(trades.recipientId, userIds)) : undefined,
          ),
        )
        .orderBy(asc(trades.expiresAt))
        .limit(50)
        .for('update', { skipLocked: true });
      for (const trade of due) await release(tx, trade, 'expired');
      return due.length;
    });
    total += done;
    if (done < 50) return total;
  }
}

/** Sends an offer to a friend: the sender's items are locked (`in_trade`) and their credits held. */
export async function createTrade(me: UserRow, body: CreateTrade): Promise<string> {
  const [partner] = await db().select().from(users).where(and(eq(users.username, body.to), eq(users.isGuest, false)));
  if (!partner || partner.id === me.id) return fail(404, 'not_found', `No player called “${body.to}”.`);
  if (!(await areFriends(me.id, partner.id))) fail(403, 'forbidden', 'You can only trade with friends.');
  const give = [...new Set(body.giveItemIds)];
  const ask = [...new Set(body.askItemIds)];
  if (give.length + ask.length === 0) fail(400, 'bad_request', 'An offer needs at least one item.');
  await expireDue([me.id, partner.id]);

  return db().transaction(async (tx) => {
    // Same lock order as everywhere: the answered trade, then both players by id, then items.
    let original: TradeRow | undefined;
    if (body.counterOf) {
      [original] = await tx.select().from(trades).where(eq(trades.id, body.counterOf)).for('update');
      if (!original || original.status !== 'pending' || original.recipientId !== me.id || original.senderId !== partner.id) {
        fail(409, 'conflict', 'The offer you are answering is no longer open.');
      }
    }
    const players = await lockUsers(tx, [me.id, partner.id]);
    const sender = players.get(me.id)!;
    assertNotBanned(sender);
    if (original) await release(tx, original, 'declined');

    const [open] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(trades).where(and(eq(trades.senderId, me.id), eq(trades.status, 'pending')));
    if ((open?.n ?? 0) >= econ().tradeMaxPending) fail(409, 'limit_reached', `You already have ${econ().tradeMaxPending} offers waiting.`);

    if (give.length) {
      const mine = await tx
        .select({ id: items.id })
        .from(items)
        .where(and(inArray(items.id, give), eq(items.ownerId, me.id), eq(items.status, 'available')))
        .for('update');
      if (mine.length !== give.length) fail(409, 'items_unavailable', 'Some of your items are no longer available (listed, in a trade or gone).');
    }
    if (ask.length) {
      const theirs = await tx
        .select({ id: items.id })
        .from(items)
        .where(and(inArray(items.id, ask), eq(items.ownerId, partner.id), eq(items.status, 'available')));
      if (theirs.length !== ask.length) fail(409, 'items_unavailable', `Some of ${partner.username}’s items are no longer available.`);
    }
    if (sender.balance < body.giveCredits) fail(402, 'insufficient_balance', 'You can’t offer more credits than your balance.');

    const [trade] = await tx
      .insert(trades)
      .values({
        senderId: me.id,
        recipientId: partner.id,
        senderCredits: body.giveCredits,
        recipientCredits: body.askCredits,
        expiresAt: new Date(Date.now() + body.expiresInDays * DAY_MS),
        counterOf: body.counterOf ?? null,
      })
      .returning({ id: trades.id });
    const rows = [...give.map((itemId) => ({ tradeId: trade!.id, itemId, side: 'sender' as const })), ...ask.map((itemId) => ({ tradeId: trade!.id, itemId, side: 'recipient' as const }))];
    await tx.insert(tradeItems).values(rows);
    if (give.length) await tx.update(items).set({ status: 'in_trade' }).where(inArray(items.id, give));
    if (body.giveCredits > 0) {
      const balance = sender.balance - body.giveCredits;
      await tx.update(users).set({ balance }).where(eq(users.id, me.id));
      await tx.insert(ledger).values({ userId: me.id, type: 'trade_hold', amount: -body.giveCredits, balanceAfter: balance, refId: trade!.id });
    }
    return trade!.id;
  });
}

async function lockTrade(tx: Tx, tradeId: string): Promise<TradeRow> {
  const [trade] = await tx.select().from(trades).where(eq(trades.id, tradeId)).for('update');
  if (!trade) return fail(404, 'not_found', 'Unknown offer.');
  return trade;
}

const balanceOf = async (userId: string) => (await db().select({ balance: users.balance }).from(users).where(eq(users.id, userId)))[0]?.balance ?? 0;

/**
 * Accepts an offer: both sides swap in one transaction (trade, then both players, then all items
 * locked). If something changed since it was sent, the offer is cancelled instead, nothing moves.
 */
export async function acceptTrade(me: UserRow, tradeId: string): Promise<TradeActionResult> {
  const outcome = await db().transaction(async (tx) => {
    const trade = await lockTrade(tx, tradeId);
    if (trade.recipientId !== me.id) fail(404, 'not_found', 'Unknown offer.');
    if (trade.status !== 'pending') fail(409, 'conflict', 'This offer was already answered.');
    if (trade.expiresAt <= new Date()) {
      await release(tx, trade, 'expired');
      return { status: 'expired' as const, reason: 'This offer has expired.' };
    }
    const players = await lockUsers(tx, [trade.senderId, trade.recipientId]);
    const sender = players.get(trade.senderId)!;
    const recipient = players.get(trade.recipientId)!;
    assertNotBanned(recipient);
    const { sender: senderItems, recipient: recipientItems } = await sides(tx, trade.id);
    const all = [...senderItems, ...recipientItems];
    const rows = all.length ? await tx.select().from(items).where(inArray(items.id, all)).orderBy(asc(items.id)).for('update') : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const senderOk = senderItems.every((id) => byId.get(id)?.ownerId === sender.id && byId.get(id)?.status === 'in_trade');
    const recipientOk = recipientItems.every((id) => byId.get(id)?.ownerId === recipient.id && byId.get(id)?.status === 'available');
    if (!senderOk || !recipientOk) {
      await release(tx, trade, 'cancelled');
      return { status: 'cancelled' as const, reason: 'Some items of this offer are no longer available, so it was cancelled.' };
    }
    if (recipient.balance < trade.recipientCredits) fail(402, 'insufficient_balance', `You need ${trade.recipientCredits} CR to accept this offer.`);

    const now = new Date();
    if (senderItems.length) {
      await tx.update(items).set({ ownerId: recipient.id, status: 'available', obtainedAt: now, acquiredVia: 'trade' }).where(inArray(items.id, senderItems));
    }
    if (recipientItems.length) {
      await tx.update(items).set({ ownerId: sender.id, obtainedAt: now, acquiredVia: 'trade' }).where(inArray(items.id, recipientItems));
    }
    // Items changing hands leave their old owner's showcase.
    if (all.length) await tx.delete(showcase).where(inArray(showcase.itemId, all));

    let senderBalance = sender.balance;
    let recipientBalance = recipient.balance;
    const entries: (typeof ledger.$inferInsert)[] = [];
    const ref = { refId: trade.id };
    if (trade.senderCredits > 0) {
      recipientBalance += trade.senderCredits;
      entries.push({ userId: recipient.id, type: 'trade_credit_in', amount: trade.senderCredits, balanceAfter: recipientBalance, ...ref });
    }
    if (trade.recipientCredits > 0) {
      recipientBalance -= trade.recipientCredits;
      entries.push({ userId: recipient.id, type: 'trade_credit_out', amount: -trade.recipientCredits, balanceAfter: recipientBalance, ...ref });
      senderBalance += trade.recipientCredits;
      entries.push({ userId: sender.id, type: 'trade_credit_in', amount: trade.recipientCredits, balanceAfter: senderBalance, ...ref });
    }
    for (const itemId of senderItems) {
      entries.push({ userId: sender.id, type: 'trade_item_out', amount: 0, balanceAfter: senderBalance, itemId, ...ref });
      entries.push({ userId: recipient.id, type: 'trade_item_in', amount: 0, balanceAfter: recipientBalance, itemId, ...ref });
    }
    for (const itemId of recipientItems) {
      entries.push({ userId: recipient.id, type: 'trade_item_out', amount: 0, balanceAfter: recipientBalance, itemId, ...ref });
      entries.push({ userId: sender.id, type: 'trade_item_in', amount: 0, balanceAfter: senderBalance, itemId, ...ref });
    }
    if (entries.length) await tx.insert(ledger).values(entries);
    await tx.update(users).set({ balance: senderBalance }).where(eq(users.id, sender.id));
    await tx.update(users).set({ balance: recipientBalance }).where(eq(users.id, recipient.id));
    await tx.update(trades).set({ status: 'accepted', respondedAt: now }).where(eq(trades.id, trade.id));
    await afterTradeAccepted(tx, { id: trade.id, senderId: sender.id, recipientId: recipient.id });
    return { status: 'accepted' as const };
  });
  return { ...outcome, balance: await balanceOf(me.id) };
}

/** Decline (recipient) or cancel (sender) a pending offer. */
export async function endTrade(me: UserRow, tradeId: string, action: 'decline' | 'cancel'): Promise<TradeActionResult> {
  const status = await db().transaction(async (tx) => {
    const trade = await lockTrade(tx, tradeId);
    const allowed = action === 'decline' ? trade.recipientId === me.id : trade.senderId === me.id;
    if (!allowed) fail(404, 'not_found', 'Unknown offer.');
    if (trade.status !== 'pending') fail(409, 'conflict', 'This offer was already answered.');
    const next = trade.expiresAt <= new Date() ? 'expired' : action === 'decline' ? 'declined' : 'cancelled';
    await release(tx, trade, next);
    return next;
  });
  return { status, balance: await balanceOf(me.id) };
}

/** Normal case skins the player does not own yet: their copies show "Album +1". */
async function albumGaps(userId: string): Promise<(skinId: string) => boolean> {
  const [cat, owned] = await Promise.all([
    catalog(),
    db().selectDistinct({ skinId: items.skinId }).from(items).where(and(eq(items.ownerId, userId), ne(items.status, 'destroyed'))),
  ]);
  const have = new Set(owned.map((o) => o.skinId));
  return (skinId) => cat.normalSkinIds.has(skinId) && !have.has(skinId);
}

const withGain = (list: Item[], gap: ((skinId: string) => boolean) | null): TradeItem[] => list.map((i) => ({ ...i, albumGain: gap ? gap(i.skin.id) : false }));
const sum = (list: Item[], extra: number) => list.reduce((s, i) => s + i.value, 0) + extra;
const slots = (list: TradeItem[]) => new Set(list.filter((i) => i.albumGain).map((i) => i.skin.id)).size;

/** Offers of a box, from the viewer's side. */
export async function listTrades(me: UserRow, box: 'received' | 'sent' | 'history'): Promise<TradeOffer[]> {
  await expireDue([me.id]);
  const where =
    box === 'received'
      ? and(eq(trades.recipientId, me.id), eq(trades.status, 'pending'))
      : box === 'sent'
        ? and(eq(trades.senderId, me.id), eq(trades.status, 'pending'))
        : and(or(eq(trades.senderId, me.id), eq(trades.recipientId, me.id)), ne(trades.status, 'pending'));
  const rows = await db()
    .select()
    .from(trades)
    .where(where)
    .orderBy(box === 'history' ? desc(trades.respondedAt) : box === 'received' ? asc(trades.expiresAt) : desc(trades.createdAt))
    .limit(50);
  if (!rows.length) return [];

  const links = await db().select().from(tradeItems).where(inArray(tradeItems.tradeId, rows.map((r) => r.id)));
  const [found, people, gap] = await Promise.all([
    links.length ? findItems(db(), inArray(items.id, links.map((l) => l.itemId))) : Promise.resolve([]),
    db().select().from(users).where(inArray(users.id, [...new Set(rows.flatMap((r) => [r.senderId, r.recipientId]))])),
    box === 'history' ? Promise.resolve(null) : albumGaps(me.id),
  ]);
  const itemById = new Map(found.map((i) => [i.id, i]));
  const userById = new Map(people.map((u) => [u.id, u]));

  return rows.map((t) => {
    const mineIsSender = t.senderId === me.id;
    const of = (side: 'sender' | 'recipient') =>
      links.filter((l) => l.tradeId === t.id && l.side === side).map((l) => itemById.get(l.itemId)).filter((i): i is Item => Boolean(i));
    const giveItems = withGain(of(mineIsSender ? 'sender' : 'recipient'), null);
    const getItems = withGain(of(mineIsSender ? 'recipient' : 'sender'), t.status === 'pending' ? gap : null);
    const giveCredits = mineIsSender ? t.senderCredits : t.recipientCredits;
    const getCredits = mineIsSender ? t.recipientCredits : t.senderCredits;
    const give = { items: giveItems, credits: giveCredits, total: sum(giveItems, giveCredits) };
    const get = { items: getItems, credits: getCredits, total: sum(getItems, getCredits) };
    return {
      id: t.id,
      direction: mineIsSender ? 'sent' : 'received',
      status: t.status,
      byStaff: t.status === 'cancelled' && t.cancelReason !== null,
      counterparty: playerRef(userById.get(mineIsSender ? t.recipientId : t.senderId)!),
      createdAt: t.createdAt.toISOString(),
      expiresAt: t.expiresAt.toISOString(),
      respondedAt: t.respondedAt?.toISOString() ?? null,
      give,
      get,
      diff: get.total - give.total,
      albumSlots: slots(getItems),
    };
  });
}

async function partnerOf(me: UserRow, username: string): Promise<UserRow> {
  const [partner] = await db().select().from(users).where(and(eq(users.username, username), eq(users.isGuest, false)));
  if (!partner || partner.id === me.id) return fail(404, 'not_found', `No player called “${username}”.`);
  if (!(await areFriends(me.id, partner.id))) fail(403, 'forbidden', 'You can only trade with friends.');
  return partner;
}

const tradableItems = (ownerId: string) =>
  selectItems(db())
    .where(and(eq(items.ownerId, ownerId), ne(items.status, 'destroyed')))
    .orderBy(desc(itemValueExpr()), desc(items.obtainedAt))
    .limit(200);

/** Both inventories for "New offer" (most valuable first, 200 each). */
export async function tradeOptions(me: UserRow, username: string): Promise<TradeOptions> {
  await expireDue([me.id]);
  const partner = await partnerOf(me, username);
  const [mine, theirs, gap] = await Promise.all([tradableItems(me.id), tradableItems(partner.id), albumGaps(me.id)]);
  return {
    partner: playerRef(partner),
    balance: await balanceOf(me.id),
    partnerBalance: await balanceOf(partner.id),
    mine: withGain(mine.map(toItem), null),
    theirs: withGain(theirs.map(toItem), gap),
  };
}

/** Summary bar of "New offer": totals and album slots, computed here, never by the client. */
export async function quoteTrade(me: UserRow, body: z.infer<typeof quoteTradeSchema>): Promise<TradeQuote> {
  const partner = await partnerOf(me, body.to);
  const give = [...new Set(body.giveItemIds)];
  const ask = [...new Set(body.askItemIds)];
  const [mine, theirs, gap] = await Promise.all([
    give.length ? findItems(db(), and(inArray(items.id, give), eq(items.ownerId, me.id))) : Promise.resolve([]),
    ask.length ? findItems(db(), and(inArray(items.id, ask), eq(items.ownerId, partner.id))) : Promise.resolve([]),
    albumGaps(me.id),
  ]);
  const giveTotal = sum(mine, body.giveCredits);
  const getTotal = sum(theirs, body.askCredits);
  return { giveTotal, getTotal, diff: getTotal - giveTotal, albumSlots: slots(withGain(theirs, gap)) };
}

/** Offers received and still waiting (badge). */
export async function pendingReceived(userId: string): Promise<number> {
  const [row] = await db()
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(trades)
    .where(and(eq(trades.recipientId, userId), eq(trades.status, 'pending'), sql`${trades.expiresAt} > now()`));
  return row?.n ?? 0;
}
