import { afterSale } from '../admin/monitors.js';
import { and, asc, desc, eq, exists, gt, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type {
  AuctionCard,
  AuctionDetail,
  AuctionRole,
  BidResult,
  BuyNowResult,
  CreateListingResult,
  ListingQuote,
  MarketPage,
  MarketSort,
  MarketTab,
  SalesHistory,
  SellInfo,
  Tier,
  WearCode,
} from '../../shared/api.js';
import { db, type DbOrTx, type Tx } from '../db/client.js';
import { activity, auctions, bids, items, sales, showcase, skins, users } from '../db/schema.js';
import {
  AUCTION_PAGE_SALES,
  FEED_TIERS,
  MARKET_ENDED_VISIBLE_DAYS,
  MARKET_PRICE_SALES,
  SALES_WINDOW_DAYS,
  TIERS,
  econ,
} from '../game/economy.js';
import { endAfterBid, marketFee, minNextBid, quickBids, sellerNet } from '../game/market.js';
import { recycleValue } from '../game/value.js';
import { wearOf } from '../game/wear.js';
import { assertNotBanned, fail, type UserRow } from '../http.js';
import { findItems, itemValueExpr, recycleValueExpr, sourceCrate, toItem } from './items.js';
import { lockUsers } from './locks.js';
import { Wallets } from './wallet.js';
import { nameMatches } from './search.js';
import { playerRef } from './social.js';

type AuctionRow = typeof auctions.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 60;
const SETTLE_BATCH = 20;
const fmt = (n: number) => n.toLocaleString('en-US');

// Limits come from the economy in force when the request is validated.
const maxPrice = (n: number) => n <= econ().maxPrice;
const tooHigh = { error: () => `The highest price is ${fmt(econ().maxPrice)} CR.` };
const price = z.number().int().min(1).refine(maxPrice, tooHigh);
const duration = z.number().int().refine((h) => econ().durationsH.includes(h), { error: () => `Pick one of ${econ().durationsH.join(', ')} hours.` });

export const quoteListingSchema = z.object({ itemId: z.uuid(), startPrice: z.number().int().min(0).refine(maxPrice, tooHigh), buyNowPrice: z.number().int().min(0).refine(maxPrice, tooHigh).nullable() });

export const createListingSchema = z
  .object({ itemId: z.uuid(), startPrice: price, buyNowPrice: price.nullable(), durationHours: duration })
  .refine((b) => b.buyNowPrice === null || b.buyNowPrice > b.startPrice, { message: 'The buy-now price has to be above the starting price.', path: ['buyNowPrice'] });
export type CreateListing = z.infer<typeof createListingSchema>;

export const bidSchema = z.object({ amount: z.number().int().min(1).max(1_000_000_000) });

export const marketQuerySchema = z.object({
  tab: z.enum(['browse', 'mine', 'bids']).default('browse'),
  q: z.string().trim().max(64).optional(),
  tier: z.enum(TIERS).optional(),
  sort: z.enum(['ending', 'newest', 'price', 'bids']).default('ending'),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type MarketQuery = z.infer<typeof marketQuerySchema>;

// ── Money and items ─────────────────────────────────────────────────────────

/** Sum of the viewer's leading bids: already taken from their balance. */
export async function heldInBids(userId: string, tx: DbOrTx = db()): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`COALESCE(SUM(${auctions.currentBid}), 0)::bigint` })
    .from(auctions)
    .where(and(eq(auctions.leaderId, userId), eq(auctions.status, 'active')));
  return Number(row?.total ?? 0);
}

/**
 * Hands the listed item to the buyer and pays the seller (price − 5 % fee). The auction, both
 * players (Wallets) and then the item are locked by the caller, in that order.
 */
