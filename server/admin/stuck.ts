import { desc, eq, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { auctions, tradeItems, trades } from '../db/schema.js';
import { utcDateTime } from '../format.js';

/**
 * A stuck item: its status says Listed or In trade while no live listing or offer holds it, so
 * its owner can't sell, trade or recycle it. A pending offer past its expiry or an active auction
 * past its end still count as live: they are settled on the next read or by the cron.
 */
// Columns are written out with their table: Drizzle drops the table name in single-table queries,
// and an unqualified "id" inside the subqueries would mean the subquery's own row.
export const stuckSql: SQL<boolean> = sql<boolean>`(
  ("items"."status" = 'listed' AND NOT EXISTS (
    SELECT 1 FROM ${auctions} a WHERE a.item_id = "items"."id" AND a.status = 'active'))
  OR ("items"."status" = 'in_trade' AND NOT EXISTS (
    SELECT 1 FROM ${tradeItems} ti JOIN ${trades} t ON t.id = ti.trade_id
    WHERE ti.item_id = "items"."id" AND ti.side = 'sender' AND t.status = 'pending'))
)`;

/** Same date format as everywhere else in admin: "Oct 23, 14:12 UTC". */
const at = (d: Date) => `${utcDateTime(d)} UTC`;

const TRADE_END: Record<string, string> = { expired: 'expired', declined: 'was declined', cancelled: 'was cancelled', accepted: 'was accepted' };
const AUCTION_END: Record<string, string> = { sold: 'was sold', unsold: 'ended unsold', cancelled: 'was cancelled' };

/** The drawer's explanation of a stuck item: what last held it and what Unlock does. */
export async function stuckNote(tx: DbOrTx, item: { id: string; status: string }, owner: string): Promise<string> {
  let cause = '';
  if (item.status === 'in_trade') {
    const [last] = await tx
      .select({ number: trades.number, status: trades.status, expiresAt: trades.expiresAt, respondedAt: trades.respondedAt })
      .from(tradeItems)
      .innerJoin(trades, eq(trades.id, tradeItems.tradeId))
      .where(eq(tradeItems.itemId, item.id))
      .orderBy(desc(trades.createdAt))
      .limit(1);
    if (last) cause = `Offer #${last.number} ${TRADE_END[last.status] ?? 'ended'} on ${at(last.respondedAt ?? last.expiresAt)}, but the item lock wasn’t released. `;
  } else {
    const [last] = await tx
      .select({ number: auctions.number, status: auctions.status, endsAt: auctions.endsAt, closedAt: auctions.closedAt })
      .from(auctions)
      .where(eq(auctions.itemId, item.id))
      .orderBy(desc(auctions.createdAt))
      .limit(1);
    if (last) cause = `Auction #${last.number} ${AUCTION_END[last.status] ?? 'ended'} on ${at(last.closedAt ?? last.endsAt)}, but the item lock wasn’t released. `;
  }
  return `${cause}No live listing or offer holds it, so ${owner} can’t sell, trade or recycle it. Unlock puts it back to Available in ${owner}’s inventory.`;
}
