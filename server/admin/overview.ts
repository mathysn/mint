import { and, count, desc, eq, gt, sql } from 'drizzle-orm';
import type { AdminJob, AdminKpi, AdminOverview, AdminPeriod, FlowBucket, Tier } from '../../shared/api.js';
import { db } from '../db/client.js';
import { caseOpenings, catalogImports, crateItems, crates, flags, items, ledger, sales, skins, users } from '../db/schema.js';
import { cr, fmt } from '../format.js';
import { caseOfDay, catalog } from '../services/catalog.js';
import { dropRates } from './dropRates.js';
import { JOBS, JOB_NAMES, lastRuns } from './jobs.js';
import { recentLog } from './logRead.js';

const DROP_SAMPLE = 10_000;

/** Ledger types that create or destroy credits; everything else moves them between players. */
const CREATED = { starting: ['starting_balance'], recycle: ['recycle'], admin: ['admin_grant', 'admin_gift'] } as const;
const DESTROYED = { cases: ['case_open'], fees: ['auction_fee'], removed: ['admin_remove', 'admin_clawback', 'account_delete'] } as const;
/** Old daily rewards still count in circulation (they were credits created). */
const MINT_BURN = ['starting_balance', 'recycle', 'admin_grant', 'admin_gift', 'daily_reward', 'case_open', 'auction_fee', 'admin_remove', 'admin_clawback', 'account_delete'];

const PERIODS: Record<AdminPeriod, { unit: 'hour' | 'day'; n: number; vs: string; over: string }> = {
  '24h': { unit: 'hour', n: 24, vs: 'vs previous 24 h', over: 'over previous 24 h' },
  '7d': { unit: 'day', n: 7, vs: 'vs previous 7 d', over: 'over previous 7 d' },
  '30d': { unit: 'day', n: 30, vs: 'vs previous 30 d', over: 'over previous 30 d' },
};

const inList = (types: readonly string[]) => sql.raw(types.map((t) => `'${t}'`).join(', '));
const pctChange = (now: number, before: number) => {
  if (!before) return now ? '+100%' : '0%';
  const pct = ((now - before) / before) * 100;
  const rounded = Math.abs(pct) < 10 ? pct.toFixed(1) : Math.round(pct).toString();
  return `${pct >= 0 ? '+' : '−'}${rounded.replace('-', '')}%`;
};

/** Buckets of the period (UTC hours or days), oldest first, the last one holding now. */
const bucketsSql = (unit: 'hour' | 'day', n: number) => sql`
  SELECT gs AS start, gs + ${`1 ${unit}`}::interval AS stop
  FROM generate_series(
    (date_trunc(${unit}, now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - ${`${n - 1} ${unit}`}::interval,
    date_trunc(${unit}, now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
    ${`1 ${unit}`}::interval) gs`;

type Num = number | string | null;
const num = (v: Num) => Number(v ?? 0);

async function flow(period: AdminPeriod) {
  const { unit, n } = PERIODS[period];
  const sum = (types: readonly string[], sign = 1) => sql`${sign} * COALESCE(SUM(l.amount) FILTER (WHERE l.type IN (${inList(types)})), 0)`;
  const res = await db().execute<{ start: string; starting: Num; recycle: Num; admin: Num; cases: Num; fees: Num; removed: Num; players: Num; openings: Num; sales: Num; flags: Num }>(sql`
    WITH b AS (${bucketsSql(unit, n)})
    SELECT b.start,
      ${sum(CREATED.starting)} AS starting, ${sum(CREATED.recycle)} AS recycle, ${sum(CREATED.admin)} AS admin,
      ${sum(DESTROYED.cases, -1)} AS cases, ${sum(DESTROYED.fees, -1)} AS fees, ${sum(DESTROYED.removed, -1)} AS removed,
      (SELECT count(*) FROM ${users} u WHERE u.created_at >= b.start AND u.created_at < b.stop AND u.deleted_at IS NULL) AS players,
      (SELECT count(*) FROM ${caseOpenings} co WHERE co.created_at >= b.start AND co.created_at < b.stop) AS openings,
      (SELECT count(*) FROM ${sales} s WHERE s.sold_at >= b.start AND s.sold_at < b.stop) AS sales,
      (SELECT count(*) FROM ${flags} f WHERE f.created_at >= b.start AND f.created_at < b.stop) AS flags
    FROM b LEFT JOIN ${ledger} l ON l.created_at >= b.start AND l.created_at < b.stop
    GROUP BY b.start, b.stop ORDER BY b.start`);
  return res.rows.map((r) => ({
    start: new Date(r.start).toISOString(),
    starting: num(r.starting),
    recycle: num(r.recycle),
    admin: num(r.admin),
    cases: num(r.cases),
    fees: num(r.fees),
    removed: num(r.removed),
    players: num(r.players),
    openings: num(r.openings),
    sales: num(r.sales),
    flags: num(r.flags),
  }));
}

