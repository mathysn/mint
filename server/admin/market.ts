// Admin › Market & trades: auctions (cancel, settle an overdue one), trade offers (cancel) and the
// flags the monitors raised (dismiss). Reads never settle anything on their own: "Settle now" does.
import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type {
  AdminActionResult,
  AdminAuctionDetail,
  AdminAuctionKind,
  AdminAuctionRow,
  AdminAuctionsPage,
  AdminConfirmText,
  AdminFlag,
  AdminFlags,
  AdminTradeRow,
  AdminTradesPage,
} from '../../shared/api.js';
import { db, type DbOrTx, type Tx } from '../db/client.js';
import { adminLog, auctions, bids, flagPlayers, flags, items, jobRuns, reports, skins, tradeItems, trades, users } from '../db/schema.js';
import { econ, OVERDUE_AFTER_MS } from '../game/economy.js';
import { marketFee } from '../game/market.js';
import { wearOf } from '../game/wear.js';
import { cr, fmt, plural, utcDateTime, utcStamp } from '../format.js';
import { fail, isBanned } from '../http.js';
import { itemValueExpr } from '../services/items.js';
import { lockUsers } from '../services/locks.js';
import { cancelAuctionByStaff, settle } from '../services/market.js';
import { release } from '../services/trades.js';
import { Wallets } from '../services/wallet.js';
import { labelOf } from './labels.js';
import { writeAdminLog } from './log.js';
import { stuckSql } from './stuck.js';
import type { StaffMember } from './staff.js';

const PAGE = 50;
export const pageSchema = z.object({ offset: z.coerce.number().int().min(0).max(100_000).default(0) });

const seller = alias(users, 'seller');
const leader = alias(users, 'leader');
const person = (id: string, username: string | null, deletedAt: Date | null) => ({ id, label: labelOf(id, username, deletedAt) });

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

