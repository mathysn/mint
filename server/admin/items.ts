import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { AdminActionResult, AdminItemDetail, AdminItemRow, AdminItemsPage, MovePreview, TimelineEntry } from '../../shared/api.js';
import { db, type DbOrTx } from '../db/client.js';
import { adminLog, auctions, caseOpenings, crates, items, ledger, showcase, skins, tradeItems, trades, tradeUpInputs, tradeUps, users } from '../db/schema.js';
import { TIERS } from '../game/economy.js';
import { wearOf } from '../game/wear.js';
import { cr, fmt, serial, utcDateTime } from '../format.js';
import { fail } from '../http.js';
import { itemValueExpr, recycleValueExpr } from '../services/items.js';
import { lockUsers } from '../services/locks.js';
import { cancelAuctionByStaff } from '../services/market.js';
import { nameMatches } from '../services/search.js';
import { release } from '../services/trades.js';
import { Wallets } from '../services/wallet.js';
import { labelOf, playerLabel } from './labels.js';
import { reasonSchema, writeAdminLog } from './log.js';
import type { StaffMember } from './staff.js';
import { stuckNote, stuckSql } from './stuck.js';

const PAGE = 50;
const SHOWCASE_BLOCK_MS = 24 * 60 * 60 * 1000;
const owner = alias(users, 'owner');
const STATUS_TEXT = { available: 'Available', listed: 'Listed', in_trade: 'In trade', destroyed: 'Destroyed' } as const;

export const itemsQuerySchema = z.object({
  q: z.string().trim().max(64).optional(),
  tiers: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter((t): t is (typeof TIERS)[number] => (TIERS as readonly string[]).includes(t)) : [])),
  status: z.enum(['any', 'available', 'listed', 'in_trade', 'destroyed', 'stuck']).default('any'),
  stattrak: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export type ItemsQuery = z.infer<typeof itemsQuerySchema>;

/** "Item ID or skin name": digits = the 9-digit ID (leading zeros optional), else words of the name. */
function searchWhere(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const digits = q.replace(/\s/g, '');
  if (/^\d{1,12}$/.test(digits)) return eq(items.serial, Number(digits));
  return nameMatches(skins.name, q);
}

const selectRows = (tx: DbOrTx) =>
  tx
    .select({ item: items, skin: skins, owner: { id: owner.id, username: owner.username, deletedAt: owner.deletedAt }, stuck: stuckSql })
    .from(items)
    .innerJoin(skins, eq(skins.id, items.skinId))
    .innerJoin(owner, eq(owner.id, items.ownerId));

type Row = Awaited<ReturnType<ReturnType<typeof selectRows>['where']>>[number];

function toRow(r: Row): AdminItemRow {
  const destroyed = r.item.status === 'destroyed';
  return {
    id: r.item.id,
    serial: serial(r.item.serial),
    name: r.skin.name,
    tier: r.item.tier,
    wear: wearOf(r.item.float)?.code ?? null,
    float: r.item.float,
    stattrak: r.item.stattrak,
    owner: destroyed ? null : { id: r.owner.id, label: labelOf(r.owner.id, r.owner.username, r.owner.deletedAt) },
    status: r.item.status,
    stuck: r.stuck,
    obtainedAt: r.item.obtainedAt.toISOString(),
  };
}

export async function listItems(query: ItemsQuery): Promise<AdminItemsPage> {
  const where = and(
    searchWhere(query.q),
    query.tiers.length ? inArray(items.tier, query.tiers) : undefined,
    query.status === 'stuck' ? stuckSql : query.status !== 'any' ? eq(items.status, query.status) : undefined,
    query.stattrak ? eq(items.stattrak, true) : undefined,
  );
  const [rows, [total], [counts]] = await Promise.all([
    selectRows(db()).where(where).orderBy(desc(items.obtainedAt), desc(items.serial)).limit(PAGE).offset(query.offset),
    db().select({ n: count() }).from(items).innerJoin(skins, eq(skins.id, items.skinId)).where(where),
    db()
      .select({
        all: count(),
        destroyedWeek: sql<number>`count(*) FILTER (WHERE ${items.destroyedAt} > now() - interval '7 days')`.mapWith(Number),
      })
      .from(items),
  ]);
  const n = total?.n ?? 0;
  return { rows: rows.map(toRow), total: n, next: query.offset + PAGE < n ? query.offset + PAGE : null, counts: counts ?? { all: 0, destroyedWeek: 0 } };
}

