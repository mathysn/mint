// Admin › Moderation: player reports, the ★ drops of the global banner, announcements and
// game-wide events (a free case or credits for every player). Player-side: filing a report and
// reading the current announcement.
import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { AdminActionResult, AdminAnnouncement, AdminDrop, AdminModeration, AdminReport, Announcement, GiftPreview, ReportCategory } from '../../shared/api.js';
import { db } from '../db/client.js';
import { activity, announcements, items, ledger, reports, skins, users } from '../db/schema.js';
import { econ, GLOBAL_DROP_TIERS } from '../game/economy.js';
import { caseReturn, type SimCrate } from '../game/simulator.js';
import { wearOf } from '../game/wear.js';
import { cr, fmt, plural, utcDateTime, utcDay, utcStamp } from '../format.js';
import { fail, type UserRow } from '../http.js';
import { catalog, caseOfDay } from '../services/catalog.js';
import { labelOf } from './labels.js';
import { reasonSchema, writeAdminLog } from './log.js';
import { freePlayerName } from './players.js';
import type { StaffMember } from './staff.js';

export const ANNOUNCEMENT_MAX = 140;
const REPORT_CATEGORIES = ['Offensive name', 'Scam', 'Other'] as const satisfies readonly ReportCategory[];
const REPORTS_PER_DAY = 10;

const target = alias(users, 'target');
const reporter = alias(users, 'reporter');

/** Accounts an event reaches: players (not guests), not deleted, not banned right now. */
const eligible = sql`${users.isGuest} = false AND ${users.deletedAt} IS NULL AND (${users.bannedAt} IS NULL OR (${users.banUntil} IS NOT NULL AND ${users.banUntil} <= now()))`;

async function eligibleCount() {
  const [row] = await db().select({ n: count() }).from(users).where(eligible);
  return row?.n ?? 0;
}

/** Credits players hold, plus what is held in bids: the "in circulation" figure of the Overview. */
async function circulation() {
  const [row] = await db()
    .select({ total: sql<number>`COALESCE(SUM(${users.balance}), 0)`.mapWith(Number) })
    .from(users)
    .where(isNull(users.deletedAt));
  const [held] = await db().execute<{ total: string }>(sql`SELECT COALESCE(SUM(current_bid), 0) AS total FROM auctions WHERE status = 'active' AND leader_id IS NOT NULL`).then((r) => r.rows);
  return (row?.total ?? 0) + Number(held?.total ?? 0);
}

// ── Page ────────────────────────────────────────────────────────────────────

/** "Oct 22, 09:35 → Oct 25, 00:00", "Oct 24, 05:30 → 06:30", "Oct 14 → Oct 21". */
function windowText(start: Date, end: Date) {
  const midnight = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  if (midnight(start) && midnight(end)) return `${utcDay(start)} → ${utcDay(end)}`;
  if (utcDay(start) === utcDay(end)) return `${utcDateTime(start)} → ${utcDateTime(end).split(', ')[1]}`;
  return `${utcDateTime(start)} → ${utcDateTime(end)}`;
}