/** "1:42" under the anti-sniping window, "58 min", "4 h 51 min". */
function remaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60 * 60 && s <= econ().antiSnipeMinutes * 60) return `${Math.floor(s / 60)}:${pad(s % 60)}`;
  const min = Math.ceil(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

const auctionSelect = (tx: DbOrTx) =>
  tx
    .select({
      a: auctions,
      name: skins.name,
      weaponName: skins.weaponName,
      finishName: skins.finishName,
      imageUrl: skins.imageUrl,
      tier: items.tier,
      float: items.float,
      stattrak: items.stattrak,
      sellerName: seller.username,
      sellerDeleted: seller.deletedAt,
      leaderName: leader.username,
      leaderDeleted: leader.deletedAt,
    })
    .from(auctions)
    .innerJoin(items, eq(items.id, auctions.itemId))
    .innerJoin(skins, eq(skins.id, items.skinId))
    .innerJoin(seller, eq(seller.id, auctions.sellerId))
    .leftJoin(leader, eq(leader.id, auctions.leaderId));

type AuctionJoin = Awaited<ReturnType<typeof auctionSelect>>[number];

function kindOf(a: AuctionJoin['a'], now: Date): AdminAuctionKind {
  if (a.status !== 'active') return a.status;
  const left = a.endsAt.getTime() - now.getTime();
  if (left <= -OVERDUE_AFTER_MS) return 'overdue';
  return left <= econ().antiSnipeMinutes * 60_000 ? 'urgent' : 'live';
}

function statusOf(a: AuctionJoin['a'], kind: AdminAuctionKind, settledBy: string | undefined): string {
  switch (kind) {
    case 'live':
    case 'urgent':
      return a.endsAt <= new Date() ? 'Settling' : 'Live';
    case 'overdue':
      return 'Overdue';
    case 'sold':
      return settledBy ? `Settled by ${settledBy}` : 'Settled';
    case 'unsold':
      return settledBy ? `Not sold · settled by ${settledBy}` : 'Not sold';
    case 'cancelled':
      if (a.cancelReason === 'admin') return `Cancelled by ${a.cancelledBy ?? 'staff'}`;
      if (a.cancelReason === 'ban') return 'Cancelled by ban';
      if (a.cancelReason === 'deleted') return 'Cancelled by deletion';
      return 'Cancelled by seller';
  }
}

/** Staff who settled these auctions by hand ("Settle now"), from the admin log. */
async function settledBy(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db()
    .select({ id: adminLog.targetId, staff: adminLog.staffName })
    .from(adminLog)
    .where(and(eq(adminLog.action, 'auction.settle'), inArray(adminLog.targetId, ids)));
  return new Map(rows.map((r) => [r.id!, r.staff]));
}

/** Auctions the unusual-price monitor flagged (open flags). */
async function flaggedAuctions(ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db()
    .select({ fp: flags.fingerprint })
    .from(flags)
    .where(and(eq(flags.status, 'open'), inArray(flags.fingerprint, ids.map((id) => `price:${id}`))));
  return new Set(rows.map((r) => r.fp!.slice('price:'.length)));
}

function toRow(r: AuctionJoin, now: Date, by: Map<string, string>, flagged: Set<string>): AdminAuctionRow {
  const a = r.a;
  const kind = kindOf(a, now);
  const ended = kind === 'sold' || kind === 'unsold' || kind === 'cancelled';
  const ends =
    kind === 'live' || kind === 'urgent'
      ? a.endsAt <= now
        ? `ended ${hhmm(a.endsAt)}`
        : remaining(a.endsAt.getTime() - now.getTime())
      : kind === 'overdue'
        ? `ended ${hhmm(a.endsAt)}`
        : utcDateTime(a.closedAt ?? a.endsAt);
  return {
    id: a.id,
    number: `#${a.number}`,
    name: r.name,
    tier: r.tier,
    wear: wearOf(r.float)?.code ?? null,
    stattrak: r.stattrak,
    seller: person(a.sellerId, r.sellerName, r.sellerDeleted),
    bid: a.finalPrice ?? a.currentBid ?? a.startPrice,
    bidsLine: a.boughtNow
      ? 'Bought now'
      : a.bidCount > 0
        ? `${plural(a.bidCount, 'bid')}${a.leaderId ? ` · ${labelOf(a.leaderId, r.leaderName, r.leaderDeleted)}` : ''}`
        : ended
          ? 'No bids'
          : 'No bids · start price',
    buyNow: a.buyNowPrice,
    kind,
    ends,
    status: statusOf(a, kind, by.get(a.id)),
    flagged: kind === 'overdue' || flagged.has(a.id),
  };
}

// Live first (ending soonest), then overdue, then closed ones (latest first).
const bucket = sql`CASE WHEN ${auctions.status} = 'active' AND ${auctions.endsAt} > now() - ${`${OVERDUE_AFTER_MS} milliseconds`}::interval THEN 0 WHEN ${auctions.status} = 'active' THEN 1 ELSE 2 END`;

export async function listAuctions(offset: number): Promise<AdminAuctionsPage> {
  const now = new Date();
  const rows = await auctionSelect(db())
    .where(sql`${auctions.status} = 'active' OR COALESCE(${auctions.closedAt}, ${auctions.endsAt}) > now() - interval '30 days'`)
    .orderBy(bucket, sql`CASE WHEN ${auctions.status} = 'active' THEN ${auctions.endsAt} END ASC`, sql`COALESCE(${auctions.closedAt}, ${auctions.endsAt}) DESC`, desc(auctions.number))
    .limit(PAGE + 1)
    .offset(offset);
  const page = rows.slice(0, PAGE);
  const ids = page.map((r) => r.a.id);
  const [by, flagged, [counts]] = await Promise.all([
    settledBy(ids),
    flaggedAuctions(ids),
    db()
      .select({
        live: sql<number>`count(*) FILTER (WHERE ${auctions.status} = 'active' AND ${auctions.endsAt} > now() - ${`${OVERDUE_AFTER_MS} milliseconds`}::interval)::int`,
        overdue: sql<number>`count(*) FILTER (WHERE ${auctions.status} = 'active' AND ${auctions.endsAt} <= now() - ${`${OVERDUE_AFTER_MS} milliseconds`}::interval)::int`,
        sold: sql<number>`count(*) FILTER (WHERE ${auctions.status} = 'sold' AND ${auctions.closedAt} > now() - interval '24 hours')::int`,
      })
      .from(auctions),
  ]);
  const c = counts ?? { live: 0, overdue: 0, sold: 0 };
  return {
    rows: page.map((r) => toRow(r, now, by, flagged)),
    next: rows.length > PAGE ? offset + PAGE : null,
    summary: `${fmt(c.live)} live · ${fmt(c.overdue)} overdue · ${fmt(c.sold)} sold in 24 h`,
    live: c.live,
  };
}

const WEAR_NAME: Record<string, string> = { FN: 'Factory New', MW: 'Minimal Wear', FT: 'Field-Tested', WW: 'Well-Worn', BS: 'Battle-Scarred' };

/** How many settlement runs went by since the auction ended. */
async function missedRuns(endsAt: Date) {
  const [row] = await db().select({ n: count() }).from(jobRuns).where(and(eq(jobRuns.job, 'settle_auctions'), gt(jobRuns.startedAt, endsAt)));
  return row?.n ?? 0;
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${fmt(n)} times`);

export async function auctionDetail(id: string): Promise<AdminAuctionDetail> {
  const now = new Date();
  const [r] = await auctionSelect(db()).where(eq(auctions.id, id));
  if (!r) return fail(404, 'not_found', 'Unknown auction.');
  const a = r.a;
  const [by, flagged] = await Promise.all([settledBy([a.id]), flaggedAuctions([a.id])]);
  const row = toRow(r, now, by, flagged);
  const bidRows = await db()
    .select({ userId: bids.userId, amount: bids.amount, at: bids.createdAt, username: users.username, deletedAt: users.deletedAt })
    .from(bids)
    .innerJoin(users, eq(users.id, bids.userId))
    .where(eq(bids.auctionId, a.id))
    .orderBy(desc(bids.amount), desc(bids.createdAt));
  const active = a.status === 'active';
  const sellerLabel = row.seller.label;
  const leaderLabel = a.leaderId ? labelOf(a.leaderId, r.leaderName, r.leaderDeleted) : null;
  const missed = row.kind === 'overdue' ? await missedRuns(a.endsAt) : 0;
  const minutesAgo = Math.max(1, Math.round((now.getTime() - a.endsAt.getTime()) / 60_000));
  const ago = minutesAgo < 60 ? `${minutesAgo} min ago` : `${Math.round(minutesAgo / 60)} h ago`;
  const timer =
    row.kind === 'overdue' ? `Ended ${ago} · not settled` : active ? (a.endsAt <= now ? `Ended ${ago} · settling` : `Ends in ${row.ends}`) : row.status;
  const planned = a.createdAt.getTime() + a.durationHours * 3_600_000;
  const extendedMin = Math.round((a.endsAt.getTime() - planned) / 60_000);
  const facts: { k: string; v: string }[] = [
    { k: 'Seller', v: sellerLabel },
    { k: 'Start price', v: cr(a.startPrice) },
    { k: 'Buy now', v: a.buyNowPrice !== null ? cr(a.buyNowPrice) : '—' },
    { k: 'Started', v: utcDateTime(a.createdAt) },
    { k: a.endsAt <= now ? 'Ended' : 'Ends', v: utcDateTime(a.endsAt) },
  ];
  if (row.kind === 'overdue') facts.push({ k: 'Settlement', v: missed ? `missed ${plural(missed, 'run')}` : 'waiting for the next run' });
  else if (a.status === 'sold') facts.push({ k: 'Sold for', v: `${cr(a.finalPrice ?? 0)} · fee ${cr(a.fee ?? 0)}` });
  else facts.push({ k: 'Anti-sniping', v: extendedMin > 0 ? `extended ${extendedMin} min` : 'not triggered' });
  const name = r.name;
  const lead = a.leaderId && a.currentBid !== null ? { who: leaderLabel!, amount: a.currentBid } : null;
  const cancel: AdminConfirmText | null = active
    ? {
        title: `Cancel auction #${a.number}`,
        lines: [
          `${name} goes back to ${sellerLabel}’s inventory.`,
          lead ? `Leading bid ${cr(lead.amount)} refunded to ${lead.who}. Earlier bids were already refunded when they were outbid.` : 'Nobody bid: there is nothing to refund.',
          `${sellerLabel} pays no fee.`,
        ],
        button: 'Cancel auction',
      }
    : null;
  let settleText: AdminConfirmText | null = null;
  if (active && a.endsAt <= now) {
    const fee = lead ? marketFee(lead.amount, a.feeBp) : 0;
    settleText = {
      title: `Settle auction #${a.number} now`,
      lines: lead
        ? [
            `${name} goes to ${lead.who} for ${cr(lead.amount)}.`,
            `${sellerLabel} gets ${cr(lead.amount - fee)} (${cr(lead.amount)} minus the ${(a.feeBp / 100).toLocaleString('en-US')}% fee, ${cr(fee)}).`,
          ]
        : [`Nobody bid: ${name} goes back to ${sellerLabel}’s inventory.`],
      button: 'Settle now',
    };
    if (missed) settleText.lines.push(`The settlement job skipped it ${times(missed)}. Logs & tools › Jobs has the details.`);
  }
  const wearCode = wearOf(r.float)?.code ?? null;
  return {
    ...row,
    weaponName: r.weaponName,
    finishName: r.finishName ?? 'Vanilla',
    imageUrl: r.imageUrl,
    wearName: wearCode ? WEAR_NAME[wearCode]! : null,
    timer,
    facts,
    bids: bidRows.map((b, i) => ({ who: person(b.userId, b.username, b.deletedAt), amount: b.amount, at: b.at.toISOString(), leading: i === 0 && active && b.userId === a.leaderId })),
    bidCount: a.bidCount,
    cancel,
    cancelHint: active ? null : `Already ${row.status.toLowerCase()}`,
    settle: settleText,
  };
}

