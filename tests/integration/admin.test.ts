import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../server/app.js';
import { closeDb, db } from '../../server/db/client.js';
import { adminLog, auctions, items, ledger, sessions, trades, users } from '../../server/db/schema.js';
import { checkLedger } from '../../server/services/ledgerCheck.js';
import { type Account, befriend, Client, giveItem, newAccount, newGuest, newStaff, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

type Role = 'viewer' | 'moderator' | 'admin';

/**
 * Minimum role of every admin route. The first test checks this table against the routes the app
 * really has, so a new admin route can't ship without a role check being tested.
 */
const ROUTES: [string, string, Role][] = [
  ['GET', '/api/admin/me', 'viewer'],
  ['GET', '/api/admin/search', 'viewer'],
  ['GET', '/api/admin/skins', 'viewer'],
  ['GET', '/api/admin/players', 'viewer'],
  ['GET', '/api/admin/players/:id', 'viewer'],
  ['GET', '/api/admin/players/:id/tabs/:tab', 'viewer'],
  ['POST', '/api/admin/players/:id/credits/preview', 'admin'],
  ['POST', '/api/admin/players/:id/credits', 'admin'],
  ['POST', '/api/admin/players/:id/grant/quote', 'admin'],
  ['POST', '/api/admin/players/:id/grant', 'admin'],
  ['POST', '/api/admin/players/:id/free-case/reset', 'admin'],
  ['POST', '/api/admin/players/:id/sign-out', 'moderator'],
  ['GET', '/api/admin/players/:id/ban/preview', 'moderator'],
  ['POST', '/api/admin/players/:id/ban', 'moderator'],
  ['POST', '/api/admin/players/:id/unban', 'moderator'],
  ['POST', '/api/admin/players/:id/rename', 'moderator'],
  ['POST', '/api/admin/players/:id/notes', 'moderator'],
  ['GET', '/api/admin/players/:id/delete/preview', 'admin'],
  ['POST', '/api/admin/players/:id/delete', 'admin'],
  ['POST', '/api/admin/guests/delete', 'admin'],
  ['GET', '/api/admin/items', 'viewer'],
  ['GET', '/api/admin/items/:id', 'viewer'],
  ['POST', '/api/admin/items/:id/unlock', 'admin'],
  ['POST', '/api/admin/items/:id/restore', 'admin'],
  ['POST', '/api/admin/items/:id/move/preview', 'admin'],
  ['POST', '/api/admin/items/:id/move', 'admin'],
  ['POST', '/api/admin/items/:id/showcase-remove', 'moderator'],
  ['GET', '/api/admin/overview', 'viewer'],
  ['POST', '/api/admin/jobs/:job/run', 'admin'],
  ['GET', '/api/admin/catalog', 'viewer'],
  ['GET', '/api/admin/catalog/cases/:id', 'viewer'],
  ['POST', '/api/admin/catalog/cases/:id/active', 'admin'],
  ['POST', '/api/admin/catalog/cases/:id/new', 'admin'],
  ['POST', '/api/admin/catalog/case-of-day', 'admin'],
  ['POST', '/api/admin/catalog/import/dry-run', 'viewer'],
  ['POST', '/api/admin/catalog/import/apply', 'admin'],
  ['GET', '/api/admin/log', 'viewer'],
  ['GET', '/api/admin/log.csv', 'viewer'],
  ['GET', '/api/admin/economy', 'viewer'],
  ['POST', '/api/admin/economy/preview', 'viewer'],
  ['POST', '/api/admin/economy', 'admin'],
  ['GET', '/api/admin/market/auctions', 'viewer'],
  ['GET', '/api/admin/market/auctions/:id', 'viewer'],
  ['POST', '/api/admin/market/auctions/:id/cancel', 'moderator'],
  ['POST', '/api/admin/market/auctions/:id/settle', 'moderator'],
  ['GET', '/api/admin/market/trades', 'viewer'],
  ['POST', '/api/admin/market/trades/:id/cancel', 'moderator'],
  ['GET', '/api/admin/flags', 'viewer'],
  ['POST', '/api/admin/flags/:id/dismiss', 'moderator'],
  ['GET', '/api/admin/moderation', 'viewer'],
  ['POST', '/api/admin/reports/:id/dismiss', 'moderator'],
  ['POST', '/api/admin/drops/:id/hide', 'moderator'],
  ['POST', '/api/admin/drops/:id/show', 'moderator'],
  ['POST', '/api/admin/announcements', 'moderator'],
  ['POST', '/api/admin/announcements/:id/end', 'moderator'],
  ['POST', '/api/admin/events/gift/preview', 'viewer'],
  ['POST', '/api/admin/events/gift', 'admin'],
  ['POST', '/api/admin/events/free-case', 'admin'],
  ['GET', '/api/admin/ledger', 'viewer'],
  ['POST', '/api/admin/ledger/check', 'viewer'],
  ['GET', '/api/admin/jobs', 'viewer'],
  ['GET', '/api/admin/errors', 'viewer'],
];

const RANK: Record<Role, number> = { viewer: 0, moderator: 1, admin: 2 };
const HINT: Record<Role, string> = { viewer: 'Staff only.', moderator: 'Moderators and admins.', admin: 'Admins only.' };

/** A concrete path for a route pattern (ids that don't exist: the role check comes first). */
const concrete = (path: string) =>
  path
    .replace('/api', '')
    .replace(':id/tabs/:tab', '00000000-0000-4000-8000-000000000000/tabs/ledger')
    .replace(':id', '00000000-0000-4000-8000-000000000000')
    .replace(':job', 'check_ledger');

async function call(client: Client, method: string, path: string) {
  const res = await client.request(concrete(path), method === 'GET' ? {} : { method, json: { reason: '' } });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function ledgerMatchesBalances() {
  return (await checkLedger()).ok;
}

const balanceOf = async (id: string) => (await db().select().from(users).where(eq(users.id, id)))[0]!.balance;
const itemOf = async (id: string) => (await db().select().from(items).where(eq(items.id, id)))[0]!;
const logRows = () => db().select().from(adminLog).orderBy(adminLog.id);

describe('roles', () => {
  it('every admin route is in the role table', () => {
    const live = app.routes
      .filter((r) => r.path.startsWith('/api/admin') && ['GET', 'POST'].includes(r.method))
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(live).toEqual(ROUTES.map(([m, p]) => `${m} ${p}`).sort());
  });

  it('refuses guests, players and deleted staff on every route', async () => {
    const guest = await newGuest();
    const player = await newAccount('lou');
    for (const [method, path] of ROUTES) {
      for (const client of [guest, player.client, new Client()]) {
        const res = await call(client, method, path);
        expect([res.status, res.body?.error?.code, `${method} ${path}`]).toEqual([403, 'forbidden', `${method} ${path}`]);
      }
    }
  });

  it('lets each role do exactly what its rank allows', async () => {
    const staff = { viewer: await newStaff('sam', 'viewer'), moderator: await newStaff('lea', 'moderator'), admin: await newStaff('mathys', 'admin') };
    for (const [method, path, min] of ROUTES) {
      for (const role of ['viewer', 'moderator', 'admin'] as Role[]) {
        const res = await call(staff[role].client, method, path);
        if (RANK[role] < RANK[min]) {
          expect([res.status, res.body?.error?.message, `${role} ${method} ${path}`]).toEqual([403, HINT[min], `${role} ${method} ${path}`]);
        } else {
          expect([res.status === 403, `${role} ${method} ${path}`]).toEqual([false, `${role} ${method} ${path}`]);
        }
      }
    }
  });
});

describe('admin log', () => {
  it('writes one entry per action with who, what, before, after and why', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const res = await admin.client.json(`/admin/players/${vex.user.id}/credits`, { method: 'POST', json: { mode: 'add', amount: 5000, reason: 'compensation, outage' } });
    expect(res).toMatchObject({ status: 200, body: { toast: 'Added 5,000 CR to vex · logged' } });
    const [entry] = await logRows();
    expect(entry).toMatchObject({
      staffName: 'mathys',
      action: 'player.add_credits',
      targetType: 'player',
      targetId: vex.user.id,
      targetLabel: 'vex',
      change: '+5,000 CR',
      before: { balance: '1,000 CR', held: '0 CR' },
      after: { balance: '6,000 CR', held: '0 CR' },
      reason: 'compensation, outage',
    });
    // The ledger row points at the action (request id in the log details).
    const [row] = await db().select().from(ledger).where(eq(ledger.type, 'admin_grant'));
    expect(row).toMatchObject({ userId: vex.user.id, amount: 5000, balanceAfter: 6000 });
    expect(entry!.details).toMatchObject({ request: row!.refId, ledger: [row!.id] });
    expect(await ledgerMatchesBalances()).toBe(true);
  });

  it('refuses an action without a reason and changes nothing', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const res = await admin.client.json(`/admin/players/${vex.user.id}/credits`, { method: 'POST', json: { mode: 'add', amount: 5000, reason: '   ' } });
    expect(res.status).toBe(400);
    expect(await balanceOf(vex.user.id)).toBe(1000);
    expect(await logRows()).toHaveLength(0);
  });

  it('can never be edited or deleted', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    await admin.client.json(`/admin/players/${vex.user.id}/credits`, { method: 'POST', json: { mode: 'add', amount: 10, reason: 'test' } });
    await expect(db().update(adminLog).set({ reason: 'changed' })).rejects.toThrow();
    await expect(db().delete(adminLog)).rejects.toThrow();
    expect((await logRows())[0]!.reason).toBe('test');
  });
});

