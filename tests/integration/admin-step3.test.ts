import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../server/db/client.js';
import { activity, adminLog, auctions, flagPlayers, flags, items, ledger, reports, trades, users } from '../../server/db/schema.js';
import { recordServerError, flushErrorLog } from '../../server/services/errors.js';
import { checkLedger } from '../../server/services/ledgerCheck.js';
import { befriend, giveItem, newAccount, newGuest, newStaff, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

type Poster = { json: (p: string, i?: object) => Promise<{ status: number; body: any }> };
const post = (client: Poster, path: string, json: unknown = {}) => client.json(path, { method: 'POST', json });
const balanceOf = async (id: string) => (await db().select().from(users).where(eq(users.id, id)))[0]!.balance;
const logsOf = (action: string) => db().select().from(adminLog).where(eq(adminLog.action, action)).orderBy(adminLog.id);
const ledgerOk = async () => (await checkLedger()).ok;

/** Lists an item and moves its end into the past (as if nobody settled it). */
async function endedListing(seller: Poster, itemId: string, bidder?: Poster, bid?: number, minutesAgo = 10) {
  const id = (await post(seller, '/market/listings', { itemId, startPrice: 100, buyNowPrice: null, durationHours: 24 })).body.id as string;
  if (bidder) expect((await post(bidder, `/market/auctions/${id}/bid`, { amount: bid })).status).toBe(200);
  await db()
    .update(auctions)
    .set({ endsAt: new Date(Date.now() - minutesAgo * 60_000) })
    .where(eq(auctions.id, id));
  return id;
}

describe('economy settings', () => {
  it('refuses odds that do not make 100% and explains why', async () => {
    const admin = await newStaff('mathys', 'admin');
    const preview = await post(admin.client, '/admin/economy/preview', { edits: { 'odds.milspec': '79.42' } });
    expect(preview.body).toMatchObject({ oddsOk: false, oddsTotal: '99.50', valid: false, sim: null, invalidText: 'Odds add up to 99.50%. They must make 100.00% to save.' });
    const save = await post(admin.client, '/admin/economy', { edits: { 'odds.milspec': '79.42' }, reason: 'test' });
    expect(save).toMatchObject({ status: 400, body: { error: { message: 'Odds add up to 99.50%. They must make 100.00% to save.' } } });
    expect(await logsOf('economy.update')).toHaveLength(0);
  });

  it('saves several settings: one log row each, and the game uses them right away', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const lou = await newAccount('lou');
    // A listing from before the change keeps the 5% fee.
    const before = await endedListing(vex.client, (await giveItem(vex.user.id, 'covert')).id, lou.client, 400);

    const preview = await post(admin.client, '/admin/economy/preview', { edits: { 'cases.price': '300', 'recycle.covert': '3,000', 'market.fee': '6', 'start.balance': '1000' } });
    expect(preview.body).toMatchObject({ valid: true, errors: {}, oddsOk: true });
    expect(preview.body.diff).toEqual([
      { key: 'cases.price', label: 'Case price', from: '250 CR', to: '300 CR' },
      { key: 'recycle.covert', label: 'Recycle Covert', from: '2,500 CR', to: '3,000 CR' },
      { key: 'market.fee', label: 'Sale fee', from: '5 %', to: '6 %' },
    ]);
    expect(preview.body.impacts).toContain('Live auctions keep the fee they started with. New listings pay 6%.');
    expect(preview.body.sim.price).toBe(300);

    const res = await post(admin.client, '/admin/economy', { edits: { 'cases.price': '300', 'recycle.covert': '3,000', 'market.fee': '6' }, reason: 'too many credits' });
    expect(res.body).toEqual({ toast: 'Saved 3 economy changes · logged' });
    const logs = await logsOf('economy.update');
    expect(logs.map((l) => [l.targetId, l.change, l.reason])).toEqual([
      ['cases.price', '250 → 300 CR', 'too many credits'],
      ['recycle.covert', '2,500 → 3,000 CR', 'too many credits'],
      ['market.fee', '5 → 6 %', 'too many credits'],
    ]);

    const page = (await admin.client.json('/admin/economy')).body;
    const price = page.groups.find((g: any) => g.id === 'cases').settings.find((s: any) => s.key === 'cases.price');
    expect(price).toMatchObject({ value: '300', changed: expect.stringMatching(/^Changed .* by mathys$/) });
    expect(page.history[0]).toMatchObject({ staff: 'mathys', key: 'market.fee', change: '5 → 6 %' });

    // The game: /config, a paid opening, a new listing's fee.
    expect((await vex.client.json('/config')).body).toMatchObject({ cratePrice: 300, marketFeePct: 6 });
    const open = await lou.client.open('crate-a');
    expect(open.status).toBe(200);
    const [charge] = await db().select().from(ledger).where(sql`${ledger.userId} = ${lou.user.id} AND ${ledger.type} = 'case_open'`);
    expect(charge!.amount).toBe(-300);
    const kenji = await newAccount('kenji');
    const after = await endedListing(vex.client, (await giveItem(vex.user.id, 'covert')).id, kenji.client, 400);
    const [a1] = await db().select().from(auctions).where(eq(auctions.id, before));
    const [a2] = await db().select().from(auctions).where(eq(auctions.id, after));
    expect([a1!.feeBp, a2!.feeBp]).toEqual([500, 600]);

    // Settled now: 5% of 400 for the old listing, 6% for the new one.
    const mod = await newStaff('lea', 'moderator');
    await post(mod.client, `/admin/market/auctions/${before}/settle`, { reason: 'overdue' });
    await post(mod.client, `/admin/market/auctions/${after}/settle`, { reason: 'overdue' });
    const fees = await db().select().from(auctions).where(sql`${auctions.id} IN (${before}, ${after})`);
    expect(fees.map((f) => [f.id === before ? 'before' : 'after', f.fee]).sort()).toEqual([
      ['after', 24],
      ['before', 20],
    ]);
    expect(await ledgerOk()).toBe(true);
  });
});