// ── Detail ──────────────────────────────────────────────────────────────────

async function loadItem(tx: DbOrTx, id: string) {
  if (!z.uuid().safeParse(id).success) return fail(404, 'not_found', 'Unknown item.');
  const [row] = await selectRows(tx).where(eq(items.id, id));
  if (!row) return fail(404, 'not_found', 'Unknown item.');
  return row;
}

async function namesOf(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map<string, string>();
  const rows = await db().select({ id: users.id, username: users.username, deletedAt: users.deletedAt }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, labelOf(r.id, r.username, r.deletedAt)]));
}

/** Staff actions that touched this item (their log entry lists it in `details.items`). */
const logsFor = (itemId: string) =>
  db().select().from(adminLog).where(sql`${adminLog.details} @> ${JSON.stringify({ items: [itemId] })}::jsonb`).orderBy(asc(adminLog.id));

const TRADE_OUTCOME: Record<string, string> = { declined: 'declined', cancelled: 'cancelled', expired: 'expired' };

function adminText(log: typeof adminLog.$inferSelect): string {
  const after = log.after as Record<string, string>;
  switch (log.action) {
    case 'item.grant':
      return `Granted to ${log.targetLabel}`;
    case 'item.unlock':
      return 'Unlocked: back to Available';
    case 'item.restore':
      return `Restored to ${after.owner}${after.clawback ? ` · ${after.clawback} taken back` : ''}`;
    case 'item.move':
      return `Moved to ${after.owner}`;
    case 'item.showcase':
      return 'Removed from showcase';
    case 'player.delete':
      return `Destroyed with ${log.targetLabel}'s account`;
    default:
      return log.change;
  }
}

