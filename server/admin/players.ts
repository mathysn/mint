import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type {
  AdminBan,
  AdminItemCard,
  AdminLedgerRow,
  AdminPlayer,
  AdminPlayerRow,
  AdminPlayersPage,
  AdminPlayerTab,
  AdminPlayerTabData,
  AdminRecord,
  AdminSignal,
} from '../../shared/api.js';
import { db, type DbOrTx } from '../db/client.js';
import {
  adminLog,
  auctions,
  bids,
  caseOpenings,
  crates,
  flagPlayers,
  flags,
  friendships,
  items,
  ledger,
  reports,
  sessions,
  skins,
  staffNotes,
  tradeItems,
  trades,
  users,
} from '../db/schema.js';
import { freeCaseStack } from '../game/dailyCrate.js';
import { wearOf } from '../game/wear.js';
import { ago, cr, fmt, inTime, plural, serial, utcDay } from '../format.js';
import { banInfo, fail, type UserRow } from '../http.js';
import { avatarUrl } from '../services/accounts.js';
import { itemValueExpr } from '../services/items.js';
import { heldInBids } from '../services/market.js';
import { playerStats } from '../services/social.js';
import { labelOf, playerLabel } from './labels.js';
import { stuckSql } from './stuck.js';

const PAGE = 50;
const ONLINE_MS = 5 * 60 * 1000;
/** Signals: an account younger than this, or this many accounts on one address, gets the urgent dot. */
const NEW_ACCOUNT_DAYS = 7;
const SAME_IP_ALERT = 2;

export const bannedSql = sql<boolean>`("users"."banned_at" IS NOT NULL AND ("users"."ban_until" IS NULL OR "users"."ban_until" > now()))`;
// Correlated subqueries name the outer table in full (Drizzle drops it in single-table queries).
const flaggedSql = sql<boolean>`EXISTS (SELECT 1 FROM ${flagPlayers} fp JOIN ${flags} f ON f.id = fp.flag_id WHERE fp.user_id = "users"."id" AND f.status = 'open')`;
const inventoryValueSql = () => sql<number>`(SELECT COALESCE(SUM(${itemValueExpr()}), 0) FROM ${items} WHERE "items"."owner_id" = "users"."id" AND "items"."status" <> 'destroyed')`.mapWith(Number);
const casesSql = sql<number>`(SELECT count(*) FROM ${caseOpenings} co WHERE co.user_id = "users"."id")`.mapWith(Number);

export const isOnline = (u: Pick<UserRow, 'lastSeenAt'>, now = Date.now()) => now - u.lastSeenAt.getTime() < ONLINE_MS;

