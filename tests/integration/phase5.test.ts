import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../server/db/client.js';
import { items, ledger, showcase, trades, users } from '../../server/db/schema.js';
import { type Account, befriend, giveItem, newAccount, newGuest, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

async function ledgerMatchesBalances() {
  const rows = await db().execute<{ balance: number; total: number }>(
    sql`SELECT u.balance, COALESCE(SUM(l.amount), 0)::bigint AS total FROM users u LEFT JOIN ledger l ON l.user_id = u.id GROUP BY u.id`,
  );
  return rows.rows.every((r) => Number(r.balance) === Number(r.total));
}

const offer = (from: Account, body: Record<string, unknown>) =>
  from.client.json('/trades', { method: 'POST', json: { giveItemIds: [], askItemIds: [], giveCredits: 0, askCredits: 0, expiresInDays: 3, ...body } });

async function pair() {
  const vex = await newAccount('vex');
  const kenji = await newAccount('kenji');
  await befriend(vex, kenji);
  return { vex, kenji };
}

const statusOf = async (id: string) => (await db().select().from(items).where(eq(items.id, id)))[0]!;
const balanceOf = async (id: string) => (await db().select().from(users).where(eq(users.id, id)))[0]!.balance;

describe('sending an offer', () => {
  it('locks the sender’s items, holds their credits, leaves the asked items free', async () => {
    const { vex, kenji } = await pair();
    const mine = await giveItem(vex.user.id, 'covert');
    const theirs = await giveItem(kenji.user.id, 'classified');
    const res = await offer(vex, { to: 'kenji', giveItemIds: [mine.id], askItemIds: [theirs.id], giveCredits: 200 });
    expect(res.status).toBe(201);
    expect((await statusOf(mine.id)).status).toBe('in_trade');
    expect((await statusOf(theirs.id)).status).toBe('available');
    expect(await balanceOf(vex.user.id)).toBe(800);
    expect((await kenji.client.json('/me')).body.tradeOffers).toBe(1);
    expect(await ledgerMatchesBalances()).toBe(true);
    // A locked item can be neither recycled nor offered again.
    expect((await vex.client.json('/items/recycle', { method: 'POST', json: { itemIds: [mine.id], confirm: true } })).status).toBe(409);
    expect((await offer(vex, { to: 'kenji', giveItemIds: [mine.id] })).status).toBe(409);
  });

  it('only with friends, at least one item, your own available items, within your balance', async () => {
    const { vex, kenji } = await pair();
    const lou = await newAccount('lou');
    const mine = await giveItem(vex.user.id, 'milspec');
    const listed = await giveItem(vex.user.id, 'milspec', { status: 'listed' });
    const theirs = await giveItem(kenji.user.id, 'milspec');
    expect((await offer(vex, { to: 'lou', giveItemIds: [mine.id] })).status).toBe(403);
    expect((await offer(vex, { to: 'kenji', giveCredits: 100 })).status).toBe(400);
    expect((await offer(vex, { to: 'kenji', giveItemIds: [theirs.id] })).status).toBe(409);
    expect((await offer(vex, { to: 'kenji', giveItemIds: [listed.id] })).status).toBe(409);
    expect((await offer(vex, { to: 'kenji', giveItemIds: [mine.id], giveCredits: 5000 })).status).toBe(402);
    expect((await offer(vex, { to: 'kenji', giveItemIds: [mine.id], expiresInDays: 2 })).status).toBe(400);
    const guest = await newGuest();
    expect((await guest.json('/trades')).status).toBe(403);
    void lou;
  });
});

describe('accepting', () => {
  it('swaps items and credits both ways in one go', async () => {
    const { vex, kenji } = await pair();
    const mine = await giveItem(vex.user.id, 'covert');
    const theirs = await giveItem(kenji.user.id, 'classified');
    await kenji.client.json('/me/showcase', { method: 'PUT', json: { itemIds: [theirs.id] } });
    const { id } = (await offer(vex, { to: 'kenji', giveItemIds: [mine.id], askItemIds: [theirs.id], giveCredits: 200, askCredits: 50 })).body;
    const res = await kenji.client.json(`/trades/${id}/accept`, { method: 'POST' });
    expect(res.body).toMatchObject({ status: 'accepted', balance: 1000 + 200 - 50 });
    expect(await statusOf(mine.id)).toMatchObject({ ownerId: kenji.user.id, status: 'available', acquiredVia: 'trade', originalOwnerId: vex.user.id });
    expect(await statusOf(theirs.id)).toMatchObject({ ownerId: vex.user.id, status: 'available', acquiredVia: 'trade' });
    expect(await balanceOf(vex.user.id)).toBe(1000 - 200 + 50);
    expect(await db().select().from(showcase).where(eq(showcase.itemId, theirs.id))).toHaveLength(0);
    const moves = await db().select().from(ledger).where(inArray(ledger.type, ['trade_item_in', 'trade_item_out']));
    expect(moves).toHaveLength(4);
    expect(await ledgerMatchesBalances()).toBe(true);
    const detail = (await vex.client.json(`/items/${theirs.id}`)).body;
    expect(detail).toMatchObject({ acquiredVia: 'trade', canRecycle: true });
    expect((await vex.client.json('/players/kenji')).body.stats).toMatchObject({ tradesCompleted: 1 });
  });

  it('cancels instead when an asked item is gone', async () => {
    const { vex, kenji } = await pair();
    const mine = await giveItem(vex.user.id, 'covert');
    const theirs = await giveItem(kenji.user.id, 'milspec');
    const { id } = (await offer(vex, { to: 'kenji', giveItemIds: [mine.id], askItemIds: [theirs.id], giveCredits: 100 })).body;
    await kenji.client.json('/items/recycle', { method: 'POST', json: { itemIds: [theirs.id] } });
    const res = await kenji.client.json(`/trades/${id}/accept`, { method: 'POST' });
    expect(res.body.status).toBe('cancelled');
    expect(res.body.reason).toMatch(/no longer available/);
    expect((await statusOf(mine.id)).status).toBe('available');
    expect(await balanceOf(vex.user.id)).toBe(1000);
    expect(await ledgerMatchesBalances()).toBe(true);
  });

  it('refuses when the recipient lacks the asked credits, and only the recipient can accept', async () => {
    const { vex, kenji } = await pair();
    const mine = await giveItem(vex.user.id, 'covert');
    const { id } = (await offer(vex, { to: 'kenji', giveItemIds: [mine.id], askCredits: 5000 })).body;
    expect((await vex.client.json(`/trades/${id}/accept`, { method: 'POST' })).status).toBe(404);
    expect((await kenji.client.json(`/trades/${id}/accept`, { method: 'POST' })).status).toBe(402);
    expect((await statusOf(mine.id)).status).toBe('in_trade');
  });

  it('settles once when accept and cancel race', async () => {
    const { vex, kenji } = await pair();
    const mine = await giveItem(vex.user.id, 'covert');
    const { id } = (await offer(vex, { to: 'kenji', giveItemIds: [mine.id], giveCredits: 300 })).body;
    const [accept, cancel] = await Promise.all([
      kenji.client.json(`/trades/${id}/accept`, { method: 'POST' }),
      vex.client.json(`/trades/${id}/cancel`, { method: 'POST' }),
    ]);
    const statuses = [accept.status, cancel.status].sort();
    expect(statuses).toEqual([200, 409]);
    const [trade] = await db().select().from(trades).where(eq(trades.id, id));
    const item = await statusOf(mine.id);
    if (trade!.status === 'accepted') expect(item.ownerId).toBe(kenji.user.id);
    else expect(item).toMatchObject({ ownerId: vex.user.id, status: 'available' });
    expect(await ledgerMatchesBalances()).toBe(true);
  });
});

describe('declining, cancelling, expiring, countering', () => {
  it('declined and cancelled offers unlock items and refund credits', async () => {
    const { vex, kenji } = await pair();
    const a = await giveItem(vex.user.id, 'milspec');
    const b = await giveItem(vex.user.id, 'milspec');
    const first = (await offer(vex, { to: 'kenji', giveItemIds: [a.id], giveCredits: 100 })).body.id;
    const second = (await offer(vex, { to: 'kenji', giveItemIds: [b.id], giveCredits: 100 })).body.id;
    expect((await kenji.client.json(`/trades/${first}/decline`, { method: 'POST' })).body.status).toBe('declined');
    expect((await vex.client.json(`/trades/${second}/cancel`, { method: 'POST' })).body).toMatchObject({ status: 'cancelled', balance: 1000 });
    expect((await statusOf(a.id)).status).toBe('available');
    expect((await statusOf(b.id)).status).toBe('available');
    expect((await kenji.client.json(`/trades/${first}/decline`, { method: 'POST' })).status).toBe(409);
    const history = (await vex.client.json('/trades?box=history')).body;
    expect(history.map((t: { status: string }) => t.status).sort()).toEqual(['cancelled', 'declined']);
  });

  it('expires on read and through the cron', async () => {
    const { vex, kenji } = await pair();
    const a = await giveItem(vex.user.id, 'milspec');
    const b = await giveItem(vex.user.id, 'milspec');
    const first = (await offer(vex, { to: 'kenji', giveItemIds: [a.id], giveCredits: 100 })).body.id;
    const second = (await offer(vex, { to: 'kenji', giveItemIds: [b.id] })).body.id;
    await db().update(trades).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(trades.id, first));
    expect((await kenji.client.json('/me')).body.tradeOffers).toBe(1);
    expect((await kenji.client.json('/trades?box=received')).body.map((t: { id: string }) => t.id)).toEqual([second]);
    expect((await statusOf(a.id)).status).toBe('available');
    expect(await balanceOf(vex.user.id)).toBe(1000);

    await db().update(trades).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(trades.id, second));
    const { Client } = await import('./helpers.js');
    const cron = await new Client().json('/cron/expire-trades', { headers: { authorization: 'Bearer test-cron' } });
    expect(cron.body.expired).toBe(1);
    expect((await statusOf(b.id)).status).toBe('available');
    expect(await ledgerMatchesBalances()).toBe(true);
  });

  it('a counter-offer declines the original in the same transaction', async () => {
    const { vex, kenji } = await pair();
    const mine = await giveItem(vex.user.id, 'covert');
    const theirs = await giveItem(kenji.user.id, 'milspec');
    const original = (await offer(vex, { to: 'kenji', giveItemIds: [mine.id], askItemIds: [theirs.id], giveCredits: 100 })).body.id;
    const counter = await offer(kenji, { to: 'vex', giveItemIds: [theirs.id], askItemIds: [mine.id], counterOf: original });
    // vex's item is locked by the original offer until it is declined, then free to be asked for.
    expect(counter.status).toBe(201);
    const [row] = await db().select().from(trades).where(eq(trades.id, original));
    expect(row!.status).toBe('declined');
    expect((await statusOf(mine.id)).status).toBe('available');
    expect(await balanceOf(vex.user.id)).toBe(1000);
  });
});