export async function moderationPage(): Promise<AdminModeration> {
  const now = new Date();
  const reportRows = await db()
    .select({
      r: reports,
      targetName: target.username,
      targetDeleted: target.deletedAt,
      targetGuest: target.isGuest,
      reporterName: reporter.username,
      reporterDeleted: reporter.deletedAt,
    })
    .from(reports)
    .innerJoin(target, eq(target.id, reports.targetId))
    .leftJoin(reporter, eq(reporter.id, reports.reporterId))
    .where(sql`${reports.status} = 'open' OR ${reports.handledAt} > now() - interval '30 days'`)
    .orderBy(sql`CASE WHEN ${reports.status} = 'open' THEN 0 ELSE 1 END`, desc(reports.createdAt))
    .limit(50);
  // Names with an open "Offensive name" report stay hidden everywhere on this screen.
  const hidden = new Set(reportRows.filter((x) => x.r.status === 'open' && x.r.category === 'Offensive name').map((x) => x.r.targetId));
  const out: AdminReport[] = [];
  for (const { r, targetName, targetDeleted, targetGuest, reporterName, reporterDeleted } of reportRows) {
    const open = r.status === 'open';
    out.push({
      id: r.id,
      category: r.category as ReportCategory,
      urgent: open && r.category === 'Scam',
      open,
      target: { id: r.targetId, label: labelOf(r.targetId, targetName, targetDeleted) },
      hideName: open && r.category === 'Offensive name',
      meta: `reported by ${r.reporterId ? labelOf(r.reporterId, reporterName, reporterDeleted) : 'Deleted player'} · ${utcDateTime(r.createdAt)}`,
      reporter: r.reporterId ? labelOf(r.reporterId, reporterName, reporterDeleted) : 'Deleted player',
      message: r.message ?? '',
      handled: open ? null : r.handledNote,
      suggestedName: open && !targetGuest && !targetDeleted ? await freePlayerName() : null,
      isGuest: targetGuest,
    });
  }

  const dropRows = await db()
    .select({ a: activity, name: skins.name, float: items.float, username: users.username, deletedAt: users.deletedAt, isGuest: users.isGuest })
    .from(activity)
    .innerJoin(items, eq(items.id, activity.itemId))
    .innerJoin(skins, eq(skins.id, items.skinId))
    .innerJoin(users, eq(users.id, activity.userId))
    .where(and(eq(activity.type, 'unbox'), inArray(items.tier, [...GLOBAL_DROP_TIERS])))
    .orderBy(desc(activity.createdAt), desc(activity.id))
    .limit(12);
  const drops: AdminDrop[] = dropRows.map((d) => {
    const w = wearOf(d.float);
    return {
      id: d.a.id,
      item: d.name,
      wear: w ? `${w.code} ${d.float!.toFixed(4)}` : 'Vanilla',
      player: d.isGuest ? null : { id: d.a.userId, label: labelOf(d.a.userId, d.username, d.deletedAt) },
      hideName: hidden.has(d.a.userId),
      at: d.a.createdAt.toISOString(),
      hidden: d.a.hiddenAt !== null,
      state: d.a.hiddenAt ? `Hidden by ${d.a.hiddenBy ?? 'staff'}` : 'Shown in banner',
    };
  });

  const annRows = await db()
    .select()
    .from(announcements)
    .where(sql`COALESCE(${announcements.endedAt}, ${announcements.endsAt}) > now() - interval '30 days'`)
    .orderBy(desc(announcements.startsAt), desc(announcements.id))
    .limit(10);
  const anns: AdminAnnouncement[] = annRows
    .map((a) => {
      const end = a.endedAt && a.endedAt < a.endsAt ? a.endedAt : a.endsAt;
      const state: AdminAnnouncement['state'] = end <= now ? 'Ended' : a.startsAt <= now ? 'Live' : 'Scheduled';
      return { id: a.id, state, text: a.text, when: windowText(a.startsAt, end) };
    })
    .sort((x, y) => ['Live', 'Scheduled', 'Ended'].indexOf(x.state) - ['Live', 'Scheduled', 'Ended'].indexOf(y.state));

  const players = await eligibleCount();
  const cat = await catalog();
  const todayId = caseOfDay(cat, now);
  const today = todayId ? cat.crates.get(todayId) : undefined;
  let expected = 0;
  if (today) {
    const crate: SimCrate = { milspec: [], restricted: [], classified: [], covert: [], gold: [] };
    for (const { skin, tier } of today.entries) crate[tier].push(skin);
    expected = caseReturn(crate, econ());
  }
  return {
    reports: out,
    openReports: out.filter((r) => r.open).length,
    drops,
    announcements: anns,
    maxText: ANNOUNCEMENT_MAX,
    freeCase: {
      text: `Every player gets one extra free case of the day${today ? ` (${today.row.name})` : ''}, on top of their stack.`,
      costs: [
        { k: 'Players', v: fmt(players) },
        { k: 'Expected credits added', v: `≈ ${cr(Math.round(players * expected))}` },
      ],
      button: 'Give everyone a free case',
      players,
    },
  };
}

// ── Reports ─────────────────────────────────────────────────────────────────

export async function dismissReport(staff: StaffMember, id: number, reason: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const [r] = await tx.select().from(reports).where(eq(reports.id, id)).for('update');
    if (!r) return fail(404, 'not_found', 'Unknown report.');
    if (r.status !== 'open') fail(409, 'conflict', 'This report was already handled.');
    const [t] = await tx.select({ username: users.username, deletedAt: users.deletedAt }).from(users).where(eq(users.id, r.targetId));
    const label = labelOf(r.targetId, t?.username ?? null, t?.deletedAt ?? null);
    const now = new Date();
    await tx.update(reports).set({ status: 'handled', handledBy: staff.name, handledAt: now, handledNote: `Dismissed by ${staff.name}, ${utcStamp(now)}` }).where(eq(reports.id, r.id));
    await writeAdminLog(tx, staff, {
      action: 'report.dismiss',
      target: { type: 'report', id: String(r.id), label: `${r.category} · ${label}` },
      change: 'dismissed',
      before: { status: 'open', message: r.message ?? '' },
      after: { status: `dismissed by ${staff.name}` },
      reason,
    });
    return { toast: `Dismissed report on ${label} · logged` };
  });
}

export const reportSchema = z.object({
  category: z.enum(REPORT_CATEGORIES),
  message: z.string().trim().min(1, 'Tell staff what happened.').max(500),
});