async function lockAuctionRow(tx: Tx, id: string) {
  const [a] = await tx.select().from(auctions).where(eq(auctions.id, id)).for('update');
  if (!a) return fail(404, 'not_found', 'Unknown auction.');
  return a;
}

async function auctionLabel(tx: DbOrTx, a: { number: number; itemId: string }) {
  const [s] = await tx.select({ name: skins.name }).from(items).innerJoin(skins, eq(skins.id, items.skinId)).where(eq(items.id, a.itemId));
  return { item: s?.name ?? 'item', label: `#${a.number} · ${s?.name ?? 'item'}` };
}

const nameOf = async (tx: DbOrTx, id: string | null) => {
  if (!id) return '';
  const [u] = await tx.select({ username: users.username, deletedAt: users.deletedAt }).from(users).where(eq(users.id, id));
  return u ? labelOf(id, u.username, u.deletedAt) : '';
};

export async function cancelAuction(staff: StaffMember, id: string, reason: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const a = await lockAuctionRow(tx, id);
    if (a.status !== 'active') fail(409, 'conflict', `Auction #${a.number} already ended.`);
    const wallets = new Wallets(await lockUsers(tx, [a.sellerId, a.leaderId ?? a.sellerId]));
    const refund = await cancelAuctionByStaff(tx, a, 'admin', wallets, staff.name);
    const ledgerIds = await wallets.save(tx);
    const { item, label } = await auctionLabel(tx, a);
    const sellerName = await nameOf(tx, a.sellerId);
    const leaderName = await nameOf(tx, refund?.userId ?? null);
    await writeAdminLog(tx, staff, {
      action: 'auction.cancel',
      target: { type: 'auction', id: a.id, label },
      change: refund ? `cancelled · ${cr(refund.amount)} refunded` : 'cancelled',
      before: { status: 'live', 'leading bid': refund ? `${cr(refund.amount)} (${leaderName})` : 'none', item: `listed by ${sellerName}` },
      after: { status: `cancelled by ${staff.name}`, ...(refund ? { refund: `+${cr(refund.amount)} to ${leaderName}` } : {}), item: `back to ${sellerName}`, fee: 'none' },
      reason,
      details: { request: randomUUID(), ledger: ledgerIds, items: [a.itemId], item },
    });
    return { toast: refund ? `Cancelled auction #${a.number}, refunded ${leaderName} · logged` : `Cancelled auction #${a.number} · logged` };
  });
}