async function transferSold(tx: Tx, auction: AuctionRow, buyerId: string, finalPrice: number, at: Date, wallets: Wallets) {
  const [item] = await tx.select().from(items).where(eq(items.id, auction.itemId)).for('update');
  if (!item || item.ownerId !== auction.sellerId || item.status !== 'listed') throw new Error(`Auction ${auction.id}: item is not listed by the seller`);
  // The fee the listing started with, even if the economy changed since.
  const fee = marketFee(finalPrice, auction.feeBp);
  const refs = { refId: auction.id, itemId: item.id };
  wallets.move(auction.sellerId, 'auction_sale', finalPrice, refs);
  wallets.move(auction.sellerId, 'auction_fee', -fee, refs);
  wallets.move(auction.sellerId, 'auction_item_out', 0, refs);
  wallets.move(buyerId, 'auction_item_in', 0, refs);
  await tx.update(items).set({ ownerId: buyerId, status: 'available', obtainedAt: at, acquiredVia: 'market' }).where(eq(items.id, item.id));
  // A sold item leaves the seller's showcase.
  await tx.delete(showcase).where(eq(showcase.itemId, item.id));
  const wear = wearOf(item.float)?.code ?? null;
  await tx.insert(sales).values({ auctionId: auction.id, skinId: item.skinId, stattrak: item.stattrak, wear, price: finalPrice, soldAt: at });
  await afterSale(tx, { auctionId: auction.id, itemId: item.id, sellerId: auction.sellerId, buyerId, price: finalPrice, soldAt: at });
  await refreshMarketPrice(tx, item.skinId, item.stattrak, wear);
  if (FEED_TIERS.includes(item.tier)) await tx.insert(activity).values({ userId: auction.sellerId, type: 'sale', itemId: item.id, price: finalPrice, createdAt: at });
  return fee;
}

/** Market value of a skin in one wear: average of its last sales (sold_at order, settled late or not). */
async function refreshMarketPrice(tx: Tx, skinId: string, stattrak: boolean, wear: WearCode | null) {
  await tx.execute(sql`
    INSERT INTO market_prices (skin_id, stattrak, wear, avg_price, sales_count, updated_at)
    SELECT ${skinId}, ${stattrak}, ${wear}::wear, ROUND(AVG(last.price))::bigint, COUNT(*)::int, now()
    FROM (
      SELECT price FROM sales
      WHERE skin_id = ${skinId} AND stattrak = ${stattrak} AND wear IS NOT DISTINCT FROM ${wear}::wear
      ORDER BY sold_at DESC, id DESC
      LIMIT ${MARKET_PRICE_SALES}
    ) last
    ON CONFLICT ON CONSTRAINT market_prices_key
    DO UPDATE SET avg_price = EXCLUDED.avg_price, sales_count = EXCLUDED.sales_count, updated_at = now()`);
}

/**
 * Closes an auction whose time is up (row locked by the caller). The result is the one at `ends_at`.
 * Returns what happened (staff "Settle now" logs it).
 */
export async function settle(tx: Tx, auction: AuctionRow): Promise<{ sold: boolean; fee: number; ledgerIds: number[] }> {
  const at = auction.endsAt;
  if (auction.leaderId && auction.currentBid !== null) {
    const wallets = new Wallets(await lockUsers(tx, [auction.sellerId, auction.leaderId]));
    // The winner's bid was held when placed: it becomes the payment, no new debit.
    const fee = await transferSold(tx, auction, auction.leaderId, auction.currentBid, at, wallets);
    const ledgerIds = await wallets.save(tx);
    await tx.update(auctions).set({ status: 'sold', buyerId: auction.leaderId, finalPrice: auction.currentBid, fee, closedAt: at }).where(eq(auctions.id, auction.id));
    return { sold: true, fee, ledgerIds };
  }
  await tx.update(items).set({ status: 'available' }).where(and(eq(items.id, auction.itemId), eq(items.ownerId, auction.sellerId), eq(items.status, 'listed')));
  await tx.update(auctions).set({ status: 'unsold', closedAt: at }).where(eq(auctions.id, auction.id));
  return { sold: false, fee: 0, ledgerIds: [] };
}

const dueWhere = (id?: string) => and(eq(auctions.status, 'active'), lte(auctions.endsAt, sql`now()`), id ? eq(auctions.id, id) : undefined);

/** Settles one due auction in its own transaction; false if it is not due or someone else holds it. */
async function settleOne(id: string): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [auction] = await tx.select().from(auctions).where(dueWhere(id)).for('update', { skipLocked: true });
    if (!auction) return false;
    await settle(tx, auction);
    return true;
  });
}

