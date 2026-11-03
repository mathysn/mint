import { sql, type SQL } from 'drizzle-orm';
import { econ, NO_WEAR_MULTIPLIER, TIERS, type Tier } from './economy.js';
import { WEARS, wearOf } from './wear.js';

export interface ValuedItem {
  tier: Tier;
  stattrak: boolean;
  float: number | null;
}

/** Wear multiplier on recycle value (economy setting), 1 for vanilla knives. */
export function wearMultiplier(float: number | null): number {
  const wear = wearOf(float);
  return wear ? econ().wearMultipliers[WEARS.indexOf(wear)]! : NO_WEAR_MULTIPLIER;
}

/** Recycle value (what recycling pays): tier value × StatTrak × wear. */
export function recycleValue(item: ValuedItem): number {
  const e = econ();
  return Math.round(e.recycle[item.tier] * (item.stattrak ? e.stattrakMultiplier : 1) * wearMultiplier(item.float));
}

const column = (table: string) => (name: string) => `"${table}"."${name}"`;

/**
 * Same formula as recycleValue, as a SQL expression over a table aliased `table`
 * (columns tier, stattrak, float). Built from the economy in force at each call, never from input.
 */
export function recycleValueSql(table = 'items'): SQL<number> {
  return sql<number>`${sql.raw(recycleRaw(table))}`;
}

function recycleRaw(table: string): string {
  const col = column(table);
  const e = econ();
  const num = (n: number) => String(Number(n));
  const tierCase = `CASE ${col('tier')} ${TIERS.map((t) => `WHEN '${t}' THEN ${num(e.recycle[t])}`).join(' ')} END`;
  const stattrakCase = `CASE WHEN ${col('stattrak')} THEN ${num(e.stattrakMultiplier)} ELSE 1 END`;
  const wearCase =
    `CASE WHEN ${col('float')} IS NULL THEN ${NO_WEAR_MULTIPLIER} ` +
    WEARS.map((w, i) =>
      Number.isFinite(w.below) ? `WHEN ${col('float')} < ${w.below} THEN ${num(e.wearMultipliers[i]!)}` : `ELSE ${num(e.wearMultipliers[i]!)}`,
    ).join(' ') +
    ' END';
  return `ROUND((${tierCase}) * (${stattrakCase}) * (${wearCase}))::int`;
}

/** Wear code of a float column, as the `wear` enum (NULL for vanilla knives). */
export function wearSql(table = 'items'): string {
  const col = column(table);
  return (
    `CASE WHEN ${col('float')} IS NULL THEN NULL ` +
    WEARS.map((w) => (Number.isFinite(w.below) ? `WHEN ${col('float')} < ${w.below} THEN '${w.code}'::wear` : `ELSE '${w.code}'::wear`)).join(' ') +
    ' END'
  );
}

/**
 * Displayed value of an item: its market price (average of the last sales of the same skin,
 * StatTrak and wear, kept in `market_prices`), or its recycle value if it has never sold.
 * Sorting, totals, trades and the leaderboard all use it; recycling always pays recycleValue.
 */
export function marketValueSql(table = 'items'): SQL<number> {
  const col = column(table);
  const price =
    `(SELECT mp.avg_price FROM market_prices mp WHERE mp.skin_id = ${col('skin_id')} ` +
    `AND mp.stattrak = ${col('stattrak')} AND mp.wear IS NOT DISTINCT FROM (${wearSql(table)}))`;
  return sql<number>`${sql.raw(`COALESCE(${price}, ${recycleRaw(table)})::int`)}`;
}
