import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../server/db/client.js';
import { activity, auctions, items, ledger, sales, showcase, users } from '../../server/db/schema.js';
import { type Account, befriend, Client, giveItem, newAccount, newGuest, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

async function ledgerMatchesBalances() {
  const rows = await db().execute<{ balance: number; total: number }>(
    sql`SELECT u.balance, COALESCE(SUM(l.amount), 0)::bigint AS total FROM users u LEFT JOIN ledger l ON l.user_id = u.id GROUP BY u.id`,
  );
  return rows.rows.every((r) => Number(r.balance) === Number(r.total));
}

const list = (seller: Account, itemId: string, body: Record<string, unknown> = {}) =>
  seller.client.json('/market/listings', { method: 'POST', json: { itemId, startPrice: 1000, buyNowPrice: null, durationHours: 24, ...body } });
const bid = (who: Account, id: string, amount: number) => who.client.json(`/market/auctions/${id}/bid`, { method: 'POST', json: { amount } });
const itemOf = async (id: string) => (await db().select().from(items).where(eq(items.id, id)))[0]!;
const balanceOf = async (id: string) => (await db().select().from(users).where(eq(users.id, id)))[0]!.balance;
const endNow = (id: string) => db().update(auctions).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(auctions.id, id));

async function trio() {
  return { lou: await newAccount('lou'), vex: await newAccount('vex'), kenji: await newAccount('kenji') };
}

describe('listing', () => {
  it('locks the item, checks the prices, the owner and the 10 listings limit', async () => {
    const { lou, vex } = await trio();
    const item = await giveItem(lou.user.id, 'covert');
    expect((await list(lou, item.id, { buyNowPrice: 900 })).status).toBe(400);
    expect((await list(vex, item.id)).status).toBe(409);
    const res = await list(lou, item.id, { buyNowPrice: 4800, durationHours: 48 });
    expect(res.status).toBe(201);
    expect(res.body.activeListings).toBe(1);
    expect((await itemOf(item.id)).status).toBe('listed');
    expect((await list(lou, item.id)).status).toBe(409);
    // A listed item can't be recycled or offered in a trade.
    expect((await lou.client.json('/items/recycle', { method: 'POST', json: { itemIds: [item.id], confirm: true } })).status).toBe(409);
    await befriend(lou, vex);
    const trade = await lou.client.json('/trades', { method: 'POST', json: { to: 'vex', giveItemIds: [item.id], askItemIds: [], giveCredits: 0, askCredits: 0, expiresInDays: 3 } });
    expect(trade.status).toBe(409);

    for (let i = 0; i < 9; i++) expect((await list(lou, (await giveItem(lou.user.id, 'milspec')).id)).status).toBe(201);
    const eleventh = await list(lou, (await giveItem(lou.user.id, 'milspec')).id);
    expect(eleventh).toMatchObject({ status: 409, body: { error: { code: 'limit_reached' } } });
  });

  it('guests can browse but not list or bid', async () => {
    const { lou } = await trio();
    const { id } = (await list(lou, (await giveItem(lou.user.id, 'covert')).id)).body;
    const guest = await newGuest();
    const page = (await guest.json('/market')).body;
    expect(page.auctions.map((a: { id: string }) => a.id)).toEqual([id]);
    expect((await guest.json(`/market/auctions/${id}`)).body).toMatchObject({ canBid: false, canBuyNow: false });
    expect((await guest.json(`/market/auctions/${id}/bid`, { method: 'POST', json: { amount: 1000 } })).status).toBe(403);
  });

  it('the seller can cancel while nobody has bid', async () => {
    const { lou, vex } = await trio();
    const item = await giveItem(lou.user.id, 'covert');
    const first = (await list(lou, item.id)).body.id;
    expect((await vex.client.json(`/market/auctions/${first}/cancel`, { method: 'POST' })).status).toBe(404);
    expect((await lou.client.json(`/market/auctions/${first}/cancel`, { method: 'POST' })).body.status).toBe('cancelled');
    expect((await itemOf(item.id)).status).toBe('available');
    const second = (await list(lou, item.id)).body.id;
    await bid(vex, second, 1000);
    expect((await lou.client.json(`/market/auctions/${second}/cancel`, { method: 'POST' })).status).toBe(409);
  });
});

