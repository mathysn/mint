import { desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { authFlows, jobRuns, users } from '../db/schema.js';
import { fmt } from '../format.js';
import { checkLedger } from '../services/ledgerCheck.js';
import { settleDue } from '../services/market.js';
import { expireDue } from '../services/trades.js';

export type JobName = (typeof jobRuns.$inferSelect)['job'];

/** A guest that never opened a case is deleted after this long unseen; any other guest after GUEST_KEEP_DAYS. */
export const IDLE_GUEST_KEEP_HOURS = 1;
export const GUEST_KEEP_DAYS = 7;

interface JobDef {
  name: string;
  schedule: string;
  run: () => Promise<{ ok: boolean; count: number; result: string }>;
}

/**
 * Deletes guests that are gone: after an hour unseen if they never opened a case (they had nothing
 * to lose), after 7 days unseen otherwise. Their items never left them (guests can't trade or sell).
 */
async function purgeInactiveGuests(): Promise<number> {
  const deleted = await db()
    .delete(users)
    .where(
      sql`${users.id} IN (
        SELECT u.id FROM users u
        WHERE u.is_guest AND (
          u.last_seen_at < now() - interval '${sql.raw(String(GUEST_KEEP_DAYS))} days'
          OR (u.last_seen_at < now() - interval '${sql.raw(String(IDLE_GUEST_KEEP_HOURS))} hours'
              AND NOT EXISTS (SELECT 1 FROM case_openings o WHERE o.user_id = u.id))
        )
        LIMIT 5000
      )`,
    )
    .returning({ id: users.id });
  // Sign-in attempts only live 10 minutes; nothing reads them after a day.
  await db().delete(authFlows).where(lt(authFlows.expiresAt, sql`now() - interval '1 day'`));
  return deleted.length;
}

/** The scheduled jobs (server/scheduler.ts, or vercel.json crons on Vercel), in the order the panel lists them. */
export const JOBS: Record<JobName, JobDef> = {
  purge_guests: {
    name: 'Guest purge',
    schedule: 'daily 04:00 UTC',
    run: async () => {
      const n = await purgeInactiveGuests();
      return { ok: true, count: n, result: `OK · ${fmt(n)} deleted` };
    },
  },
  expire_trades: {
    name: 'Trade expiry',
    schedule: 'daily 03:00 UTC',
    run: async () => {
      const n = await expireDue();
      return { ok: true, count: n, result: `OK · ${fmt(n)} expired` };
    },
  },
  settle_auctions: {
    name: 'Auction settlement',
    schedule: 'daily 03:30 UTC',
    run: async () => {
      const n = await settleDue();
      return { ok: true, count: n, result: `OK · ${fmt(n)} settled` };
    },
  },
  check_ledger: {
    name: 'Ledger check',
    schedule: 'daily 05:00 UTC',
    run: async () => {
      const check = await checkLedger();
      return check.ok
        ? { ok: true, count: check.entries, result: `OK · ${fmt(check.entries)} entries` }
        : { ok: false, count: check.mismatches.length, result: `${fmt(check.mismatches.length)} mismatch${check.mismatches.length === 1 ? '' : 'es'}` };
    },
  },
};

export const JOB_NAMES = Object.keys(JOBS) as JobName[];

/**
 * Jobs the server's own scheduler (server/scheduler.ts) runs every minute. On Vercel they stay daily
 * crons; offers and auctions are settled on read anyway.
 */
export const MINUTE_JOBS: readonly JobName[] = ['expire_trades', 'settle_auctions'];

/** Jobs the server's scheduler runs every hour at this minute (daily crons on Vercel). */
export const HOURLY_JOBS: readonly JobName[] = ['purge_guests'];
export const HOURLY_MINUTE = 5;

let minuteSchedule = false;

/** Called once by the scheduler: the Jobs tab then shows the real schedule. */
export function enableMinuteSchedule() {
  minuteSchedule = true;
}

/** "daily 04:00 UTC", or "every minute" / "hourly at :05" for MINUTE_JOBS / HOURLY_JOBS when the scheduler runs. */
export function scheduleOf(job: JobName): string {
  if (minuteSchedule && MINUTE_JOBS.includes(job)) return 'every minute';
  if (minuteSchedule && HOURLY_JOBS.includes(job)) return `hourly at :${String(HOURLY_MINUTE).padStart(2, '0')}`;
  return JOBS[job].schedule;
}

/** UTC hour and minute of a "daily HH:MM UTC" schedule. */
export function dailyTime(job: JobName): { hour: number; minute: number } {
  const m = JOBS[job].schedule.match(/(\d{2}):(\d{2})/);
  return { hour: Number(m?.[1] ?? 0), minute: Number(m?.[2] ?? 0) };
}

/**
 * Runs a job and records the run (cron, scheduler, or a staff member's "Run now"). `quiet` (the
 * every-minute runs) only records a run that did something or failed, not 1,440 empty rows a day.
 */
export async function runJob(job: JobName, triggeredBy: string, { quiet = false } = {}) {
  const def = JOBS[job];
  const started = new Date();
  if (quiet) {
    try {
      const out = await def.run();
      const durationMs = Date.now() - started.getTime();
      if (out.count > 0 || !out.ok) {
        await db().insert(jobRuns).values({ job, startedAt: started, triggeredBy, finishedAt: new Date(), ok: out.ok, count: out.count, result: out.result, durationMs });
      }
      return { ...out, durationMs, startedAt: started };
    } catch (err) {
      await db().insert(jobRuns).values({ job, startedAt: started, triggeredBy, finishedAt: new Date(), ok: false, result: 'Failed', durationMs: Date.now() - started.getTime() });
      throw err;
    }
  }
  const [run] = await db().insert(jobRuns).values({ job, startedAt: started, triggeredBy }).returning({ id: jobRuns.id });
  try {
    const out = await def.run();
    const durationMs = Date.now() - started.getTime();
    await db().update(jobRuns).set({ finishedAt: new Date(), ok: out.ok, count: out.count, result: out.result, durationMs }).where(eq(jobRuns.id, run!.id));
    return { ...out, durationMs, startedAt: started };
  } catch (err) {
    const durationMs = Date.now() - started.getTime();
    await db().update(jobRuns).set({ finishedAt: new Date(), ok: false, result: 'Failed', durationMs }).where(eq(jobRuns.id, run!.id));
    throw err;
  }
}

/** Last run of each job. */
export async function lastRuns() {
  const rows = await db()
    .selectDistinctOn([jobRuns.job])
    .from(jobRuns)
    .orderBy(jobRuns.job, desc(jobRuns.startedAt));
  return new Map(rows.map((r) => [r.job, r]));
}