describe('views', () => {
  it('shows each side from the viewer, with server totals and Album +1', async () => {
    const { vex, kenji } = await pair();
    const mine = await giveItem(vex.user.id, 'covert');
    const theirs = await giveItem(kenji.user.id, 'classified');
    await offer(vex, { to: 'kenji', giveItemIds: [mine.id], askItemIds: [theirs.id], giveCredits: 200 });
    const [sent] = (await vex.client.json('/trades?box=sent')).body;
    expect(sent).toMatchObject({ direction: 'sent', status: 'pending', counterparty: { username: 'kenji' } });
    expect(sent.give).toMatchObject({ credits: 200, total: 2500 + 200 });
    expect(sent.get.total).toBe(500);
    expect(sent.diff).toBe(500 - 2700);
    expect(sent.get.items[0].albumGain).toBe(true);
    expect(sent.albumSlots).toBe(1);
    const [received] = (await kenji.client.json('/trades?box=received')).body;
    expect(received.give.items[0].id).toBe(theirs.id);
    expect(received.get.credits).toBe(200);
    expect(received.get.items[0].albumGain).toBe(true);

    const options = (await vex.client.json('/trades/options?with=kenji')).body;
    // Both balances: yours (200 CR held by the offer) and the friend's, to know what you can ask.
    expect(options).toMatchObject({ balance: 800, partnerBalance: 1000 });
    expect(options.mine.map((i: { status: string }) => i.status)).toEqual(['in_trade']);
    expect(options.theirs[0]).toMatchObject({ id: theirs.id, albumGain: true });
    const quote = (await vex.client.json('/trades/quote', { method: 'POST', json: { to: 'kenji', giveItemIds: [], askItemIds: [theirs.id], giveCredits: 0, askCredits: 30 } })).body;
    expect(quote).toEqual({ giveTotal: 0, getTotal: 530, diff: 530, albumSlots: 1 });
    expect((await vex.client.json('/trades/options?with=nobody')).status).toBe(404);
  });
});
