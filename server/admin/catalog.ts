import { and, count, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AdminActionResult, AdminCatalog, AdminCrateDetail, AdminCrateRow, ImportReport, Tier } from '../../shared/api.js';
import { db } from '../db/client.js';
import { adminLog, caseOpenings, catalogImports, crateItems, crates, gameSettings, items, skins } from '../db/schema.js';
import { TIERS } from '../game/economy.js';
import { fmt } from '../format.js';
import { fail } from '../http.js';
import { bumpCatalogVersion, caseOfDay, catalog, clearCatalogCache } from '../services/catalog.js';
import { afterImport, applyCatalog, buildCatalog, dryRun, ImportError, type StoredReport } from '../services/catalogImport.js';
import { reasonSchema, writeAdminLog } from './log.js';
import type { StaffMember } from './staff.js';

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : null);
const DRAWER_ORDER: Tier[] = ['covert', 'classified', 'restricted', 'milspec', 'gold'];

async function lastImport() {
  const [row] = await db().select().from(catalogImports).where(eq(catalogImports.dryRun, false)).orderBy(desc(catalogImports.startedAt)).limit(1);
  return row ?? null;
}

async function crateRows(): Promise<AdminCrateRow[]> {
  const cat = await catalog();
  const today = caseOfDay(cat);
  const rows = await db()
    .select({
      crate: crates,
      normalCount: sql<number>`(SELECT count(*) FROM ${crateItems} ci WHERE ci.crate_id = "crates"."id" AND ci.tier <> 'gold')`.mapWith(Number),
      goldCount: sql<number>`(SELECT count(*) FROM ${crateItems} ci WHERE ci.crate_id = "crates"."id" AND ci.tier = 'gold')`.mapWith(Number),
      opened7d: sql<number>`(SELECT count(*) FROM ${caseOpenings} co WHERE co.crate_id = "crates"."id" AND co.created_at > now() - interval '7 days')`.mapWith(Number),
      broken: sql<number>`(SELECT count(*) FROM ${crateItems} ci JOIN ${skins} s ON s.id = ci.skin_id WHERE ci.crate_id = "crates"."id" AND s.image_broken)`.mapWith(Number),
    })
    .from(crates)
    .orderBy(sql`${crates.releasedOn} DESC NULLS LAST`, crates.name);
  return rows.map((r) => ({
    id: r.crate.id,
    name: r.crate.name,
    imageUrl: r.crate.imageUrl,
    releasedOn: r.crate.releasedOn,
    normalCount: r.normalCount,
    hasGold: r.goldCount > 0,
    active: r.crate.isActive,
    isNew: r.crate.isNew,
    price: r.crate.price,
    opened7d: r.opened7d,
    caseOfDay: r.crate.id === today,
    brokenImages: r.broken,
  }));
}

export async function adminCatalog(): Promise<AdminCatalog> {
  const [rows, last, [skinCount], imports] = await Promise.all([
    crateRows(),
    lastImport(),
    db().select({ n: count() }).from(skins),
    db().select().from(catalogImports).where(eq(catalogImports.dryRun, false)).orderBy(desc(catalogImports.startedAt)).limit(6),
  ]);
  const today = rows.find((r) => r.caseOfDay);
  return {
    commit: short(last?.sourceCommit),
    importedAt: last?.finishedAt?.toISOString() ?? last?.startedAt.toISOString() ?? null,
    caseCount: rows.length,
    skinCount: skinCount?.n ?? 0,
    caseOfDay: today ? { id: today.id, name: today.name } : null,
    rows,
    imports: imports.map((imp, i) => {
      const cases = (imp.counts as { cases?: number } | null)?.cases;
      const first = i === imports.length - 1 && imports.length < 6;
      return { commit: short(imp.sourceCommit)!, what: first ? 'first import' : `${fmt(cases ?? 0)} cases`, by: imp.staffName, at: (imp.finishedAt ?? imp.startedAt).toISOString() };
    }),
  };
}

/** "★ Kukri Knife", "★ 4 knives", "★ 6 gloves". */
function goldTitle(entries: { weaponName: string; category: string }[]): string {
  const weapons = [...new Set(entries.map((e) => e.weaponName.replace(/^★\s*/, '')))];
  if (weapons.length === 1) return `★ ${weapons[0]}`;
  const gloves = entries.every((e) => e.category === 'Gloves');
  const knives = entries.every((e) => e.category !== 'Gloves');
  return `★ ${weapons.length} ${gloves ? 'gloves' : knives ? 'knives' : 'knives and gloves'}`;
}