describe('case of the day rotation', () => {
  it('rotates every 4 h by default, follows the admin setting, and stops while staff pick a case', async () => {
    const H = 60 * 60 * 1000;
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const boundary = (every: number) => new Date((Math.floor(Date.now() / every) + 1) * every).toISOString();

    const before = (await vex.client.json('/me')).body.freeCase;
    expect(before.crateChangesAt).toBe(boundary(4 * H));

    const preview = await post(admin.client, '/admin/economy/preview', { edits: { 'case_of_day.every_h': '1' } });
    expect(preview.body).toMatchObject({ valid: true, diff: [{ key: 'case_of_day.every_h', label: 'Case of the day every', from: '4 h', to: '1 h' }] });
    expect(preview.body.impacts[0]).toMatch(/^The case of the day may change right away/);
    const save = await post(admin.client, '/admin/economy', { edits: { 'case_of_day.every_h': '1' }, reason: 'faster rotation' });
    expect(save.body).toEqual({ toast: 'Saved 1 economy change · logged' });
    expect((await logsOf('economy.update')).map((l) => [l.targetId, l.change])).toEqual([['case_of_day.every_h', '4 → 1 h']]);
    expect((await vex.client.json('/me')).body.freeCase.crateChangesAt).toBe(boundary(H));

    await post(admin.client, '/admin/catalog/case-of-day', { crateId: 'crate-b', reason: 'event' });
    expect((await vex.client.json('/me')).body.freeCase).toMatchObject({ crateId: 'crate-b', crateChangesAt: null });
  });
});