export async function settleAuction(staff: StaffMember, id: string, reason: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const a = await lockAuctionRow(tx, id);
    if (a.status !== 'active') fail(409, 'conflict', `Auction #${a.number} already ended.`);
    if (a.endsAt > new Date()) fail(409, 'conflict', `Auction #${a.number} hasn't ended yet.`);
    const done = await settle(tx, a);
    const { item, label } = await auctionLabel(tx, a);
    const sellerName = await nameOf(tx, a.sellerId);
    const winner = done.sold ? await nameOf(tx, a.leaderId) : '';
    await writeAdminLog(tx, staff, {
      action: 'auction.settle',
      target: { type: 'auction', id: a.id, label },
      change: done.sold ? `sold to ${winner} · ${cr(a.currentBid ?? 0)}` : 'not sold',
      before: { status: `overdue since ${utcDateTime(a.endsAt)}` },
      after: done.sold
        ? { status: 'sold', winner: `${winner} · ${cr(a.currentBid ?? 0)}`, seller: `+${cr((a.currentBid ?? 0) - done.fee)} to ${sellerName} (fee ${cr(done.fee)})` }
        : { status: 'not sold', item: `back to ${sellerName}` },
      reason,
      details: { request: randomUUID(), ledger: done.ledgerIds, items: [a.itemId], item },
    });
    return { toast: done.sold ? `Settled auction #${a.number}: ${winner} wins · logged` : `Settled auction #${a.number}: not sold · logged` };
  });
}