/** The item's story, oldest first: drop, offers, listings, recycling, staff actions. */
async function timeline(itemId: string, stuck: boolean, status: string): Promise<{ entries: TimelineEntry[]; grantedBy: string | null }> {
  const [opening] = await db()
    .select({ at: caseOpenings.createdAt, userId: caseOpenings.userId, crate: crates.name, free: caseOpenings.free })
    .from(caseOpenings)
    .innerJoin(crates, eq(crates.id, caseOpenings.crateId))
    .where(eq(caseOpenings.itemId, itemId));
  const [made] = await db().select().from(tradeUps).where(eq(tradeUps.resultItemId, itemId));
  const [usedIn] = await db().select({ at: tradeUps.createdAt, userId: tradeUps.userId }).from(tradeUpInputs).innerJoin(tradeUps, eq(tradeUps.id, tradeUpInputs.tradeUpId)).where(eq(tradeUpInputs.itemId, itemId));
  const offerRows = await db().select({ trade: trades, side: tradeItems.side }).from(tradeItems).innerJoin(trades, eq(trades.id, tradeItems.tradeId)).where(eq(tradeItems.itemId, itemId));
  const auctionRows = await db().select().from(auctions).where(eq(auctions.itemId, itemId));
  const ledgerRows = await db().select().from(ledger).where(and(eq(ledger.itemId, itemId), inArray(ledger.type, ['recycle']))).orderBy(asc(ledger.id));
  const logs = await logsFor(itemId);
  const names = await namesOf([
    opening?.userId ?? null,
    made?.userId ?? null,
    usedIn?.userId ?? null,
    ...offerRows.flatMap((o) => [o.trade.senderId, o.trade.recipientId]),
    ...auctionRows.flatMap((a) => [a.sellerId, a.leaderId, a.buyerId]),
    ...ledgerRows.map((l) => l.userId),
  ]);
  const name = (id: string | null) => (id ? (names.get(id) ?? '—') : '—');
  const entries: TimelineEntry[] = [];
  const add = (at: Date, text: string, kind: TimelineEntry['kind'] = 'normal', to: string | null = null, when: string | null = null) =>
    entries.push({ at: at.toISOString(), text, kind, to, when });

  if (opening) add(opening.at, `Opened by ${name(opening.userId)} from ${opening.crate}${opening.free ? ' (free)' : ''}`, 'normal', `/admin/players/${opening.userId}`);
  if (made) add(made.createdAt, `Made by ${name(made.userId)} in a trade-up contract`, 'normal', `/admin/players/${made.userId}`);
  let lockSince: Date | null = null;
  for (const { trade: t, side } of offerRows) {
    const holder = side === 'sender' ? t.senderId : t.recipientId;
    const other = side === 'sender' ? t.recipientId : t.senderId;
    add(t.createdAt, side === 'sender' ? `Offered to ${name(other)} in offer #${t.number}` : `Asked for by ${name(other)} in offer #${t.number}`, 'normal', `/admin/players/${holder}`);
    if (t.status === 'accepted') add(t.respondedAt ?? t.createdAt, `Traded to ${name(other)} (offer #${t.number})`, 'normal', `/admin/players/${other}`);
    else if (t.status !== 'pending') {
      const end = t.respondedAt ?? t.expiresAt;
      add(end, `Offer #${t.number} ${TRADE_OUTCOME[t.status]}${t.status === 'expired' ? ' (Trade expiry job)' : ''}`);
      if (side === 'sender') lockSince = end;
    }
  }
  for (const a of auctionRows) {
    add(a.createdAt, `Listed on the market by ${name(a.sellerId)} · start ${cr(a.startPrice)}`, 'normal', `/admin/players/${a.sellerId}`);
    if (a.status === 'active' && a.bidCount > 0 && a.leaderId) add(new Date(), `${fmt(a.bidCount)} bid${a.bidCount === 1 ? '' : 's'} · leading ${cr(a.currentBid ?? 0)} by ${name(a.leaderId)}`, 'normal', `/admin/players/${a.leaderId}`, 'now');
    if (a.status === 'sold') add(a.closedAt ?? a.endsAt, `Sold to ${name(a.buyerId)} for ${cr(a.finalPrice ?? 0)}`, 'normal', `/admin/players/${a.buyerId}`);
    if (a.status === 'unsold') add(a.closedAt ?? a.endsAt, 'Listing ended unsold');
    if (a.status === 'cancelled') add(a.closedAt ?? a.endsAt, a.cancelReason === 'ban' ? 'Listing cancelled by ban' : a.cancelReason ? 'Listing cancelled by staff' : 'Listing cancelled by the seller');
    if (a.status !== 'active') lockSince = a.closedAt ?? a.endsAt;
  }
  for (const l of ledgerRows) add(l.createdAt, `Recycled by ${name(l.userId)} for ${cr(l.amount)}`, 'end', `/admin/players/${l.userId}`);
  if (usedIn) add(usedIn.at, `Used by ${name(usedIn.userId)} in a trade-up contract`, 'end', `/admin/players/${usedIn.userId}`);
  for (const log of logs) add(log.createdAt, `${adminText(log)} by ${log.staffName} · ${log.reason}`, log.action === 'player.delete' ? 'end' : 'admin', '/admin/logs', `${utcDateTime(log.createdAt)} · by ${log.staffName}`);
  if (stuck) {
    const since = lockSince ?? new Date();
    add(since, `Lock not released: still “${STATUS_TEXT[status as keyof typeof STATUS_TEXT]}”`, 'alert', null, `since ${utcDateTime(since)}`);
  }
  entries.sort((a, b) => a.at.localeCompare(b.at));
  const grant = logs.find((l) => l.action === 'item.grant');
  return { entries, grantedBy: grant?.staffName ?? null };
}

