// Flag monitors (docs/ADMIN.md, thresholds in game/economy.ts MONITORS). They run inside the
// transaction of the event they watch, in a savepoint: a monitor failure never breaks a trade,
// a sign-up or a sale. One open flag per kind and players (fingerprint): a repeat refreshes it.
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../db/client.js';
import { auctions, flagPlayers, flags, items, sales, sessions, skins, tradeItems, trades, users } from '../db/schema.js';
import { MONITORS } from '../game/economy.js';
import { recycleValue } from '../game/value.js';
import { wearOf } from '../game/wear.js';
import { cr, fmt, plural, utcDay } from '../format.js';
import { itemValueExpr } from '../services/items.js';
import { labelOf } from './labels.js';

export const FLAG_KIND = {
  repeated: 'Repeated trades',
  sameIp: 'Many accounts, 1 IP',
  price: 'Unusual price',
  newAccount: 'New account',
} as const;

interface FlagInput {
  kind: string;
  fingerprint: string;
  monitor: string;
  urgent: boolean;
  evidence: { v: string; k: string }[];
  text: string;
  players: string[];
  tradeId?: string | null;
}

async function raise(tx: DbOrTx, f: FlagInput) {
  const [row] = await tx
    .insert(flags)
    .values({ kind: f.kind, fingerprint: f.fingerprint, monitor: f.monitor, urgent: f.urgent, evidence: f.evidence, text: f.text, tradeId: f.tradeId ?? null })
    .onConflictDoUpdate({
      target: flags.fingerprint,
      targetWhere: sql`${flags.status} = 'open'`,
      set: { urgent: f.urgent, evidence: f.evidence, text: f.text, tradeId: f.tradeId ?? null, updatedAt: new Date() },
    })
    .returning({ id: flags.id });
  for (const userId of [...new Set(f.players)]) await tx.insert(flagPlayers).values({ flagId: row!.id, userId }).onConflictDoNothing();
}

/** Runs a monitor in a savepoint; logs and forgets any failure. */
async function guarded(tx: DbOrTx, name: string, run: (sp: Tx) => Promise<void>) {
  try {
    await tx.transaction(run);
  } catch (error) {
    console.error(`monitor ${name} failed`, error);
  }
}

const names = async (tx: DbOrTx, ids: string[]) => {
  const rows = ids.length ? await tx.select({ id: users.id, username: users.username, deletedAt: users.deletedAt }).from(users).where(inArray(users.id, ids)) : [];
  return new Map(rows.map((r) => [r.id, labelOf(r.id, r.username, r.deletedAt)]));
};

/** Value a trade moved each way: items at today's value, plus credits. */
async function tradeValues(tx: DbOrTx, tradeIds: string[]) {
  if (!tradeIds.length) return new Map<string, { sender: number; recipient: number }>();
  const lines = await tx
    .select({ tradeId: tradeItems.tradeId, side: tradeItems.side, value: itemValueExpr() })
    .from(tradeItems)
    .innerJoin(items, eq(items.id, tradeItems.itemId))
    .where(inArray(tradeItems.tradeId, tradeIds));
  const out = new Map<string, { sender: number; recipient: number }>();
  for (const id of tradeIds) out.set(id, { sender: 0, recipient: 0 });
  for (const l of lines) out.get(l.tradeId)![l.side] += Number(l.value);
  return out;
}