/** "7 d", "24 h", "Permanent". */
export function banDuration(u: Pick<UserRow, 'bannedAt' | 'banUntil'>): string {
  if (!u.banUntil || !u.bannedAt) return 'Permanent';
  const hours = Math.round((u.banUntil.getTime() - u.bannedAt.getTime()) / 3_600_000);
  return hours <= 24 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

export function adminBan(u: UserRow): AdminBan | null {
  if (!banInfo(u)) return null;
  return { since: u.bannedAt!.toISOString(), until: u.banUntil?.toISOString() ?? null, by: u.bannedBy ?? 'staff', reason: u.banReason ?? '', duration: banDuration(u) };
}

// ── List ────────────────────────────────────────────────────────────────────

export const playersQuerySchema = z.object({
  q: z.string().trim().max(64).optional(),
  type: z.enum(['all', 'account', 'guest']).default('all'),
  status: z.enum(['all', 'active', 'banned', 'flagged']).default('all'),
  joined: z.enum(['any', '7', '30']).default('any'),
  sort: z.enum(['seen', 'balance', 'value', 'joined']).default('seen'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type PlayersQuery = z.infer<typeof playersQuerySchema>;

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (m) => `\\${m}`);

/** "Name or Discord ID" (and "Guest #91c0" / "91c0" for guests). */
function searchWhere(q: string): SQL | undefined {
  const text = q.replace(/^guest\s*#?/i, '').trim();
  if (!text) return undefined;
  return or(
    ilike(users.username, `%${escapeLike(text)}%`),
    ilike(users.discordId, `${escapeLike(text)}%`),
    and(eq(users.isGuest, true), ilike(sql`${users.id}::text`, `${escapeLike(text.toLowerCase())}%`)),
  );
}

export async function listPlayers(query: PlayersQuery): Promise<AdminPlayersPage> {
  const where = and(
    isNull(users.deletedAt),
    query.q ? searchWhere(query.q) : undefined,
    query.type === 'account' ? eq(users.isGuest, false) : query.type === 'guest' ? eq(users.isGuest, true) : undefined,
    query.status === 'banned' ? bannedSql : query.status === 'active' ? sql`NOT ${bannedSql}` : query.status === 'flagged' ? flaggedSql : undefined,
    query.joined !== 'any' ? gt(users.createdAt, sql`now() - ${`${query.joined} days`}::interval`) : undefined,
  );
  const column = { seen: users.lastSeenAt, balance: users.balance, value: inventoryValueSql(), joined: users.createdAt }[query.sort];
  const order = query.dir === 'asc' ? sql`${column} ASC` : sql`${column} DESC`;

  const [rows, [total], [counts]] = await Promise.all([
    db()
      .select({ user: users, value: inventoryValueSql(), cases: casesSql, flagged: flaggedSql })
      .from(users)
      .where(where)
      .orderBy(order, asc(users.id))
      .limit(PAGE)
      .offset(query.offset),
    db().select({ n: count() }).from(users).where(where),
    db()
      .select({
        all: count(),
        accounts: sql<number>`count(*) FILTER (WHERE NOT ${users.isGuest})`.mapWith(Number),
        guests: sql<number>`count(*) FILTER (WHERE ${users.isGuest})`.mapWith(Number),
        flagged: sql<number>`count(*) FILTER (WHERE ${flaggedSql})`.mapWith(Number),
        banned: sql<number>`count(*) FILTER (WHERE ${bannedSql})`.mapWith(Number),
      })
      .from(users)
      .where(isNull(users.deletedAt)),
  ]);
  const now = Date.now();
  const n = total?.n ?? 0;
  return {
    rows: rows.map(({ user, value, cases, flagged }): AdminPlayerRow => ({
      id: user.id,
      label: playerLabel(user),
      discordId: user.discordId,
      isGuest: user.isGuest,
      avatarUrl: avatarUrl(user),
      balance: user.balance,
      inventoryValue: value,
      casesOpened: cases,
      joinedAt: user.createdAt.toISOString(),
      lastSeenAt: user.lastSeenAt.toISOString(),
      online: isOnline(user, now),
      ban: banInfo(user) ? banDuration(user) : null,
      flagged,
    })),
    total: n,
    next: query.offset + PAGE < n ? query.offset + PAGE : null,
    counts: counts ?? { all: 0, accounts: 0, guests: 0, flagged: 0, banned: 0 },
  };
}

// ── Detail ──────────────────────────────────────────────────────────────────

export async function loadPlayer(tx: DbOrTx, id: string): Promise<UserRow> {
  if (!z.uuid().safeParse(id).success) return fail(404, 'not_found', 'Unknown player.');
  const [user] = await tx.select().from(users).where(eq(users.id, id));
  if (!user) return fail(404, 'not_found', 'Unknown player.');
  return user;
}

/** A free "player_NNNN" name for Rename. */
export async function freePlayerName(tx: DbOrTx = db()): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const name = `player_${1000 + Math.floor(Math.random() * 9000)}`;
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.username, name));
    if (!taken) return name;
  }
  return `player_${Date.now().toString(36)}`;
}

/** Other players seen on the same addresses (sessions, or the guest's creation). */
async function sameIpPlayers(user: UserRow) {
  const rows = await db().execute<{ id: string; username: string | null; deleted_at: string | null; created_at: string }>(sql`
    WITH mine AS (
      SELECT ip_hash FROM sessions WHERE user_id = ${user.id} AND ip_hash IS NOT NULL
      UNION SELECT created_ip_hash FROM users WHERE id = ${user.id} AND created_ip_hash IS NOT NULL
    )
    SELECT DISTINCT u.id, u.username, u.deleted_at, u.created_at FROM users u
    WHERE u.id <> ${user.id} AND (
      EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.ip_hash IN (SELECT ip_hash FROM mine))
      OR u.created_ip_hash IN (SELECT ip_hash FROM mine)
    )
    ORDER BY u.created_at`);
  return rows.rows;
}