describe('credits', () => {
  it('never takes a balance below 0, and says how much can be removed', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const preview = await admin.client.json(`/admin/players/${vex.user.id}/credits/preview`, { method: 'POST', json: { mode: 'remove', amount: 5000 } });
    expect(preview.body).toMatchObject({ before: 1000, after: -4000, blocked: 'vex only has 1,000 CR. Remove 1,000 CR or less.' });
    const res = await admin.client.json(`/admin/players/${vex.user.id}/credits`, { method: 'POST', json: { mode: 'remove', amount: 5000, reason: 'duplicate refund' } });
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'balance_too_low', message: 'vex only has 1,000 CR. Remove 1,000 CR or less.' } } });
    expect(await balanceOf(vex.user.id)).toBe(1000);
    expect(await db().select().from(ledger).where(eq(ledger.type, 'admin_remove'))).toHaveLength(0);
    expect(await logRows()).toHaveLength(0);

    const ok = await admin.client.json(`/admin/players/${vex.user.id}/credits`, { method: 'POST', json: { mode: 'remove', amount: 1000, reason: 'duplicate refund' } });
    expect(ok.body.toast).toBe('Removed 1,000 CR from vex · logged');
    expect(await balanceOf(vex.user.id)).toBe(0);
    expect((await logRows())[0]).toMatchObject({ action: 'player.remove_credits', change: '−1,000 CR' });
    expect(await ledgerMatchesBalances()).toBe(true);
  });
});