/** How a destroyed item came back: recycled (credits can be taken back) or not restorable. */
async function restoreInfo(itemId: string, ownerId: string) {
  const [ownerRow] = await db().select().from(users).where(eq(users.id, ownerId));
  const ownerLabel = ownerRow ? playerLabel(ownerRow) : '—';
  const [usedIn] = await db().select({ id: tradeUpInputs.tradeUpId }).from(tradeUpInputs).where(eq(tradeUpInputs.itemId, itemId));
  if (usedIn) return { owner: ownerLabel, blocked: 'It went into a trade-up contract: restoring it would duplicate value.', clawback: null, recycled: 0 };
  if (!ownerRow || ownerRow.deletedAt) return { owner: ownerLabel, blocked: 'Its last owner’s account was deleted.', clawback: null, recycled: 0 };
  const [recycled] = await db().select({ amount: ledger.amount }).from(ledger).where(and(eq(ledger.itemId, itemId), eq(ledger.type, 'recycle'))).orderBy(desc(ledger.id)).limit(1);
  const amount = recycled?.amount ?? 0;
  const clawback = amount > 0
    ? {
        amount,
        before: ownerRow.balance,
        after: ownerRow.balance - amount,
        blocked: ownerRow.balance < amount ? `${ownerLabel} only has ${cr(ownerRow.balance)}. Untick it, or restore without taking credits back.` : null,
      }
    : null;
  return { owner: ownerLabel, blocked: null, clawback, recycled: amount };
}

export async function itemDetail(id: string): Promise<AdminItemDetail> {
  const r = await loadItem(db(), id);
  const [extra] = await db()
    .select({ value: itemValueExpr(), recycleValue: recycleValueExpr(), crate: crates.name, originalId: items.originalOwnerId })
    .from(items)
    .leftJoin(crates, eq(crates.id, items.sourceCrateId))
    .where(eq(items.id, id));
  const [shown] = await db().select({ id: showcase.itemId }).from(showcase).where(eq(showcase.itemId, id));
  const [listing] = await db().select().from(auctions).where(and(eq(auctions.itemId, id), eq(auctions.status, 'active')));
  const [offer] = await db()
    .select({ trade: trades })
    .from(tradeItems)
    .innerJoin(trades, eq(trades.id, tradeItems.tradeId))
    .where(and(eq(tradeItems.itemId, id), eq(tradeItems.side, 'sender'), eq(trades.status, 'pending')));
  const names = await namesOf([extra?.originalId ?? null, listing?.leaderId ?? null]);
  const ownerLabel = labelOf(r.owner.id, r.owner.username, r.owner.deletedAt);
  const story = await timeline(id, r.stuck, r.item.status);
  const restore = r.item.status === 'destroyed' ? await restoreInfo(id, r.item.ownerId) : null;
  return {
    ...toRow(r),
    weaponName: r.skin.weaponName,
    finishName: r.skin.finishName,
    imageUrl: r.skin.imageUrl,
    pattern: r.item.pattern,
    minFloat: r.skin.minFloat,
    maxFloat: r.skin.maxFloat,
    originCase: extra?.crate ?? null,
    grantedBy: story.grantedBy,
    originalOwner: extra?.originalId ? { id: extra.originalId, label: names.get(extra.originalId) ?? '—' } : null,
    inShowcase: !!shown,
    value: extra?.value ?? 0,
    recycleValue: extra?.recycleValue ?? 0,
    stuckNote: r.stuck ? await stuckNote(db(), r.item, ownerLabel) : null,
    timeline: story.entries,
    restore: restore ? { owner: restore.owner, blocked: restore.blocked, clawback: restore.clawback } : null,
    listing: listing ? { number: listing.number, bid: listing.currentBid, leader: listing.leaderId ? (names.get(listing.leaderId) ?? null) : null } : null,
    offer: offer ? { number: offer.trade.number, expired: offer.trade.expiresAt <= new Date() } : null,
  };
}

// ── Actions ─────────────────────────────────────────────────────────────────

const itemLabel = (r: Row) => r.skin.name;
const logTarget = (r: Row) => ({ type: 'item' as const, id: r.item.id, label: serial(r.item.serial) });

