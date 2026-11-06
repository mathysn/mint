import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, db } from '../../server/db/client.js';
import { items, ledger, users } from '../../server/db/schema.js';
import { caseRotationMs, dailyCrateId } from '../../server/game/dailyCrate.js';
import { recycleValue } from '../../server/game/value.js';
import { Client, newAccount, newGuest, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

const todaysCrate = () => dailyCrateId({ allIds: ['crate-a', 'crate-b'], activeIds: ['crate-a', 'crate-b'], pick: null }, new Date(), caseRotationMs())!;
const otherCrate = () => (todaysCrate() === 'crate-a' ? 'crate-b' : 'crate-a');

async function ledgerMatchesBalances() {
  const rows = await db().execute<{ id: string; balance: number; total: number }>(
    sql`SELECT u.id, u.balance, COALESCE(SUM(l.amount), 0)::bigint AS total FROM users u LEFT JOIN ledger l ON l.user_id = u.id GROUP BY u.id`,
  );
  return rows.rows.every((r) => Number(r.balance) === Number(r.total));
}

describe('guest accounts', () => {
  it('creates a guest with 1 000 CR, a session cookie and a ledger entry', async () => {
    const client = new Client();
    const created = await client.json('/auth/guest', { method: 'POST' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ isGuest: true, balance: 1000, freeCase: { available: true } });
    expect(client.cookie).toMatch(/^mint_session=/);
    const me = await client.json('/me');
    expect(me.body.id).toBe(created.body.id);
    const rows = await db().select().from(ledger).where(eq(ledger.userId, created.body.id));
    expect(rows).toMatchObject([{ type: 'starting_balance', amount: 1000, balanceAfter: 1000 }]);
  });

  it('answers 401 without a session', async () => {
    expect((await new Client().json('/me')).status).toBe(401);
  });

  it('limits guest creation per network', async () => {
    for (let i = 0; i < 10; i++) await newGuest('198.51.100.7');
    expect((await new Client('198.51.100.7').json('/auth/guest', { method: 'POST' })).status).toBe(429);
    expect((await new Client('198.51.100.8').json('/auth/guest', { method: 'POST' })).status).toBe(201);
  });

  it('refuses state-changing requests from another origin', async () => {
    const res = await new Client().json('/auth/guest', { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });
});

describe('opening a case', () => {
  it('debits 250 CR, creates the item and writes the ledger in one go', async () => {
    const client = await newGuest();
    const res = await client.open('crate-a');
    expect(res.status).toBe(200);
    const { item, balance, strip, resultIndex } = res.body;
    expect(balance).toBe(750);
    expect(strip).toHaveLength(48);
    expect(strip[resultIndex].id).toBe(item.skin.id);
    expect(item.status).toBe('available');
    expect(item.value).toBe(recycleValue({ tier: item.skin.tier, stattrak: item.stattrak, float: item.float }));
    const [row] = await db().select().from(items).where(eq(items.id, item.id));
    expect(row!.sourceCrateId).toBe('crate-a');
    const entries = await db().select().from(ledger).where(eq(ledger.itemId, item.id));
    expect(entries).toMatchObject([{ type: 'case_open', amount: -250, balanceAfter: 750 }]);
    expect(await ledgerMatchesBalances()).toBe(true);
  });

  it('replays the same Idempotency-Key without charging twice', async () => {
    const client = await newGuest();
    const key = crypto.randomUUID();
    const first = await client.open('crate-a', { key });
    const second = await client.open('crate-a', { key });
    expect(second.body.item.id).toBe(first.body.item.id);
    expect(second.body.balance).toBe(750);
    expect((await client.json('/me')).body.balance).toBe(750);
    const count = await db().select().from(items);
    expect(count).toHaveLength(1);
  });

  it('lets only one of 5 simultaneous openings through with 250 CR (row lock)', async () => {
    const client = await newGuest();
    const me = (await client.json('/me')).body;
    await db().update(users).set({ balance: 250 }).where(eq(users.id, me.id));
    await db().insert(ledger).values({ userId: me.id, type: 'case_open', amount: -750, balanceAfter: 250 });
    const results = await Promise.all(Array.from({ length: 5 }, () => client.open('crate-a')));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 402)).toHaveLength(4);
    expect((await client.json('/me')).body.balance).toBe(0);
    expect(await ledgerMatchesBalances()).toBe(true);
  });

  it('refuses when the balance is too low', async () => {
    const client = await newGuest();
    for (let i = 0; i < 4; i++) expect((await client.open('crate-a')).status).toBe(200);
    const res = await client.open('crate-a');
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('insufficient_balance');
  });

  it('refuses an unknown case', async () => {
    const client = await newGuest();
    expect((await client.open('crate-zzz')).status).toBe(404);
  });
});

describe('free case stack', () => {
  const MIN = 60_000;

  it('starts full: today’s case opens for free five times in a row, then it refuses', async () => {
    const client = await newGuest();
    expect((await client.json('/me')).body.freeCase).toMatchObject({ available: true, count: 5, max: 5, nextAt: null });
    for (let left = 4; left >= 0; left--) {
      const free = await client.open(todaysCrate(), { free: true });
      expect(free.status).toBe(200);
      expect(free.body.balance).toBe(1000);
      expect(free.body.freeCase).toMatchObject({ available: left > 0, count: left, max: 5 });
      expect(free.body.freeCase.nextAt).toBeTruthy();
    }
    const again = await client.open(todaysCrate(), { free: true });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('free_case_unavailable');
    const entries = await db().select().from(ledger).where(eq(ledger.type, 'free_case_open'));
    expect(entries).toHaveLength(5);
    expect(entries.every((e) => e.amount === 0 && e.balanceAfter === 1000)).toBe(true);
    expect(await ledgerMatchesBalances()).toBe(true);
  });

  it('starts the timer with the first case taken: the next one comes 10 minutes later', async () => {
    const client = await newGuest();
    const before = Date.now();
    const free = await client.open(todaysCrate(), { free: true });
    const nextAt = new Date(free.body.freeCase.nextAt).getTime();
    expect(nextAt).toBeGreaterThanOrEqual(before + 10 * MIN);
    expect(nextAt).toBeLessThanOrEqual(Date.now() + 10 * MIN);
  });

  it('gains one case every 10 minutes, up to 5', async () => {
    const client = await newGuest();
    const { id } = (await client.json('/me')).body;
    const anchor = (minutesAgo: number) => db().update(users).set({ freeCaseAnchor: new Date(Date.now() - minutesAgo * MIN) }).where(eq(users.id, id));
    await anchor(0);
    expect((await client.json('/me')).body.freeCase).toMatchObject({ available: false, count: 0 });
    await anchor(25);
    const stack = (await client.json('/me')).body.freeCase;
    expect(stack).toMatchObject({ available: true, count: 2 });
    const left = new Date(stack.nextAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(4 * MIN);
    expect(left).toBeLessThanOrEqual(5 * MIN);
    await anchor(500);
    expect((await client.json('/me')).body.freeCase).toMatchObject({ count: 5, nextAt: null });
  });

  it('is only valid on today’s case', async () => {
    const client = await newGuest();
    const res = await client.open(otherCrate(), { free: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('free_case_unavailable');
  });

  it('takes one case per request, even when the request is replayed', async () => {
    const client = await newGuest();
    const key = crypto.randomUUID();
    const first = await client.open(todaysCrate(), { free: true, key });
    const replay = await client.open(todaysCrate(), { free: true, key });
    expect(replay.status).toBe(200);
    expect(replay.body.openingId).toBe(first.body.openingId);
    expect((await client.json('/me')).body.freeCase.count).toBe(4);
  });
});

describe('catalog and inventory', () => {
  it('lists cases newest first with flags and completion', async () => {
    const client = await newGuest();
    const list = (await client.json('/crates')).body;
    expect(list.map((c: { id: string }) => c.id)).toEqual(['crate-b', 'crate-a']);
    expect(list[0]).toMatchObject({ isNew: true, skinCount: 5, completion: { owned: 0, total: 5 } });
    expect(list.filter((c: { isFreeToday: boolean }) => c.isFreeToday)).toHaveLength(1);
  });

  it('describes a case: groups with odds, ★ types, owned flags', async () => {
    const client = await newGuest();
    const detail = (await client.json('/crates/crate-a')).body;
    expect(detail.groups.map((g: { tier: string }) => g.tier)).toEqual(['covert', 'classified', 'restricted', 'milspec']);
    expect(detail.groups[3].pct).toBe(79.92);
    expect(detail.special.pct).toBe(0.26);
    expect(detail.special.types.map((t: { weaponName: string }) => t.weaponName).sort()).toEqual(['★ Gloves', '★ Knife']);
  });

  it('filters, sorts and totals on the server', async () => {
    const client = await newGuest();
    const me = (await client.json('/me')).body;
    await db().insert(items).values([
      { skinId: 'm1', ownerId: me.id, float: 0.01, pattern: 1, stattrak: false, tier: 'milspec', source: 'case', sourceCrateId: 'crate-a' },
      { skinId: 'k1', ownerId: me.id, float: 0.3, pattern: 2, stattrak: true, tier: 'covert', source: 'case', sourceCrateId: 'crate-b' },
      { skinId: 'vanilla', ownerId: me.id, float: null, pattern: 3, stattrak: false, tier: 'gold', source: 'case', sourceCrateId: 'crate-a' },
      { skinId: 'r1', ownerId: me.id, float: 0.5, pattern: 4, stattrak: false, tier: 'restricted', source: 'case', sourceCrateId: 'crate-a', status: 'destroyed', destroyedAt: new Date() },
    ]);
    const all = (await client.json('/inventory')).body;
    expect(all.totalCount).toBe(3);
    expect(all.totalValue).toBe(45 + 5000 + 10000);
    expect(all.items.map((i: { value: number }) => i.value)).toEqual([10000, 5000, 45]);
    expect((await client.json('/inventory?rarity=covert')).body.items).toHaveLength(1);
    expect((await client.json('/inventory?stattrak=1')).body.items[0].skin.id).toBe('k1');
    expect((await client.json('/inventory?wear=FN')).body.items[0].skin.id).toBe('m1');
    expect((await client.json('/inventory?crate=crate-b')).body.items).toHaveLength(1);
    expect((await client.json('/inventory?q=knife')).body.items[0].skin.id).toBe('vanilla');
    const byFloat = (await client.json('/inventory?sort=float')).body.items.map((i: { skin: { id: string } }) => i.skin.id);
    expect(byFloat).toEqual(['m1', 'k1', 'vanilla']);
    expect((await client.json('/inventory?rarity=nope')).status).toBe(400);
    const crates = (await client.json('/crates')).body;
    // Album completion counts skins owned, whatever case they came from (both test cases share m1 and k1).
    expect(crates.find((c: { id: string }) => c.id === 'crate-a').completion).toEqual({ owned: 2, total: 5 });
  });
});

describe('Discord sign-in', () => {
  function fakeDiscord(profile: { id: string; username: string }) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/oauth2/token')) return Response.json({ access_token: 'at', token_type: 'Bearer' });
        if (String(url).endsWith('/users/@me')) return Response.json({ ...profile, global_name: profile.username, avatar: null });
        return new Response('not found', { status: 404 });
      }),
    );
  }

  async function signIn(client: Client, profile: { id: string; username: string }) {
    fakeDiscord(profile);
    const start = await client.json('/auth/discord/flows', { method: 'POST', json: {} });
    expect(start.status).toBe(201);
    const state = new URL(start.body.authorizeUrl).searchParams.get('state')!;
    await client.request(`/auth/discord/callback?state=${state}&code=abc`);
    vi.unstubAllGlobals();
    const poll = await client.json(`/auth/discord/flows/${start.body.flowId}`, { headers: { 'x-poll-secret': start.body.pollSecret } });
    return { ...start.body, poll };
  }

  it('never carries guest progress over: a new Discord account starts fresh, the guest is deleted', async () => {
    const client = await newGuest();
    const guest = (await client.json('/me')).body;
    await client.open('crate-a');
    const { poll } = await signIn(client, { id: 'd-1', username: 'vex' });
    expect(poll.body.status).toBe('success');
    expect(poll.body.me).toMatchObject({ isGuest: false, username: 'vex', balance: 1000 });
    expect(poll.body.me.id).not.toBe(guest.id);
    const me = (await client.json('/me')).body;
    expect(me.id).toBe(poll.body.me.id);
    expect((await client.json('/inventory')).body.totalCount).toBe(0);
    expect(me.freeCase.available).toBe(true);
    expect(await db().select().from(users).where(eq(users.id, guest.id))).toHaveLength(0);
  });

  it('signs a guest with progress into an existing account, nothing merged, the guest is deleted', async () => {
    const first = await newGuest('192.0.2.1');
    await signIn(first, { id: 'd-1', username: 'vex' });
    const account = (await first.json('/me')).body;

    const second = await newGuest('192.0.2.2');
    const guest = (await second.json('/me')).body;
    await second.open('crate-a');
    const flow = await signIn(second, { id: 'd-1', username: 'vex' });
    expect(flow.poll.body.status).toBe('success');
    const me = (await second.json('/me')).body;
    expect(me).toMatchObject({ id: account.id, balance: 1000 });
    expect((await second.json('/inventory')).body.totalCount).toBe(0);
    expect(await db().select().from(users).where(eq(users.id, guest.id))).toHaveLength(0);
  });

  it('signs straight in when the guest has nothing to lose', async () => {
    const first = await newGuest('192.0.2.1');
    await signIn(first, { id: 'd-1', username: 'vex' });
    const account = (await first.json('/me')).body;
    const fresh = await newGuest('192.0.2.3');
    const { poll } = await signIn(fresh, { id: 'd-1', username: 'vex' });
    expect(poll.body.status).toBe('success');
    expect((await fresh.json('/me')).body.id).toBe(account.id);
  });

  it('protects the flow: wrong poll secret, single use, declined consent', async () => {
    const client = await newGuest();
    const flow = await signIn(client, { id: 'd-9', username: 'kenji' });
    expect((await client.json(`/auth/discord/flows/${flow.flowId}`, { headers: { 'x-poll-secret': 'nope' } })).status).toBe(404);
    const reuse = await client.json(`/auth/discord/flows/${flow.flowId}`, { headers: { 'x-poll-secret': flow.pollSecret } });
    expect(reuse.body.status).toBe('error');

    const other = await newGuest('192.0.2.9');
    const start = (await other.json('/auth/discord/flows', { method: 'POST', json: {} })).body;
    const state = new URL(start.authorizeUrl).searchParams.get('state')!;
    await other.request(`/auth/discord/callback?state=${state}&error=access_denied`);
    const declined = await other.json(`/auth/discord/flows/${start.flowId}`, { headers: { 'x-poll-secret': start.pollSecret } });
    expect(declined.body).toMatchObject({ status: 'error', error: 'access_denied' });
  });

  it('signs the Discord activity in with a Bearer session', async () => {
    fakeDiscord({ id: 'd-5', username: 'lou' });
    const res = await new Client().json('/auth/activity', { method: 'POST', json: { code: 'abc' } });
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accessToken: 'at', me: { isGuest: false, username: 'lou', balance: 1000 } });
    const me = await new Client().json('/me', { headers: { authorization: `Bearer ${res.body.sessionToken}` } });
    expect(me.body.username).toBe('lou');
  });
});