// ── Stuck items ─────────────────────────────────────────────────────────────

const list = (seller: Account, itemId: string) =>
  seller.client.json('/market/listings', { method: 'POST', json: { itemId, startPrice: 100, buyNowPrice: null, durationHours: 24 } });
const offer = (from: Account, to: string, body: Record<string, unknown>) =>
  from.client.json('/trades', { method: 'POST', json: { to, giveItemIds: [], askItemIds: [], giveCredits: 0, askCredits: 0, expiresInDays: 3, ...body } });

describe('stuck items', () => {
  it('finds items marked Listed or In trade that nothing live holds, and unlocks them', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    await befriend(vex, kenji);

    const orphanListed = await giveItem(vex.user.id, 'milspec', { status: 'listed' });
    const orphanTrade = await giveItem(vex.user.id, 'restricted');
    await db().update(items).set({ status: 'in_trade' }).where(eq(items.id, orphanTrade.id));
    const reallyListed = await giveItem(vex.user.id, 'classified');
    expect((await list(vex, reallyListed.id)).status).toBe(201);
    const inOffer = await giveItem(vex.user.id, 'covert');
    const sent = await offer(vex, 'kenji', { giveItemIds: [inOffer.id] });
    expect(sent.status).toBe(201);
    // An offer past its expiry still holds its items until it is settled: not stuck.
    await db().update(trades).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(trades.id, sent.body.id));

    const stuck = await admin.client.json('/admin/items?status=stuck');
    expect(stuck.body.rows.map((r: { id: string }) => r.id).sort()).toEqual([orphanListed.id, orphanTrade.id].sort());
    expect(stuck.body.rows.every((r: { stuck: boolean }) => r.stuck)).toBe(true);
    const detail = await admin.client.json(`/admin/items/${orphanTrade.id}`);
    expect(detail.body.stuckNote).toContain('No live listing or offer holds it, so vex can’t sell, trade or recycle it.');
    expect(detail.body.timeline.some((t: { kind: string }) => t.kind === 'alert')).toBe(true);

    const refused = await admin.client.json(`/admin/items/${reallyListed.id}/unlock`, { method: 'POST', json: { reason: 'support' } });
    expect(refused).toMatchObject({ status: 409, body: { error: { code: 'not_stuck' } } });
    const unlocked = await admin.client.json(`/admin/items/${orphanTrade.id}/unlock`, { method: 'POST', json: { reason: 'ticket #58' } });
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.toast).toBe('Unlocked Gun | r1 · logged');
    expect((await itemOf(orphanTrade.id)).status).toBe('available');
    expect((await logRows()).at(-1)).toMatchObject({ action: 'item.unlock', before: { status: 'In trade' }, after: { status: 'Available', owner: 'vex (unchanged)' } });
    const after = await admin.client.json('/admin/items?status=stuck');
    expect(after.body.rows.map((r: { id: string }) => r.id)).toEqual([orphanListed.id]);
  });
});

