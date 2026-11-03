import { eq, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Item } from '../../shared/api.js';
import type { DbOrTx } from '../db/client.js';
import { crates, items, skins } from '../db/schema.js';
import { RECYCLE_CONFIRM_TIERS } from '../game/economy.js';
import { marketValueSql, recycleValueSql } from '../game/value.js';
import { wearOf } from '../game/wear.js';
import { skinCard } from './catalog.js';

export const sourceCrate = alias(crates, 'source_crate');

/** Displayed value (market price, else recycle value) and what recycling pays. */
export const itemValueExpr = () => marketValueSql('items');
export const recycleValueExpr = () => recycleValueSql('items');

/** Base query for item lists: item + skin + source case + server-computed values. */
export function selectItems(tx: DbOrTx) {
  return tx
    .select({ item: items, skin: skins, crateId: sourceCrate.id, crateName: sourceCrate.name, value: itemValueExpr(), recycleValue: recycleValueExpr() })
    .from(items)
    .innerJoin(skins, eq(skins.id, items.skinId))
    .leftJoin(sourceCrate, eq(sourceCrate.id, items.sourceCrateId));
}

type ItemRow = Awaited<ReturnType<ReturnType<typeof selectItems>['where']>>[number];

export function toItem(row: ItemRow): Item {
  const wear = wearOf(row.item.float);
  return {
    id: row.item.id,
    skin: skinCard(row.skin, row.item.tier),
    float: row.item.float,
    minFloat: row.skin.minFloat,
    maxFloat: row.skin.maxFloat,
    wear: wear ? { code: wear.code, name: wear.name } : null,
    pattern: row.item.pattern,
    stattrak: row.item.stattrak,
    status: row.item.status,
    value: row.value,
    recycleValue: row.recycleValue,
    recycleConfirm: RECYCLE_CONFIRM_TIERS.includes(row.item.tier),
    obtainedAt: row.item.obtainedAt.toISOString(),
    crate: row.crateId && row.crateName ? { id: row.crateId, name: row.crateName } : null,
  };
}

export async function findItems(tx: DbOrTx, where: SQL | undefined): Promise<Item[]> {
  const rows = await selectItems(tx).where(where);
  return rows.map(toItem);
}