/**
 * Settles every auction whose time is up. Called on reads (Vercel Hobby runs the cron once a day)
 * and by the cron. One transaction per auction, so locks never pile up across auctions.
 */
export async function settleDue(): Promise<number> {
  let total = 0;
  for (;;) {
    const due = await db().select({ id: auctions.id }).from(auctions).where(dueWhere()).orderBy(asc(auctions.endsAt)).limit(SETTLE_BATCH);
    let done = 0;
    for (const { id } of due) if (await settleOne(id)) done++;
    total += done;
    if (due.length < SETTLE_BATCH || done === 0) return total;
  }
}

async function lockAuction(tx: Tx, id: string): Promise<AuctionRow> {
  const [auction] = await tx.select().from(auctions).where(eq(auctions.id, id)).for('update');
  if (!auction) return fail(404, 'not_found', 'Unknown auction.');
  return auction;
}

/** Common checks before a bid or a buy; settles it on the spot when its time is up. */
async function openAuctionOrEnd(tx: Tx, id: string): Promise<AuctionRow | null> {
  const auction = await lockAuction(tx, id);
  if (auction.status !== 'active') fail(409, 'auction_ended', 'This auction has ended.');
  if (auction.endsAt <= new Date()) {
    await settle(tx, auction);
    return null;
  }
  return auction;
}

// ── Listing ─────────────────────────────────────────────────────────────────

const activeListings = async (tx: DbOrTx, userId: string) =>
  (await tx.select({ n: sql<number>`count(*)::int` }).from(auctions).where(and(eq(auctions.sellerId, userId), eq(auctions.status, 'active'))))[0]?.n ?? 0;

/** Puts one of your available items up for auction: it is `listed` (locked) until the sale closes. */
export async function createListing(me: UserRow, body: CreateListing): Promise<CreateListingResult> {
  await settleDue();
  return db().transaction(async (tx) => {
    assertNotBanned((await lockUsers(tx, [me.id])).get(me.id)!);
    const active = await activeListings(tx, me.id);
    if (active >= econ().maxListings) fail(409, 'limit_reached', `You already have ${econ().maxListings} active listings.`);
    const [item] = await tx.select().from(items).where(and(eq(items.id, body.itemId), eq(items.ownerId, me.id))).for('update');
    if (!item || item.status !== 'available') fail(409, 'items_unavailable', 'This item is no longer available (listed, in a trade or gone).');
    await tx.update(items).set({ status: 'listed' }).where(eq(items.id, body.itemId));
    const endsAt = new Date(Date.now() + body.durationHours * 60 * 60 * 1000);
    const [auction] = await tx
      .insert(auctions)
      .values({ itemId: body.itemId, sellerId: me.id, startPrice: body.startPrice, buyNowPrice: body.buyNowPrice, durationHours: body.durationHours, endsAt, feeBp: econ().marketFeeBp })
      .returning();
    return { id: auction!.id, endsAt: endsAt.toISOString(), activeListings: active + 1 };
  });
}

/** "What you get": net after the 5 % fee at the starting and buy-now prices, and recycling instead. */
export async function quoteListing(me: UserRow, body: z.infer<typeof quoteListingSchema>): Promise<ListingQuote> {
  const [item] = await db().select().from(items).where(and(eq(items.id, body.itemId), eq(items.ownerId, me.id), ne(items.status, 'destroyed')));
  if (!item) return fail(404, 'not_found', 'Unknown item.');
  return {
    atStart: sellerNet(body.startPrice),
    atBuyNow: body.buyNowPrice === null ? null : sellerNet(body.buyNowPrice),
    feeAtStart: marketFee(body.startPrice),
    recycleValue: recycleValue(item),
  };
}

export async function sellInfo(me: UserRow, itemId: string): Promise<SellInfo> {
  await settleDue();
  const [item] = await findItems(db(), and(eq(items.id, itemId), eq(items.ownerId, me.id), ne(items.status, 'destroyed')));
  if (!item) return fail(404, 'not_found', 'Unknown item.');
  return {
    item,
    sales: await salesHistory(item.skin.id, item.stattrak, item.wear?.code ?? null, 'window'),
    activeListings: await activeListings(db(), me.id),
    maxListings: econ().maxListings,
    maxPrice: econ().maxPrice,
    durations: [...econ().durationsH],
  };
}