// ── Ban ─────────────────────────────────────────────────────────────────────

describe('ban', () => {
  async function scene() {
    const mod = await newStaff('lea', 'moderator');
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    const lou = await newAccount('lou');
    await befriend(vex, kenji);
    await befriend(vex, lou);
    // vex sells an item kenji bids on.
    const sold = await giveItem(vex.user.id, 'covert');
    const listing = (await list(vex, sold.id)).body.id as string;
    expect((await kenji.client.json(`/market/auctions/${listing}/bid`, { method: 'POST', json: { amount: 300 } })).status).toBe(200);
    // vex leads a bid on lou's listing.
    const lousItem = await giveItem(lou.user.id, 'classified');
    const lousListing = (await list(lou, lousItem.id)).body.id as string;
    expect((await vex.client.json(`/market/auctions/${lousListing}/bid`, { method: 'POST', json: { amount: 200 } })).status).toBe(200);
    // One offer sent by vex (item + credits), one received from lou.
    const given = await giveItem(vex.user.id, 'milspec');
    const sent = (await offer(vex, 'kenji', { giveItemIds: [given.id], giveCredits: 50 })).body.id as string;
    const lousOffer = await giveItem(lou.user.id, 'restricted');
    const received = (await offer(lou, 'vex', { giveItemIds: [lousOffer.id] })).body.id as string;
    return { mod, vex, kenji, lou, sold, listing, lousItem, lousListing, given, sent, lousOffer, received };
  }

  it('shows what will happen before it happens', async () => {
    const s = await scene();
    const preview = await s.mod.client.json(`/admin/players/${s.vex.user.id}/ban/preview`);
    expect(preview.body).toMatchObject({
      sessions: 1,
      listings: [{ item: 'Gun | k1', bids: 1, leader: 'kenji', leading: 300 }],
      bids: [{ item: 'Gun | c1', amount: 200 }],
      offers: 2,
    });
  });

  it('cancels listings, bids and offers, signs the player out, and leaves them read-only', async () => {
    const s = await scene();
    const kenjiBefore = await balanceOf(s.kenji.user.id);
    const vexBefore = await balanceOf(s.vex.user.id);
    const res = await s.mod.client.json(`/admin/players/${s.vex.user.id}/ban`, { method: 'POST', json: { duration: '7d', reason: 'scam attempt in trades' } });
    expect(res).toMatchObject({ status: 200, body: { toast: 'Banned vex for 7 days · logged' } });

    // Listing cancelled, the item back to vex, kenji's bid refunded, no fee.
    const [listing] = await db().select().from(auctions).where(eq(auctions.id, s.listing));
    expect(listing).toMatchObject({ status: 'cancelled', cancelReason: 'ban' });
    expect((await itemOf(s.sold.id)).status).toBe('available');
    expect(await balanceOf(s.kenji.user.id)).toBe(kenjiBefore + 300);
    // vex's leading bid on lou's listing refunded; the listing goes on with no leader.
    const [lous] = await db().select().from(auctions).where(eq(auctions.id, s.lousListing));
    expect(lous).toMatchObject({ status: 'active', leaderId: null, currentBid: null, bidCount: 0 });
    // Offers both ways cancelled: vex's held credits and items come back, lou's item too.
    const offers = await db().select().from(trades).where(sql`${trades.id} IN (${s.sent}, ${s.received})`);
    expect(offers.map((t) => [t.status, t.cancelReason])).toEqual([['cancelled', 'ban'], ['cancelled', 'ban']]);
    expect((await itemOf(s.given.id)).status).toBe('available');
    expect((await itemOf(s.lousOffer.id)).status).toBe('available');
    expect(await balanceOf(s.vex.user.id)).toBe(vexBefore + 200 + 50);
    // Every session revoked.
    const live = await db().select().from(sessions).where(sql`${sessions.userId} = ${s.vex.user.id} AND ${sessions.revokedAt} IS NULL`);
    expect(live).toHaveLength(0);
    expect(await ledgerMatchesBalances()).toBe(true);
    expect((await checkLedger()).ok).toBe(true);

    // The old session shows the ban instead of turning into a guest.
    const me = await s.vex.client.json('/me');
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe('banned');
    expect(me.body.error.message).toMatch(/^You’re banned until [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} UTC\. Reason: scam attempt in trades$/);
    expect(me.body.error.ban).toMatchObject({ reason: 'scam attempt in trades' });

    // Signing in again: read-only, with the ban in /me.
    const { createSession } = await import('../../server/auth/sessions.js');
    const { token } = await createSession(db(), s.vex.user.id, 'web');
    s.vex.client.cookie = `mint_session=${token}`;
    const again = await s.vex.client.json('/me');
    expect(again.status).toBe(200);
    expect(again.body.ban).toMatchObject({ reason: 'scam attempt in trades' });
    expect((await s.vex.client.json('/inventory')).status).toBe(200);
    const blocked = await s.vex.client.open('crate-a');
    expect(blocked).toMatchObject({ status: 403, body: { error: { code: 'banned' } } });

    const entry = (await logRows()).at(-1)!;
    expect(entry).toMatchObject({ staffName: 'lea', action: 'player.ban', change: '7 days', reason: 'scam attempt in trades', before: { status: 'active', sessions: '1' } });
    expect(entry.after).toMatchObject({ sessions: '0 (revoked)' });
    expect(String(entry.after.status)).toMatch(/^banned until /);
  });

  it('asks for the name before a permanent ban, and unbans', async () => {
    const mod = await newStaff('lea', 'moderator');
    const nyx = await newAccount('nyx');
    const wrong = await mod.client.json(`/admin/players/${nyx.user.id}/ban`, { method: 'POST', json: { duration: 'permanent', reason: 'scam', confirmName: 'nix' } });
    expect(wrong).toMatchObject({ status: 400, body: { error: { code: 'confirm_name_mismatch', message: 'Type nyx to confirm a permanent ban.' } } });
    const ok = await mod.client.json(`/admin/players/${nyx.user.id}/ban`, { method: 'POST', json: { duration: 'permanent', reason: 'scam', confirmName: 'nyx' } });
    expect(ok.body.toast).toBe('Banned nyx permanently · logged');
    expect((await db().select().from(users).where(eq(users.id, nyx.user.id)))[0]).toMatchObject({ banUntil: null, banReason: 'scam', bannedBy: 'lea' });
    const twice = await mod.client.json(`/admin/players/${nyx.user.id}/ban`, { method: 'POST', json: { duration: '24h', reason: 'again' } });
    expect(twice.status).toBe(409);

    const unban = await mod.client.json(`/admin/players/${nyx.user.id}/unban`, { method: 'POST', json: { reason: 'appeal accepted' } });
    expect(unban.body.toast).toBe('Unbanned nyx · logged');
    const { createSession } = await import('../../server/auth/sessions.js');
    const { token } = await createSession(db(), nyx.user.id, 'web');
    nyx.client.cookie = `mint_session=${token}`;
    expect((await nyx.client.open('crate-a')).status).toBe(200);
  });
});


