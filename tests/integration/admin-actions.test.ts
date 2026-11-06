import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../server/db/client.js';
import { adminLog, auctions, items, ledger, sessions, showcase, trades, users } from '../../server/db/schema.js';
import { checkLedger } from '../../server/services/ledgerCheck.js';
import { befriend, giveItem, newAccount, newGuest, newStaff, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

const balanceOf = async (id: string) => (await db().select().from(users).where(eq(users.id, id)))[0]!.balance;
const itemOf = async (id: string) => (await db().select().from(items).where(eq(items.id, id)))[0]!;
const lastLog = async () => (await db().select().from(adminLog).orderBy(adminLog.id)).at(-1)!;
const post = (client: { json: (p: string, i?: object) => Promise<{ status: number; body: any }> }, path: string, json: unknown) =>
  client.json(path, { method: 'POST', json });

describe('items', () => {
  it('moves a listed item: the listing is cancelled and the leading bid refunded first', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    const lou = await newAccount('lou');
    const item = await giveItem(vex.user.id, 'covert');
    const listing = (await post(vex.client, '/market/listings', { itemId: item.id, startPrice: 100, buyNowPrice: null, durationHours: 24 })).body.id;
    await post(lou.client, `/market/auctions/${listing}/bid`, { amount: 400 });
    const louBefore = await balanceOf(lou.user.id);

    expect((await post(admin.client, `/admin/items/${item.id}/move/preview`, { to: 'nobody' })).body).toMatchObject({ target: null, error: 'No player called “nobody”.' });
    expect((await post(admin.client, `/admin/items/${item.id}/move/preview`, { to: 'kenji' })).body).toMatchObject({ target: { label: 'kenji' }, error: null });
    const res = await post(admin.client, `/admin/items/${item.id}/move`, { to: 'kenji', reason: 'support ticket #58' });
    expect(res.body.toast).toBe('Moved Gun | k1 to kenji · logged');
    expect(await itemOf(item.id)).toMatchObject({ ownerId: kenji.user.id, status: 'available', acquiredVia: 'admin' });
    expect((await db().select().from(auctions).where(eq(auctions.id, listing)))[0]).toMatchObject({ status: 'cancelled', cancelReason: 'admin' });
    expect(await balanceOf(lou.user.id)).toBe(louBefore + 400);
    expect(await lastLog()).toMatchObject({ action: 'item.move', change: 'vex → kenji', before: { owner: 'vex' }, after: { owner: 'kenji', status: 'Available' } });
    const moves = await db().select().from(ledger).where(eq(ledger.itemId, item.id));
    expect(moves.map((m) => m.type)).toEqual(expect.arrayContaining(['admin_item_out', 'admin_item_in', 'bid_release']));
    expect((await checkLedger()).ok).toBe(true);
  });

  it('moves an item out of a pending offer, which is cancelled', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    await befriend(vex, kenji);
    const item = await giveItem(vex.user.id, 'classified');
    const sent = await post(vex.client, '/trades', { to: 'kenji', giveItemIds: [item.id], askItemIds: [], giveCredits: 30, askCredits: 0, expiresInDays: 3 });
    const res = await post(admin.client, `/admin/items/${item.id}/move`, { to: 'kenji', reason: 'ticket' });
    expect(res.status).toBe(200);
    expect((await db().select().from(trades).where(eq(trades.id, sent.body.id)))[0]).toMatchObject({ status: 'cancelled', cancelReason: 'admin' });
    expect(await balanceOf(vex.user.id)).toBe(1000);
    expect((await checkLedger()).ok).toBe(true);
  });

  it('restores a recycled item and can take the recycle credits back', async () => {
    const admin = await newStaff('mathys', 'admin');
    const lou = await newAccount('lou');
    const item = await giveItem(lou.user.id, 'classified');
    await post(lou.client, '/items/recycle', { itemIds: [item.id], confirm: true });
    const paid = (await balanceOf(lou.user.id)) - 1000;
    expect(paid).toBeGreaterThan(0);
    const detail = (await admin.client.json(`/admin/items/${item.id}`)).body;
    expect(detail.restore).toMatchObject({ owner: 'lou', blocked: null, clawback: { amount: paid, before: 1000 + paid, after: 1000 } });
    expect((await post(admin.client, `/admin/items/${item.id}/move`, { to: 'lou', reason: 'x' })).body.error.message).toBe('Restore it first.');
    const res = await post(admin.client, `/admin/items/${item.id}/restore`, { clawback: true, reason: 'credits taken, item not delivered' });
    expect(res.body.toast).toBe(`Restored Gun | c1 to lou, took back ${paid.toLocaleString('en-US')} CR · logged`);
    expect(await itemOf(item.id)).toMatchObject({ status: 'available', destroyedAt: null });
    expect(await balanceOf(lou.user.id)).toBe(1000);
    expect((await checkLedger()).ok).toBe(true);
  });

  it('removes an item from a showcase for 24 h', async () => {
    const mod = await newStaff('lea', 'moderator');
    const vex = await newAccount('vex');
    const item = await giveItem(vex.user.id, 'covert');
    await vex.client.json('/me/showcase', { method: 'PUT', json: { itemIds: [item.id] } });
    const res = await post(mod.client, `/admin/items/${item.id}/showcase-remove`, { reason: 'offensive pattern' });
    expect(res.body.toast).toBe('Removed Gun | k1 from vex’s showcase · logged');
    expect(await db().select().from(showcase).where(eq(showcase.itemId, item.id))).toHaveLength(0);
    const back = await vex.client.json('/me/showcase', { method: 'PUT', json: { itemIds: [item.id] } });
    expect(back.status).toBe(409);
    expect(back.body.error.message).toMatch(/^This item can’t go back in a showcase until /);
    expect((await post(mod.client, `/admin/items/${item.id}/showcase-remove`, { reason: 'again' })).body.error.message).toBe('Not in a showcase.');
  });
});