async function signals(user: UserRow): Promise<AdminSignal[]> {
  const days = Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000);
  const [others, [flagRow], [reportRow]] = await Promise.all([
    sameIpPlayers(user),
    db()
      .select({ all: count(), open: sql<number>`count(*) FILTER (WHERE ${flags.status} = 'open')`.mapWith(Number) })
      .from(flagPlayers)
      .innerJoin(flags, eq(flags.id, flagPlayers.flagId))
      .where(eq(flagPlayers.userId, user.id)),
    db()
      .select({ all: count(), open: sql<number>`count(*) FILTER (WHERE ${reports.status} = 'open')`.mapWith(Number) })
      .from(reports)
      .where(eq(reports.targetId, user.id)),
  ]);
  const names = others.slice(0, 3).map((o) => labelOf(o.id, o.username, o.deleted_at));
  const more = others.length > 3 ? ` and ${others.length - 3} more` : '';
  return [
    { key: 'age', value: days < 1 ? 'Less than a day' : plural(days, 'day'), alert: days < NEW_ACCOUNT_DAYS, sub: null, to: null },
    { key: 'ip', value: fmt(others.length), alert: others.length >= SAME_IP_ALERT, sub: others.length ? `${names.join(', ')}${more}` : null, to: null },
    { key: 'flags', value: fmt(flagRow?.all ?? 0), alert: (flagRow?.open ?? 0) > 0, sub: null, to: null },
    { key: 'reports', value: fmt(reportRow?.all ?? 0), alert: (reportRow?.open ?? 0) > 0, sub: null, to: null },
  ];
}

