import { desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ImportReport } from '../../shared/api.js';
import { db, type DbOrTx } from '../db/client.js';
import * as schema from '../db/schema.js';
import { econ, TIERS, type Tier } from '../game/economy.js';
import { bumpCatalogVersion, clearCatalogCache } from './catalog.js';

// Imports the case catalog from ByMykel/CSGO-API. Used by `pnpm catalog:import` and by the admin
// panel (dry run, then apply). Items players own are never touched; new cases arrive turned off.

const REPO = 'ByMykel/CSGO-API';
const LANG = 'en';

const rarity = z.object({ id: z.string(), name: z.string() });
const ref = z.object({ id: z.string(), name: z.string(), image: z.string().nullish() });
const crateEntry = z.object({ id: z.string(), name: z.string(), rarity });

const crateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().nullable(),
  first_sale_date: z.string().nullish(),
  image: z.string().nullish(),
  contains: z.array(crateEntry).default([]),
  contains_rare: z.array(crateEntry).default([]),
});

const skinSchema = z.object({
  id: z.string(),
  name: z.string(),
  weapon: z.object({ name: z.string() }),
  category: z.object({ name: z.string() }).nullish(),
  pattern: z.object({ name: z.string() }).nullish(),
  min_float: z.number().nullish(),
  max_float: z.number().nullish(),
  rarity,
  stattrak: z.boolean(),
  paint_index: z.string().nullish(),
  phase: z.string().nullish(),
  image: z.string(),
  collections: z.array(ref).default([]),
});

const collectionSchema = z.object({ id: z.string(), name: z.string(), image: z.string().nullish() });

/** API rarity of a normal case slot → game tier. Everything in contains_rare is `gold`. */
const TIER_BY_RARITY: Record<string, Tier> = {
  rarity_rare_weapon: 'milspec',
  rarity_mythical_weapon: 'restricted',
  rarity_legendary_weapon: 'classified',
  rarity_ancient_weapon: 'covert',
};

// ── Download ────────────────────────────────────────────────────────────────

/** "main" (or nothing) → the latest commit hash; a hash stays as given. */
export async function resolveCommit(commit?: string | null): Promise<string> {
  const wanted = commit?.trim() || 'main';
  if (/^[0-9a-f]{40}$/i.test(wanted)) return wanted.toLowerCase();
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${encodeURIComponent(wanted)}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 404 || res.status === 422) throw new ImportError(`No commit “${wanted}” in ${REPO}.`);
  if (!res.ok) throw new ImportError(`GitHub answered ${res.status} while resolving “${wanted}”.`);
  return ((await res.json()) as { sha: string }).sha;
}

export class ImportError extends Error {}