/**
 * Staff cancel (ban, account deletion, item moved by staff): the leading bid is refunded, the item
 * goes back to the seller as available, no fee. The auction and all players involved (seller,
 * leader) are locked by the caller, in that order; the caller saves the wallets.
 */
export async function cancelAuctionByStaff(tx: Tx, auction: AuctionRow, reason: 'ban' | 'admin' | 'deleted', wallets: Wallets, by: string | null = null) {
  const refs = { refId: auction.id, itemId: auction.itemId };
  const refund = auction.leaderId && auction.currentBid !== null ? { userId: auction.leaderId, amount: auction.currentBid } : null;
  if (refund) wallets.move(refund.userId, 'bid_release', refund.amount, refs);
  await tx.update(items).set({ status: 'available' }).where(and(eq(items.id, auction.itemId), eq(items.status, 'listed')));
  await tx.update(auctions).set({ status: 'cancelled', closedAt: new Date(), cancelReason: reason, cancelledBy: by }).where(eq(auctions.id, auction.id));
  return refund;
}

/**
 * Staff removes the leading bid of a banned or deleted player: it is refunded and the auction has no
 * leader any more (the next bid starts at the starting price). Their bids on it are dropped so the
 * history stays coherent; everyone else was refunded when outbid. Locks as above.
 */
export async function dropLeadingBid(tx: Tx, auction: AuctionRow, wallets: Wallets) {
  if (!auction.leaderId || auction.currentBid === null) return null;
  const refund = { userId: auction.leaderId, amount: auction.currentBid };
  wallets.move(refund.userId, 'bid_release', refund.amount, { refId: auction.id, itemId: auction.itemId });
  await tx.delete(bids).where(and(eq(bids.auctionId, auction.id), eq(bids.userId, refund.userId)));
  const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(bids).where(eq(bids.auctionId, auction.id));
  await tx.update(auctions).set({ leaderId: null, currentBid: null, bidCount: left?.n ?? 0 }).where(eq(auctions.id, auction.id));
  return refund;
}

/** Seller only, while nobody has bid: the item goes back to the inventory. */
export async function cancelListing(me: UserRow, id: string): Promise<AuctionDetail> {
  const ended = await db().transaction(async (tx) => {
    const auction = await lockAuction(tx, id);
    if (auction.sellerId !== me.id) fail(404, 'not_found', 'Unknown auction.');
    if (auction.status !== 'active') fail(409, 'auction_ended', 'This auction has ended.');
    if (auction.endsAt <= new Date()) {
      await settle(tx, auction);
      return true;
    }
    if (auction.bidCount > 0) fail(409, 'conflict', 'Someone already bid: the listing can’t be cancelled.');
    await tx.update(items).set({ status: 'available' }).where(and(eq(items.id, auction.itemId), eq(items.status, 'listed')));
    await tx.update(auctions).set({ status: 'cancelled', closedAt: new Date() }).where(eq(auctions.id, auction.id));
    return false;
  });
  if (ended) fail(409, 'auction_ended', 'This auction has ended.');
  return (await auctionDetail(me, id))!;
}

// ── Bids ────────────────────────────────────────────────────────────────────

/**
 * Places a bid: at least the starting price, then 5 % above the current bid. The amount is taken
 * from the bidder's balance and the previous leader gets theirs back, in the same transaction.
 */
