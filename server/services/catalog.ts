import { eq, inArray } from 'drizzle-orm';
import type { SkinCard } from '../../shared/api.js';
import { db, type DbOrTx } from '../db/client.js';
import { collections, crateItems, crates, gameSettings, skins } from '../db/schema.js';
import { dailyCrateId } from '../game/dailyCrate.js';
import type { CrateContents, DrawableSkin } from '../game/draw.js';
import { TIERS, type Tier } from '../game/economy.js';

export type CrateRow = typeof crates.$inferSelect;
export type SkinRow = typeof skins.$inferSelect;

export interface CatalogCrate {
  row: CrateRow;
  /** The case's collection (its normal skins all belong to one): the album title. */
  collection: { id: string; name: string } | null;
  contents: CrateContents;
  /** Skin rows of this crate with their tier in it. */
  entries: { skin: SkinRow; tier: Tier }[];
}

export interface Catalog {
  crates: Map<string, CatalogCrate>;
  skins: Map<string, SkinRow>;
  /** Tier of a skin in the crates (a skin has the same tier in every crate it is in). */
  tiers: Map<string, Tier>;
  /** Normal (non-★) skins of all active cases: the denominator of the album percentage. */
  normalSkinIds: Set<string>;
  /** Active crate ids, newest first. */
  activeIds: string[];
  /** Every crate id, active or not (the rotation of the case of the day). */
  allIds: string[];
  /** Case of the day picked by staff (game_settings.case_of_day), if any. */
  caseOfDayPick: string | null;
  /** Active cases that drop each skin, newest first (a ★ finish is in several cases). */
  cratesBySkin: Map<string, string[]>;
}

// The catalog changes only on an import or a staff edit: kept per function instance, reloaded after
// 5 minutes or as soon as `catalog_version` changes (checked at most every 10 s), so staff edits
// reach every instance within seconds.
const TTL_MS = 5 * 60 * 1000;
const VERSION_CHECK_MS = 10 * 1000;
let cache: { at: number; checkedAt: number; version: string | null; catalog: Catalog } | undefined;

async function readVersion(): Promise<string | null> {
  const [row] = await db().select({ value: gameSettings.value }).from(gameSettings).where(eq(gameSettings.key, 'catalog_version'));
  return row ? String(row.value) : null;
}

/** Called in every staff transaction that changes cases, contents or the case of the day. */
export async function bumpCatalogVersion(tx: DbOrTx, by: string) {
  const value = String(Date.now());
  await tx
    .insert(gameSettings)
    .values({ key: 'catalog_version', value, updatedBy: by })
    .onConflictDoUpdate({ target: gameSettings.key, set: { value, updatedAt: new Date(), updatedBy: by } });
}

export async function catalog(): Promise<Catalog> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    if (now - cache.checkedAt < VERSION_CHECK_MS) return cache.catalog;
    const version = await readVersion();
    if (version === cache.version) {
      cache.checkedAt = now;
      return cache.catalog;
    }
  }
  const version = await readVersion();

  const rows = await db()
    .select({ crate: crates, skin: skins, tier: crateItems.tier })
    .from(crateItems)
    .innerJoin(crates, eq(crates.id, crateItems.crateId))
    .innerJoin(skins, eq(skins.id, crateItems.skinId))
    .where(eq(crates.isActive, true));

  const collectionNames = new Map((await db().select().from(collections)).map((c) => [c.id, c.name]));
  const byCrate = new Map<string, CatalogCrate>();
  const skinMap = new Map<string, SkinRow>();
  const tierMap = new Map<string, Tier>();
  for (const { crate, skin, tier } of rows) {
    let entry = byCrate.get(crate.id);
    if (!entry) {
      entry = { row: crate, collection: null, contents: Object.fromEntries(TIERS.map((t) => [t, []])) as unknown as CrateContents, entries: [] };
      byCrate.set(crate.id, entry);
    }
    entry.contents[tier].push(toDrawable(skin));
    entry.entries.push({ skin, tier });
    if (!entry.collection && tier !== 'gold' && skin.collectionId) {
      entry.collection = { id: skin.collectionId, name: collectionNames.get(skin.collectionId) ?? skin.collectionId };
    }
    skinMap.set(skin.id, skin);
    tierMap.set(skin.id, tier);
  }
  for (const entry of byCrate.values()) {
    for (const tier of TIERS) entry.contents[tier].sort((a, b) => a.id.localeCompare(b.id));
    entry.entries.sort((a, b) => a.skin.name.localeCompare(b.skin.name));
  }

  const activeIds = [...byCrate.values()]
    .sort((a, b) => (b.row.releasedOn ?? '').localeCompare(a.row.releasedOn ?? '') || a.row.name.localeCompare(b.row.name))
    .map((c) => c.row.id);

  const normalSkinIds = new Set([...byCrate.values()].flatMap((c) => c.entries.filter((e) => e.tier !== 'gold').map((e) => e.skin.id)));
  const cratesBySkin = new Map<string, string[]>();
  for (const id of activeIds) {
    for (const { skin } of byCrate.get(id)!.entries) cratesBySkin.set(skin.id, [...(cratesBySkin.get(skin.id) ?? []), id]);
  }
  const allIds = (await db().select({ id: crates.id }).from(crates)).map((r) => r.id);
  const [pickRow] = await db().select({ value: gameSettings.value }).from(gameSettings).where(inArray(gameSettings.key, ['case_of_day']));
  const caseOfDayPick = (pickRow?.value as { crateId?: string } | undefined)?.crateId ?? null;
  const result: Catalog = { crates: byCrate, skins: skinMap, tiers: tierMap, normalSkinIds, activeIds, allIds, caseOfDayPick, cratesBySkin };
  cache = { at: Date.now(), checkedAt: Date.now(), version, catalog: result };
  return result;
}

/** Today's free case. */
export const caseOfDay = (cat: Pick<Catalog, 'allIds' | 'activeIds' | 'caseOfDayPick'>, now = new Date()) =>
  dailyCrateId({ allIds: cat.allIds, activeIds: cat.activeIds, pick: cat.caseOfDayPick }, now);

export function clearCatalogCache() {
  cache = undefined;
}

function toDrawable(skin: SkinRow): DrawableSkin {
  return { id: skin.id, minFloat: skin.minFloat, maxFloat: skin.maxFloat, stattrakAvailable: skin.stattrakAvailable };
}

export function skinCard(skin: SkinRow, tier: Tier): SkinCard {
  return {
    id: skin.id,
    name: skin.name,
    weaponName: skin.weaponName,
    finishName: skin.finishName,
    phase: skin.phase,
    imageUrl: skin.imageUrl,
    tier,
  };
}