const liveSessionsWhere = (userId: string) => and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`));

export async function liveSessions(tx: DbOrTx, userId: string) {
  const [row] = await tx.select({ n: count() }).from(sessions).where(liveSessionsWhere(userId));
  return row?.n ?? 0;
}

export async function playerDetail(id: string): Promise<AdminPlayer> {
  const user = await loadPlayer(db(), id);
  const [stats, held, [cases], [tradesDone], live, sig, renameTo] = await Promise.all([
    playerStats([user.id]),
    heldInBids(user.id),
    db().select({ n: count() }).from(caseOpenings).where(eq(caseOpenings.userId, user.id)),
    db()
      .select({ n: count() })
      .from(trades)
      .where(and(eq(trades.status, 'accepted'), or(eq(trades.senderId, user.id), eq(trades.recipientId, user.id)))),
    liveSessions(db(), user.id),
    signals(user),
    freePlayerName(),
  ]);
  const s = stats.get(user.id)!;
  const stack = freeCaseStack(user.freeCaseAnchor, new Date());
  return {
    id: user.id,
    label: playerLabel(user),
    discordId: user.discordId,
    isGuest: user.isGuest,
    deleted: !!user.deletedAt,
    avatarUrl: avatarUrl(user),
    joinedAt: user.createdAt.toISOString(),
    lastSeenAt: user.lastSeenAt.toISOString(),
    online: !user.deletedAt && isOnline(user),
    ban: adminBan(user),
    stats: {
      balance: user.balance,
      heldInBids: held,
      inventoryValue: s.inventoryValue,
      casesOpened: cases?.n ?? 0,
      tradesCompleted: tradesDone?.n ?? 0,
      albumsPct: s.albumsPct,
    },
    signals: sig,
    sessions: live,
    freeCases: stack.count,
    freeCaseMax: stack.max,
    freeCaseNextAt: stack.nextAt?.toISOString() ?? null,
    renameTo,
  };
}

// ── Tabs ────────────────────────────────────────────────────────────────────

const itemName = (skinName: string, stattrak: boolean, float: number | null) => {
  const wear = wearOf(float)?.code;
  const tags = [stattrak ? 'ST™' : null, wear ?? null].filter(Boolean).join(' ');
  return tags ? `${skinName} (${tags})` : skinName;
};

const wearFloat = (float: number | null) => (float === null ? 'Vanilla' : `${wearOf(float)!.code} ${float.toFixed(4)}`);

async function namesOf(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db().select({ id: users.id, username: users.username, deletedAt: users.deletedAt }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, labelOf(r.id, r.username, r.deletedAt)]));
}

const TYPE_LABEL: Record<string, string> = { starting_balance: 'start_balance' };

async function ledgerTab(user: UserRow): Promise<AdminLedgerRow[]> {
  const rows = await db().select().from(ledger).where(eq(ledger.userId, user.id)).orderBy(desc(ledger.id)).limit(200);
  return describeLedger(rows);
}

/** Ledger rows with a readable "details" line built from what each row refers to. */
export async function describeLedger(rows: (typeof ledger.$inferSelect)[]): Promise<AdminLedgerRow[]> {
  const refIds = [...new Set(rows.map((r) => r.refId).filter((x): x is string => !!x))];
  const itemIds = [...new Set(rows.map((r) => r.itemId).filter((x): x is string => !!x))];
  const [openRows, tradeRows, auctionRows, logRows, itemRows] = await Promise.all([
    refIds.length ? db().select({ id: caseOpenings.id, crate: crates.name, free: caseOpenings.free }).from(caseOpenings).innerJoin(crates, eq(crates.id, caseOpenings.crateId)).where(inArray(caseOpenings.id, refIds)) : [],
    refIds.length ? db().select().from(trades).where(inArray(trades.id, refIds)) : [],
    refIds.length ? db().select().from(auctions).where(inArray(auctions.id, refIds)) : [],
    refIds.length
      ? db()
          .select({ request: sql<string>`${adminLog.details}->>'request'`, staff: adminLog.staffName, reason: adminLog.reason })
          .from(adminLog)
          .where(inArray(sql`${adminLog.details}->>'request'`, refIds))
      : [],
    itemIds.length ? db().select({ id: items.id, name: skins.name, stattrak: items.stattrak, float: items.float }).from(items).innerJoin(skins, eq(skins.id, items.skinId)).where(inArray(items.id, itemIds)) : [],
  ]);
  const openings = new Map(openRows.map((o) => [o.id, o]));
  const tradeMap = new Map(tradeRows.map((t) => [t.id, t]));
  const auctionMap = new Map(auctionRows.map((a) => [a.id, a]));
  const logs = new Map(logRows.map((l) => [l.request, l]));
  const itemMap = new Map(itemRows.map((i) => [i.id, itemName(i.name, i.stattrak, i.float)]));
  const names = await namesOf([...tradeRows.flatMap((t) => [t.senderId, t.recipientId]), ...auctionRows.flatMap((a) => [a.sellerId, a.buyerId ?? ''])]);

  const details = (r: (typeof rows)[number]): string => {
    const item = r.itemId ? itemMap.get(r.itemId) : undefined;
    const log = r.refId ? logs.get(r.refId) : undefined;
    if (log) return [item, `by ${log.staff} · ${log.reason}`].filter(Boolean).join(' · ');
    const opening = r.refId ? openings.get(r.refId) : undefined;
    if (opening) return opening.free ? `${opening.crate}, free` : opening.crate;
    const trade = r.refId ? tradeMap.get(r.refId) : undefined;
    if (trade) {
      const other = trade.senderId === r.userId ? `to ${names.get(trade.recipientId)}` : `from ${names.get(trade.senderId)}`;
      return [`offer #${trade.number} ${other}`, item].filter(Boolean).join(' · ');
    }
    const auction = r.refId ? auctionMap.get(r.refId) : undefined;
    if (auction) {
      if (r.type === 'auction_sale') return `sold to ${names.get(auction.buyerId ?? '') ?? '—'}${item ? ` · ${item}` : ''}`;
      if (r.type === 'auction_fee') return `${(auction.feeBp / 100).toLocaleString('en-US')}% of ${cr(auction.finalPrice ?? 0)}`;
      return [`auction #${auction.number}`, item].filter(Boolean).join(' · ');
    }
    if (r.type === 'starting_balance') return 'account created';
    return item ?? '';
  };
  return rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), type: TYPE_LABEL[r.type] ?? r.type, amount: r.amount, balanceAfter: r.balanceAfter, details: details(r) }));
}

