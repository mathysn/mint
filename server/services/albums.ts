import { and, eq, inArray, ne } from 'drizzle-orm';
import type { AlbumBest, AlbumDetail, AlbumSkin, AlbumSummary } from '../../shared/api.js';
import { db } from '../db/client.js';
import { items } from '../db/schema.js';
import { wearOf } from '../game/wear.js';
import { catalog, skinCard, type Catalog, type CatalogCrate } from './catalog.js';

/**
 * An album is the obtainable normal skins of a case, titled with the case's collection.
 * Same count as the Cases screen; ★ items are listed apart and never counted.
 */
function summary(crate: CatalogCrate, owned: Set<string>): AlbumSummary {
  const normal = crate.entries.filter((e) => e.tier !== 'gold');
  return {
    id: crate.row.id,
    name: crate.collection?.name ?? crate.row.name,
    crate: { id: crate.row.id, name: crate.row.name, imageUrl: crate.row.imageUrl },
    owned: normal.filter((e) => owned.has(e.skin.id)).length,
    total: normal.length,
  };
}

async function ownedRows(userId: string, skinIds?: string[]) {
  const owned = and(eq(items.ownerId, userId), ne(items.status, 'destroyed'));
  return db()
    .select({ id: items.id, skinId: items.skinId, float: items.float, stattrak: items.stattrak })
    .from(items)
    .where(skinIds ? and(owned, inArray(items.skinId, skinIds)) : owned);
}

/** All case albums: started ones first (most complete first), then the others, newest case first. */
export async function listAlbums(userId: string): Promise<AlbumSummary[]> {
  const cat: Catalog = await catalog();
  const owned = new Set((await ownedRows(userId)).map((r) => r.skinId));
  const albums = cat.activeIds.map((id) => summary(cat.crates.get(id)!, owned));
  const ratio = (a: AlbumSummary) => (a.total ? a.owned / a.total : 0);
  const started = albums.filter((a) => a.owned > 0).sort((a, b) => ratio(b) - ratio(a));
  return [...started, ...albums.filter((a) => a.owned === 0)];
}

/** Lowest float wins; a vanilla knife (no float) only if nothing else. */
function bestOf(copies: { id: string; float: number | null; stattrak: boolean }[]): AlbumBest | null {
  if (!copies.length) return null;
  const best = [...copies].sort((a, b) => (a.float ?? 2) - (b.float ?? 2))[0]!;
  const wear = wearOf(best.float);
  return { itemId: best.id, float: best.float, wear: wear ? { code: wear.code, name: wear.name } : null, stattrak: best.stattrak };
}

export async function albumDetail(userId: string, crateId: string): Promise<AlbumDetail | null> {
  const cat = await catalog();
  const crate = cat.crates.get(crateId);
  if (!crate) return null;
  const rows = await ownedRows(userId, crate.entries.map((e) => e.skin.id));
  const copies = new Map<string, typeof rows>();
  for (const r of rows) copies.set(r.skinId, [...(copies.get(r.skinId) ?? []), r]);
  const skinOf = (e: CatalogCrate['entries'][number]): AlbumSkin => ({ ...skinCard(e.skin, e.tier), best: bestOf(copies.get(e.skin.id) ?? []) });

  const groups = (['covert', 'classified', 'restricted', 'milspec'] as const)
    .map((tier) => {
      const skins = crate.entries.filter((e) => e.tier === tier).map(skinOf);
      return { tier, owned: skins.filter((s) => s.best).length, total: skins.length, skins };
    })
    .filter((g) => g.total > 0);

  return {
    album: summary(crate, new Set(rows.map((r) => r.skinId))),
    groups,
    special: crate.entries.filter((e) => e.tier === 'gold' && copies.has(e.skin.id)).map(skinOf),
  };
}
