import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../server/db/client.js';
import { activity, auctions, collections, crateItems, crates, items, ledger, marketPrices, showcase, skins } from '../../server/db/schema.js';
import { clearCatalogCache } from '../../server/services/catalog.js';
import { type Account, befriend, giveItem, newAccount, newGuest, resetDb } from './helpers.js';

afterAll(closeDb);

/** Second collection and case: m3 (Mil-Spec), r2 and r3 (Restricted, r3 in 0.10–0.60). */
beforeEach(async () => {
  await resetDb();
  await db().insert(collections).values({ id: 'col-2', name: 'Second Collection' });
  const base = { category: 'Rifles', apiRarityId: 'x', minFloat: 0, maxFloat: 1, stattrakAvailable: true, collectionId: 'col-2' };
  await db().insert(skins).values([
    { id: 'm3', name: 'Gun | m3', weaponName: 'Gun', finishName: 'm3', imageUrl: 'https://img.test/m3.png', ...base },
    { id: 'r2', name: 'Gun | r2', weaponName: 'Gun', finishName: 'r2', imageUrl: 'https://img.test/r2.png', ...base },
    { id: 'r3', name: 'Gun | r3', weaponName: 'Gun', finishName: 'r3', imageUrl: 'https://img.test/r3.png', ...base, minFloat: 0.1, maxFloat: 0.6 },
  ]);
  await db().insert(crates).values({ id: 'crate-c', name: 'Gamma Case', imageUrl: 'https://img.test/c.png', price: 250, releasedOn: '2023-01-01' });
  await db().insert(crateItems).values([
    { crateId: 'crate-c', skinId: 'm3', tier: 'milspec', special: false },
    { crateId: 'crate-c', skinId: 'r2', tier: 'restricted', special: false },
    { crateId: 'crate-c', skinId: 'r3', tier: 'restricted', special: false },
  ]);
  clearCatalogCache();
});

async function ledgerMatchesBalances() {
  const rows = await db().execute<{ balance: number; total: number }>(
    sql`SELECT u.balance, COALESCE(SUM(l.amount), 0)::bigint AS total FROM users u LEFT JOIN ledger l ON l.user_id = u.id GROUP BY u.id`,
  );
  return rows.rows.every((r) => Number(r.balance) === Number(r.total));
}

const make = async (ownerId: string, skinId: string, tier: 'milspec' | 'restricted' | 'classified' | 'covert', float: number, stattrak = false) =>
  (await db().insert(items).values({ skinId, ownerId, originalOwnerId: ownerId, float, pattern: 1, stattrak, tier, source: 'case', sourceCrateId: 'crate-a' }).returning())[0]!;

/** 4 from the first collection (m1) and 6 from the second (m3), floats 0.20 and 0.30. */
async function contractOf(owner: string) {
  const a = await Promise.all(Array.from({ length: 4 }, () => make(owner, 'm1', 'milspec', 0.2)));
  const b = await Promise.all(Array.from({ length: 6 }, () => make(owner, 'm3', 'milspec', 0.3)));
  return [...a, ...b].map((i) => i.id);
}

const sign = (who: Account, itemIds: string[], key = crypto.randomUUID()) =>
  who.client.json('/tradeup', { method: 'POST', headers: { 'idempotency-key': key }, json: { itemIds } });