describe('market and trades', () => {
  it('cancels an auction: the leading bid is refunded, no fee, the item goes back', async () => {
    const mod = await newStaff('lea', 'moderator');
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    const item = await giveItem(vex.user.id, 'covert');
    const id = (await post(vex.client, '/market/listings', { itemId: item.id, startPrice: 100, buyNowPrice: null, durationHours: 24 })).body.id;
    await post(kenji.client, `/market/auctions/${id}/bid`, { amount: 300 });
    expect(await balanceOf(kenji.user.id)).toBe(700);

    const detail = (await mod.client.json(`/admin/market/auctions/${id}`)).body;
    expect(detail.cancel.lines).toEqual([
      'Gun | k1 goes back to vex’s inventory.',
      'Leading bid 300 CR refunded to kenji. Earlier bids were already refunded when they were outbid.',
      'vex pays no fee.',
    ]);
    expect(detail.settle).toBeNull();

    const res = await post(mod.client, `/admin/market/auctions/${id}/cancel`, { reason: 'listing abuse' });
    expect(res.body).toEqual({ toast: `Cancelled auction ${detail.number}, refunded kenji · logged` });
    expect(await balanceOf(kenji.user.id)).toBe(1000);
    expect((await db().select().from(items).where(eq(items.id, item.id)))[0]).toMatchObject({ status: 'available', ownerId: vex.user.id });
    expect((await db().select().from(auctions).where(eq(auctions.id, id)))[0]).toMatchObject({ status: 'cancelled', cancelReason: 'admin', cancelledBy: 'lea' });
    const list = (await mod.client.json('/admin/market/auctions')).body;
    expect(list.rows[0]).toMatchObject({ kind: 'cancelled', status: 'Cancelled by lea' });
    expect((await post(mod.client, `/admin/market/auctions/${id}/cancel`, { reason: 'again' })).status).toBe(409);
    expect(await ledgerOk()).toBe(true);
  });

  it('shows an overdue auction and settles it: the winner gets the item, the seller the price minus the fee', async () => {
    const mod = await newStaff('lea', 'moderator');
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    const item = await giveItem(vex.user.id, 'covert');
    const id = await endedListing(vex.client, item.id, kenji.client, 640, 14);

    const list = (await mod.client.json('/admin/market/auctions')).body;
    expect(list.rows[0]).toMatchObject({ id, kind: 'overdue', status: 'Overdue', flagged: true });
    expect(list.summary).toBe('0 live · 1 overdue · 0 sold in 24 h');
    const jobs = (await mod.client.json('/admin/jobs')).body;
    expect(jobs.find((j: any) => j.job === 'settle_auctions')).toMatchObject({ status: 'Warning', link: { to: '/admin/market' } });

    const detail = (await mod.client.json(`/admin/market/auctions/${id}`)).body;
    expect(detail.timer).toBe('Ended 14 min ago · not settled');
    expect(detail.settle.lines.slice(0, 2)).toEqual(['Gun | k1 goes to kenji for 640 CR.', 'vex gets 608 CR (640 CR minus the 5% fee, 32 CR).']);

    const res = await post(mod.client, `/admin/market/auctions/${id}/settle`, { reason: 'job missed it' });
    expect(res.body).toEqual({ toast: `Settled auction ${detail.number}: kenji wins · logged` });
    expect((await db().select().from(items).where(eq(items.id, item.id)))[0]).toMatchObject({ ownerId: kenji.user.id, status: 'available' });
    expect(await balanceOf(vex.user.id)).toBe(1000 + 608);
    expect((await logsOf('auction.settle'))[0]).toMatchObject({ staffName: 'lea', reason: 'job missed it' });
    expect((await mod.client.json('/admin/market/auctions')).body.rows[0]).toMatchObject({ kind: 'sold', status: 'Settled by lea' });
    expect(await ledgerOk()).toBe(true);
  });

  it('cancels a pending offer: items and credits released, players see "Cancelled by staff"', async () => {
    const mod = await newStaff('lea', 'moderator');
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    await befriend(vex, kenji);
    const item = await giveItem(vex.user.id, 'classified');
    const sent = await post(vex.client, '/trades', { to: 'kenji', giveItemIds: [item.id], askItemIds: [], giveCredits: 200, askCredits: 0, expiresInDays: 3 });
    expect(await balanceOf(vex.user.id)).toBe(800);

    const page = (await mod.client.json('/admin/market/trades')).body;
    expect(page.pending).toBe(1);
    expect(page.rows[0]).toMatchObject({ live: true, status: 'Pending', give: 'Gun | c1 + 200 CR', get: 'nothing', cancelText: 'Gun | c1 + 200 CR goes back to vex.' });

    const res = await post(mod.client, `/admin/market/trades/${sent.body.id}/cancel`, { reason: 'scam report' });
    expect(res.body.toast).toMatch(/^Cancelled offer #\d+, items and credits released · logged$/);
    expect(await balanceOf(vex.user.id)).toBe(1000);
    expect((await db().select().from(items).where(eq(items.id, item.id)))[0]!.status).toBe('available');
    expect((await db().select().from(trades).where(eq(trades.id, sent.body.id)))[0]).toMatchObject({ status: 'cancelled', cancelReason: 'admin', cancelledBy: 'lea' });
    const history = (await kenji.client.json('/trades?box=history')).body;
    expect(history[0]).toMatchObject({ status: 'cancelled', byStaff: true });
    expect(await ledgerOk()).toBe(true);
  });
});

describe('monitors', () => {
  async function tradeGold(from: Awaited<ReturnType<typeof newAccount>>, to: Awaited<ReturnType<typeof newAccount>>) {
    const item = await giveItem(from.user.id, 'gold');
    const sent = await post(from.client, '/trades', { to: to.user.username, giveItemIds: [item.id], askItemIds: [], giveCredits: 0, askCredits: 0, expiresInDays: 3 });
    expect((await post(to.client, `/trades/${sent.body.id}/accept`)).status).toBe(200);
  }

  it('flags repeated one-way trades once, and refreshes the flag on the next one', async () => {
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    await befriend(vex, kenji);
    for (let i = 0; i < 3; i++) await tradeGold(vex, kenji);
    expect(await db().select().from(flags).where(eq(flags.kind, 'Repeated trades'))).toHaveLength(0);
    await tradeGold(vex, kenji);
    const [flag] = await db().select().from(flags).where(eq(flags.kind, 'Repeated trades'));
    expect(flag).toMatchObject({ status: 'open', urgent: true, monitor: 'trade monitor', text: expect.stringContaining('from vex to kenji') });
    expect(flag!.evidence[0]).toEqual({ v: '4', k: 'trades in 2 days' });
    await tradeGold(vex, kenji);
    const again = await db().select().from(flags).where(eq(flags.kind, 'Repeated trades'));
    expect(again).toHaveLength(1);
    expect(again[0]!.evidence[0]).toEqual({ v: '5', k: 'trades in 2 days' });
    expect(await db().select().from(flagPlayers).where(eq(flagPlayers.flagId, flag!.id))).toHaveLength(2);

    // The new account that received it all is flagged too.
    const [fresh] = await db().select().from(flags).where(eq(flags.kind, 'New account'));
    expect(fresh!.text).toMatch(/^kenji received [\d,]+ CR of items 1 day after joining\.$/);

    // Dismiss, then a ban handles the other one.
    const mod = await newStaff('lea', 'moderator');
    const listed = (await mod.client.json('/admin/flags')).body;
    expect(listed.open).toBe(2);
    const res = await post(mod.client, `/admin/flags/${flag!.id}/dismiss`, { reason: 'brothers, checked on Discord' });
    expect(res.body).toEqual({ toast: 'Dismissed flag “Repeated trades” · logged' });
    await post(mod.client, `/admin/players/${kenji.user.id}/ban`, { duration: '7d', reason: 'alt account' });
    const after = (await mod.client.json('/admin/flags')).body;
    expect(after.open).toBe(0);
    expect(after.rows.find((f: any) => f.kind === 'New account')).toMatchObject({ open: false, state: 'Handled', raised: expect.stringContaining('kenji banned by lea') });
    expect(after.rows.find((f: any) => f.kind === 'Repeated trades')).toMatchObject({ state: 'Dismissed by lea' });
  });

  it('never flags guests, nor Discord accounts that only share an address', async () => {
    for (let i = 0; i < 6; i++) await newGuest('192.0.2.50');
    const family = [await newAccount('ana'), await newAccount('ben'), await newAccount('cleo')];
    await db().update(users).set({ createdIpHash: 'home' }).where(inArray(users.id, family.map((a) => a.user.id)));
    await newGuest('192.0.2.50');
    expect(await db().select().from(flags)).toHaveLength(0);
  });

  it('flags accounts from one address that send their items to one player', async () => {
    const main = await newAccount('nyx');
    const alts = [await newAccount('alt1'), await newAccount('alt2'), await newAccount('alt3')];
    await db().update(users).set({ createdIpHash: 'farm' }).where(inArray(users.id, alts.map((a) => a.user.id)));
    for (const alt of alts) await befriend(alt, main);
    const sameIp = () => db().select().from(flags).where(eq(flags.kind, 'Many accounts, 1 IP'));
    expect(await sameIp()).toHaveLength(0);
    // One ★ item (10,000 CR) is enough to raise it.
    await tradeGold(alts[0]!, main);
    const [flag] = await sameIp();
    expect(flag).toMatchObject({ monitor: 'trade monitor', urgent: false, text: expect.stringContaining('all sent their items to nyx') });
    expect(flag!.evidence[0]!.v).toBe('3');
    expect(flag!.evidence[2]!.k).toBe('of items sent to nyx');
    expect(await db().select().from(flagPlayers).where(eq(flagPlayers.flagId, flag!.id))).toHaveLength(4);
    await tradeGold(alts[1]!, main);
    await tradeGold(alts[2]!, main);
    const again = await sameIp();
    expect(again).toHaveLength(1);
    expect(again[0]!.urgent).toBe(true);
  });

  it('flags a sale far above the usual price', async () => {
    const vex = await newAccount('vex');
    const kenji = await newAccount('kenji');
    const item = await giveItem(vex.user.id, 'milspec');
    const id = (await post(vex.client, '/market/listings', { itemId: item.id, startPrice: 900, buyNowPrice: 1000, durationHours: 24 })).body.id;
    expect((await post(kenji.client, `/market/auctions/${id}/buy`)).status).toBe(200);
    const [flag] = await db().select().from(flags);
    expect(flag).toMatchObject({ kind: 'Unusual price', fingerprint: `price:${id}`, text: expect.stringContaining('sold by vex to kenji') });
    expect(flag!.evidence[1]).toEqual({ v: '30 CR', k: 'recycle value' });
    const mod = await newStaff('lea', 'moderator');
    expect((await mod.client.json('/admin/market/auctions')).body.rows[0]).toMatchObject({ flagged: true });
  });
});

describe('moderation', () => {
  it('takes player reports, one open per pair, and handles them by dismiss or rename', async () => {
    const mod = await newStaff('lea', 'moderator');
    const dune = await newAccount('dune');
    const ash = await newAccount('ash');
    await newAccount('l0ser_dune');
    expect((await post(dune.client, '/players/l0ser_dune/report', { category: 'Offensive name', message: 'This name is about me.' })).status).toBe(200);
    expect((await post(dune.client, '/players/l0ser_dune/report', { category: 'Other', message: 'again' })).status).toBe(409);
    expect((await post(dune.client, '/players/dune/report', { category: 'Scam', message: 'me' })).status).toBe(400);
    expect((await post(ash.client, '/players/dune/report', { category: 'Scam', message: 'Never sent the CR.' })).status).toBe(200);
    const guest = await newGuest();
    expect((await post(guest, '/players/dune/report', { category: 'Scam', message: 'x' })).status).toBe(403);

    const page = (await mod.client.json('/admin/moderation')).body;
    expect(page.openReports).toBe(2);
    const offensive = page.reports.find((r: any) => r.category === 'Offensive name');
    expect(offensive).toMatchObject({ hideName: true, urgent: false, suggestedName: expect.stringMatching(/^player_/) });
    const scam = page.reports.find((r: any) => r.category === 'Scam');
    expect(scam).toMatchObject({ urgent: true, hideName: false, meta: expect.stringMatching(/^reported by ash · /) });

    const dismissed = await post(mod.client, `/admin/reports/${scam.id}/dismiss`, { reason: 'no proof' });
    expect(dismissed.body).toEqual({ toast: 'Dismissed report on dune · logged' });
    await post(mod.client, `/admin/players/${offensive.target.id}/rename`, { name: offensive.suggestedName, reason: 'offensive name' });
    const rows = await db().select().from(reports).orderBy(reports.id);
    expect(rows.map((r) => [r.status, r.handledNote?.split(',')[0]])).toEqual([
      ['handled', `Handled · renamed to ${offensive.suggestedName} by lea`],
      ['handled', 'Dismissed by lea'],
    ]);
    expect((await mod.client.json('/admin/me')).body.badges.reports).toBe(0);
  });

  it('hides a ★ drop from the banner and shows it again', async () => {
    const mod = await newStaff('lea', 'moderator');
    const vex = await newAccount('vex');
    const item = await giveItem(vex.user.id, 'gold');
    const [row] = await db().insert(activity).values({ userId: vex.user.id, type: 'unbox', itemId: item.id }).returning();
    expect((await vex.client.json('/drops/latest')).body.drop).toMatchObject({ id: row!.id });
    expect((await post(mod.client, `/admin/drops/${row!.id}/hide`, { reason: 'name' })).body).toEqual({ toast: 'Hid vex’s drop from the banner · logged' });
    expect((await vex.client.json('/drops/latest')).body.drop).toBeNull();
    expect((await mod.client.json('/admin/moderation')).body.drops[0]).toMatchObject({ hidden: true, state: 'Hidden by lea' });
    expect((await post(mod.client, `/admin/drops/${row!.id}/show`, { reason: 'renamed' })).body.toast).toBe('Showing vex’s drop in the banner again · logged');
    expect((await vex.client.json('/drops/latest')).body.drop).toMatchObject({ id: row!.id });
  });

  it('posts, schedules and ends announcements (UTC times, 140 characters)', async () => {
    const mod = await newStaff('lea', 'moderator');
    const vex = await newAccount('vex');
    const local = (d: Date) => d.toISOString().slice(0, 16);
    const now = Date.now();
    expect((await post(mod.client, '/admin/announcements', { text: 'x'.repeat(141), startsAt: local(new Date(now)), endsAt: local(new Date(now + 3_600_000)), reason: 'r' })).status).toBe(400);
    expect((await post(mod.client, '/admin/announcements', { text: 'Late', startsAt: local(new Date(now)), endsAt: local(new Date(now - 3_600_000)), reason: 'r' })).body.error.message).toBe('The end must come after the start.');
    const live = await post(mod.client, '/admin/announcements', { text: 'Fever Case is off for a fix.', startsAt: local(new Date(now - 60_000)), endsAt: local(new Date(now + 3_600_000)), reason: 'bug' });
    expect(live.body).toEqual({ toast: 'Posted the announcement · logged' });
    const later = new Date(now + 86_400_000);
    const scheduled = await post(mod.client, '/admin/announcements', { text: 'Maintenance tomorrow.', startsAt: local(later), endsAt: local(new Date(later.getTime() + 3_600_000)), reason: 'ops' });
    expect(scheduled.body.toast).toMatch(/^Scheduled the announcement for .* · logged$/);
    expect((await vex.client.json('/announcements/current')).body).toMatchObject({ text: 'Fever Case is off for a fix.' });
    const page = (await mod.client.json('/admin/moderation')).body;
    expect(page.announcements.map((a: any) => a.state)).toEqual(['Live', 'Scheduled']);
    await post(mod.client, `/admin/announcements/${page.announcements[0].id}/end`, { reason: 'fixed' });
    expect((await vex.client.json('/announcements/current')).body).toBeNull();
  });

  it('gifts credits to every player (not guests or banned ones), with a ledger entry each', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const nyx = await newAccount('nyx');
    const guest = await newGuest();
    await post(admin.client, `/admin/players/${nyx.user.id}/ban`, { duration: '24h', reason: 'x' });
    const preview = (await post(admin.client, '/admin/events/gift/preview', { amount: 500 })).body;
    expect(preview).toMatchObject({ players: 2, button: 'Gift 500 CR to 2 players' });
    expect(preview.costs[0]).toEqual({ k: 'Total cost', v: '1,000 CR' });
    const res = await post(admin.client, '/admin/events/gift', { amount: 500, reason: 'weekend event' });
    expect(res.body).toEqual({ toast: 'Gifted 500 CR to 2 players · logged' });
    expect(await balanceOf(vex.user.id)).toBe(1500);
    expect(await balanceOf(nyx.user.id)).toBe(1000);
    const gifts = await db().select().from(ledger).where(eq(ledger.type, 'admin_gift'));
    expect(gifts.map((g) => g.userId).sort()).toEqual([admin.user.id, vex.user.id].sort());
    expect((await guest.json('/me')).body.balance).toBe(1000);
    // The ledger tab of the player names who gave it and why.
    const tab = (await admin.client.json(`/admin/players/${vex.user.id}/tabs/ledger`)).body;
    expect(tab.ledger[0]).toMatchObject({ type: 'admin_gift', amount: 500, details: 'by mathys · weekend event' });
    expect(await ledgerOk()).toBe(true);
  });

  it('gives everyone one extra free case, on top of an empty stack', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const daily = (await vex.client.json('/me')).body.freeCase.crateId;
    // Empty stack: the timer just started.
    await db().update(users).set({ freeCaseAnchor: new Date() }).where(eq(users.id, vex.user.id));
    expect((await vex.client.json('/me')).body.freeCase.available).toBe(false);
    expect((await post(admin.client, '/admin/events/free-case', { reason: 'sorry for the outage' })).body).toEqual({ toast: 'Gave 2 players a free case · logged' });
    expect((await vex.client.json('/me')).body.freeCase).toMatchObject({ available: true, count: 1 });
    expect((await vex.client.open(daily, { free: true })).status).toBe(200);
    expect((await vex.client.open(daily, { free: true })).status).not.toBe(200);
    expect((await db().select().from(users).where(eq(users.id, vex.user.id)))[0]!.bonusFreeCases).toBe(0);
    expect(await ledgerOk()).toBe(true);
  });

  it('uses a bonus case before the stack, and lets it go above the stack size', async () => {
    const admin = await newStaff('mathys', 'admin');
    const vex = await newAccount('vex');
    const daily = (await vex.client.json('/me')).body.freeCase.crateId;
    await post(admin.client, '/admin/events/free-case', { reason: 'launch party' });
    expect((await vex.client.json('/me')).body.freeCase).toMatchObject({ count: 6, max: 5, nextAt: null });
    expect((await vex.client.open(daily, { free: true })).body.freeCase).toMatchObject({ count: 5, nextAt: null });
    const [row] = await db().select().from(users).where(eq(users.id, vex.user.id));
    expect(row).toMatchObject({ bonusFreeCases: 0, freeCaseAnchor: null });
  });
});