/** A player reports another one: one open report per pair, 10 a day. */
export async function fileReport(me: UserRow, username: string, body: z.infer<typeof reportSchema>) {
  const [t] = await db().select().from(users).where(and(eq(users.username, username), isNull(users.deletedAt)));
  if (!t || t.isGuest) return fail(404, 'not_found', 'Unknown player.');
  if (t.id === me.id) fail(400, 'bad_request', 'You can’t report yourself.');
  const [today] = await db()
    .select({ n: count() })
    .from(reports)
    .where(and(eq(reports.reporterId, me.id), gt(reports.createdAt, sql`now() - interval '24 hours'`)));
  if ((today?.n ?? 0) >= REPORTS_PER_DAY) fail(429, 'rate_limited', 'You sent a lot of reports today. Try again tomorrow.');
  const inserted = await db()
    .insert(reports)
    .values({ reporterId: me.id, targetId: t.id, category: body.category, message: body.message })
    .onConflictDoNothing()
    .returning({ id: reports.id });
  if (!inserted.length) fail(409, 'conflict', `You already reported ${t.username}. Staff will look at it.`);
  return { ok: true as const };
}

// ── Global drop ─────────────────────────────────────────────────────────────

export async function setDropHidden(staff: StaffMember, id: number, hide: boolean, reason: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .select({ a: activity, name: skins.name, username: users.username, deletedAt: users.deletedAt, isGuest: users.isGuest, tier: items.tier })
      .from(activity)
      .innerJoin(items, eq(items.id, activity.itemId))
      .innerJoin(skins, eq(skins.id, items.skinId))
      .innerJoin(users, eq(users.id, activity.userId))
      .where(eq(activity.id, id))
      .for('update', { of: activity });
    if (!row || row.a.type !== 'unbox' || !GLOBAL_DROP_TIERS.includes(row.tier)) return fail(404, 'not_found', 'Unknown drop.');
    if (hide === (row.a.hiddenAt !== null)) fail(409, 'conflict', hide ? 'This drop is already hidden.' : 'This drop is already shown.');
    await tx
      .update(activity)
      .set(hide ? { hiddenAt: new Date(), hiddenBy: staff.name } : { hiddenAt: null, hiddenBy: null })
      .where(eq(activity.id, id));
    const who = row.isGuest ? 'A guest' : labelOf(row.a.userId, row.username, row.deletedAt);
    await writeAdminLog(tx, staff, {
      action: hide ? 'drop.hide' : 'drop.show',
      target: { type: 'drop', id: String(id), label: `${row.name} · ${who}` },
      change: hide ? 'hidden from banner' : 'shown in banner',
      before: { banner: hide ? 'shown' : `hidden by ${row.a.hiddenBy ?? 'staff'}` },
      after: { banner: hide ? `hidden by ${staff.name}` : 'shown' },
      reason,
    });
    return { toast: hide ? `Hid ${who}’s drop from the banner · logged` : `Showing ${who}’s drop in the banner again · logged` };
  });
}

// ── Announcements ───────────────────────────────────────────────────────────

/** "2026-10-24 05:30" (or with a T), read as UTC. */
const utcInput = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, 'Write the date as 2026-10-24 05:30 (UTC).')
  .transform((s) => new Date(`${s.replace(' ', 'T')}:00Z`));

export const announcementSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Write the announcement.')
    .max(ANNOUNCEMENT_MAX, `Keep it to ${ANNOUNCEMENT_MAX} characters.`),
  startsAt: utcInput,
  endsAt: utcInput,
  reason: reasonSchema,
});

export async function createAnnouncement(staff: StaffMember, body: z.infer<typeof announcementSchema>): Promise<AdminActionResult> {
  if (Number.isNaN(body.startsAt.getTime()) || Number.isNaN(body.endsAt.getTime())) fail(400, 'bad_request', 'Pick a date and time.');
  if (body.endsAt <= body.startsAt) fail(400, 'bad_request', 'The end must come after the start.');
  if (body.endsAt <= new Date()) fail(400, 'bad_request', 'The end is already past.');
  return db().transaction(async (tx) => {
    const [a] = await tx.insert(announcements).values({ text: body.text, startsAt: body.startsAt, endsAt: body.endsAt, createdBy: staff.name }).returning();
    const live = body.startsAt <= new Date();
    await writeAdminLog(tx, staff, {
      action: 'announcement.create',
      target: { type: 'announcement', id: String(a!.id), label: body.text.length > 48 ? `${body.text.slice(0, 47)}…` : body.text },
      change: live ? 'live now' : `scheduled ${utcDateTime(body.startsAt)}`,
      before: {},
      after: { text: body.text, window: windowText(body.startsAt, body.endsAt) },
      reason: body.reason,
    });
    return { toast: live ? 'Posted the announcement · logged' : `Scheduled the announcement for ${utcDateTime(body.startsAt)} · logged` };
  });
}