describe('trade-up contracts', () => {
  it('quotes the odds per collection, the float each result would land at, and Album +1', async () => {
    const vex = await newAccount('vex');
    const ids = await contractOf(vex.user.id);
    const quote = (await vex.client.json('/tradeup/quote', { method: 'POST', json: { itemIds: ids } })).body;
    expect(quote).toMatchObject({ count: 10, size: 10, next: 'restricted', stattrak: false });
    expect(quote.avgFloat).toBeCloseTo(0.26, 10);
    const pct = Object.fromEntries(quote.outcomes.map((o: { skin: { id: string }; pct: number }) => [o.skin.id, o.pct]));
    expect(pct).toEqual({ r1: 40, r2: 30, r3: 30 });
    const r3 = quote.outcomes.find((o: { skin: { id: string } }) => o.skin.id === 'r3');
    expect(r3.float).toBeCloseTo(0.23, 10);
    expect(r3).toMatchObject({ wear: { code: 'FT' }, albumGain: true, collection: { name: 'Second Collection' } });

    const options = (await vex.client.json('/tradeup/options?tier=milspec&stattrak=0')).body;
    expect(options).toMatchObject({ tier: 'milspec', next: 'restricted', size: 10, tiers: ['milspec', 'restricted', 'classified'] });
    expect(options.items).toHaveLength(10);
  });

  it('refuses Covert, mixed rarities, mixed StatTrak, other players’ and locked items, and anything but 10', async () => {
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    const ids = await contractOf(vex.user.id);
    const quote = (itemIds: string[]) => vex.client.json('/tradeup/quote', { method: 'POST', json: { itemIds } });
    expect((await quote([(await make(vex.user.id, 'k1', 'covert', 0.2)).id])).status).toBe(400);
    expect((await quote([ids[0]!, (await make(vex.user.id, 'r1', 'restricted', 0.2)).id])).status).toBe(400);
    expect((await quote([ids[0]!, (await make(vex.user.id, 'm1', 'milspec', 0.2, true)).id])).status).toBe(400);
    expect((await quote([ids[0]!, (await make(kenji.user.id, 'm1', 'milspec', 0.2)).id])).status).toBe(409);
    const listed = await giveItem(vex.user.id, 'milspec', { status: 'listed' });
    expect((await sign(vex, [...ids.slice(0, 9), listed.id])).status).toBe(409);
    expect((await sign(vex, ids.slice(0, 9))).status).toBe(400);
    expect((await db().select().from(items).where(eq(items.status, 'destroyed'))).length).toBe(0);
  });

  it('signs: the 10 are destroyed, one result of the next rarity is created, replay returns it', async () => {
    const vex = await newAccount('vex');
    const ids = await contractOf(vex.user.id);
    await vex.client.json('/me/showcase', { method: 'PUT', json: { itemIds: [ids[0]] } });
    const key = crypto.randomUUID();
    const res = await sign(vex, ids, key);
    expect(res.status).toBe(200);
    const result = res.body.item;
    expect(result.skin.tier).toBe('restricted');
    expect(['r1', 'r2', 'r3']).toContain(result.skin.id);
    const expected = result.skin.id === 'r3' ? 0.1 + 0.26 * 0.5 : 0.26;
    expect(result.float).toBeCloseTo(expected, 10);
    expect(result.stattrak).toBe(false);
    expect(res.body.albumGain).toBe(true);
    const [row] = await db().select().from(items).where(eq(items.id, result.id));
    expect(row).toMatchObject({ source: 'tradeup', acquiredVia: 'tradeup', ownerId: vex.user.id, status: 'available' });
    const destroyed = await db().select().from(items).where(eq(items.status, 'destroyed'));
    expect(destroyed.map((i) => i.id).sort()).toEqual([...ids].sort());
    expect(await db().select().from(showcase)).toHaveLength(0);
    const moves = await db().select().from(ledger).where(eq(ledger.userId, vex.user.id));
    expect(moves.filter((m) => m.type === 'tradeup_in')).toHaveLength(10);
    expect(moves.filter((m) => m.type === 'tradeup_out').map((m) => m.itemId)).toEqual([result.id]);

    const replay = await sign(vex, ids, key);
    expect(replay.body.item.id).toBe(result.id);
    expect((await db().select().from(items).where(eq(items.ownerId, vex.user.id))).length).toBe(11);
    expect((await sign(vex, ids)).status).toBe(409);
    expect(await ledgerMatchesBalances()).toBe(true);
  });

  it('StatTrak in, StatTrak out; a Classified result shows in the friends’ feed', async () => {
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    await befriend(vex, kenji);
    const ids = await Promise.all(Array.from({ length: 10 }, (_, i) => make(vex.user.id, 'r1', 'restricted', 0.05 + i * 0.01, true)));
    const res = await sign(vex, ids.map((i) => i.id));
    expect(res.body.item).toMatchObject({ stattrak: true, skin: { id: 'c1', tier: 'classified' } });
    const feed = (await kenji.client.json('/feed')).body;
    expect(feed[0]).toMatchObject({ type: 'tradeup', player: { username: 'vex' }, item: { id: res.body.item.id } });
  });

  it('guests can sign contracts', async () => {
    const guest = await newGuest();
    const me = (await guest.json('/me')).body;
    const ids = await contractOf(me.id);
    expect((await sign({ client: guest } as Account, ids)).status).toBe(200);
  });
});