describe('logs and tools', () => {
  it('searches the ledger by player, type and entry, and checks it without writing anything', async () => {
    const viewer = await newStaff('sam', 'viewer');
    const vex = await newAccount('vex');
    await vex.client.open('crate-a');
    const byPlayer = (await viewer.client.json('/admin/ledger?q=vex')).body;
    expect(byPlayer.rows.map((r: any) => r.type).sort()).toEqual(['case_open', 'start_balance']);
    expect(byPlayer.rows.every((r: any) => r.player.label === 'vex')).toBe(true);
    const byType = (await viewer.client.json('/admin/ledger?q=case_open')).body;
    expect(byType.rows).toHaveLength(1);
    expect(byType.rows[0]).toMatchObject({ amount: -250, details: 'Alpha Case' });
    const byId = (await viewer.client.json(`/admin/ledger?q=%23${byType.rows[0].id}`)).body;
    expect(byId.rows).toHaveLength(1);
    const check = await post(viewer.client, '/admin/ledger/check');
    expect(check.body).toMatchObject({ ok: true, mismatches: [] });
    expect(await db().select().from(adminLog)).toHaveLength(0);
  });

  it('counts API errors per code and keeps server errors', async () => {
    const viewer = await newStaff('sam', 'viewer');
    const vex = await newAccount('vex');
    await vex.client.json('/admin/overview');
    await vex.client.json('/admin/overview');
    recordServerError('POST /api/test', 'boom');
    await flushErrorLog();
    const page = (await viewer.client.json('/admin/errors')).body;
    expect(page.codes).toEqual(expect.arrayContaining([{ code: 'forbidden', count: 2, hint: expect.any(String), alert: false }, { code: 'internal', count: 1, hint: 'Server error. Always worth a look.', alert: true }]));
    expect(page.errors[0]).toMatchObject({ code: 'internal', route: 'POST /api/test', message: 'boom', count: 1 });
  });
});