export async function unlockItem(staff: StaffMember, id: string, reason: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const r = await loadItem(tx, id);
    const [locked] = await tx.select({ id: items.id, status: items.status, stuck: stuckSql }).from(items).where(eq(items.id, id)).for('update');
    if (!locked?.stuck) return fail(409, 'not_stuck', 'This item isn’t stuck: a live listing or offer holds it, or it is already free.');
    await tx.update(items).set({ status: 'available' }).where(eq(items.id, id));
    const ownerLabel = labelOf(r.owner.id, r.owner.username, r.owner.deletedAt);
    await writeAdminLog(tx, staff, {
      action: 'item.unlock',
      target: logTarget(r),
      change: `${STATUS_TEXT[locked.status]} → Available`,
      before: { status: STATUS_TEXT[locked.status], owner: ownerLabel },
      after: { status: 'Available', owner: `${ownerLabel} (unchanged)` },
      reason,
      details: { items: [id] },
    });
    return { toast: `Unlocked ${itemLabel(r)} (${serial(r.item.serial)}) · logged` };
  });
}

export const restoreSchema = z.object({ clawback: z.boolean(), reason: reasonSchema });

export async function restoreItem(staff: StaffMember, id: string, body: z.infer<typeof restoreSchema>): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const r = await loadItem(tx, id);
    if (r.item.status !== 'destroyed') fail(409, 'conflict', 'Only destroyed items can be restored.');
    const info = await restoreInfo(id, r.item.ownerId);
    if (info.blocked) fail(409, 'conflict', info.blocked);
    const players = await lockUsers(tx, [r.item.ownerId]);
    const [item] = await tx.select().from(items).where(eq(items.id, id)).for('update');
    if (item?.status !== 'destroyed') fail(409, 'conflict', 'Only destroyed items can be restored.');
    const wallets = new Wallets(players);
    const request = randomUUID();
    const take = body.clawback ? info.recycled : 0;
    if (take > 0 && wallets.get(r.item.ownerId) < take) {
      fail(409, 'balance_too_low', `${info.owner} only has ${cr(wallets.get(r.item.ownerId))}. Untick it, or restore without taking credits back.`);
    }
    const before = wallets.get(r.item.ownerId);
    wallets.move(r.item.ownerId, 'admin_item_restore', 0, { refId: request, itemId: id });
    if (take > 0) wallets.move(r.item.ownerId, 'admin_clawback', -take, { refId: request, itemId: id });
    const ledgerIds = await wallets.save(tx);
    await tx.update(items).set({ status: 'available', destroyedAt: null }).where(eq(items.id, id));
    await writeAdminLog(tx, staff, {
      action: 'item.restore',
      target: logTarget(r),
      change: `Destroyed → ${info.owner}`,
      before: { status: 'Destroyed', owner: '—', ...(take ? { balance: cr(before) } : {}) },
      after: { status: 'Available', owner: info.owner, ...(take ? { balance: cr(before - take), clawback: cr(take) } : {}) },
      reason: body.reason,
      details: { request, ledger: ledgerIds, items: [id] },
    });
    return { toast: take ? `Restored ${itemLabel(r)} to ${info.owner}, took back ${cr(take)} · logged` : `Restored ${itemLabel(r)} to ${info.owner} · logged` };
  });
}

export const moveSchema = z.object({ to: z.string().trim().min(1).max(64), reason: reasonSchema });

/** "Move to": an account by name or Discord ID (not a guest, not deleted, not the owner). */
async function findTarget(tx: DbOrTx, to: string, ownerId: string) {
  const text = to.trim();
  const [target] = await tx
    .select()
    .from(users)
    .where(and(or(eq(users.username, text.toLowerCase()), eq(users.username, text), eq(users.discordId, text)), isNull(users.deletedAt)))
    .limit(1);
  if (!target) return { target: null, error: `No player called “${text}”.` };
  if (target.isGuest) return { target: null, error: 'Guests can’t receive items.' };
  if (target.id === ownerId) return { target: null, error: `${playerLabel(target)} already owns it.` };
  return { target, error: null };
}

export async function previewMove(id: string, to: string): Promise<MovePreview> {
  const r = await loadItem(db(), id);
  const { target, error } = await findTarget(db(), to, r.item.ownerId);
  return { target: target ? { id: target.id, label: playerLabel(target) } : null, error };
}