describe('players', () => {
  it('grants an item with a float inside both the wear and the skin range', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const base = { skinId: 'm2', wear: 'FT', stattrak: false };
    expect((await post(admin.client, `/admin/players/${vex.user.id}/grant/quote`, { ...base, float: 0.5 })).body.error).toBe('FT floats go from 0.15 to 0.38. Pick another wear or change the float.');
    expect((await post(admin.client, `/admin/players/${vex.user.id}/grant/quote`, { ...base, wear: 'BS', float: 0.9 })).body.error).toBe("This skin’s floats go from 0.00 to 0.80.");
    expect((await post(admin.client, `/admin/players/${vex.user.id}/grant/quote`, { ...base, float: 2 })).body.error).toBe('Type a float between 0 and 1.');
    const quote = (await post(admin.client, `/admin/players/${vex.user.id}/grant/quote`, { ...base, float: 0.2381 })).body;
    expect(quote).toMatchObject({ error: null, value: 30, inventoryBefore: 0, inventoryAfter: 30 });
    const bad = await post(admin.client, `/admin/players/${vex.user.id}/grant`, { ...base, float: 0.5, pattern: null, reason: 'ticket' });
    expect(bad.status).toBe(400);
    const res = await post(admin.client, `/admin/players/${vex.user.id}/grant`, { ...base, float: 0.2381, pattern: 412, reason: 'support ticket #61' });
    expect(res.body.toast).toBe('Granted Gun | m2 (FT 0.2381) to vex · logged');
    const [granted] = await db().select().from(items).where(eq(items.ownerId, vex.user.id));
    expect(granted).toMatchObject({ skinId: 'm2', float: 0.2381, pattern: 412, source: 'admin', acquiredVia: 'admin', status: 'available' });
    const detail = (await admin.client.json(`/admin/items/${granted!.id}`)).body;
    expect(detail.grantedBy).toBe('mathys');
    expect((await checkLedger()).ok).toBe(true);
  });

  it('refills the free cases and signs a player out everywhere', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    // 2 cases in the stack (anchor 25 minutes ago).
    await db().update(users).set({ freeCaseAnchor: new Date(Date.now() - 25 * 60_000) }).where(eq(users.id, vex.user.id));
    expect((await admin.client.json(`/admin/players/${vex.user.id}`)).body).toMatchObject({ freeCases: 2, freeCaseMax: 5 });
    expect((await post(admin.client, `/admin/players/${vex.user.id}/free-case/reset`, { reason: 'outage' })).body.toast).toBe('Refilled vex’s free cases · logged');
    expect((await db().select().from(users).where(eq(users.id, vex.user.id)))[0]!.freeCaseAnchor).toBeNull();
    expect((await vex.client.json('/me')).body.freeCase).toMatchObject({ count: 5, nextAt: null });
    const [entry] = await db().select().from(adminLog).where(eq(adminLog.action, 'player.refill_free_cases'));
    expect(entry).toMatchObject({ change: 'free cases refilled', after: { 'free cases': '5/5 (full)' } });
    expect((entry!.before as Record<string, string>)['free cases']).toMatch(/^2\/5 · next /);
    expect((await post(admin.client, `/admin/players/${vex.user.id}/sign-out`, { reason: 'account shared' })).body.toast).toBe('Signed vex out of 1 session · logged');
    expect((await vex.client.json('/me')).status).toBe(401);
    expect((await db().select().from(sessions).where(eq(sessions.userId, vex.user.id)))[0]!.revokedReason).toBe('admin');
  });

  it('renames a player, who then picks a new name', async () => {
    const mod = await newStaff('lea', 'moderator');
    const vex = await newAccount('vex');
    const { renameTo } = (await mod.client.json(`/admin/players/${vex.user.id}`)).body;
    expect(renameTo).toMatch(/^player_\d{4}$/);
    const res = await post(mod.client, `/admin/players/${vex.user.id}/rename`, { name: renameTo, reason: 'offensive name' });
    expect(res.body.toast).toBe(`Renamed vex to ${renameTo} · logged`);
    expect((await vex.client.json('/me')).body).toMatchObject({ username: renameTo, mustPickName: true });
    await newAccount('taken');
    expect((await post(vex.client, '/me/username', { username: 'taken' })).status).toBe(409);
    expect((await post(vex.client, '/me/username', { username: 'x' })).status).toBe(400);
    expect((await post(vex.client, '/me/username', { username: 'Vexed' })).body).toMatchObject({ username: 'vexed', mustPickName: false });
    expect((await post(vex.client, '/me/username', { username: 'again' })).status).toBe(409);
  });

  it('deletes an account but keeps its history', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    await befriend(vex, kenji);
    const item = await giveItem(vex.user.id, 'covert');
    const preview = (await admin.client.json(`/admin/players/${vex.user.id}/delete/preview`)).body;
    expect(preview).toMatchObject({ balance: 1000, items: 1, friends: 1, sessions: 1 });
    expect((await post(admin.client, `/admin/players/${vex.user.id}/delete`, { confirmName: 'vix', reason: 'gdpr' })).status).toBe(400);
    const res = await post(admin.client, `/admin/players/${vex.user.id}/delete`, { confirmName: 'vex', reason: 'asked to delete their data, ticket #63' });
    expect(res.body.toast).toBe('Deleted vex’s account · logged');
    const [row] = await db().select().from(users).where(eq(users.id, vex.user.id));
    expect(row).toMatchObject({ username: null, discordId: null, balance: 0 });
    expect(row!.deletedAt).not.toBeNull();
    expect((await itemOf(item.id)).status).toBe('destroyed');
    expect((await db().select().from(ledger).where(eq(ledger.userId, vex.user.id))).length).toBeGreaterThan(1);
    expect((await vex.client.json('/me')).status).toBe(401);
    expect((await kenji.client.json('/friends')).body.friends).toHaveLength(0);
    expect((await admin.client.json(`/admin/players/${vex.user.id}`)).body).toMatchObject({ label: 'Deleted player', deleted: true });
    expect((await checkLedger()).ok).toBe(true);
  });

  it('lets a player delete their own account, like a staff deletion', async () => {
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    const guest = await newGuest();
    await befriend(vex, kenji);
    const item = await giveItem(vex.user.id, 'covert');
    expect((await post(guest, '/me/delete', { confirmName: 'guest' })).status).toBe(403);
    const wrong = await post(vex.client, '/me/delete', { confirmName: 'kenji' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('confirm_name_mismatch');
    const res = await post(vex.client, '/me/delete', { confirmName: ' VEX ' });
    expect(res.status).toBe(204);
    const [row] = await db().select().from(users).where(eq(users.id, vex.user.id));
    expect(row).toMatchObject({ username: null, discordId: null, balance: 0 });
    expect(row!.deletedAt).not.toBeNull();
    expect((await itemOf(item.id)).status).toBe('destroyed');
    expect(await db().select().from(sessions).where(eq(sessions.userId, vex.user.id))).toHaveLength(0);
    expect((await vex.client.json('/me')).status).toBe(401);
    expect((await kenji.client.json('/friends')).body.friends).toHaveLength(0);
    expect(await lastLog()).toMatchObject({ action: 'player.delete', staffName: 'player', reason: 'Deleted by the player', targetLabel: 'vex' });
    expect((await checkLedger()).ok).toBe(true);
  });

  it('deletes guests in bulk, and only guests', async () => {
    const admin = await newStaff('mathys', 'admin');
    const a = await newGuest('198.51.100.1');
    const b = await newGuest('198.51.100.2');
    const vex = await newAccount('vex');
    const ids = await Promise.all([a, b].map(async (g) => (await g.json('/me')).body.id as string));
    expect((await post(admin.client, '/admin/guests/delete', { ids: [...ids, vex.user.id], reason: 'spam' })).status).toBe(409);
    const res = await post(admin.client, '/admin/guests/delete', { ids, reason: 'spam' });
    expect(res.body.toast).toBe('Deleted 2 guests · logged');
    expect(await lastLog()).toMatchObject({ action: 'player.delete_guests', change: '2 deleted', before: { balance: '2,000 CR' } });
    expect((await a.json('/me')).status).toBe(401);
  });

  it('lists players with filters and counts', async () => {
    const viewer = await newStaff('sam', 'viewer');
    await newAccount('vex');
    await newGuest();
    const page = (await viewer.client.json('/admin/players?type=guest')).body;
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].label).toMatch(/^Guest #[0-9a-f]{4}$/);
    expect(page.counts).toMatchObject({ all: 3, accounts: 2, guests: 1, banned: 0, flagged: 0 });
    expect((await viewer.client.json('/admin/players?q=vex')).body.rows.map((r: { label: string }) => r.label)).toEqual(['vex']);
    const search = (await viewer.client.json('/admin/search?q=vex')).body;
    expect(search.players.map((p: { label: string }) => p.label)).toEqual(['vex']);
  });
});