describe('guest purge (cron)', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000);
  const idOf = async (c: Client) => (await c.json('/me')).body.id as string;
  const exists = async (id: string) => (await db().select().from(users).where(eq(users.id, id))).length === 1;
  const seen = (id: string, h: number) => db().update(users).set({ lastSeenAt: hoursAgo(h) }).where(eq(users.id, id));

  it('needs the cron secret; deletes guests gone 1 h without a case, or 7 days after playing', async () => {
    const visitor = await newGuest('192.0.2.10'); // never opened a case, gone 2 h
    const player = await newGuest('192.0.2.11'); // opened a case, gone 2 days
    const oldPlayer = await newGuest('192.0.2.12'); // opened a case, gone 8 days
    const active = await newGuest('192.0.2.13'); // never opened a case, seen 30 min ago
    const account = await newAccount('kept'); // Discord accounts are never purged
    const [visitorId, playerId, oldId, activeId] = [await idOf(visitor), await idOf(player), await idOf(oldPlayer), await idOf(active)];
    await player.open('crate-a');
    await oldPlayer.open('crate-a');
    await seen(visitorId, 2);
    await seen(playerId, 48);
    await seen(oldId, 8 * 24);
    await seen(activeId, 0.5);
    await seen(account.user.id, 365 * 24);
    expect((await new Client().json('/cron/purge-guests')).status).toBe(401);
    const res = await new Client().json('/cron/purge-guests', { headers: { authorization: 'Bearer test-cron' } });
    expect(res.body.deleted).toBe(2);
    expect(await exists(visitorId)).toBe(false);
    expect(await exists(oldId)).toBe(false);
    expect(await exists(playerId)).toBe(true);
    expect(await exists(activeId)).toBe(true);
    expect(await exists(account.user.id)).toBe(true);
  });
});
