import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { labelOf } from '../admin/labels.js';
import { cr } from '../format.js';

export interface LedgerCheck {
  ok: boolean;
  players: number;
  entries: number;
  /** One line per problem: "Guest #91c0 balance 250 CR, entries add up to 500 CR". */
  mismatches: { userId: string; label: string; text: string }[];
}

/**
 * The economy's invariants: for every player the ledger adds up to the balance, and the credits
 * taken by their open bids (bid_hold − bid_release on live auctions) match the bids they lead.
 */
export async function checkLedger(): Promise<LedgerCheck> {
  const balances = await db().execute<{ id: string; username: string | null; deleted_at: string | null; balance: number; total: number }>(sql`
    SELECT u.id, u.username, u.deleted_at, u.balance, COALESCE(SUM(l.amount), 0)::bigint AS total
    FROM users u LEFT JOIN ledger l ON l.user_id = u.id
    GROUP BY u.id
    HAVING u.balance <> COALESCE(SUM(l.amount), 0)`);
  const held = await db().execute<{ id: string; username: string | null; deleted_at: string | null; ledger_held: number; lead_amount: number }>(sql`
    WITH ledger_held AS (
      SELECT l.user_id, -SUM(l.amount)::bigint AS amount
      FROM ledger l JOIN auctions a ON a.id = l.ref_id AND a.status = 'active'
      WHERE l.type IN ('bid_hold', 'bid_release')
      GROUP BY l.user_id
    ), lead_bids AS (
      SELECT leader_id AS user_id, SUM(current_bid)::bigint AS amount
      FROM auctions WHERE status = 'active' AND leader_id IS NOT NULL
      GROUP BY leader_id
    )
    SELECT u.id, u.username, u.deleted_at, COALESCE(h.amount, 0)::bigint AS ledger_held, COALESCE(b.amount, 0)::bigint AS lead_amount
    FROM ledger_held h FULL JOIN lead_bids b ON b.user_id = h.user_id
    JOIN users u ON u.id = COALESCE(h.user_id, b.user_id)
    WHERE COALESCE(h.amount, 0) <> COALESCE(b.amount, 0)`);
  const counts = await db().execute<{ players: number; entries: number }>(sql`
    SELECT (SELECT count(*) FROM users)::int AS players, (SELECT count(*) FROM ledger)::int AS entries`);

  const mismatches = [
    ...balances.rows.map((r) => {
      const label = labelOf(r.id, r.username, r.deleted_at);
      return { userId: r.id, label, text: `${label} balance ${cr(Number(r.balance))}, entries add up to ${cr(Number(r.total))}` };
    }),
    ...held.rows.map((r) => {
      const label = labelOf(r.id, r.username, r.deleted_at);
      return { userId: r.id, label, text: `${label} holds ${cr(Number(r.ledger_held))} in bids, open bids add up to ${cr(Number(r.lead_amount))}` };
    }),
  ];
  const { players, entries } = counts.rows[0]!;
  return { ok: mismatches.length === 0, players: Number(players), entries: Number(entries), mismatches };
}