export async function placeBid(me: UserRow, id: string, amount: number): Promise<BidResult> {
  const outcome = await db().transaction(async (tx) => {
    const auction = await openAuctionOrEnd(tx, id);
    if (!auction) return null;
    if (auction.sellerId === me.id) fail(403, 'forbidden', 'You can’t bid on your own listing.');
    if (auction.leaderId === me.id) fail(409, 'conflict', 'You already have the highest bid.');
    const min = minNextBid(auction.currentBid, auction.startPrice);
    if (amount < min) {
      fail(400, 'bid_too_low', auction.currentBid === null ? `The first bid has to be at least the starting price, ${fmt(min)} CR.` : `Your bid has to be at least ${fmt(min)} CR, 5% above the current one.`);
    }
    const bidders = await lockUsers(tx, auction.leaderId ? [me.id, auction.leaderId] : [me.id]);
    assertNotBanned(bidders.get(me.id)!);
    const wallets = new Wallets(bidders);
    if (wallets.get(me.id) < amount) fail(402, 'insufficient_balance', `You only have ${fmt(wallets.get(me.id))} CR available.`);
    const refs = { refId: auction.id, itemId: auction.itemId };
    if (auction.leaderId && auction.currentBid !== null) wallets.move(auction.leaderId, 'bid_release', auction.currentBid, refs);
    wallets.move(me.id, 'bid_hold', -amount, refs);
    await wallets.save(tx);
    const now = new Date();
    const { endsAt, extended } = endAfterBid(auction.endsAt, now);
    await tx.insert(bids).values({ auctionId: auction.id, userId: me.id, amount, createdAt: now });
    await tx.update(auctions).set({ leaderId: me.id, currentBid: amount, bidCount: auction.bidCount + 1, endsAt }).where(eq(auctions.id, auction.id));
    return { extended, balance: wallets.get(me.id) };
  });
  if (!outcome) return fail(409, 'auction_ended', 'This auction has ended.');
  return { ...outcome, auction: (await auctionDetail(me, id))!, heldInBids: await heldInBids(me.id) };
}

/** Buys at the buy-now price while the current bid is below it: the leader is refunded, the sale closes now. */
export async function buyNow(me: UserRow, id: string): Promise<BuyNowResult> {
  const balance = await db().transaction(async (tx) => {
    const auction = await openAuctionOrEnd(tx, id);
    if (!auction) return null;
    if (auction.sellerId === me.id) fail(403, 'forbidden', 'You can’t buy your own listing.');
    const priceNow = auction.buyNowPrice;
    if (priceNow === null) return fail(409, 'conflict', 'This listing has no buy-now price.');
    if (auction.currentBid !== null && auction.currentBid >= priceNow) fail(409, 'conflict', 'Bids are already at the buy-now price.');
    const buyers = await lockUsers(tx, [me.id, auction.sellerId, ...(auction.leaderId ? [auction.leaderId] : [])]);
    assertNotBanned(buyers.get(me.id)!);
    const wallets = new Wallets(buyers);
    const refs = { refId: auction.id, itemId: auction.itemId };
    if (auction.leaderId && auction.currentBid !== null) wallets.move(auction.leaderId, 'bid_release', auction.currentBid, refs);
    if (wallets.get(me.id) < priceNow) fail(402, 'insufficient_balance', `You need ${fmt(priceNow)} CR to buy it now.`);
    wallets.move(me.id, 'auction_buy', -priceNow, refs);
    const now = new Date();
    const fee = await transferSold(tx, auction, me.id, priceNow, now, wallets);
    await wallets.save(tx);
    await tx.update(auctions).set({ status: 'sold', buyerId: me.id, finalPrice: priceNow, fee, boughtNow: true, closedAt: now }).where(eq(auctions.id, auction.id));
    return wallets.get(me.id);
  });
  if (balance === null) return fail(409, 'auction_ended', 'This auction has ended.');
  return { auction: (await auctionDetail(me, id))!, balance, heldInBids: await heldInBids(me.id) };
}

// ── Reads ───────────────────────────────────────────────────────────────────

function auctionSelect(tx: DbOrTx, viewerId: string | null) {
  const myBid = viewerId
    ? sql<boolean>`EXISTS (SELECT 1 FROM ${bids} WHERE ${bids.auctionId} = ${auctions.id} AND ${bids.userId} = ${viewerId})`
    : sql<boolean>`false`;
  return tx
    .select({ auction: auctions, item: items, skin: skins, crateId: sourceCrate.id, crateName: sourceCrate.name, value: itemValueExpr(), recycleValue: recycleValueExpr(), myBid })
    .from(auctions)
    .innerJoin(items, eq(items.id, auctions.itemId))
    .innerJoin(skins, eq(skins.id, items.skinId))
    .leftJoin(sourceCrate, eq(sourceCrate.id, items.sourceCrateId));
}

