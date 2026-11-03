import { and, count, desc, eq, gt, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AdminLogEntry, AdminLogPage } from '../../shared/api.js';
import { db } from '../db/client.js';
import { adminLog, crates, items, users } from '../db/schema.js';

const PAGE = 50;

/** Panel route of a log target, when it still exists. */
async function routes(rows: (typeof adminLog.$inferSelect)[]): Promise<Map<number, string | null>> {
  const ids = (type: string) => [...new Set(rows.filter((r) => r.targetType === type && r.targetId).map((r) => r.targetId!))];
  const uuid = (s: string) => z.uuid().safeParse(s).success;
  const [players, itemRows, crateRows] = await Promise.all([
    ids('player').filter(uuid).length ? db().select({ id: users.id }).from(users).where(inArray(users.id, ids('player').filter(uuid))) : [],
    ids('item').filter(uuid).length ? db().select({ id: items.id }).from(items).where(inArray(items.id, ids('item').filter(uuid))) : [],
    ids('case').length ? db().select({ id: crates.id }).from(crates).where(inArray(crates.id, ids('case'))) : [],
  ]);
  const exists = new Set([...players, ...itemRows, ...crateRows].map((r) => r.id));
  return new Map(
    rows.map((r) => {
      if (r.targetType === 'catalog') return [r.id, '/admin/catalog'];
      if (r.targetType === 'job') return [r.id, '/admin'];
      if (!r.targetId || !exists.has(r.targetId)) return [r.id, null];
      if (r.targetType === 'player') return [r.id, `/admin/players/${r.targetId}`];
      if (r.targetType === 'item') return [r.id, `/admin/items?item=${r.targetId}`];
      if (r.targetType === 'case') return [r.id, `/admin/catalog?case=${encodeURIComponent(r.targetId)}`];
      return [r.id, null];
    }),
  );
}

export async function toLogEntries(rows: (typeof adminLog.$inferSelect)[]): Promise<AdminLogEntry[]> {
  const to = await routes(rows);
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    staff: r.staffName,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    targetLabel: r.targetLabel,
    to: to.get(r.id) ?? null,
    change: r.change,
    reason: r.reason,
    before: r.before,
    after: r.after,
    details: r.details,
  }));
}

export async function recentLog(limit = 5) {
  return toLogEntries(await db().select().from(adminLog).orderBy(desc(adminLog.id)).limit(limit));
}

/** Action filter values of the log screen: a prefix ("credits.") or several ("case.,catalog."). */
export const logQuerySchema = z.object({
  staff: z.string().trim().max(64).optional(),
  action: z.string().trim().max(64).optional(),
  target: z.string().trim().max(100).optional(),
  range: z.enum(['today', '7d', '30d', 'all']).default('7d'),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export type LogQuery = z.infer<typeof logQuerySchema>;

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (m) => `\\${m}`);

function logWhere(q: LogQuery): SQL | undefined {
  const prefixes = q.action ? q.action.split(',').map((p) => p.trim()).filter(Boolean) : [];
  const since =
    q.range === 'today'
      ? sql`date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`
      : q.range === '7d'
        ? sql`now() - interval '7 days'`
        : q.range === '30d'
          ? sql`now() - interval '30 days'`
          : null;
  return and(
    q.staff ? eq(adminLog.staffName, q.staff) : undefined,
    prefixes.length ? or(...prefixes.map((p) => ilike(adminLog.action, `${escapeLike(p)}%`))) : undefined,
    q.target
      ? or(ilike(adminLog.targetLabel, `%${escapeLike(q.target)}%`), ilike(adminLog.targetId, `%${escapeLike(q.target)}%`), ilike(adminLog.change, `%${escapeLike(q.target)}%`))
      : undefined,
    since ? gt(adminLog.createdAt, since) : undefined,
  );
}

export async function logPage(q: LogQuery): Promise<AdminLogPage> {
  const where = logWhere(q);
  const [rows, [total], staffRows] = await Promise.all([
    db().select().from(adminLog).where(where).orderBy(desc(adminLog.id)).limit(PAGE).offset(q.offset),
    db().select({ n: count() }).from(adminLog).where(where),
    db().selectDistinct({ name: adminLog.staffName }).from(adminLog).orderBy(adminLog.staffName),
  ]);
  const n = total?.n ?? 0;
  return { rows: await toLogEntries(rows), total: n, next: q.offset + PAGE < n ? q.offset + PAGE : null, staff: staffRows.map((s) => s.name) };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every matching entry (no paging), oldest last, as CSV. Times in UTC (ISO). */
export async function logCsv(q: LogQuery): Promise<string> {
  const rows = await db().select().from(adminLog).where(logWhere(q)).orderBy(desc(adminLog.id)).limit(50_000);
  const header = ['id', 'time_utc', 'staff', 'action', 'target_type', 'target_id', 'target', 'change', 'reason', 'before', 'after', 'details'];
  const lines = rows.map((r) =>
    [r.id, r.createdAt.toISOString(), r.staffName, r.action, r.targetType, r.targetId, r.targetLabel, r.change, r.reason, r.before, r.after, r.details].map(csvCell).join(','),
  );
  return [header.join(','), ...lines].join('\r\n') + '\r\n';
}