export async function endAnnouncement(staff: StaffMember, id: number, reason: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const [a] = await tx.select().from(announcements).where(eq(announcements.id, id)).for('update');
    if (!a) return fail(404, 'not_found', 'Unknown announcement.');
    const now = new Date();
    if (a.endedAt || a.endsAt <= now) fail(409, 'conflict', 'This announcement already ended.');
    await tx.update(announcements).set({ endedAt: now, endedBy: staff.name }).where(eq(announcements.id, id));
    const live = a.startsAt <= now;
    await writeAdminLog(tx, staff, {
      action: 'announcement.end',
      target: { type: 'announcement', id: String(a.id), label: a.text.length > 48 ? `${a.text.slice(0, 47)}…` : a.text },
      change: live ? 'ended early' : 'cancelled',
      before: { window: windowText(a.startsAt, a.endsAt) },
      after: { window: live ? windowText(a.startsAt, now) : 'never shown' },
      reason,
    });
    return { toast: live ? 'Ended the announcement · logged' : 'Cancelled the scheduled announcement · logged' };
  });
}

/** The banner players see now: the latest one that has started and not ended. */
export async function currentAnnouncement(): Promise<Announcement | null> {
  const [a] = await db()
    .select({ id: announcements.id, text: announcements.text })
    .from(announcements)
    .where(and(lte(announcements.startsAt, sql`now()`), gt(announcements.endsAt, sql`now()`), isNull(announcements.endedAt)))
    .orderBy(desc(announcements.startsAt), desc(announcements.id))
    .limit(1);
  return a ?? null;
}

// ── Events ──────────────────────────────────────────────────────────────────

export const giftSchema = z.object({ amount: z.number().int().min(1).max(100_000), reason: reasonSchema });
export const giftPreviewSchema = z.object({ amount: z.number().int().min(0).max(100_000) });

export async function giftPreview(amount: number): Promise<GiftPreview> {
  const [players, circ] = await Promise.all([eligibleCount(), circulation()]);
  const total = players * amount;
  const pct = circ ? (total / circ) * 100 : 0;
  return {
    players,
    costs: [
      { k: 'Total cost', v: cr(total) },
      { k: `In circulation after, +${pct.toFixed(1)}%`, v: cr(circ + total) },
    ],
    button: `Gift ${cr(amount)} to ${plural(players, 'player')}`,
  };
}

export async function giftEveryone(staff: StaffMember, body: z.infer<typeof giftSchema>): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const request = randomUUID();
    // Locks every eligible player (by id, the lock order used everywhere), credits them and writes
    // one gift entry per player, in one statement.
    const rows = await tx.execute<{ id: number }>(sql`
      WITH locked AS (
        SELECT id FROM users WHERE ${eligible} ORDER BY id FOR UPDATE
      ), paid AS (
        UPDATE users SET balance = users.balance + ${body.amount}
        FROM locked WHERE users.id = locked.id
        RETURNING users.id, users.balance
      )
      INSERT INTO ${ledger} (user_id, type, amount, balance_after, ref_id)
      SELECT id, 'admin_gift', ${body.amount}, balance, ${request}::uuid FROM paid
      RETURNING id`);
    const players = rows.rows.length;
    if (!players) fail(409, 'conflict', 'No player to gift.');
    await writeAdminLog(tx, staff, {
      action: 'event.gift',
      target: { type: 'event', id: null, label: 'Gift credits to all players' },
      change: `+${cr(body.amount)} × ${fmt(players)}`,
      before: {},
      after: { players: fmt(players), each: `+${cr(body.amount)}`, total: `+${cr(body.amount * players)}` },
      reason: body.reason,
      details: { request, ledgerCount: players },
    });
    return { toast: `Gifted ${cr(body.amount)} to ${plural(players, 'player')} · logged` };
  });
}

export async function freeCaseEveryone(staff: StaffMember, reason: string): Promise<AdminActionResult> {
  return db().transaction(async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      WITH locked AS (SELECT id FROM users WHERE ${eligible} ORDER BY id FOR UPDATE)
      UPDATE users SET bonus_free_cases = users.bonus_free_cases + 1
      FROM locked WHERE users.id = locked.id
      RETURNING users.id`);
    const players = rows.rows.length;
    if (!players) fail(409, 'conflict', 'No player to give a free case to.');
    await writeAdminLog(tx, staff, {
      action: 'event.free_case',
      target: { type: 'event', id: null, label: 'Free case for everyone' },
      change: `+1 free case × ${fmt(players)}`,
      before: {},
      after: { players: fmt(players), each: '+1 free case of the day' },
      reason,
    });
    return { toast: `Gave ${plural(players, 'player')} a free case · logged` };
  });
}