async function activeDays(days: number) {
  const res = await db().execute<{ day: string; n: Num }>(sql`
    SELECT d::date AS day, (SELECT count(*) FROM player_days p WHERE p.day = d::date) AS n
    FROM generate_series(((now() AT TIME ZONE 'UTC')::date - ${days - 1}::int)::timestamp, (now() AT TIME ZONE 'UTC')::date::timestamp, interval '1 day') d
    ORDER BY d`);
  return res.rows.map((r) => num(r.n));
}

async function jobsSummary(): Promise<AdminJob[]> {
  const last = await lastRuns();
  return JOB_NAMES.map((job) => {
    const run = last.get(job);
    return { job, name: JOBS[job].name, schedule: JOBS[job].schedule, lastRunAt: run?.startedAt.toISOString() ?? null, ok: run?.ok ?? null, result: run?.result ?? null, durationMs: run?.durationMs ?? null };
  });
}

async function catalogCard(): Promise<AdminOverview['catalog']> {
  const [[last], crateRows, broken, cat] = await Promise.all([
    db().select().from(catalogImports).where(eq(catalogImports.dryRun, false)).orderBy(desc(catalogImports.startedAt)).limit(1),
    db().select({ id: crates.id, name: crates.name, active: crates.isActive }).from(crates),
    db()
      .select({ crateId: crateItems.crateId, n: count() })
      .from(crateItems)
      .innerJoin(skins, eq(skins.id, crateItems.skinId))
      .where(eq(skins.imageBroken, true))
      .groupBy(crateItems.crateId),
    catalog(),
  ]);
  const today = caseOfDay(cat);
  const byId = new Map(crateRows.map((c) => [c.id, c]));
  return {
    commit: last?.sourceCommit.slice(0, 7) ?? null,
    importedAt: (last?.finishedAt ?? last?.startedAt)?.toISOString() ?? null,
    cases: crateRows.length,
    active: crateRows.filter((c) => c.active).length,
    caseOfDay: today ? (byId.get(today)?.name ?? null) : null,
    warnings: broken.map((b) => {
      const crate = byId.get(b.crateId);
      const images = `${fmt(b.n)} broken image${b.n === 1 ? '' : 's'}`;
      return { crateId: b.crateId, text: crate?.active ? `${crate.name}: ${images}` : `${crate?.name ?? b.crateId} is off: ${images}` };
    }),
  };
}