type AuctionJoinRow = Awaited<ReturnType<ReturnType<typeof auctionSelect>['where']>>[number];

function roleOf(a: AuctionRow, viewerId: string | null, myBid: boolean): AuctionRole {
  if (!viewerId) return null;
  if (a.sellerId === viewerId) return 'seller';
  if (a.status === 'active') return a.leaderId === viewerId ? 'leading' : myBid ? 'outbid' : null;
  if (a.status === 'sold' && a.buyerId === viewerId) return 'won';
  return myBid ? 'lost' : null;
}

function toCard(row: AuctionJoinRow, viewerId: string | null): AuctionCard {
  const a = row.auction;
  return {
    id: a.id,
    item: toItem(row),
    status: a.status,
    startPrice: a.startPrice,
    currentBid: a.currentBid,
    bidCount: a.bidCount,
    buyNowPrice: a.buyNowPrice,
    createdAt: a.createdAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    closedAt: a.closedAt?.toISOString() ?? null,
    finalPrice: a.finalPrice,
    role: roleOf(a, viewerId, row.myBid),
  };
}

const SORTS: Record<MarketSort, SQL[]> = {
  ending: [asc(auctions.endsAt)],
  newest: [desc(auctions.createdAt)],
  price: [sql`COALESCE(${auctions.currentBid}, ${auctions.startPrice}) ASC`],
  bids: [desc(auctions.bidCount), asc(auctions.endsAt)],
};

const live = () => and(eq(auctions.status, 'active'), gt(auctions.endsAt, sql`now()`));
const recentlyClosed = () => gt(auctions.closedAt, sql`now() - ${`${MARKET_ENDED_VISIBLE_DAYS} days`}::interval`);
const bidBy = (userId: string) => exists(db().select({ one: sql`1` }).from(bids).where(and(eq(bids.auctionId, auctions.id), eq(bids.userId, userId))));

function tabWhere(tab: MarketTab, viewer: UserRow): SQL | undefined {
  // Your own listings show in Browse too, tagged "Your listing".
  if (tab === 'browse') return live();
  if (tab === 'mine') return and(eq(auctions.sellerId, viewer.id), or(eq(auctions.status, 'active'), recentlyClosed()));
  return and(or(bidBy(viewer.id), eq(auctions.buyerId, viewer.id)), or(eq(auctions.status, 'active'), recentlyClosed()));
}

const countWhere = async (where: SQL | undefined) =>
  (await db().select({ n: sql<number>`count(*)::int` }).from(auctions).where(where))[0]?.n ?? 0;

/** Market tabs. Guests can browse; their "mine" and "bids" are empty. */
export async function listMarket(viewer: UserRow, query: MarketQuery): Promise<MarketPage> {
  await settleDue();
  const guest = viewer.isGuest;
  const filters = and(
    nameMatches(skins.name, query.q),
    query.tier ? eq(items.tier, query.tier as Tier) : undefined,
  );
  const rows =
    guest && query.tab !== 'browse'
      ? []
      : await auctionSelect(db(), viewer.id)
          .where(and(tabWhere(query.tab, viewer), filters))
          // Running auctions first in "My listings" / "My bids", ended ones after.
          .orderBy(sql`(${auctions.status} <> 'active')`, ...SORTS[query.sort], desc(auctions.closedAt), asc(auctions.id))
          .limit(PAGE_SIZE + 1)
          .offset(query.offset);
  const [browse, mine, mineBids] = await Promise.all([
    countWhere(live()),
    guest ? 0 : countWhere(and(eq(auctions.sellerId, viewer.id), eq(auctions.status, 'active'))),
    guest ? 0 : countWhere(and(eq(auctions.status, 'active'), bidBy(viewer.id))),
  ]);
  return {
    auctions: rows.slice(0, PAGE_SIZE).map((r) => toCard(r, viewer.id)),
    hasMore: rows.length > PAGE_SIZE,
    counts: { browse, mine, bids: mineBids },
    maxListings: econ().maxListings,
    serverNow: new Date().toISOString(),
  };
}

