import { and, eq, ne } from 'drizzle-orm';
import type { Completion, CrateDetail, CrateSpecialType, CrateSummary, OddsRow } from '../../shared/api.js';
import { db } from '../db/client.js';
import { items } from '../db/schema.js';
import { econ, TIERS } from '../game/economy.js';
import type { UserRow } from '../http.js';
import { freeCaseFor } from './accounts.js';
import { caseOfDay, catalog, skinCard, type Catalog, type CatalogCrate } from './catalog.js';

/** Odds actually used for a crate: the shared table, renormalised if a tier is empty. */
export function crateOdds(crate: CatalogCrate): OddsRow[] {
  const present = TIERS.filter((t) => crate.contents[t].length > 0);
  const odds = econ().oddsBp;
  const total = present.reduce((s, t) => s + odds[t], 0) || 1;
  return present.map((tier) => ({ tier, pct: Math.round((odds[tier] / total) * 10_000) / 100 }));
}

export const sharedOdds = (): OddsRow[] => TIERS.map((tier) => ({ tier, pct: econ().oddsBp[tier] / 100 }));

/** Distinct skins owned (not destroyed) by the player. */
async function ownedSkinIds(userId: string): Promise<Set<string>> {
  const rows = await db()
    .selectDistinct({ skinId: items.skinId })
    .from(items)
    .where(and(eq(items.ownerId, userId), ne(items.status, 'destroyed')));
  return new Set(rows.map((r) => r.skinId));
}

function completion(crate: CatalogCrate, owned: Set<string>): Completion {
  const normal = crate.entries.filter((e) => e.tier !== 'gold');
  return { owned: normal.filter((e) => owned.has(e.skin.id)).length, total: normal.length };
}

function summary(cat: Catalog, crate: CatalogCrate, owned: Set<string>, now: Date): CrateSummary {
  return {
    id: crate.row.id,
    name: crate.row.name,
    imageUrl: crate.row.imageUrl,
    price: econ().casePrice,
    isNew: crate.row.isNew,
    isFreeToday: crate.row.id === caseOfDay(cat, now),
    completion: completion(crate, owned),
    skinCount: crate.entries.filter((e) => e.tier !== 'gold').length,
  };
}

/** Newest first. */
export async function listCrates(user: UserRow | null): Promise<CrateSummary[]> {
  const cat = await catalog();
  const owned = user ? await ownedSkinIds(user.id) : new Set<string>();
  const now = new Date();
  return cat.activeIds.map((id) => summary(cat, cat.crates.get(id)!, owned, now));
}

export async function crateDetail(crateId: string, user: UserRow | null): Promise<CrateDetail | null> {
  const cat = await catalog();
  const crate = cat.crates.get(crateId);
  if (!crate) return null;
  const owned = user ? await ownedSkinIds(user.id) : new Set<string>();
  const odds = new Map(crateOdds(crate).map((o) => [o.tier, o.pct]));

  const normalTiers = (['covert', 'classified', 'restricted', 'milspec'] as const).filter((t) => crate.contents[t].length > 0);
  const groups = normalTiers.map((tier) => ({
    tier,
    pct: odds.get(tier) ?? 0,
    skins: crate.entries
      .filter((e) => e.tier === tier)
      .map((e) => ({ ...skinCard(e.skin, tier), owned: owned.has(e.skin.id) })),
  }));

  // One card per knife / glove type, illustrated by its vanilla version when there is one.
  const types = new Map<string, CrateSpecialType & { vanilla: boolean }>();
  for (const e of crate.entries.filter((x) => x.tier === 'gold')) {
    const current = types.get(e.skin.weaponName);
    const vanilla = e.skin.minFloat === null;
    if (!current) {
      types.set(e.skin.weaponName, { weaponName: e.skin.weaponName, category: e.skin.category, imageUrl: e.skin.imageUrl, finishCount: 1, vanilla });
    } else {
      current.finishCount++;
      if (vanilla && !current.vanilla) Object.assign(current, { imageUrl: e.skin.imageUrl, vanilla: true });
    }
  }

  return {
    crate: summary(cat, crate, owned, new Date()),
    groups,
    special: {
      pct: odds.get('gold') ?? 0,
      types: [...types.values()].map(({ vanilla: _vanilla, ...type }) => type),
    },
    freeCase: await freeCaseFor(user ?? { freeCaseAnchor: null, bonusFreeCases: 0 }),
  };
}