// ── Trades ──────────────────────────────────────────────────────────────────

const sender = alias(users, 'sender');
const recipient = alias(users, 'recipient');

interface Side {
  names: string[];
  value: number;
  count: number;
}

async function tradeSides(tradeIds: string[]) {
  const out = new Map<string, { sender: Side; recipient: Side; stuck: boolean }>();
  for (const id of tradeIds) out.set(id, { sender: { names: [], value: 0, count: 0 }, recipient: { names: [], value: 0, count: 0 }, stuck: false });
  if (!tradeIds.length) return out;
  const rows = await db()
    .select({ tradeId: tradeItems.tradeId, side: tradeItems.side, name: skins.name, value: itemValueExpr(), stuck: stuckSql })
    .from(tradeItems)
    .innerJoin(items, eq(items.id, tradeItems.itemId))
    .innerJoin(skins, eq(skins.id, items.skinId))
    .where(inArray(tradeItems.tradeId, tradeIds))
    .orderBy(asc(tradeItems.itemId));
  for (const r of rows) {
    const t = out.get(r.tradeId)!;
    const side = t[r.side];
    side.names.push(r.name);
    side.value += Number(r.value);
    side.count++;
    if (r.side === 'sender' && r.stuck) t.stuck = true;
  }
  return out;
}

/** "M4A1-S | Black Lotus, Tec-9 | Slag" / "P90 | Neoqueen + 300 CR" / "900 CR" / "nothing". */
function sideText(side: Side, credits: number) {
  const items = side.names.join(', ');
  const give = items && credits ? `${items} + ${cr(credits)}` : items || (credits ? cr(credits) : 'nothing');
  const value = side.count ? `${plural(side.count, 'item')} · ${cr(side.value + credits)}` : cr(credits);
  return { give, value };
}

/** "in 2 d 23 h", "in 6 d", "in 5 h". */
function expiresIn(d: Date, now: Date) {
  const min = Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 60_000));
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `in ${h} h`;
  const days = Math.floor(h / 24);
  return `in ${days} d${h % 24 ? ` ${h % 24} h` : ''}`;
}