async function download<T>(commit: string, file: string, itemSchema: z.ZodType<T>): Promise<T[]> {
  const url = `https://raw.githubusercontent.com/${REPO}/${commit}/public/api/${LANG}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new ImportError(`GitHub answered ${res.status} for ${file} at this commit. Check the commit and try again.`);
  const parsed = z.array(itemSchema).safeParse(await res.json());
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new ImportError(`${file} doesn’t have the expected shape (at ${issue.path.join('.') || 'the top'}: ${issue.message}). Try another commit.`);
  }
  return parsed.data;
}

// ── Build ───────────────────────────────────────────────────────────────────

function splitName(name: string): { weapon: string; finish: string | null } {
  const at = name.indexOf(' | ');
  return at === -1 ? { weapon: name, finish: null } : { weapon: name.slice(0, at), finish: name.slice(at + 3) };
}

function toDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalised = value.replaceAll('/', '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(normalised) ? normalised : null;
}

export interface CatalogBuild {
  commit: string;
  crateRows: (typeof schema.crates.$inferInsert)[];
  skinRows: (typeof schema.skins.$inferInsert)[];
  collectionRows: (typeof schema.collections.$inferInsert)[];
  crateItems: (typeof schema.crateItems.$inferInsert)[];
  perCrate: { name: string; tiers: Record<Tier, number>; vanilla: number; released: string | null }[];
  problems: string[];
  rawCrateCount: number;
}

/** Downloads one commit of the source and turns it into rows (nothing is written). */
export async function buildCatalog(commit: string): Promise<CatalogBuild> {
  const [rawCrates, rawSkins, rawCollections] = await Promise.all([
    download(commit, 'crates.json', crateSchema),
    download(commit, 'skins.json', skinSchema),
    download(commit, 'collections.json', collectionSchema),
  ]);
  const skinsById = new Map(rawSkins.map((s) => [s.id, s]));
  const cases = rawCrates.filter((c) => c.type === 'Case' && c.contains.length > 0);
  const problems: string[] = [];
  const crateItems: CatalogBuild['crateItems'] = [];
  const perCrate: CatalogBuild['perCrate'] = [];

  for (const crate of cases) {
    const tiers = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
    const seen = new Set<string>();
    let vanilla = 0;
    const add = (skinId: string, tier: Tier) => {
      if (!skinsById.has(skinId)) return problems.push(`${crate.name}: unknown skin id ${skinId}`);
      if (seen.has(skinId)) return problems.push(`${crate.name}: ${skinId} listed twice`);
      seen.add(skinId);
      tiers[tier]++;
      if (skinsById.get(skinId)!.min_float == null) vanilla++;
      crateItems.push({ crateId: crate.id, skinId, tier, special: tier === 'gold' });
    };
    for (const entry of crate.contains) {
      const tier = TIER_BY_RARITY[entry.rarity.id];
      if (!tier) problems.push(`${crate.name}: unexpected rarity ${entry.rarity.id} for ${entry.name}`);
      else add(entry.id, tier);
    }
    for (const entry of crate.contains_rare) add(entry.id, 'gold');
    perCrate.push({ name: crate.name, tiers, vanilla, released: toDate(crate.first_sale_date) });
  }

  const collectionRows = new Map<string, typeof schema.collections.$inferInsert>();
  for (const c of rawCollections) collectionRows.set(c.id, { id: c.id, name: c.name, imageUrl: c.image ?? null });
  for (const s of rawSkins) for (const c of s.collections) if (!collectionRows.has(c.id)) collectionRows.set(c.id, { id: c.id, name: c.name, imageUrl: c.image ?? null });

  const skinRows = rawSkins.map((s) => {
    const { weapon, finish } = splitName(s.name);
    const hasFloat = s.min_float != null && s.max_float != null;
    return {
      id: s.id,
      name: s.name,
      weaponName: weapon,
      finishName: finish,
      category: s.category?.name ?? 'Other',
      apiRarityId: s.rarity.id,
      minFloat: hasFloat ? s.min_float! : null,
      maxFloat: hasFloat ? s.max_float! : null,
      stattrakAvailable: s.stattrak,
      phase: s.phase ?? null,
      paintIndex: s.paint_index ?? null,
      imageUrl: s.image,
      collectionId: s.collections[0]?.id ?? null,
      updatedAt: new Date(),
    };
  });

  const crateRows = cases.map((c) => ({
    id: c.id,
    name: c.name,
    imageUrl: c.image ?? '',
    price: econ().casePrice,
    releasedOn: toDate(c.first_sale_date),
    isActive: false,
    isNew: false,
    updatedAt: new Date(),
  }));

  return { commit, crateRows, skinRows, collectionRows: [...collectionRows.values()], crateItems, perCrate, problems, rawCrateCount: rawCrates.length };
}

// ── Images ──────────────────────────────────────────────────────────────────

/** HEAD each URL (16 at a time, 5 s each); returns the ones that don't answer 2xx. */
export async function brokenUrls(urls: string[]): Promise<Set<string>> {
  const broken = new Set<string>();
  const queue = [...new Set(urls)];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        if (!res.ok) broken.add(url);
      } catch {
        broken.add(url);
      }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return broken;
}

// ── Report ──────────────────────────────────────────────────────────────────

export interface StoredReport extends ImportReport {
  /** Image check results, reused by Apply: skin ids checked and those broken. */
  checked: string[];
  broken: string[];
}

/** Compares a build with the database: what an apply would change, plus the image check. */
export async function diffReport(tx: DbOrTx, build: CatalogBuild): Promise<Omit<StoredReport, 'id'>> {
  const [last] = await tx.select().from(schema.catalogImports).where(eq(schema.catalogImports.dryRun, false)).orderBy(desc(schema.catalogImports.startedAt)).limit(1);
  const currentCrates = new Set((await tx.select({ id: schema.crates.id }).from(schema.crates)).map((c) => c.id));
  const currentCaseSkins = new Set((await tx.selectDistinct({ id: schema.crateItems.skinId }).from(schema.crateItems)).map((r) => r.id));
  const skinsNow = new Map((await tx.select({ id: schema.skins.id, imageUrl: schema.skins.imageUrl, broken: schema.skins.imageBroken }).from(schema.skins)).map((s) => [s.id, s]));

  const newCrates = new Set(build.crateRows.map((c) => c.id!).filter((id) => !currentCrates.has(id)));
  const sourceCrates = new Set(build.crateRows.map((c) => c.id!));
  const newCaseSkins = new Set(build.crateItems.map((i) => i.skinId));
  const added = [...newCaseSkins].filter((id) => !currentCaseSkins.has(id));
  const inNewCases = added.filter((id) => build.crateItems.some((i) => i.skinId === id && newCrates.has(i.crateId)));
  const removed = [...currentCaseSkins].filter((id) => !newCaseSkins.has(id));

  // Only new or changed images, and those already known as broken, so the check stays short.
  const sourceSkins = new Map(build.skinRows.map((s) => [s.id, s]));
  const toCheck = [...newCaseSkins].filter((id) => {
    const now = skinsNow.get(id);
    return !now || now.broken || now.imageUrl !== sourceSkins.get(id)?.imageUrl;
  });
  const brokenSet = await brokenUrls(toCheck.map((id) => sourceSkins.get(id)!.imageUrl!));
  const broken = toCheck.filter((id) => brokenSet.has(sourceSkins.get(id)!.imageUrl!));
  const fixed = toCheck.filter((id) => skinsNow.get(id)?.broken && !brokenSet.has(sourceSkins.get(id)!.imageUrl!));
  const nameOf = (id: string) => sourceSkins.get(id)?.name ?? id;

  return {
    from: last?.sourceCommit ?? null,
    to: build.commit,
    casesAdded: newCrates.size,
    skinsAdded: added.length,
    skinsAddedInNewCases: inNewCases.length,
    skinsRemoved: removed.length,
    casesRemoved: [...currentCrates].filter((id) => !sourceCrates.has(id)).length,
    brokenImages: broken.map(nameOf),
    fixedImages: fixed.map(nameOf),
    checked: toCheck,
    broken,
  };
}

// ── Apply ───────────────────────────────────────────────────────────────────

const chunks = <T>(rows: T[], size = 500) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, i * size + size));

/**
 * Writes a build in the caller's transaction. Existing cases keep their Active / New switches;
 * new ones arrive off. Cases that left the source are turned off (items still point at them).
 * The very first import (empty catalog) turns every case on and marks the newest one as new.
 */
export async function applyCatalog(tx: DbOrTx, build: CatalogBuild, images: { checked: string[]; broken: string[] }, by: string) {
  const [{ n: existing } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.crates);
  const first = existing === 0;
  const newest = [...build.crateRows].sort((a, b) => (b.releasedOn ?? '').localeCompare(a.releasedOn ?? ''))[0]?.id;
  const crateRows = first ? build.crateRows.map((c) => ({ ...c, isActive: true, isNew: c.id === newest })) : build.crateRows;
  for (const rows of chunks(build.collectionRows)) {
    await tx
      .insert(schema.collections)
      .values(rows)
      .onConflictDoUpdate({ target: schema.collections.id, set: { name: sql`excluded.name`, imageUrl: sql`excluded.image_url` } });
  }
  for (const rows of chunks(build.skinRows)) {
    await tx
      .insert(schema.skins)
      .values(rows)
      .onConflictDoUpdate({
        target: schema.skins.id,
        set: {
          name: sql`excluded.name`,
          weaponName: sql`excluded.weapon_name`,
          finishName: sql`excluded.finish_name`,
          category: sql`excluded.category`,
          apiRarityId: sql`excluded.api_rarity_id`,
          minFloat: sql`excluded.min_float`,
          maxFloat: sql`excluded.max_float`,
          stattrakAvailable: sql`excluded.stattrak_available`,
          phase: sql`excluded.phase`,
          paintIndex: sql`excluded.paint_index`,
          imageUrl: sql`excluded.image_url`,
          collectionId: sql`excluded.collection_id`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  const now = new Date();
  if (images.checked.length) {
    const broken = new Set(images.broken);
    const ok = images.checked.filter((id) => !broken.has(id));
    if (ok.length) await tx.update(schema.skins).set({ imageBroken: false, imageCheckedAt: now }).where(inArray(schema.skins.id, ok));
    if (images.broken.length) await tx.update(schema.skins).set({ imageBroken: true, imageCheckedAt: now }).where(inArray(schema.skins.id, images.broken));
  }
  await tx
    .insert(schema.crates)
    .values(crateRows)
    .onConflictDoUpdate({
      target: schema.crates.id,
      set: { name: sql`excluded.name`, imageUrl: sql`excluded.image_url`, releasedOn: sql`excluded.released_on`, updatedAt: sql`excluded.updated_at` },
    });
  const ids = build.crateRows.map((c) => c.id!);
  await tx.update(schema.crates).set({ isActive: false }).where(notInArray(schema.crates.id, ids));
  // Contents are replaced as a whole; nothing references crate_items.
  await tx.delete(schema.crateItems).where(inArray(schema.crateItems.crateId, ids));
  for (const rows of chunks(build.crateItems)) await tx.insert(schema.crateItems).values(rows);
  await bumpCatalogVersion(tx, by);
}

/** Admin dry run: builds, compares, checks images, stores the report. Changes nothing else. */
export async function dryRun(commit: string | null, staffName: string): Promise<StoredReport> {
  const sha = await resolveCommit(commit);
  const build = await buildCatalog(sha);
  if (build.problems.length) throw new ImportError(`The source has ${build.problems.length} ${build.problems.length === 1 ? 'problem' : 'problems'}: ${build.problems.slice(0, 3).join('; ')}.`);
  const report = await diffReport(db(), build);
  const [row] = await db()
    .insert(schema.catalogImports)
    .values({ sourceCommit: sha, status: 'dry_run', dryRun: true, staffName, report, finishedAt: new Date(), counts: { cases: build.crateRows.length, skins: build.skinRows.length } })
    .returning({ id: schema.catalogImports.id });
  return { id: row!.id, ...report };
}

export function afterImport() {
  clearCatalogCache();
}