export async function overview(period: AdminPeriod): Promise<AdminOverview> {
  const p = PERIODS[period];
  const [buckets, active, [players], [today], [periodCases], [circ], [sales24], [fees24], [openFlags], drops, jobs, catalogInfo, recent] = await Promise.all([
    flow(period),
    activeDays(period === '30d' ? 30 : 7),
    db()
      .select({ all: count(), guests: sql<number>`count(*) FILTER (WHERE ${users.isGuest})`.mapWith(Number) })
      .from(users)
      .where(sql`${users.deletedAt} IS NULL`),
    db().select({ n: count() }).from(caseOpenings).where(gt(caseOpenings.createdAt, sql`date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`)),
    db().select({ n: count() }).from(caseOpenings).where(gt(caseOpenings.createdAt, sql`now() - ${period === '24h' ? '24 hours' : period === '7d' ? '7 days' : '30 days'}::interval`)),
    db().select({ total: sql<number>`COALESCE(SUM(${ledger.amount}), 0)`.mapWith(Number) }).from(ledger).where(sql`${ledger.type} IN (${inList(MINT_BURN)})`),
    db().select({ n: count() }).from(sales).where(gt(sales.soldAt, sql`now() - interval '24 hours'`)),
    db().select({ total: sql<number>`COALESCE(-SUM(${ledger.amount}), 0)`.mapWith(Number) }).from(ledger).where(and(eq(ledger.type, 'auction_fee'), gt(ledger.createdAt, sql`now() - interval '24 hours'`))),
    db().select({ n: count() }).from(flags).where(eq(flags.status, 'open')),
    db().execute<{ tier: Tier; n: Num; total: Num }>(sql`
      SELECT i.tier, count(*) AS n, (SELECT count(*) FROM (SELECT 1 FROM ${caseOpenings} LIMIT ${DROP_SAMPLE}) s) AS total
      FROM (SELECT item_id FROM ${caseOpenings} ORDER BY created_at DESC LIMIT ${DROP_SAMPLE}) o
      JOIN ${items} i ON i.id = o.item_id
      GROUP BY i.tier`),
    jobsSummary(),
    catalogCard(),
    recentLog(5),
  ]);

  const created = (b: (typeof buckets)[number]) => b.starting + b.recycle + b.admin;
  const destroyed = (b: (typeof buckets)[number]) => b.cases + b.fees + b.removed;
  const createdTotal = buckets.reduce((s, b) => s + created(b), 0);
  const destroyedTotal = buckets.reduce((s, b) => s + destroyed(b), 0);
  // Circulation at the end of each bucket, walking back from now.
  const circulation = circ?.total ?? 0;
  const circSpark: number[] = [];
  let running = circulation;
  for (let i = buckets.length - 1; i >= 0; i--) {
    circSpark.unshift(running);
    running -= created(buckets[i]!) - destroyed(buckets[i]!);
  }
  const allPlayers = players?.all ?? 0;
  const playerSpark: number[] = [];
  let count_ = allPlayers;
  for (let i = buckets.length - 1; i >= 0; i--) {
    playerSpark.unshift(count_);
    count_ -= buckets[i]!.players;
  }
  const todayActive = active[active.length - 1] ?? 0;
  const yesterdayActive = active[active.length - 2] ?? 0;
  const days = period === '24h' ? 1 : period === '7d' ? 7 : 30;
  const flagsOpen = openFlags?.n ?? 0;

  const kpis: AdminKpi[] = [
    { key: 'players', value: allPlayers, delta: `${fmt(allPlayers - (players?.guests ?? 0))} accounts · ${fmt(players?.guests ?? 0)} guests`, spark: playerSpark, alert: false },
    { key: 'active', value: todayActive, delta: `${pctChange(todayActive, yesterdayActive)} vs yesterday`, spark: active, alert: false },
    { key: 'cases', value: today?.n ?? 0, delta: `avg ${fmt((periodCases?.n ?? 0) / days)} a day ${p.over}`, spark: buckets.map((b) => b.openings), alert: false },
    { key: 'circulation', value: circulation, delta: `${pctChange(circulation, running)} ${p.vs}`, spark: circSpark, alert: false },
    { key: 'sales', value: sales24?.n ?? 0, delta: `fees ${cr(fees24?.total ?? 0)}`, spark: buckets.map((b) => b.sales), alert: false },
    { key: 'flags', value: flagsOpen, delta: flagsOpen ? 'needs review' : 'none open', spark: buckets.map((b) => b.flags), alert: flagsOpen > 0 },
  ];

  const dropCounts: Partial<Record<Tier, number>> = {};
  let sample = 0;
  for (const r of drops.rows) {
    dropCounts[r.tier] = num(r.n);
    sample = num(r.total);
  }

  return {
    period,
    kpis,
    players: { accounts: allPlayers - (players?.guests ?? 0), guests: players?.guests ?? 0 },
    flow: {
      unit: p.unit,
      buckets: buckets.map(({ start, starting, recycle, admin, cases, fees, removed }): FlowBucket => ({ start, starting, recycle, admin, cases, fees, removed })),
      created: createdTotal,
      destroyed: destroyedTotal,
      net: createdTotal - destroyedTotal,
    },
    drops: { sample, ...dropRates(dropCounts, sample) },
    jobs,
    catalog: catalogInfo,
    recent,
  };
}