export async function moveItem(staff: StaffMember, id: string, body: z.infer<typeof moveSchema>): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const r = await loadItem(tx, id);
    if (r.item.status === 'destroyed') fail(409, 'conflict', 'Restore it first.');
    const { target, error } = await findTarget(tx, body.to, r.item.ownerId);
    if (!target) return fail(409, 'conflict', error!);
    // Lock order: listing and offers holding the item, then every player involved, then the item.
    const [listing] = await tx.select().from(auctions).where(and(eq(auctions.itemId, id), eq(auctions.status, 'active'))).for('update');
    const offerIds = (await tx.select({ id: tradeItems.tradeId }).from(tradeItems).where(and(eq(tradeItems.itemId, id), eq(tradeItems.side, 'sender')))).map((o) => o.id);
    const offers = offerIds.length ? await tx.select().from(trades).where(and(inArray(trades.id, offerIds), eq(trades.status, 'pending'))).orderBy(asc(trades.id)).for('update') : [];
    const involved = [r.item.ownerId, target.id, ...(listing ? [listing.sellerId, listing.leaderId ?? target.id] : []), ...offers.flatMap((t) => [t.senderId, t.recipientId])];
    await lockUsers(tx, involved);
    for (const offer of offers) await release(tx, offer, 'cancelled', 'admin');
    const wallets = new Wallets(await lockUsers(tx, involved));
    const refund = listing ? await cancelAuctionByStaff(tx, listing, 'admin', wallets) : null;
    const [item] = await tx.select().from(items).where(eq(items.id, id)).for('update');
    if (!item || item.status === 'destroyed') fail(409, 'conflict', 'Restore it first.');
    const request = randomUUID();
    wallets.move(item!.ownerId, 'admin_item_out', 0, { refId: request, itemId: id });
    wallets.move(target.id, 'admin_item_in', 0, { refId: request, itemId: id });
    const ledgerIds = await wallets.save(tx);
    await tx.update(items).set({ ownerId: target.id, status: 'available', obtainedAt: new Date(), acquiredVia: 'admin' }).where(eq(items.id, id));
    await tx.delete(showcase).where(eq(showcase.itemId, id));
    const from = labelOf(r.owner.id, r.owner.username, r.owner.deletedAt);
    const to = playerLabel(target);
    const statusBefore = listing ? `Listed (auction #${listing.number})` : offers.length ? `In trade (offer #${offers[0]!.number})` : STATUS_TEXT[r.item.status];
    await writeAdminLog(tx, staff, {
      action: 'item.move',
      target: logTarget(r),
      change: `${from} → ${to}`,
      before: { owner: from, status: statusBefore },
      after: {
        owner: to,
        status: 'Available',
        ...(listing ? { listing: `auction #${listing.number} cancelled${refund ? `, ${cr(refund.amount)} refunded` : ''}` } : {}),
        ...(offers.length ? { offers: offers.map((o) => `#${o.number} cancelled`).join(' / ') } : {}),
      },
      reason: body.reason,
      details: { request, ledger: ledgerIds, items: [id] },
    });
    return { toast: `Moved ${itemLabel(r)} to ${to} · logged` };
  });
}

export async function removeFromShowcase(staff: StaffMember, id: string, reason: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const r = await loadItem(tx, id);
    await lockUsers(tx, [r.item.ownerId]);
    const removed = await tx.delete(showcase).where(eq(showcase.itemId, id)).returning();
    if (!removed.length) fail(409, 'conflict', 'Not in a showcase.');
    const until = new Date(Date.now() + SHOWCASE_BLOCK_MS);
    await tx.update(items).set({ showcaseBlockedUntil: until }).where(eq(items.id, id));
    const ownerLabel = labelOf(r.owner.id, r.owner.username, r.owner.deletedAt);
    await writeAdminLog(tx, staff, {
      action: 'item.showcase',
      target: logTarget(r),
      change: 'removed from showcase',
      before: { showcase: 'shown', inventory: ownerLabel },
      after: { showcase: `hidden, blocked until ${utcDateTime(until)}`, inventory: 'unchanged' },
      reason,
      details: { items: [id] },
    });
    return { toast: `Removed ${itemLabel(r)} from ${ownerLabel}’s showcase · logged` };
  });
}