async function inventoryTab(user: UserRow): Promise<NonNullable<AdminPlayerTabData['inventory']>> {
  const rows = await db()
    .select({ item: items, skin: skins, value: itemValueExpr(), stuck: stuckSql })
    .from(items)
    .innerJoin(skins, eq(skins.id, items.skinId))
    .where(and(eq(items.ownerId, user.id), ne(items.status, 'destroyed')))
    .orderBy(desc(items.obtainedAt))
    .limit(300);
  const cards: AdminItemCard[] = rows.map(({ item, skin, value, stuck }) => ({
    id: item.id,
    serial: serial(item.serial),
    weaponName: skin.weaponName,
    finishName: skin.finishName,
    tier: item.tier,
    imageUrl: skin.imageUrl,
    wear: wearOf(item.float)?.code ?? null,
    float: item.float,
    stattrak: item.stattrak,
    status: item.status,
    stuck,
    value,
  }));
  const [counts] = await db()
    .select({
      all: count(),
      available: sql<number>`count(*) FILTER (WHERE ${items.status} = 'available')`.mapWith(Number),
      listed: sql<number>`count(*) FILTER (WHERE ${items.status} = 'listed')`.mapWith(Number),
      in_trade: sql<number>`count(*) FILTER (WHERE ${items.status} = 'in_trade')`.mapWith(Number),
    })
    .from(items)
    .where(and(eq(items.ownerId, user.id), ne(items.status, 'destroyed')));
  return { items: cards, counts: counts ?? { all: 0, available: 0, listed: 0, in_trade: 0 } };
}

async function openingsTab(user: UserRow): Promise<AdminRecord[]> {
  const rows = await db()
    .select({ opening: caseOpenings, crate: crates.name, item: items, skin: skins, value: itemValueExpr() })
    .from(caseOpenings)
    .innerJoin(crates, eq(crates.id, caseOpenings.crateId))
    .innerJoin(items, eq(items.id, caseOpenings.itemId))
    .innerJoin(skins, eq(skins.id, items.skinId))
    .where(eq(caseOpenings.userId, user.id))
    .orderBy(desc(caseOpenings.createdAt))
    .limit(100);
  return rows.map((r) => ({
    lead: null,
    at: r.opening.createdAt.toISOString(),
    title: r.item.stattrak ? `StatTrak™ ${r.skin.name}` : r.skin.name,
    tier: r.item.tier,
    meta: `${r.crate}${r.opening.free ? ', free' : ''} · ${wearFloat(r.item.float)}`,
    value: cr(r.value),
    chip: null,
    to: `/admin/items?item=${r.item.id}`,
  }));
}

/** "MP7 | Skulls", "MP7 | Skulls +2", "900 CR", "MP7 | Skulls and 900 CR", "nothing". */
function side(names: string[], credits: number) {
  const parts = [names.length ? `${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ''}` : null, credits > 0 ? cr(credits) : null].filter(Boolean);
  return parts.length ? parts.join(' and ') : 'nothing';
}