describe('market value', () => {
  it('an item is worth the average of the last sales of its skin and wear; recycling still pays the grid', async () => {
    const lou = await newAccount('lou');
    const vex = await newAccount('vex');
    const sell = async (price: number) => {
      const item = await make(lou.user.id, 'm1', 'milspec', 0.2);
      const { id } = (await lou.client.json('/market/listings', { method: 'POST', json: { itemId: item.id, startPrice: price, buyNowPrice: null, durationHours: 24 } })).body;
      await vex.client.json(`/market/auctions/${id}/bid`, { method: 'POST', json: { amount: price } });
      await db().update(auctions).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(auctions.id, id));
      await lou.client.json('/me');
    };
    await sell(90);
    await sell(110);
    const [price] = await db().select().from(marketPrices);
    expect(price).toMatchObject({ skinId: 'm1', stattrak: false, wear: 'FT', avgPrice: 100, salesCount: 2 });

    const mine = await make(vex.user.id, 'm1', 'milspec', 0.25);
    const fn = await make(vex.user.id, 'm1', 'milspec', 0.01);
    const inv = (await vex.client.json('/inventory?sort=value')).body;
    const byId = Object.fromEntries(inv.items.map((i: { id: string; value: number; recycleValue: number }) => [i.id, i]));
    expect(byId[mine.id]).toMatchObject({ value: 100, recycleValue: 30 });
    expect(byId[fn.id]).toMatchObject({ value: 45, recycleValue: 45 });
    const quote = (await vex.client.json('/items/recycle/quote', { method: 'POST', json: { itemIds: [mine.id] } })).body;
    expect(quote.total).toBe(30);
  });
});

describe('leaderboard and global drops', () => {
  it('ranks accounts by inventory value and by skins collected, with friends and your own row', async () => {
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    const lou = await newAccount('lou');
    await newGuest();
    await befriend(vex, kenji);
    await giveItem(kenji.user.id, 'covert');
    await giveItem(lou.user.id, 'classified');
    for (const skinId of ['m1', 'm2', 'r1', 'c1', 'k1']) {
      const tier = ({ m1: 'milspec', m2: 'milspec', r1: 'restricted', c1: 'classified', k1: 'covert' } as const)[skinId as 'm1'];
      await giveItem(vex.user.id, tier, { skinId });
    }
    const value = (await vex.client.json('/leaderboard?board=value&scope=all')).body;
    expect(value.entries.map((e: { player: { username: string } }) => e.player.username)).toEqual(['vex', 'kenji', 'lou']);
    expect(value.entries[1]).toMatchObject({ rank: 2, metric: 2500, isFriend: true, best: { id: 'k1' } });
    expect(value.you).toMatchObject({ rank: 1, isYou: true, metric: 30 + 30 + 120 + 500 + 2500 });

    const albums = (await lou.client.json('/leaderboard?board=albums&scope=all')).body;
    expect(albums.entries[0]).toMatchObject({ player: { username: 'vex' }, metric: 5, completeAlbums: 2 });
    expect(albums.you).toMatchObject({ rank: 3, metric: 1 });

    const friends = (await vex.client.json('/leaderboard?board=value&scope=friends')).body;
    expect(friends.entries.map((e: { player: { username: string } }) => e.player.username)).toEqual(['vex', 'kenji']);
    expect((await kenji.client.json('/players/vex')).body.ranks).toEqual({ value: 1, albums: 1 });
  });

  it('the banner shows the latest knife or gloves, guests as anonymous', async () => {
    const vex = await newAccount('vex');
    expect((await vex.client.json('/drops/latest')).body.drop).toBeNull();
    const glove = await giveItem(vex.user.id, 'gold');
    await db().insert(activity).values({ userId: vex.user.id, type: 'unbox', itemId: glove.id, createdAt: new Date(Date.now() - 3 * 86_400_000) });
    expect((await vex.client.json('/drops/latest')).body.drop).toMatchObject({ player: { username: 'vex' }, item: { id: glove.id } });
    const guest = await newGuest();
    const guestId = (await guest.json('/me')).body.id;
    const knife = await giveItem(guestId, 'gold', { skinId: 'vanilla' });
    await db().insert(activity).values({ userId: guestId, type: 'unbox', itemId: knife.id });
    await db().insert(activity).values({ userId: vex.user.id, type: 'unbox', itemId: (await giveItem(vex.user.id, 'covert')).id });
    expect((await guest.json('/drops/latest')).body.drop).toMatchObject({ player: null, item: { id: knife.id } });
  });
});
