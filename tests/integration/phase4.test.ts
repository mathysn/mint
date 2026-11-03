import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../../server/auth/sessions.js';
import { closeDb, db } from '../../server/db/client.js';
import { activity, items, showcase, users } from '../../server/db/schema.js';
import { createDiscordAccount } from '../../server/services/accounts.js';
import { Client, newGuest, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

let n = 0;
/** A signed-in Discord account with its own browser. */
async function account(username: string) {
  const user = await createDiscordAccount(db(), { id: `d-${username}-${n++}`, username, global_name: null, avatar: null });
  const { token } = await createSession(db(), user.id, 'web');
  const client = new Client(`192.0.2.${100 + n}`);
  client.cookie = `mint_session=${token}`;
  return { user, client };
}

type Tier = 'milspec' | 'restricted' | 'classified' | 'covert' | 'gold';
const skinOf: Record<Tier, string> = { milspec: 'm1', restricted: 'r1', classified: 'c1', covert: 'k1', gold: 'glove' };

async function give(ownerId: string, tier: Tier, extra: { destroyed?: boolean } = {}) {
  const [row] = await db()
    .insert(items)
    .values({
      skinId: skinOf[tier],
      ownerId,
      originalOwnerId: ownerId,
      float: 0.2,
      pattern: 1,
      stattrak: false,
      tier,
      source: 'case',
      sourceCrateId: 'crate-a',
      status: extra.destroyed ? 'destroyed' : 'available',
      destroyedAt: extra.destroyed ? new Date() : null,
    })
    .returning();
  return row!;
}

const request = (c: Client, username: string) => c.json('/friends/requests', { method: 'POST', json: { username } });

async function befriend(a: Awaited<ReturnType<typeof account>>, b: Awaited<ReturnType<typeof account>>) {
  await request(a.client, b.user.username!);
  await b.client.json(`/friends/requests/${a.user.id}/accept`, { method: 'POST' });
}

describe('friends', () => {
  it('goes request → accept, with both sides seeing it', async () => {
    const vex = await account('vex');
    const kenji = await account('kenji');
    expect((await request(vex.client, 'kenji')).body).toEqual({ relation: 'outgoing' });
    const theirs = (await kenji.client.json('/friends')).body;
    expect(theirs.incoming.map((p: { username: string }) => p.username)).toEqual(['vex']);
    expect((await kenji.client.json('/me')).body.friendRequests).toBe(1);
    expect((await vex.client.json('/friends')).body.outgoing[0].username).toBe('kenji');

    expect((await kenji.client.json(`/friends/requests/${vex.user.id}/accept`, { method: 'POST' })).body).toEqual({ relation: 'friend' });
    const mine = (await vex.client.json('/friends')).body;
    expect(mine.friends).toHaveLength(1);
    expect(mine.friends[0]).toMatchObject({ username: 'kenji', relation: 'friend', showcase: [] });
    expect(mine.friends[0].since).toBeTruthy();
    expect((await kenji.client.json('/me')).body.friendRequests).toBe(0);
  });

  it('turns crossed requests into a friendship', async () => {
    const vex = await account('vex');
    const kenji = await account('kenji');
    await request(vex.client, 'kenji');
    expect((await request(kenji.client, 'vex')).body).toEqual({ relation: 'friend' });
  });

  it('declines, cancels and removes', async () => {
    const vex = await account('vex');
    const kenji = await account('kenji');
    await request(vex.client, 'kenji');
    expect((await kenji.client.request(`/friends/requests/${vex.user.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await vex.client.json('/friends')).body.outgoing).toHaveLength(0);
    await request(vex.client, 'kenji');
    expect((await vex.client.request(`/friends/requests/${kenji.user.id}`, { method: 'DELETE' })).status).toBe(204);
    await befriend(vex, kenji);
    expect((await vex.client.request(`/friends/${kenji.user.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await kenji.client.json('/friends')).body.friends).toHaveLength(0);
    expect((await vex.client.request(`/friends/${kenji.user.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('refuses guests, unknown names and yourself', async () => {
    const vex = await account('vex');
    const guest = await newGuest();
    expect((await guest.json('/friends')).status).toBe(403);
    expect((await guest.json('/friends')).body.error.code).toBe('account_required');
    expect((await request(guest, 'vex')).status).toBe(403);
    expect((await request(vex.client, 'nobody')).status).toBe(404);
    expect((await request(vex.client, 'vex')).status).toBe(404);
  });

  it('finds players by name with their relation, never guests or yourself', async () => {
    const vex = await account('vex');
    await account('dune');
    await account('dunewalker');
    const kenji = await account('kenji');
    await request(kenji.client, 'vex');
    await newGuest();
    const results = (await vex.client.json('/players/search?q=dun')).body;
    expect(results.map((p: { username: string }) => p.username)).toEqual(['dune', 'dunewalker']);
    expect(results[0]).toMatchObject({ relation: 'none', stats: { inventoryValue: 0, albumsPct: 0 } });
    expect((await vex.client.json('/players/search?q=ken')).body[0].relation).toBe('incoming');
    expect((await vex.client.json('/players/search?q=ve')).body).toHaveLength(0);
    expect((await vex.client.json('/players/search?q=d')).body).toHaveLength(0);
  });
});

describe('showcase and profile', () => {
  it('saves up to 5 of your own items in order and shows them on the profile', async () => {
    const vex = await account('vex');
    const a = await give(vex.user.id, 'covert');
    const b = await give(vex.user.id, 'milspec');
    const res = await vex.client.json('/me/showcase', { method: 'PUT', json: { itemIds: [b.id, a.id] } });
    expect(res.body.map((i: { id: string }) => i.id)).toEqual([b.id, a.id]);
    const profile = (await new Client().json('/players/vex')).body;
    expect(profile).toMatchObject({ relation: 'none', canViewCollection: false, player: { username: 'vex' } });
    expect(profile.showcase.map((i: { id: string }) => i.id)).toEqual([b.id, a.id]);
    expect(profile.stats).toMatchObject({ casesOpened: 0, inventoryValue: 2500 + 30, skinsCollected: 2 });
  });

  it('refuses someone else’s item, a destroyed item and more than 5', async () => {
    const vex = await account('vex');
    const kenji = await account('kenji');
    const theirs = await give(kenji.user.id, 'covert');
    const gone = await give(vex.user.id, 'covert', { destroyed: true });
    expect((await vex.client.json('/me/showcase', { method: 'PUT', json: { itemIds: [theirs.id] } })).status).toBe(409);
    expect((await vex.client.json('/me/showcase', { method: 'PUT', json: { itemIds: [gone.id] } })).status).toBe(409);
    const six = await Promise.all(Array.from({ length: 6 }, () => give(vex.user.id, 'milspec')));
    expect((await vex.client.json('/me/showcase', { method: 'PUT', json: { itemIds: six.map((i) => i.id) } })).status).toBe(400);
  });

  it('drops a recycled item from the showcase', async () => {
    const vex = await account('vex');
    const a = await give(vex.user.id, 'milspec');
    await vex.client.json('/me/showcase', { method: 'PUT', json: { itemIds: [a.id] } });
    await vex.client.json('/items/recycle', { method: 'POST', json: { itemIds: [a.id] } });
    expect(await db().select().from(showcase).where(eq(showcase.userId, vex.user.id))).toHaveLength(0);
  });

  it('tells the relation and opens the collection to friends only', async () => {
    const vex = await account('vex');
    const kenji = await account('kenji');
    const lou = await account('lou');
    await befriend(vex, kenji);
    expect((await vex.client.json('/players/kenji')).body).toMatchObject({ relation: 'friend', canViewCollection: true });
    expect((await vex.client.json('/players/kenji')).body.friendsSince).toBeTruthy();
    expect((await vex.client.json('/players/vex')).body.relation).toBe('self');
    expect((await vex.client.json('/players/lou')).body).toMatchObject({ relation: 'none', canViewCollection: false });
    await give(kenji.user.id, 'covert');
    expect((await vex.client.json('/players/kenji/inventory')).body.totalCount).toBe(1);
    expect((await vex.client.json('/players/kenji/albums')).status).toBe(200);
    expect((await vex.client.json('/players/kenji/albums/crate-a')).body.album.owned).toBe(1);
    expect((await lou.client.json('/players/kenji/inventory')).status).toBe(403);
    expect((await vex.client.json('/players/nobody')).status).toBe(404);
  });
});

describe('item visibility', () => {
  it('shows an item to its owner, their friends, and to anyone when showcased', async () => {
    const vex = await account('vex');
    const kenji = await account('kenji');
    const lou = await account('lou');
    await befriend(vex, kenji);
    const item = await give(vex.user.id, 'covert');
    expect((await vex.client.json(`/items/${item.id}`)).body).toMatchObject({ owner: { isYou: true }, canRecycle: true, inShowcase: false });
    expect((await kenji.client.json(`/items/${item.id}`)).body).toMatchObject({ owner: { username: 'vex', isYou: false }, canRecycle: false });
    expect((await lou.client.json(`/items/${item.id}`)).status).toBe(404);
    await vex.client.json('/me/showcase', { method: 'PUT', json: { itemIds: [item.id] } });
    expect((await lou.client.json(`/items/${item.id}`)).body.inShowcase).toBe(true);
    // Only the owner can recycle.
    expect((await kenji.client.json('/items/recycle', { method: 'POST', json: { itemIds: [item.id], confirm: true } })).status).toBe(409);
  });
});

describe('friends feed', () => {
  it('lists friends’ unboxings from Classified, newest first', async () => {
    const vex = await account('vex');
    const kenji = await account('kenji');
    const lou = await account('lou');
    await befriend(vex, kenji);
    const covert = await give(kenji.user.id, 'covert');
    const classified = await give(kenji.user.id, 'classified');
    const stranger = await give(lou.user.id, 'covert');
    await db().insert(activity).values([
      { userId: kenji.user.id, type: 'unbox', itemId: covert.id, createdAt: new Date(Date.now() - 60_000) },
      { userId: kenji.user.id, type: 'unbox', itemId: classified.id },
      { userId: lou.user.id, type: 'unbox', itemId: stranger.id },
    ]);
    const feed = (await vex.client.json('/feed')).body;
    expect(feed.map((e: { item: { id: string } }) => e.item.id)).toEqual([classified.id, covert.id]);
    expect(feed[0]).toMatchObject({ type: 'unbox', player: { username: 'kenji' } });
    expect((await (await newGuest()).json('/feed')).body).toEqual([]);
  });

  it('is written by the opening itself, only from Classified', async () => {
    const vex = await account('vex');
    await db().update(users).set({ balance: 250 * 40 }).where(eq(users.id, vex.user.id));
    for (let i = 0; i < 40; i++) await vex.client.open('crate-a');
    const opened = await db().select().from(items).where(eq(items.ownerId, vex.user.id));
    const entries = await db().select().from(activity).where(eq(activity.userId, vex.user.id));
    const expected = opened.filter((i) => ['classified', 'covert', 'gold'].includes(i.tier)).map((i) => i.id).sort();
    expect(entries.map((e) => e.itemId).sort()).toEqual(expected);
  });
});