async function tradesTab(user: UserRow): Promise<AdminRecord[]> {
  const rows = await db()
    .select()
    .from(trades)
    .where(or(eq(trades.senderId, user.id), eq(trades.recipientId, user.id)))
    .orderBy(desc(trades.createdAt))
    .limit(100);
  if (!rows.length) return [];
  const ids = rows.map((t) => t.id);
  const lines = await db()
    .select({ tradeId: tradeItems.tradeId, side: tradeItems.side, name: skins.name, status: items.status, stuck: stuckSql })
    .from(tradeItems)
    .innerJoin(items, eq(items.id, tradeItems.itemId))
    .innerJoin(skins, eq(skins.id, items.skinId))
    .where(inArray(tradeItems.tradeId, ids));
  const names = await namesOf(rows.flatMap((t) => [t.senderId, t.recipientId]));
  return rows.map((t) => {
    const mine = t.senderId === user.id;
    const of = (s: 'sender' | 'recipient') => lines.filter((l) => l.tradeId === t.id && l.side === s);
    const give = mine ? of('sender') : of('recipient');
    const get = mine ? of('recipient') : of('sender');
    const partner = mine ? `to ${names.get(t.recipientId)}` : `from ${names.get(t.senderId)}`;
    const stuck = t.status !== 'pending' && of('sender').some((l) => l.stuck && l.status === 'in_trade');
    const when = utcDay(t.respondedAt ?? t.expiresAt);
    const chip: AdminRecord['chip'] =
      t.status === 'pending'
        ? { text: 'Pending', style: 'outline' }
        : t.status === 'accepted'
          ? { text: 'Accepted', style: 'solid' }
          : t.status === 'declined'
            ? { text: 'Declined', style: 'dashed' }
            : t.status === 'expired'
              ? { text: stuck ? `Expired ${when} · item still locked` : `Expired ${when}`, style: stuck ? 'flag' : 'dashed' }
              : { text: t.cancelReason === 'ban' ? 'Cancelled by ban' : t.cancelReason === 'admin' ? 'Cancelled by staff' : 'Cancelled', style: stuck ? 'flag' : 'dashed' };
    return {
      lead: `#${t.number} · ${utcDay(t.createdAt)}`,
      at: t.createdAt.toISOString(),
      title: `${partner} · ${side(give.map((l) => l.name), mine ? t.senderCredits : t.recipientCredits)} for ${side(get.map((l) => l.name), mine ? t.recipientCredits : t.senderCredits)}`,
      tier: null,
      meta: null,
      value: null,
      chip,
      to: null,
    };
  });
}

async function marketTab(user: UserRow): Promise<AdminRecord[]> {
  const now = new Date();
  const bidOn = db().selectDistinct({ id: bids.auctionId }).from(bids).where(eq(bids.userId, user.id));
  const rows = await db()
    .select({ auction: auctions, item: items, skin: skins })
    .from(auctions)
    .innerJoin(items, eq(items.id, auctions.itemId))
    .innerJoin(skins, eq(skins.id, items.skinId))
    .where(or(eq(auctions.sellerId, user.id), eq(auctions.leaderId, user.id), eq(auctions.buyerId, user.id), inArray(auctions.id, bidOn)))
    .orderBy(desc(auctions.createdAt))
    .limit(100);
  const names = await namesOf(rows.flatMap((r) => [r.auction.buyerId ?? '', r.auction.leaderId ?? '']));
  return rows.map(({ auction: a, item, skin }) => {
    const title = itemName(skin.name, item.stattrak, item.float);
    const base = { at: a.createdAt.toISOString(), title, tier: item.tier, chip: null, to: `/admin/items?item=${item.id}` };
    if (a.sellerId === user.id) {
      if (a.status === 'active') return { ...base, lead: `Listing · ends in ${inTime(a.endsAt, now)}`, meta: `start ${fmt(a.startPrice)} · ${plural(a.bidCount, 'bid')}`, value: cr(a.currentBid ?? a.startPrice) };
      if (a.status === 'sold') return { ...base, lead: `Sold · ${utcDay(a.closedAt ?? a.endsAt)}`, meta: `to ${names.get(a.buyerId ?? '')} · fee ${cr(a.fee ?? 0)}`, value: cr(a.finalPrice ?? 0) };
      if (a.status === 'unsold') return { ...base, lead: `Listing · not sold`, meta: `ended ${utcDay(a.closedAt ?? a.endsAt)}`, value: '—' };
      const why = a.cancelReason === 'ban' ? 'cancelled by ban' : a.cancelReason === 'admin' ? 'cancelled by staff' : a.cancelReason === 'deleted' ? 'cancelled, account deleted' : 'cancelled by the seller';
      return { ...base, lead: 'Listing · cancelled', meta: a.bidCount > 0 && a.cancelReason ? `${why}, bid refunded` : why, value: '—' };
    }
    if (a.status === 'active') {
      const leading = a.leaderId === user.id;
      return { ...base, lead: leading ? 'Bid · leading' : 'Bid · outbid', meta: `ends in ${inTime(a.endsAt, now)}`, value: leading ? `${cr(a.currentBid ?? 0)} held` : '—' };
    }
    if (a.status === 'sold' && a.buyerId === user.id) return { ...base, lead: `${a.boughtNow ? 'Bought' : 'Won'} · ${utcDay(a.closedAt ?? a.endsAt)}`, meta: null, value: cr(a.finalPrice ?? 0) };
    return { ...base, lead: `Bid · lost`, meta: a.status === 'sold' ? `sold to ${names.get(a.buyerId ?? '')}` : a.status, value: '—' };
  });
}