export async function crateDetail(id: string): Promise<AdminCrateDetail> {
  const row = (await crateRows()).find((r) => r.id === id);
  if (!row) return fail(404, 'not_found', 'Unknown case.');
  const contents = await db()
    .select({ tier: crateItems.tier, skin: skins })
    .from(crateItems)
    .innerJoin(skins, eq(skins.id, crateItems.skinId))
    .where(eq(crateItems.crateId, id))
    .orderBy(skins.name);
  const opened = await db()
    .select({ tier: items.tier, n: count() })
    .from(caseOpenings)
    .innerJoin(items, eq(items.id, caseOpenings.itemId))
    .where(and(eq(caseOpenings.crateId, id), gt(caseOpenings.createdAt, sql`now() - interval '30 days'`)))
    .groupBy(items.tier);
  const total = opened.reduce((s, r) => s + r.n, 0);
  const [off] = row.active
    ? []
    : await db()
        .select({ by: adminLog.staffName, at: adminLog.createdAt })
        .from(adminLog)
        .where(and(eq(adminLog.action, 'case.toggle'), eq(adminLog.targetId, id)))
        .orderBy(desc(adminLog.id))
        .limit(1);
  return {
    ...row,
    groups: DRAWER_ORDER.map((tier) => {
      const inTier = contents.filter((c) => c.tier === tier);
      return {
        tier,
        count: inTier.length,
        skins: tier === 'gold' ? [] : inTier.map((c) => ({ id: c.skin.id, weaponName: c.skin.weaponName, finishName: c.skin.finishName, imageUrl: c.skin.imageUrl, broken: c.skin.imageBroken })),
        gold: tier === 'gold' && inTier.length ? { title: goldTitle(inTier.map((c) => c.skin)), finishes: inTier.length } : null,
      };
    }).filter((g) => g.count > 0),
    last30: {
      total,
      rows: TIERS.map((tier) => {
        const n = opened.find((o) => o.tier === tier)?.n ?? 0;
        return { tier, count: n, pct: total ? Math.round((n / total) * 10_000) / 100 : 0 };
      }),
    },
    broken: contents.filter((c) => c.skin.imageBroken).map((c) => ({ name: c.skin.name, reason: 'image broken' })),
    off: off ? { by: off.by, at: off.at.toISOString() } : null,
  };
}

// ── Switches and case of the day ────────────────────────────────────────────

export const toggleSchema = z.object({ value: z.boolean(), reason: reasonSchema });

async function lockCrate(tx: Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0], id: string) {
  const [crate] = await tx.select().from(crates).where(eq(crates.id, id)).for('update');
  if (!crate) return fail(404, 'not_found', 'Unknown case.');
  return crate;
}

export async function setActive(staff: StaffMember, id: string, body: z.infer<typeof toggleSchema>): Promise<AdminActionResult> {
  const result = await db().transaction(async (tx) => {
    const crate = await lockCrate(tx, id);
    if (crate.isActive === body.value) fail(409, 'conflict', `${crate.name} is already ${crate.isActive ? 'on' : 'off'}.`);
    if (!body.value) {
      clearCatalogCache();
      if (caseOfDay(await catalog()) === id) fail(409, 'conflict', 'It’s today’s case of the day. Pick another case of the day first, then turn it off.');
    }
    await tx.update(crates).set({ isActive: body.value, updatedAt: new Date() }).where(eq(crates.id, id));
    await bumpCatalogVersion(tx, staff.name);
    await writeAdminLog(tx, staff, {
      action: 'case.toggle',
      target: { type: 'case', id, label: crate.name },
      change: body.value ? 'off → active' : 'active → off',
      before: { active: String(crate.isActive) },
      after: { active: String(body.value) },
      reason: body.reason,
    });
    return { toast: `Turned ${body.value ? 'on' : 'off'} ${crate.name} · logged` };
  });
  clearCatalogCache();
  return result;
}

export async function setNew(staff: StaffMember, id: string, body: z.infer<typeof toggleSchema>): Promise<AdminActionResult> {
  const result = await db().transaction(async (tx) => {
    const crate = await lockCrate(tx, id);
    if (crate.isNew === body.value) fail(409, 'conflict', `${crate.name} ${crate.isNew ? 'already has' : 'has no'} NEW badge.`);
    await tx.update(crates).set({ isNew: body.value, updatedAt: new Date() }).where(eq(crates.id, id));
    await bumpCatalogVersion(tx, staff.name);
    await writeAdminLog(tx, staff, {
      action: 'case.new',
      target: { type: 'case', id, label: crate.name },
      change: body.value ? 'NEW badge on' : 'NEW badge off',
      before: { new: String(crate.isNew) },
      after: { new: String(body.value) },
      reason: body.reason,
    });
    return { toast: body.value ? `Marked ${crate.name} as new · logged` : `Removed NEW badge from ${crate.name} · logged` };
  });
  clearCatalogCache();
  return result;
}

