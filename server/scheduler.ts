// The server's own clock (self-hosted only, started by server/main.ts): offers and auctions settle
// every minute, the guest purge runs every hour, the daily jobs run at their time. On Vercel, vercel.json crons do this instead.
import { HOURLY_JOBS, HOURLY_MINUTE, JOB_NAMES, MINUTE_JOBS, dailyTime, enableMinuteSchedule, lastRuns, runJob, type JobName } from './admin/jobs.js';

const DAILY_JOBS = JOB_NAMES.filter((job) => !MINUTE_JOBS.includes(job) && !HOURLY_JOBS.includes(job));
const DAY_MS = 24 * 3_600_000;

/** Jobs due at this minute: the every-minute ones and, at :05, the hourly ones (quiet), plus any daily job set for this minute. */
export function dueJobs(now: Date): { job: JobName; quiet: boolean }[] {
  const due = MINUTE_JOBS.map((job) => ({ job, quiet: true }));
  if (now.getUTCMinutes() === HOURLY_MINUTE) for (const job of HOURLY_JOBS) due.push({ job, quiet: true });
  for (const job of DAILY_JOBS) {
    const { hour, minute } = dailyTime(job);
    if (now.getUTCHours() === hour && now.getUTCMinutes() === minute) due.push({ job, quiet: false });
  }
  return due;
}

/** Daily jobs that missed their run (server down at that minute): last run over a day ago, or never. */
export function missedDaily(last: Map<JobName, { startedAt: Date }>, now: Date): JobName[] {
  return DAILY_JOBS.filter((job) => {
    const run = last.get(job);
    return !run || now.getTime() - run.startedAt.getTime() > DAY_MS + 3_600_000;
  });
}

const running = new Map<JobName, Promise<void>>();

/** Runs a job unless its previous run is still going (a slow minute never stacks up). */
function start(job: JobName, quiet: boolean) {
  if (running.has(job)) return;
  const run = runJob(job, 'scheduler', { quiet })
    .then(() => undefined)
    .catch((err: unknown) => console.error(`[scheduler] ${job} failed`, err))
    .finally(() => running.delete(job));
  running.set(job, run);
}

/** Starts the clock; the returned function stops it and waits for the runs in progress. */
export function startScheduler(): () => Promise<void> {
  enableMinuteSchedule();
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const next = () => {
    // A little after each minute boundary, so "daily 04:00" sees 04:00.
    timer = setTimeout(() => {
      if (stopped) return;
      for (const { job, quiet } of dueJobs(new Date())) start(job, quiet);
      next();
    }, 60_000 - (Date.now() % 60_000) + 200);
  };
  next();
  void lastRuns()
    .then((last) => {
      for (const job of missedDaily(last, new Date())) start(job, false);
    })
    .catch((err: unknown) => console.error('[scheduler] catch-up failed', err));
  console.log(`[scheduler] ${MINUTE_JOBS.join(', ')} every minute; ${HOURLY_JOBS.join(', ')} hourly; ${DAILY_JOBS.join(', ')} daily`);
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await Promise.allSettled([...running.values()]);
  };
}
