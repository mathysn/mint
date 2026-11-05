import { describe, expect, it } from 'vitest';
import { nextRun } from '../../server/admin/logs.js';
import { dueJobs, missedDaily } from '../../server/scheduler.js';

const at = (iso: string) => new Date(iso);

describe('scheduler', () => {
  it('settles offers and auctions every minute, quietly', () => {
    expect(dueJobs(at('2026-10-28T13:17:00Z'))).toEqual([
      { job: 'expire_trades', quiet: true },
      { job: 'settle_auctions', quiet: true },
    ]);
  });

  it('runs each daily job at its own minute, recorded', () => {
    expect(dueJobs(at('2026-10-28T05:00:00Z'))).toContainEqual({ job: 'check_ledger', quiet: false });
    expect(dueJobs(at('2026-10-28T05:01:00Z')).map((d) => d.job)).not.toContain('check_ledger');
  });

  it('purges guests every hour at :05, quietly', () => {
    expect(dueJobs(at('2026-10-28T13:05:00Z'))).toContainEqual({ job: 'purge_guests', quiet: true });
    expect(dueJobs(at('2026-10-28T04:00:00Z')).map((d) => d.job)).not.toContain('purge_guests');
    expect(dueJobs(at('2026-10-28T13:06:00Z')).map((d) => d.job)).not.toContain('purge_guests');
  });

  it('catches up a daily job the server missed (never the hourly purge)', () => {
    const now = at('2026-10-28T12:00:00Z');
    const last = new Map([['check_ledger', { startedAt: at('2026-10-26T05:00:00Z') }]] as const);
    expect(missedDaily(new Map(last), now)).toEqual(['check_ledger']);
  });

  it('shows the next run of each kind of schedule', () => {
    const now = at('2026-10-28T13:17:42Z');
    expect(nextRun('every minute', now).toISOString()).toBe('2026-10-28T13:18:00.000Z');
    expect(nextRun('daily 04:00 UTC', now).toISOString()).toBe('2026-10-29T04:00:00.000Z');
    expect(nextRun('hourly at :05', now).toISOString()).toBe('2026-10-28T14:05:00.000Z');
    expect(nextRun('hourly at :05', at('2026-10-28T13:02:00Z')).toISOString()).toBe('2026-10-28T13:05:00.000Z');
  });
});