export const caseOfDaySchema = z.object({ crateId: z.string().min(1).max(200), reason: reasonSchema });

export async function setCaseOfDay(staff: StaffMember, body: z.infer<typeof caseOfDaySchema>): Promise<AdminActionResult> {
  clearCatalogCache();
  const cat = await catalog();
  const current = caseOfDay(cat);
  const result = await db().transaction(async (tx) => {
    const crate = await lockCrate(tx, body.crateId);
    if (!crate.isActive) fail(409, 'conflict', 'Cases that are off can’t be picked.');
    if (current === crate.id) fail(409, 'conflict', `${crate.name} is already the case of the day.`);
    const value = { crateId: crate.id };
    await tx
      .insert(gameSettings)
      .values({ key: 'case_of_day', value, updatedBy: staff.name })
      .onConflictDoUpdate({ target: gameSettings.key, set: { value, updatedAt: new Date(), updatedBy: staff.name } });
    await bumpCatalogVersion(tx, staff.name);
    const before = current ? (cat.crates.get(current)?.row.name ?? current) : '—';
    await writeAdminLog(tx, staff, {
      action: 'case.cotd',
      target: { type: 'case', id: crate.id, label: crate.name },
      change: `${before} → ${crate.name}`,
      before: { 'case of the day': before },
      after: { 'case of the day': crate.name },
      reason: body.reason,
    });
    return { toast: `${crate.name} is the case of the day · logged` };
  });
  clearCatalogCache();
  return result;
}

// ── Import ──────────────────────────────────────────────────────────────────

export const dryRunSchema = z.object({ commit: z.string().trim().max(64).optional() });
export const applySchema = z.object({ dryRunId: z.uuid(), reason: reasonSchema });

const publicReport = (id: string, r: Omit<StoredReport, 'id'>): ImportReport => ({
  id,
  from: short(r.from),
  to: short(r.to)!,
  casesAdded: r.casesAdded,
  skinsAdded: r.skinsAdded,
  skinsAddedInNewCases: r.skinsAddedInNewCases,
  skinsRemoved: r.skinsRemoved,
  casesRemoved: r.casesRemoved,
  brokenImages: r.brokenImages,
  fixedImages: r.fixedImages,
});

export async function importDryRun(staff: StaffMember, commit: string | undefined): Promise<ImportReport> {
  try {
    const report = await dryRun(commit ?? null, staff.name);
    return publicReport(report.id, report);
  } catch (err) {
    if (err instanceof ImportError) return fail(502, 'conflict', err.message);
    throw err;
  }
}

export async function importApply(staff: StaffMember, body: z.infer<typeof applySchema>): Promise<AdminActionResult> {
  const [run] = await db().select().from(catalogImports).where(and(eq(catalogImports.id, body.dryRunId), eq(catalogImports.dryRun, true)));
  if (!run?.report) return fail(404, 'not_found', 'Unknown dry run.');
  const last = await lastImport();
  if (last && last.startedAt > run.startedAt) fail(409, 'conflict', 'The catalog changed since this dry run. Run it again.');
  const report = run.report as Omit<StoredReport, 'id'>;
  let build;
  try {
    build = await buildCatalog(run.sourceCommit);
  } catch (err) {
    if (err instanceof ImportError) return fail(502, 'conflict', err.message);
    throw err;
  }
  const result = await db().transaction(async (tx) => {
    const [cases] = await tx.select({ n: count() }).from(crates);
    await applyCatalog(tx, build, report, staff.name);
    await tx.insert(catalogImports).values({
      sourceCommit: run.sourceCommit,
      counts: { cases: build.crateRows.length, skins: build.skinRows.length },
      status: 'done',
      staffName: staff.name,
      reason: body.reason,
      report,
      finishedAt: new Date(),
    });
    const sha = short(run.sourceCommit)!;
    const change = `+${fmt(report.casesAdded)} case${report.casesAdded === 1 ? '' : 's'}, +${fmt(report.skinsAdded)} skin${report.skinsAdded === 1 ? '' : 's'}`;
    await writeAdminLog(tx, staff, {
      action: 'catalog.import',
      target: { type: 'catalog', id: sha, label: sha },
      change,
      before: { commit: short(last?.sourceCommit) ?? '—', cases: fmt(cases?.n ?? 0) },
      after: { commit: sha, cases: fmt((cases?.n ?? 0) + report.casesAdded) },
      reason: body.reason,
      details: { dryRun: run.id, dryRunAt: run.startedAt.toISOString() },
    });
    return { toast: `Imported catalog ${sha}: ${change} · logged` };
  });
  afterImport();
  return result;
}