describe('catalog', () => {
  it('turns cases off and on, never the case of the day, and picks it', async () => {
    const admin = await newStaff('mathys', 'admin');
    const catalog = (await admin.client.json('/admin/catalog')).body;
    const today = catalog.caseOfDay.id as string;
    const other = today === 'crate-a' ? 'crate-b' : 'crate-a';
    const blocked = await post(admin.client, `/admin/catalog/cases/${today}/active`, { value: false, reason: 'broken images' });
    expect(blocked.body.error.message).toBe('It’s the case of the day right now. Pick another case of the day first, then turn it off.');
    const off = await post(admin.client, `/admin/catalog/cases/${other}/active`, { value: false, reason: 'broken images' });
    expect(off.body.toast).toMatch(/^Turned off (Alpha|Beta) Case · logged$/);
    expect((await admin.client.json('/admin/catalog')).body.caseOfDay.id).toBe(today);
    expect((await post(admin.client, '/admin/catalog/case-of-day', { crateId: other, reason: 'rotation' })).body.error.message).toBe('Cases that are off can’t be picked.');
    await post(admin.client, `/admin/catalog/cases/${other}/active`, { value: true, reason: 'fixed' });
    const picked = await post(admin.client, '/admin/catalog/case-of-day', { crateId: other, reason: 'weekly rotation' });
    expect(picked.body.toast).toMatch(/^Made (Alpha|Beta) Case the case of the day · logged$/);
    const player = await newAccount('vex');
    expect((await player.client.json('/me')).body.freeCase.crateId).toBe(other);
    const newBadge = await post(admin.client, `/admin/catalog/cases/crate-a/new`, { value: true, reason: 'launch' });
    expect(newBadge.body.toast).toBe('Marked Alpha Case as new · logged');
    expect((await player.client.json('/crates')).body.find((c: { id: string }) => c.id === 'crate-a').isNew).toBe(true);
  });
});