export async function listTrades(offset: number): Promise<AdminTradesPage> {
  const now = new Date();
  const rows = await db()
    .select({ t: trades, fromName: sender.username, fromDeleted: sender.deletedAt, toName: recipient.username, toDeleted: recipient.deletedAt })
    .from(trades)
    .innerJoin(sender, eq(sender.id, trades.senderId))
    .innerJoin(recipient, eq(recipient.id, trades.recipientId))
    .where(sql`${trades.status} = 'pending' OR COALESCE(${trades.respondedAt}, ${trades.expiresAt}) > now() - interval '30 days'`)
    .orderBy(sql`CASE WHEN ${trades.status} = 'pending' THEN 0 ELSE 1 END`, sql`CASE WHEN ${trades.status} = 'pending' THEN ${trades.expiresAt} END ASC`, sql`COALESCE(${trades.respondedAt}, ${trades.expiresAt}) DESC`, desc(trades.number))
    .limit(PAGE + 1)
    .offset(offset);
  const page = rows.slice(0, PAGE);
  const ids = page.map((r) => r.t.id);
  const [sides, flagged, [pending]] = await Promise.all([
    tradeSides(ids),
    ids.length ? db().select({ tradeId: flags.tradeId }).from(flags).where(and(eq(flags.status, 'open'), inArray(flags.tradeId, ids))) : Promise.resolve([]),
    db().select({ n: count() }).from(trades).where(eq(trades.status, 'pending')),
  ]);
  const flaggedIds = new Set(flagged.map((f) => f.tradeId));
  // Pending offers between flagged players count as flagged too (the flag points at the last accepted one).
  const flaggedPairs = new Set<string>();
  const openFlags = await db().select({ id: flags.id }).from(flags).where(and(eq(flags.status, 'open'), eq(flags.kind, 'Repeated trades')));
  if (openFlags.length) {
    const fp = await db().select({ flagId: flagPlayers.flagId, userId: flagPlayers.userId }).from(flagPlayers).where(inArray(flagPlayers.flagId, openFlags.map((f) => f.id)));
    const byFlag = new Map<number, string[]>();
    for (const r of fp) byFlag.set(r.flagId, [...(byFlag.get(r.flagId) ?? []), r.userId]);
    for (const players of byFlag.values()) if (players.length === 2) flaggedPairs.add([...players].sort().join(':'));
  }
  const out: AdminTradeRow[] = page.map(({ t, fromName, fromDeleted, toName, toDeleted }) => {
    const s = sides.get(t.id)!;
    const give = sideText(s.sender, t.senderCredits);
    const get = sideText(s.recipient, t.recipientCredits);
    const from = person(t.senderId, fromName, fromDeleted);
    const to = person(t.recipientId, toName, toDeleted);
    const live = t.status === 'pending';
    const flag = live && (flaggedIds.has(t.id) || flaggedPairs.has([t.senderId, t.recipientId].sort().join(':')));
    let status: string;
    let chip: AdminTradeRow['chip'];
    if (live) {
      status = flag ? 'Pending · flagged' : 'Pending';
      chip = flag ? 'flag' : 'outline';
    } else if (t.status === 'accepted') {
      status = 'Accepted';
      chip = 'solid';
    } else {
      chip = 'dashed';
      const day = t.respondedAt ?? t.expiresAt;
      status =
        t.status === 'expired'
          ? `Expired ${utcDateTime(day).split(',')[0]}`
          : t.status === 'declined'
            ? 'Declined'
            : t.cancelReason === 'admin'
              ? `Cancelled by ${t.cancelledBy ?? 'staff'}`
              : t.cancelReason === 'ban'
                ? 'Cancelled by ban'
                : t.cancelReason === 'deleted'
                  ? 'Cancelled by deletion'
                  : 'Cancelled';
    }
    return {
      id: t.id,
      number: `#${t.number}`,
      from,
      to,
      give: give.give,
      giveValue: give.value,
      get: get.give,
      getValue: get.value,
      status,
      chip,
      expires: live ? expiresIn(t.expiresAt, now) : '—',
      live,
      note: !live && s.stuck ? 'Item still locked' : null,
      cancelText: live ? (get.give === 'nothing' ? `${give.give} goes back to ${from.label}.` : `${give.give} goes back to ${from.label} and ${get.give} stays with ${to.label}.`) : null,
    };
  });
  return { rows: out, next: rows.length > PAGE ? offset + PAGE : null, pending: pending?.n ?? 0 };
}

