// Logs & tools: the ledger explorer and its check, the scheduled jobs and the API errors.
import { and, count, desc, eq, gt, ilike, inArray, like, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AdminErrors, AdminJobCard, AdminLedgerPage, LedgerCheckResult } from '../../shared/api.js';
import { db } from '../db/client.js';
import { auctions, errorCounts, items, ledger, ledgerTypeEnum, serverErrors, users } from '../db/schema.js';
import { OVERDUE_AFTER_MS } from '../game/economy.js';
import { plural } from '../format.js';
import { checkLedger } from '../services/ledgerCheck.js';
import { JOB_NAMES, JOBS, lastRuns, scheduleOf, type JobName } from './jobs.js';
import { labelOf } from './labels.js';
import { describeLedger, TYPE_LABEL } from './players.js';
import { stuckSql } from './stuck.js';

const PAGE = 50;

export const ledgerQuerySchema = z.object({
  q: z.string().trim().max(64).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

/** "Player, entry ID or type (case_open, recycle…)". */
function ledgerWhere(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const id = q.replace(/^#/, '');
  if (/^\d{1,15}$/.test(id)) return eq(ledger.id, Number(id));
  const typed = q.toLowerCase().replace(/\s+/g, '_');
  // The ledger shows some types under a short name ("start_balance"): search finds them by either.
  const type = Object.keys(TYPE_LABEL).find((k) => TYPE_LABEL[k] === typed) ?? typed;
  if ((ledgerTypeEnum.enumValues as readonly string[]).includes(type)) return eq(ledger.type, type as (typeof ledgerTypeEnum.enumValues)[number]);
  const guest = q.match(/^guest\s*#?\s*([0-9a-f]{2,8})$/i);
  const players = guest
    ? db().select({ id: users.id }).from(users).where(like(sql`${users.id}::text`, `${guest[1]!.toLowerCase()}%`))
    : db().select({ id: users.id }).from(users).where(ilike(users.username, `${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
  return inArray(ledger.userId, players);
}

export async function ledgerPage(query: z.infer<typeof ledgerQuerySchema>): Promise<AdminLedgerPage> {
  const rows = await db()
    .select()
    .from(ledger)
    .where(ledgerWhere(query.q))
    .orderBy(desc(ledger.id))
    .limit(PAGE + 1)
    .offset(query.offset);
  const page = rows.slice(0, PAGE);
  const described = await describeLedger(page);
  const owners = page.length ? await db().select({ id: users.id, username: users.username, deletedAt: users.deletedAt }).from(users).where(inArray(users.id, [...new Set(page.map((r) => r.userId))])) : [];
  const names = new Map(owners.map((o) => [o.id, labelOf(o.id, o.username, o.deletedAt)]));
  const last = (await lastRuns()).get('check_ledger');
  return {
    rows: described.map((d, i) => ({ ...d, player: { id: page[i]!.userId, label: names.get(page[i]!.userId) ?? 'Deleted player' } })),
    next: rows.length > PAGE ? query.offset + PAGE : null,
    lastCheck: last && last.finishedAt ? { ok: Boolean(last.ok), at: last.startedAt.toISOString(), result: last.result ?? '' } : null,
  };
}

/** "Check ledger" button: read-only, not logged, open to every role. */
export async function ledgerCheckNow(): Promise<LedgerCheckResult> {
  const check = await checkLedger();
  return { ...check, at: new Date().toISOString() };
}

// ── Jobs ────────────────────────────────────────────────────────────────────

/** Next run of an "every minute", "hourly at :MM" or "daily HH:MM UTC" schedule. */
export function nextRun(schedule: string, now = new Date()): Date {
  if (schedule === 'every minute') return new Date(Math.floor(now.getTime() / 60_000) * 60_000 + 60_000);
  const hourly = schedule.match(/^hourly at :(\d{2})$/);
  if (hourly) {
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), Number(hourly[1])));
    if (next <= now) next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }
  const m = schedule.match(/(\d{2}):(\d{2})/);
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(m?.[1] ?? 0), Number(m?.[2] ?? 0)));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export async function jobsPage(): Promise<AdminJobCard[]> {
  const [last, [stuck], overdue] = await Promise.all([
    lastRuns(),
    db().select({ n: count() }).from(items).where(and(eq(items.status, 'in_trade'), stuckSql)),
    db()
      .select({ number: auctions.number })
      .from(auctions)
      .where(and(eq(auctions.status, 'active'), lte(auctions.endsAt, sql`now() - ${`${OVERDUE_AFTER_MS} milliseconds`}::interval`)))
      .orderBy(auctions.endsAt)
      .limit(6),
  ]);
  const notes: Partial<Record<JobName, { note: string; link: AdminJobCard['link']; warn: boolean }>> = {};
  if ((stuck?.n ?? 0) > 0) {
    notes.expire_trades = {
      note: `${plural(stuck!.n, 'item')} still locked after ${stuck!.n === 1 ? 'its offer' : 'their offer'} ended.`,
      link: { label: 'Open stuck items', to: '/admin/items?status=stuck' },
      warn: true,
    };
  }
  if (overdue.length) {
    notes.settle_auctions = {
      note: `Overdue: ${overdue.map((o) => `#${o.number}`).join(', ')}${overdue.length === 6 ? '…' : ''}. They settle on the next run, or now from Market & trades.`,
      link: { label: 'Open Market & trades', to: '/admin/market' },
      warn: true,
    };
  }
  const ledgerRun = last.get('check_ledger');
  if (ledgerRun && ledgerRun.finishedAt && !ledgerRun.ok && ledgerRun.result !== 'Failed') {
    notes.check_ledger = { note: `The last check found ${ledgerRun.result}.`, link: { label: 'Open the ledger', to: '/admin/logs?tab=ledger' }, warn: true };
  }
  return JOB_NAMES.map((job) => {
    const run = last.get(job);
    const n = notes[job];
    const status: AdminJobCard['status'] = run?.result === 'Failed' ? 'Failed' : n?.warn || run?.ok === false ? 'Warning' : !run ? 'Never run' : 'OK';
    return {
      job,
      name: JOBS[job].name,
      schedule: scheduleOf(job),
      lastRunAt: run?.startedAt.toISOString() ?? null,
      ok: run?.ok ?? null,
      result: run?.result ?? null,
      durationMs: run?.durationMs ?? null,
      status,
      nextAt: nextRun(scheduleOf(job)).toISOString(),
      note: n?.note ?? null,
      link: n?.link ?? null,
    };
  });
}

// ── Errors ──────────────────────────────────────────────────────────────────

const HINTS: Record<string, string> = {
  insufficient_balance: 'Normal: a player without enough CR to open a case, bid, buy now or accept an offer.',
  items_unavailable: 'Item already listed, traded or recycled.',
  unauthorized: 'Normal: a first visit, before the guest account exists.',
  rate_limited: 'Too many requests from one player or address.',
  banned: 'A banned player tried to play.',
  forbidden: 'Someone tried an action their account or role doesn’t allow.',
  not_found: 'A link to something that no longer exists.',
  bad_request: 'Input the server refused: a form, or an old version of the app.',
  auction_ended: 'A bid or a buy after the end of an auction.',
  bid_too_low: 'A bid below the minimum raise.',
  free_case_unavailable: 'A free case asked for before the timer.',
  confirmation_required: 'Normal: recycling a rare item asks for a confirmation.',
  conflict: 'Two actions on the same thing at once, or something already done.',
  limit_reached: 'A player at a limit (listings, offers, friends).',
  account_required: 'A guest tried an action that needs an account.',
  crate_inactive: 'Someone tried to open a case that is turned off.',
  discord_disabled: 'Discord sign-in isn’t configured on this server.',
  balance_too_low: 'Staff: a credit removal or a restore clawback that would go below 0 CR.',
  not_stuck: 'Staff: Unlock on an item that isn’t stuck.',
  confirm_name_mismatch: 'Staff: the typed name didn’t match.',
  upstream_failed: 'GitHub (catalog import) or Discord failed or answered something unusable.',
  internal: 'Server error. Always worth a look.',
};

export async function errorsPage(): Promise<AdminErrors> {
  const [codes, errors] = await Promise.all([
    db()
      .select({ code: errorCounts.code, count: sql<number>`SUM(${errorCounts.count})::int` })
      .from(errorCounts)
      .where(gt(errorCounts.hour, sql`now() - interval '24 hours'`))
      .groupBy(errorCounts.code)
      .orderBy(desc(sql`SUM(${errorCounts.count})`))
      .limit(8),
    db().select().from(serverErrors).orderBy(desc(serverErrors.lastAt)).limit(20),
  ]);
  return {
    codes: codes.map((c) => ({ code: c.code, count: c.count, hint: HINTS[c.code] ?? '—', alert: c.code === 'internal' })),
    errors: errors.map((e) => ({ at: e.lastAt.toISOString(), code: e.code, route: e.route, count: e.count, message: e.message })),
  };
}