describe('reads', () => {
  it('answers every screen with real data', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    await befriend(vex, kenji);
    expect((await vex.client.open('crate-a')).status).toBe(200);
    const item = await giveItem(vex.user.id, 'covert');
    await post(vex.client, '/market/listings', { itemId: item.id, startPrice: 100, buyNowPrice: null, durationHours: 24 });
    await post(admin.client, `/admin/players/${vex.user.id}/credits`, { mode: 'add', amount: 10, reason: 'test' });
    await post(admin.client, `/admin/players/${vex.user.id}/notes`, { text: 'Watch the trades with kenji.' });

    const ok = async (path: string): Promise<any> => {
      const res = await admin.client.request(path);
      expect([path, res.status]).toEqual([path, 200]);
      return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
    };
    for (const period of ['24h', '7d', '30d']) {
      const o = await ok(`/admin/overview?period=${period}`);
      expect(o.kpis).toHaveLength(6);
      expect(o.flow.buckets).toHaveLength(period === '24h' ? 24 : period === '7d' ? 7 : 30);
      expect(o.flow.created).toBeGreaterThan(0);
      expect(o.drops.sample).toBe(1);
      expect(o.jobs.map((j: { name: string }) => j.name)).toEqual(['Guest purge', 'Trade expiry', 'Auction settlement', 'Ledger check']);
    }
    for (const tab of ['inventory', 'openings', 'trades', 'market', 'friends', 'ledger', 'sessions', 'notes']) await ok(`/admin/players/${vex.user.id}/tabs/${tab}`);
    const ledgerTab = await ok(`/admin/players/${vex.user.id}/tabs/ledger`);
    expect(ledgerTab.ledger[0]).toMatchObject({ type: 'admin_grant', amount: 10, details: 'by mathys · test' });
    expect(ledgerTab.ledger.at(-1)).toMatchObject({ type: 'start_balance', details: 'account created' });
    const player = await ok(`/admin/players/${vex.user.id}`);
    expect(player.signals.map((s: { key: string }) => s.key)).toEqual(['age', 'ip', 'flags', 'reports']);
    await ok('/admin/players?sort=value&dir=desc&status=active&joined=30');
    await ok(`/admin/items/${item.id}`);
    await ok('/admin/items?tiers=covert,gold&stattrak=false');
    await ok('/admin/items?q=000000001');
    await ok('/admin/catalog');
    const crate = await ok('/admin/catalog/cases/crate-a');
    expect(crate.groups.map((g: { tier: string }) => g.tier)).toEqual(['covert', 'classified', 'restricted', 'milspec', 'gold']);
    const log = await ok('/admin/log?range=all&action=credits.,player.');
    expect(log.rows.map((r: { action: string }) => r.action)).toEqual(['player.add_note', 'player.add_credits']);
    const csv = await ok('/admin/log.csv?range=all');
    expect(csv.split('\r\n')[0]).toBe('id,time_utc,staff,action,target_type,target_id,target,change,reason,before,after,details');
    await ok('/admin/me');
    await ok('/admin/skins?q=gun m1');

    const run = await post(admin.client, '/admin/jobs/check_ledger/run', { reason: 'after the fix' });
    expect(run.body.toast).toBe('Ran ledger check · logged');
    expect((await ok('/admin/overview')).jobs.find((j: { job: string }) => j.job === 'check_ledger').result).toMatch(/^OK · \d+ entries$/);
  });
});