describe('bidding', () => {
  it('holds the bid, refunds the previous leader, enforces +5 % and forbids your own listing', async () => {
    const { lou, vex, kenji } = await trio();
    const { id } = (await list(lou, (await giveItem(lou.user.id, 'covert')).id, { startPrice: 500 })).body;
    expect((await bid(lou, id, 500)).status).toBe(403);
    expect((await bid(vex, id, 499)).body.error.code).toBe('bid_too_low');
    const first = await bid(vex, id, 500);
    expect(first.body).toMatchObject({ balance: 500, heldInBids: 500, extended: false });
    expect(first.body.auction).toMatchObject({ currentBid: 500, bidCount: 1, role: 'leading', minNextBid: 525, canBid: false });
    expect((await bid(vex, id, 600)).status).toBe(409);
    expect((await bid(kenji, id, 524)).status).toBe(400);
    expect((await bid(kenji, id, 525)).status).toBe(200);
    expect(await balanceOf(vex.user.id)).toBe(1000);
    expect(await balanceOf(kenji.user.id)).toBe(1000 - 525);
    expect((await vex.client.json('/me')).body.heldInBids).toBe(0);
    expect((await kenji.client.json('/me')).body.heldInBids).toBe(525);
    expect((await vex.client.json(`/market/auctions/${id}`)).body.role).toBe('outbid');
    expect((await bid(vex, id, 5000)).status).toBe(402);
    expect(await ledgerMatchesBalances()).toBe(true);
  });

  it('a bid in the last 2 minutes adds 2 minutes', async () => {
    const { lou, vex } = await trio();
    const { id } = (await list(lou, (await giveItem(lou.user.id, 'covert')).id, { startPrice: 100 })).body;
    const soon = new Date(Date.now() + 60_000);
    await db().update(auctions).set({ endsAt: soon }).where(eq(auctions.id, id));
    const res = await bid(vex, id, 100);
    expect(res.body.extended).toBe(true);
    expect(new Date(res.body.auction.endsAt).getTime()).toBe(soon.getTime() + 120_000);
  });

  it('two bids at the same time: one wins, nobody pays twice', async () => {
    const { lou, vex, kenji } = await trio();
    const { id } = (await list(lou, (await giveItem(lou.user.id, 'covert')).id, { startPrice: 100 })).body;
    const results = await Promise.all([bid(vex, id, 100), bid(kenji, id, 100)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const [row] = await db().select().from(auctions).where(eq(auctions.id, id));
    expect(row).toMatchObject({ currentBid: 100, bidCount: 1 });
    expect((await balanceOf(vex.user.id)) + (await balanceOf(kenji.user.id))).toBe(2000 - 100);
    expect(await ledgerMatchesBalances()).toBe(true);
  });

  it('a bid after the end is refused even before the auction is settled', async () => {
    const { lou, vex, kenji } = await trio();
    const item = await giveItem(lou.user.id, 'covert');
    const { id } = (await list(lou, item.id, { startPrice: 100 })).body;
    await bid(vex, id, 100);
    await endNow(id);
    const late = await bid(kenji, id, 500);
    expect(late.body.error.code).toBe('auction_ended');
    expect((await itemOf(item.id)).ownerId).toBe(vex.user.id);
    expect(await balanceOf(kenji.user.id)).toBe(1000);
  });
});

describe('buy now and settlement', () => {
  it('buy now refunds the leader, charges the buyer, pays the seller minus 5 %', async () => {
    const { lou, vex, kenji } = await trio();
    const item = await giveItem(lou.user.id, 'covert');
    await lou.client.json('/me/showcase', { method: 'PUT', json: { itemIds: [item.id] } });
    const { id } = (await list(lou, item.id, { startPrice: 300, buyNowPrice: 900 })).body;
    await bid(vex, id, 300);
    expect((await lou.client.json(`/market/auctions/${id}/buy`, { method: 'POST' })).status).toBe(403);
    const res = await kenji.client.json(`/market/auctions/${id}/buy`, { method: 'POST' });
    expect(res.body).toMatchObject({ balance: 100, heldInBids: 0, auction: { status: 'sold', role: 'won', finalPrice: 900, boughtNow: true } });
    expect(await balanceOf(vex.user.id)).toBe(1000);
    expect(await balanceOf(lou.user.id)).toBe(1000 + 900 - 45);
    expect(await itemOf(item.id)).toMatchObject({ ownerId: kenji.user.id, status: 'available', acquiredVia: 'market' });
    expect(await db().select().from(showcase).where(eq(showcase.itemId, item.id))).toHaveLength(0);
    expect((await vex.client.json(`/market/auctions/${id}/buy`, { method: 'POST' })).body.error.code).toBe('auction_ended');
    const fees = await db().select().from(ledger).where(eq(ledger.type, 'auction_fee'));
    expect(fees.map((f) => f.amount)).toEqual([-45]);
    expect(await ledgerMatchesBalances()).toBe(true);
  });

  it('buy now is gone once the bids reach it', async () => {
    const { lou, vex, kenji } = await trio();
    const { id } = (await list(lou, (await giveItem(lou.user.id, 'covert')).id, { startPrice: 300, buyNowPrice: 400 })).body;
    await bid(vex, id, 400);
    expect((await kenji.client.json(`/market/auctions/${id}`)).body.canBuyNow).toBe(false);
    expect((await kenji.client.json(`/market/auctions/${id}/buy`, { method: 'POST' })).status).toBe(409);
  });

  it('settles on read: the winner gets the item, the seller the price minus the fee, the sale is recorded', async () => {
    const { lou, vex, kenji } = await trio();
    await befriend(kenji, lou);
    const item = await giveItem(lou.user.id, 'classified');
    const { id } = (await list(lou, item.id, { startPrice: 95 })).body;
    await bid(vex, id, 95);
    await endNow(id);
    const me = (await lou.client.json('/me')).body;
    expect(me.balance).toBe(1000 + 95 - 5);
    expect(await itemOf(item.id)).toMatchObject({ ownerId: vex.user.id, status: 'available' });
    expect(await balanceOf(vex.user.id)).toBe(1000 - 95);
    const [sale] = await db().select().from(sales);
    expect(sale).toMatchObject({ skinId: 'c1', stattrak: false, wear: 'FT', price: 95 });
    const feed = (await kenji.client.json('/feed')).body;
    expect(feed[0]).toMatchObject({ type: 'sale', price: 95, player: { username: 'lou' } });
    const detail = (await vex.client.json(`/items/${item.id}`)).body;
    expect(detail).toMatchObject({ acquiredVia: 'market', sales: { count: 1, average: 95, last: 95 } });
    expect((await lou.client.json('/market?tab=mine')).body.auctions[0]).toMatchObject({ status: 'sold', role: 'seller' });
    expect((await vex.client.json('/market?tab=bids')).body.auctions[0]).toMatchObject({ status: 'sold', role: 'won' });
    expect(await ledgerMatchesBalances()).toBe(true);
  });

  it('no bid: the item comes back; the cron settles too, and only once', async () => {
    const { lou, vex } = await trio();
    const a = await giveItem(lou.user.id, 'milspec');
    const b = await giveItem(lou.user.id, 'covert');
    const unsold = (await list(lou, a.id)).body.id;
    const sold = (await list(lou, b.id, { startPrice: 200 })).body.id;
    await bid(vex, sold, 200);
    await endNow(unsold);
    await endNow(sold);
    const cron = () => new Client().json('/cron/settle-auctions', { headers: { authorization: 'Bearer test-cron' } });
    expect((await cron()).body.settled).toBe(2);
    expect((await cron()).body.settled).toBe(0);
    expect((await itemOf(a.id)).status).toBe('available');
    expect((await itemOf(b.id)).ownerId).toBe(vex.user.id);
    expect(await balanceOf(lou.user.id)).toBe(1000 + 200 - 10);
    expect(await db().select().from(activity).where(eq(activity.type, 'sale'))).toHaveLength(1);
    expect(await ledgerMatchesBalances()).toBe(true);
  });
});

describe('search suggestions', () => {
  const names = (body: { skin: { id: string }; count: number }[]) => body.map((s) => `${s.skin.id}×${s.count}`);

  it('suggests the skins of your inventory, every word matching, rarest first', async () => {
    const { lou } = await trio();
    await giveItem(lou.user.id, 'milspec');
    await giveItem(lou.user.id, 'milspec');
    await giveItem(lou.user.id, 'covert');
    expect(names((await lou.client.json('/skins/suggest?q=gun')).body)).toEqual(['k1×1', 'm1×2']);
    expect(names((await lou.client.json('/skins/suggest?q=m1%20gun')).body)).toEqual(['m1×2']);
    expect((await lou.client.json('/skins/suggest?q=g')).body).toEqual([]);
    // The inventory search uses the same words.
    expect((await lou.client.json('/inventory?q=m1%20gun')).body.matched).toBe(2);
  });

  it('suggests listed skins on the market, and a friend’s inventory only to friends', async () => {
    const { lou, vex } = await trio();
    await list(lou, (await giveItem(lou.user.id, 'covert')).id);
    await giveItem(lou.user.id, 'milspec');
    expect(names((await vex.client.json('/skins/suggest?q=gun&scope=market')).body)).toEqual(['k1×1']);
    expect((await vex.client.json('/skins/suggest?q=gun&player=lou')).status).toBe(403);
    await befriend(lou, vex);
    expect(names((await vex.client.json('/skins/suggest?q=gun&player=lou')).body)).toEqual(['k1×1', 'm1×1']);
  });
});

describe('market views', () => {
  it('browse shows your own listings too (tagged), filters and sorts on the server, counts the tabs', async () => {
    const { lou, vex } = await trio();
    const cheap = (await list(lou, (await giveItem(lou.user.id, 'milspec')).id, { startPrice: 50 })).body.id;
    const dear = (await list(lou, (await giveItem(lou.user.id, 'covert')).id, { startPrice: 3000 })).body.id;
    const own = (await list(vex, (await giveItem(vex.user.id, 'restricted')).id)).body.id;
    await bid(vex, cheap, 50);
    const page = (await vex.client.json('/market?sort=price')).body;
    expect(page.auctions.map((a: { id: string }) => a.id)).toEqual([cheap, own, dear]);
    expect(page.counts).toEqual({ browse: 3, mine: 1, bids: 1 });
    expect(page.auctions[0]).toMatchObject({ role: 'leading', currentBid: 50 });
    expect(page.auctions[1]).toMatchObject({ role: 'seller' });
    expect((await vex.client.json('/market?tier=covert')).body.auctions.map((a: { id: string }) => a.id)).toEqual([dear]);
    expect((await vex.client.json('/market?q=k1')).body.auctions.map((a: { id: string }) => a.id)).toEqual([dear]);
    expect((await vex.client.json('/market?tab=bids')).body.auctions.map((a: { id: string }) => a.id)).toEqual([cheap]);
  });

  it('sell page data and quote come from the server', async () => {
    const { lou } = await trio();
    const item = await giveItem(lou.user.id, 'covert');
    const info = (await lou.client.json(`/market/sell?item=${item.id}`)).body;
    expect(info).toMatchObject({ activeListings: 0, maxListings: 10, durations: [24, 48], sales: { count: 0, average: null } });
    const quote = (await lou.client.json('/market/quote', { method: 'POST', json: { itemId: item.id, startPrice: 6500, buyNowPrice: 9000 } })).body;
    expect(quote).toEqual({ atStart: 6175, atBuyNow: 8550, feeAtStart: 325, recycleValue: 2500 });
    const page = (await lou.client.json(`/items/${item.id}`)).body;
    expect(page).toMatchObject({ canList: true, listing: null });
    const { id } = (await list(lou, item.id)).body;
    expect((await lou.client.json(`/items/${item.id}`)).body).toMatchObject({ canList: false, canRecycle: false, listing: { auctionId: id } });
  });
});
