import { and, count, eq, gt, ilike, ne, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { CaseFinder, SkinCard, SkinSuggestion, SuggestScope } from '../../shared/api.js';
import { db } from '../db/client.js';
import { auctions, items } from '../db/schema.js';
import { TIERS } from '../game/economy.js';
import { matchesTokens, searchTokens, suggestionRank } from '../game/search.js';
import { catalog, skinCard } from './catalog.js';

export const SUGGEST_LIMIT = 8;
export const SUGGEST_MIN_CHARS = 2;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** SQL side of the search box: every word must appear in the name. */
export function nameMatches(column: AnyColumn, q: string | undefined): SQL | undefined {
  const tokens = q ? searchTokens(q) : [];
  return tokens.length > 0 ? and(...tokens.map((t) => ilike(column, `%${escapeLike(t)}%`))) : undefined;
}

async function ownedCounts(ownerId: string): Promise<Map<string, number>> {
  const rows = await db()
    .select({ skinId: items.skinId, n: count() })
    .from(items)
    .where(and(eq(items.ownerId, ownerId), ne(items.status, 'destroyed')))
    .groupBy(items.skinId);
  return new Map(rows.map((r) => [r.skinId, r.n]));
}

async function listedCounts(): Promise<Map<string, number>> {
  const rows = await db()
    .select({ skinId: items.skinId, n: count() })
    .from(auctions)
    .innerJoin(items, eq(items.id, auctions.itemId))
    .where(and(eq(auctions.status, 'active'), gt(auctions.endsAt, sql`now()`)))
    .groupBy(items.skinId);
  return new Map(rows.map((r) => [r.skinId, r.n]));
}

type Ranked = { skin: SkinCard; rank: number };

/** Best matches first, then the rarest, then by name. */
const byRelevance = (a: Ranked, b: Ranked) =>
  a.rank - b.rank ||
  TIERS.indexOf(b.skin.tier) - TIERS.indexOf(a.skin.tier) ||
  a.skin.name.localeCompare(b.skin.name) ||
  (a.skin.phase ?? '').localeCompare(b.skin.phase ?? '');

const tooShort = (q: string, tokens: string[]) => q.trim().length < SUGGEST_MIN_CHARS || tokens.length === 0;

/**
 * Suggestions while typing: skins of that inventory, or skins listed on the market,
 * whose name holds every word. Best matches first, then the rarest.
 */
export async function suggestSkins(scope: SuggestScope, ownerId: string, q: string): Promise<SkinSuggestion[]> {
  const tokens = searchTokens(q);
  if (tooShort(q, tokens)) return [];
  const [counts, { skins, tiers }] = await Promise.all([scope === 'market' ? listedCounts() : ownedCounts(ownerId), catalog()]);
  const found: (SkinSuggestion & Ranked)[] = [];
  for (const [skinId, n] of counts) {
    const skin = skins.get(skinId);
    const tier = tiers.get(skinId);
    if (!skin || !tier || !matchesTokens(skin.name, tokens)) continue;
    found.push({ skin: skinCard(skin, tier), count: n, rank: suggestionRank(skin, tokens) });
  }
  found.sort(byRelevance);
  return found.slice(0, SUGGEST_LIMIT).map(({ skin, count: n }) => ({ skin, count: n }));
}

const FINDER_CRATE_MATCHES = 3;

/**
 * Weapon finder of the Cases screen: the active cases that drop a skin whose name holds every word.
 * With `crateId`, that case only, with all its matches (highlighted in "What's inside").
 */
export async function findCases(q: string, crateId?: string): Promise<CaseFinder> {
  const tokens = searchTokens(q);
  if (tooShort(q, tokens)) return { crates: [], skins: [] };
  const { skins, tiers, cratesBySkin, activeIds: allIds } = await catalog();
  const activeIds = crateId ? allIds.filter((id) => id === crateId) : allIds;
  const matchLimit = crateId ? Infinity : FINDER_CRATE_MATCHES;
  // One entry per name: Doppler phases are separate skins sharing a name.
  const byName = new Map<string, Ranked & { crateIds: Set<string> }>();
  for (const [skinId, crateIds] of cratesBySkin) {
    const skin = skins.get(skinId);
    const tier = tiers.get(skinId);
    if (!skin || !tier || !matchesTokens(skin.name, tokens)) continue;
    let entry = byName.get(skin.name);
    if (!entry) {
      entry = { skin: { ...skinCard(skin, tier), phase: null }, rank: suggestionRank(skin, tokens), crateIds: new Set() };
      byName.set(skin.name, entry);
    }
    for (const id of crateIds) entry.crateIds.add(id);
  }
  const found = [...byName.values()].sort(byRelevance);
  return {
    crates: activeIds.flatMap((id) => {
      const matches = found.filter((f) => f.crateIds.has(id));
      return matches.length ? [{ id, matches: matches.slice(0, matchLimit).map((m) => m.skin), matchCount: matches.length }] : [];
    }),
    skins: found
      .filter((f) => activeIds.some((id) => f.crateIds.has(id)))
      .slice(0, SUGGEST_LIMIT)
      .map((f) => ({ skin: f.skin, crateIds: activeIds.filter((id) => f.crateIds.has(id)) })),
  };
}