/** After an accepted trade: repeated one-way trades between the pair, and new accounts receiving a lot. */
export async function afterTradeAccepted(tx: Tx, trade: { id: string; senderId: string; recipientId: string }) {
  await guarded(tx, 'repeated trades', async (sp) => {
    const m = MONITORS.repeatedTrades;
    const pair = or(
      and(eq(trades.senderId, trade.senderId), eq(trades.recipientId, trade.recipientId)),
      and(eq(trades.senderId, trade.recipientId), eq(trades.recipientId, trade.senderId)),
    );
    const recent = await sp
      .select()
      .from(trades)
      .where(and(pair, eq(trades.status, 'accepted'), gt(trades.respondedAt, sql`now() - ${`${m.windowHours} hours`}::interval`)));
    if (recent.length < m.trades) return;
    const values = await tradeValues(sp, recent.map((t) => t.id));
    // Value that went from A to B, and from B to A.
    const moved = new Map<string, number>([
      [trade.senderId, 0],
      [trade.recipientId, 0],
    ]);
    for (const t of recent) {
      const v = values.get(t.id)!;
      moved.set(t.senderId, moved.get(t.senderId)! + v.sender + t.senderCredits);
      moved.set(t.recipientId, moved.get(t.recipientId)! + v.recipient + t.recipientCredits);
    }
    const [giver, oneWay] = [...moved.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const total = [...moved.values()].reduce((s, v) => s + v, 0);
    if (oneWay < m.minMoved || oneWay / Math.max(1, total) < m.oneWayShare) return;
    const receiver = giver === trade.senderId ? trade.recipientId : trade.senderId;
    const pending = await sp.select({ number: trades.number }).from(trades).where(and(pair, eq(trades.status, 'pending'))).orderBy(desc(trades.createdAt));
    const n = await names(sp, [giver, receiver]);
    const [a, b] = [trade.senderId, trade.recipientId].sort();
    await raise(sp, {
      kind: FLAG_KIND.repeated,
      fingerprint: `repeated:${a}:${b}`,
      monitor: 'trade monitor',
      urgent: oneWay >= m.urgentFrom,
      evidence: [
        { v: fmt(recent.length), k: `trades in ${m.windowHours / 24} days` },
        { v: cr(oneWay), k: 'moved one way' },
        { v: fmt(pending.length), k: pending.length ? `still pending (#${pending.map((p) => p.number).join(', #')})` : 'still pending' },
      ],
      text: `Every trade sends items from ${n.get(giver)} to ${n.get(receiver)} for almost nothing. Could be a gift, an alt account or a sale for real money.`,
      players: [giver, receiver],
      tradeId: trade.id,
    });
  });

  await guarded(tx, 'new account', async (sp) => {
    const m = MONITORS.newAccount;
    for (const userId of [trade.senderId, trade.recipientId]) {
      const [user] = await sp.select().from(users).where(eq(users.id, userId));
      if (!user || user.isGuest) continue;
      const days = (Date.now() - user.createdAt.getTime()) / 86_400_000;
      if (days >= m.maxAgeDays) continue;
      const received = await sp
        .select()
        .from(trades)
        .where(and(eq(trades.status, 'accepted'), or(eq(trades.senderId, userId), eq(trades.recipientId, userId))));
      const values = await tradeValues(sp, received.map((t) => t.id));
      const total = received.reduce((s, t) => {
        const v = values.get(t.id)!;
        return s + (t.recipientId === userId ? v.sender + t.senderCredits : v.recipient + t.recipientCredits);
      }, 0);
      if (total < m.minReceived) continue;
      const label = labelOf(user.id, user.username, user.deletedAt);
      const age = Math.max(1, Math.ceil(days));
      await raise(sp, {
        kind: FLAG_KIND.newAccount,
        fingerprint: `new:${user.id}`,
        monitor: 'trade monitor',
        urgent: false,
        evidence: [
          { v: plural(age, 'day'), k: 'account age' },
          { v: cr(total), k: 'of items received' },
        ],
        text: `${label} received ${cr(total)} of items ${plural(age, 'day')} after joining.`,
        players: [user.id],
        tradeId: trade.id,
      });
    }
  });
}

/** After a session opens: many accounts created from one address in a day. */
export async function afterSessionCreated(tx: DbOrTx, ipHash: string | null) {
  if (!ipHash) return;
  await guarded(tx, 'same ip', async (sp) => {
    const m = MONITORS.sameIp;
    const window = sql`now() - ${`${m.windowHours} hours`}::interval`;
    const rows = await sp
      .selectDistinct({ id: users.id, createdAt: users.createdAt })
      .from(users)
      .leftJoin(sessions, eq(sessions.userId, users.id))
      .where(and(gt(users.createdAt, window), or(eq(sessions.ipHash, ipHash), eq(users.createdIpHash, ipHash))));
    if (rows.length < m.accounts) return;
    const ids = rows.map((r) => r.id);
    // Items those accounts sent to one player outside the group, in accepted trades.
    const sent = await sp
      .select({ to: trades.recipientId, from: trades.senderId, id: trades.id, credits: trades.senderCredits })
      .from(trades)
      .where(and(eq(trades.status, 'accepted'), inArray(trades.senderId, ids)));
    const values = await tradeValues(sp, sent.map((t) => t.id));
    const byReceiver = new Map<string, number>();
    for (const t of sent) byReceiver.set(t.to, (byReceiver.get(t.to) ?? 0) + values.get(t.id)!.sender + t.credits);
    const top = [...byReceiver.entries()].sort((a, b) => b[1] - a[1])[0];
    const n = await names(sp, top ? [top[0]] : []);
    const times = rows.map((r) => r.createdAt.getTime());
    const first = new Date(Math.min(...times));
    const last = new Date(Math.max(...times));
    const spanMin = Math.max(1, Math.ceil((last.getTime() - first.getTime()) / 60_000));
    const within = spanMin < 60 ? plural(spanMin, 'minute') : plural(Math.ceil(spanMin / 60), 'hour');
    const day = utcDay(first) === utcDay(last) ? utcDay(first) : `since ${utcDay(first)}`;
    await raise(sp, {
      kind: FLAG_KIND.sameIp,
      fingerprint: `ip:${ipHash}`,
      monitor: 'sign-up monitor',
      urgent: Boolean(top && top[1] > 0),
      evidence: [
        { v: fmt(rows.length), k: `accounts created ${day}` },
        { v: '1', k: 'address' },
        ...(top && top[1] > 0 ? [{ v: cr(top[1]), k: `of items sent to ${n.get(top[0])}` }] : []),
      ],
      text: top && top[1] > 0 ? `Same address, created within ${within}, all sent their items to ${n.get(top[0])}.` : `Same address, created within ${within}.`,
      players: top && top[1] > 0 ? [...ids, top[0]] : ids,
    });
  });
}

/** After a sale: a price far above the recent average of that skin, StatTrak™ and wear. */
export async function afterSale(tx: Tx, sale: { auctionId: string; itemId: string; sellerId: string; buyerId: string; price: number; soldAt: Date }) {
  await guarded(tx, 'unusual price', async (sp) => {
    const m = MONITORS.unusualPrice;
    const [item] = await sp.select({ item: items, name: skins.name }).from(items).innerJoin(skins, eq(skins.id, items.skinId)).where(eq(items.id, sale.itemId));
    if (!item) return;
    const wear = wearOf(item.item.float)?.code ?? null;
    const [avg] = await sp
      .select({ avg: sql<number | null>`AVG(${sales.price})`.mapWith((v) => (v === null ? null : Number(v))) })
      .from(sales)
      .where(
        and(
          eq(sales.skinId, item.item.skinId),
          eq(sales.stattrak, item.item.stattrak),
          wear ? eq(sales.wear, wear) : sql`${sales.wear} IS NULL`,
          gt(sales.soldAt, sql`now() - ${`${m.windowDays} days`}::interval`),
          or(isNull(sales.auctionId), ne(sales.auctionId, sale.auctionId)),
        ),
      );
    const reference = avg?.avg ?? recycleValue(item.item);
    if (!reference || sale.price < reference * m.factor) return;
    const n = await names(sp, [sale.sellerId, sale.buyerId]);
    const [auction] = await sp.select({ number: auctions.number }).from(auctions).where(eq(auctions.id, sale.auctionId));
    await raise(sp, {
      kind: FLAG_KIND.price,
      fingerprint: `price:${sale.auctionId}`,
      monitor: 'market monitor',
      urgent: false,
      evidence: [
        { v: cr(sale.price), k: 'sale price' },
        { v: cr(Math.round(reference)), k: avg?.avg ? `${m.windowDays}-day average` : 'recycle value' },
        { v: `×${(sale.price / reference).toFixed(1)}`, k: 'above average' },
      ],
      text: `${item.name}${wear ? ` (${wear})` : ''} sold by ${n.get(sale.sellerId)} to ${n.get(sale.buyerId)}${auction ? ` (auction #${auction.number})` : ''}. Credits may be moving between accounts through the market.`,
      players: [sale.sellerId, sale.buyerId],
    });
  });
}