export async function cancelTrade(staff: StaffMember, id: string, reason: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const [t] = await tx.select().from(trades).where(eq(trades.id, id)).for('update');
    if (!t) return fail(404, 'not_found', 'Unknown offer.');
    if (t.status !== 'pending') fail(409, 'conflict', `Offer #${t.number} is no longer pending.`);
    await lockUsers(tx, [t.senderId, t.recipientId]);
    const before = await tx.select({ id: tradeItems.itemId }).from(tradeItems).where(and(eq(tradeItems.tradeId, t.id), eq(tradeItems.side, 'sender')));
    await release(tx, t, 'cancelled', 'admin', staff.name);
    const [from, to] = [await nameOf(tx, t.senderId), await nameOf(tx, t.recipientId)];
    const ledgerIds = t.senderCredits > 0 ? (await tx.execute<{ id: number }>(sql`SELECT id FROM ledger WHERE ref_id = ${t.id} AND type = 'trade_release' ORDER BY id DESC LIMIT 1`)).rows.map((r) => Number(r.id)) : [];
    await writeAdminLog(tx, staff, {
      action: 'trade.cancel',
      target: { type: 'trade', id: t.id, label: `#${t.number} · ${from} → ${to}` },
      change: 'cancelled',
      before: { status: 'pending', items: `${fmt(before.length)} locked`, credits: cr(t.senderCredits) },
      after: { status: `cancelled by ${staff.name}`, items: 'released', credits: t.senderCredits ? `+${cr(t.senderCredits)} back to ${from}` : '—' },
      reason,
      details: { request: randomUUID(), ledger: ledgerIds, items: before.map((b) => b.id) },
    });
    return { toast: `Cancelled offer #${t.number}, items and credits released · logged` };
  });
}

// ── Flags ───────────────────────────────────────────────────────────────────

const MAX_PLAYERS_SHOWN = 2;