/** One auction for the viewer (guests included: they can look, not bid). */
export async function auctionDetail(viewer: UserRow, id: string): Promise<AuctionDetail | null> {
  const [row] = await auctionSelect(db(), viewer.id).where(eq(auctions.id, id));
  if (!row) return null;
  if (row.auction.status === 'active' && row.auction.endsAt <= new Date() && (await settleOne(id))) return auctionDetail(viewer, id);
  const a = row.auction;
  const people = [...new Set([a.sellerId, a.leaderId, a.buyerId].filter((x): x is string => !!x))];
  const [players, history, salesSeen] = await Promise.all([
    db().select().from(users).where(inArray(users.id, people)),
    db()
      .select({ bid: bids, user: users })
      .from(bids)
      .innerJoin(users, eq(users.id, bids.userId))
      .where(eq(bids.auctionId, a.id))
      .orderBy(desc(bids.createdAt), desc(bids.id))
      .limit(50),
    salesHistory(row.skin.id, row.item.stattrak, wearOf(row.item.float)?.code ?? null, 'last'),
  ]);
  const ref = (userId: string | null) => {
    const u = userId ? players.find((p) => p.id === userId) : undefined;
    return u ? playerRef(u) : null;
  };
  const running = a.status === 'active';
  const account = !viewer.isGuest;
  const isSeller = a.sellerId === viewer.id;
  return {
    ...toCard(row, viewer.id),
    seller: ref(a.sellerId)!,
    durationHours: a.durationHours,
    leader: ref(a.leaderId),
    buyer: ref(a.buyerId),
    boughtNow: a.boughtNow,
    fee: isSeller ? a.fee : null,
    feePct: a.feeBp / 100,
    bids: history.map((h) => ({ player: playerRef(h.user), amount: h.bid.amount, createdAt: h.bid.createdAt.toISOString(), isYou: h.user.id === viewer.id })),
    minNextBid: minNextBid(a.currentBid, a.startPrice),
    quickBids: quickBids(a.currentBid, a.startPrice),
    canBid: running && account && !isSeller && a.leaderId !== viewer.id,
    canBuyNow: running && account && !isSeller && a.buyNowPrice !== null && (a.currentBid === null || a.currentBid < a.buyNowPrice),
    canCancel: running && isSeller && a.bidCount === 0,
    sales: salesSeen,
    serverNow: new Date().toISOString(),
  };
}

/** The open auction of an item, for its page ("Listed · see the auction"). */
export async function openListingOf(itemId: string): Promise<{ auctionId: string; endsAt: string } | null> {
  const [row] = await db().select({ id: auctions.id, endsAt: auctions.endsAt }).from(auctions).where(and(eq(auctions.itemId, itemId), eq(auctions.status, 'active')));
  return row ? { auctionId: row.id, endsAt: row.endsAt.toISOString() } : null;
}

/**
 * Sales of a skin in one wear, StatTrak or not. `window`: the last 30 days (item page, sell page);
 * `last`: the last 10 sales whenever they happened (auction page).
 */
export async function salesHistory(skinId: string, stattrak: boolean, wear: WearCode | null, mode: 'window' | 'last'): Promise<SalesHistory> {
  const to = new Date();
  const from = new Date(to.getTime() - SALES_WINDOW_DAYS * DAY_MS);
  const rows = await db()
    .select({ price: sales.price, at: sales.soldAt })
    .from(sales)
    .where(and(eq(sales.skinId, skinId), eq(sales.stattrak, stattrak), wear === null ? sql`${sales.wear} IS NULL` : eq(sales.wear, wear), mode === 'window' ? gt(sales.soldAt, from) : undefined))
    .orderBy(desc(sales.soldAt), desc(sales.id))
    .limit(mode === 'window' ? 500 : AUCTION_PAGE_SALES);
  const points = rows.reverse().map((r) => ({ price: r.price, at: r.at.toISOString() }));
  const total = points.reduce((sum, p) => sum + p.price, 0);
  return {
    stattrak,
    wear,
    count: points.length,
    average: points.length ? Math.round(total / points.length) : null,
    last: points.length ? points[points.length - 1]!.price : null,
    points,
    from: (mode === 'window' ? from : new Date(points[0]?.at ?? to)).toISOString(),
    to: to.toISOString(),
  };
}
