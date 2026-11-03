import { and, asc, count, desc, eq, gte, lt, ne, sql, sum, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { InventoryPage } from '../../shared/api.js';
import { db } from '../db/client.js';
import { crates, items, skins } from '../db/schema.js';
import { TIERS } from '../game/economy.js';
import { WEAR_CODES, wearRange, type WearCode } from '../game/wear.js';
import { itemValueExpr, selectItems, toItem } from './items.js';
import { nameMatches } from './search.js';

export const PAGE_SIZE = 60;

export const inventoryQuerySchema = z.object({
  rarity: z.enum(TIERS).optional(),
  stattrak: z.enum(['1', 'true']).optional(),
  wear: z.enum(WEAR_CODES as [WearCode, ...WearCode[]]).optional(),
  crate: z.string().max(64).optional(),
  q: z.string().trim().max(80).optional(),
  sort: z.enum(['value', 'recent', 'float']).default('value'),
  offset: z.coerce.number().int().min(0).default(0),
});

export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;

/** Filtering, sorting and totals all happen here; the client only displays the page. */
export async function inventoryPage(ownerId: string, query: InventoryQuery): Promise<InventoryPage> {
  const owned = and(eq(items.ownerId, ownerId), ne(items.status, 'destroyed'))!;
  const filters: SQL[] = [owned];
  if (query.rarity) filters.push(eq(items.tier, query.rarity));
  if (query.stattrak) filters.push(eq(items.stattrak, true));
  if (query.wear) {
    const [min, max] = wearRange(query.wear);
    filters.push(gte(items.float, min), lt(items.float, max));
  }
  if (query.crate) filters.push(eq(items.sourceCrateId, query.crate));
  const search = nameMatches(skins.name, query.q);
  if (search) filters.push(search);
  const where = and(...filters);

  // Vanilla knives (no float) go last when sorting by float.
  const order =
    query.sort === 'recent'
      ? [desc(items.obtainedAt), desc(items.id)]
      : query.sort === 'float'
        ? [sql`${items.float} ASC NULLS LAST`, desc(items.obtainedAt)]
        : [desc(itemValueExpr()), desc(items.obtainedAt)];

  const database = db();
  const [rows, [matched], [totals], crateRows] = await Promise.all([
    selectItems(database).where(where).orderBy(...order).limit(PAGE_SIZE + 1).offset(query.offset),
    database.select({ n: count() }).from(items).innerJoin(skins, eq(skins.id, items.skinId)).where(where),
    database.select({ n: count(), value: sum(itemValueExpr()).mapWith(Number) }).from(items).where(owned),
    database
      .selectDistinct({ id: crates.id, name: crates.name })
      .from(items)
      .innerJoin(crates, eq(crates.id, items.sourceCrateId))
      .where(owned)
      .orderBy(asc(crates.name)),
  ]);

  return {
    items: rows.slice(0, PAGE_SIZE).map(toItem),
    matched: matched?.n ?? 0,
    hasMore: rows.length > PAGE_SIZE,
    totalCount: totals?.n ?? 0,
    totalValue: totals?.value ?? 0,
    crates: crateRows,
  };
}