export async function listFlags(): Promise<AdminFlags> {
  const rows = await db()
    .select()
    .from(flags)
    .where(sql`${flags.status} = 'open' OR ${flags.handledAt} > now() - interval '30 days'`)
    .orderBy(sql`CASE WHEN ${flags.status} = 'open' THEN 0 ELSE 1 END`, desc(flags.urgent), desc(flags.updatedAt))
    .limit(100);
  const players = rows.length
    ? await db()
        .select({ flagId: flagPlayers.flagId, id: users.id, username: users.username, deletedAt: users.deletedAt, bannedAt: users.bannedAt, banUntil: users.banUntil, banReason: users.banReason })
        .from(flagPlayers)
        .innerJoin(users, eq(users.id, flagPlayers.userId))
        .where(inArray(flagPlayers.flagId, rows.map((r) => r.id)))
        .orderBy(asc(users.createdAt))
    : [];
  const byFlag = new Map<number, typeof players>();
  for (const p of players) byFlag.set(p.flagId, [...(byFlag.get(p.flagId) ?? []), p]);
  // "Still pending" of a repeated-trades flag is read now, not when the flag was raised.
  const pendingOf = new Map<number, number[]>();
  for (const f of rows) {
    const pair = byFlag.get(f.id) ?? [];
    if (f.status !== 'open' || f.kind !== 'Repeated trades' || pair.length !== 2) continue;
    const [a, b] = [pair[0]!.id, pair[1]!.id];
    const live = await db()
      .select({ number: trades.number })
      .from(trades)
      .where(and(eq(trades.status, 'pending'), sql`(${trades.senderId} = ${a} AND ${trades.recipientId} = ${b}) OR (${trades.senderId} = ${b} AND ${trades.recipientId} = ${a})`))
      .orderBy(desc(trades.createdAt));
    pendingOf.set(f.id, live.map((t) => t.number));
  }
  const out: AdminFlag[] = rows.map((f) => {
    const ps = (byFlag.get(f.id) ?? []).map((p) => ({ id: p.id, label: labelOf(p.id, p.username, p.deletedAt), banned: isBanned(p) }));
    // In the order the text names them (seller, giver, receiver of a cluster), the others after.
    const at = (label: string) => (f.text.indexOf(label) < 0 ? Infinity : f.text.indexOf(label));
    ps.sort((a, b) => at(a.label) - at(b.label));
    const pending = pendingOf.get(f.id);
    const evidence = pending
      ? f.evidence.map((e) => (e.k.startsWith('still pending') ? { v: fmt(pending.length), k: pending.length ? `still pending (#${pending.join(', #')})` : 'still pending' } : e))
      : f.evidence;
    const open = f.status === 'open';
    const note = f.handledNote ?? '';
    const [state, ...rest] = note.split(' · ');
    return {
      id: f.id,
      kind: f.kind,
      urgent: f.urgent && open,
      open,
      raised: `Raised ${utcDateTime(f.createdAt)} · ${f.monitor}${!open && rest.length ? ` · ${rest.join(' · ')}` : ''}`,
      state: open ? 'Open' : state || 'Handled',
      players: ps.slice(0, ps.length > MAX_PLAYERS_SHOWN + 1 ? MAX_PLAYERS_SHOWN : ps.length),
      morePlayers: ps.length > MAX_PLAYERS_SHOWN + 1 ? ps.length - MAX_PLAYERS_SHOWN : 0,
      evidence,
      text: f.text,
    };
  });
  return { rows: out, open: out.filter((f) => f.open).length };
}

export async function dismissFlag(staff: StaffMember, id: number, reason: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const [f] = await tx.select().from(flags).where(eq(flags.id, id)).for('update');
    if (!f) return fail(404, 'not_found', 'Unknown flag.');
    if (f.status !== 'open') fail(409, 'conflict', 'This flag was already handled.');
    await tx.update(flags).set({ status: 'handled', handledBy: staff.name, handledAt: new Date(), handledNote: `Dismissed by ${staff.name}` }).where(eq(flags.id, f.id));
    await writeAdminLog(tx, staff, {
      action: 'flag.dismiss',
      target: { type: 'flag', id: String(f.id), label: f.kind },
      change: 'dismissed',
      before: { status: 'open', text: f.text },
      after: { status: `dismissed by ${staff.name}` },
      reason,
    });
    return { toast: `Dismissed flag “${f.kind}” · logged` };
  });
}

/**
 * A ban closes the player's open flags and the open reports about them; a rename closes the
 * reports only. The note says how ("Handled · nyx banned by lea, Oct 23 11:02"). Called inside the
 * ban / rename transaction, after the player row is locked.
 */
export async function handleOpenFor(tx: Tx, userId: string, staffName: string, what: string, withFlags: boolean) {
  const now = new Date();
  const note = `Handled · ${what} by ${staffName}, ${utcStamp(now)}`;
  const set = { status: 'handled' as const, handledBy: staffName, handledAt: now, handledNote: note };
  if (withFlags) {
    const ids = await tx
      .select({ id: flags.id })
      .from(flags)
      .innerJoin(flagPlayers, eq(flagPlayers.flagId, flags.id))
      .where(and(eq(flags.status, 'open'), eq(flagPlayers.userId, userId)));
    if (ids.length) await tx.update(flags).set(set).where(inArray(flags.id, ids.map((r) => r.id)));
  }
  await tx.update(reports).set(set).where(and(eq(reports.status, 'open'), eq(reports.targetId, userId)));
}