async function friendsTab(user: UserRow): Promise<AdminRecord[]> {
  const rows = await db()
    .select()
    .from(friendships)
    .where(or(eq(friendships.userLow, user.id), eq(friendships.userHigh, user.id)))
    .orderBy(desc(friendships.acceptedAt), desc(friendships.createdAt));
  const other = (r: (typeof rows)[number]) => (r.userLow === user.id ? r.userHigh : r.userLow);
  const names = await namesOf(rows.map(other));
  return rows.map((r) => ({
    lead: `since ${utcDay(r.acceptedAt ?? r.createdAt)}`,
    at: (r.acceptedAt ?? r.createdAt).toISOString(),
    title: names.get(other(r)) ?? '—',
    tier: null,
    meta: null,
    value: null,
    chip: r.status === 'accepted' ? { text: 'Friend', style: 'outline' } : { text: r.requesterId === user.id ? 'Request sent' : 'Request received', style: 'dashed' },
    to: `/admin/players/${other(r)}`,
  }));
}

const REVOKED: Record<string, string> = { sign_out: 'signed out', admin: 'signed out by staff', ban: 'signed out by ban', deleted: 'account deleted' };

async function sessionsTab(user: UserRow): Promise<AdminRecord[]> {
  const rows = await db().select().from(sessions).where(eq(sessions.userId, user.id)).orderBy(desc(sessions.lastUsedAt)).limit(50);
  const now = new Date();
  return rows.map((s) => {
    const live = !s.revokedAt && s.expiresAt > now;
    const lead = s.revokedAt ? (REVOKED[s.revokedReason ?? 'sign_out'] ?? 'signed out') : !live ? 'expired' : now.getTime() - s.lastUsedAt.getTime() < ONLINE_MS ? 'active now' : ago(s.lastUsedAt, now);
    return {
      lead,
      at: s.lastUsedAt.toISOString(),
      title: s.device ?? (s.kind === 'activity' ? 'Discord activity' : 'Web'),
      tier: null,
      meta: [s.city, s.country].filter(Boolean).join(', ') || '—',
      value: null,
      chip: live ? { text: 'Active', style: 'solid' } : { text: 'Session', style: 'outline' },
      to: null,
    };
  });
}

async function notesTab(user: UserRow) {
  const rows = await db().select().from(staffNotes).where(eq(staffNotes.userId, user.id)).orderBy(desc(staffNotes.createdAt));
  return rows.map((n) => ({ id: n.id, staffName: n.staffName, at: n.createdAt.toISOString(), text: n.text }));
}

export async function playerTab(id: string, tab: AdminPlayerTab): Promise<AdminPlayerTabData> {
  const user = await loadPlayer(db(), id);
  switch (tab) {
    case 'ledger':
      return { ledger: await ledgerTab(user) };
    case 'inventory':
      return { inventory: await inventoryTab(user) };
    case 'openings':
      return { records: await openingsTab(user) };
    case 'trades':
      return { records: await tradesTab(user) };
    case 'market':
      return { records: await marketTab(user) };
    case 'friends':
      return { records: await friendsTab(user) };
    case 'sessions':
      return { records: await sessionsTab(user) };
    case 'notes':
      return { notes: await notesTab(user) };
  }
}

