import type { DrawableSkin } from './draw.js';
import type { Rng } from './rng.js';

export interface TradeUpInput {
  collectionId: string;
  float: number;
}

/** Next-rarity skins of each collection (a collection = the content of its case). */
export type TradeUpPools = Map<string, DrawableSkin[]>;

export interface TradeUpChance {
  skin: DrawableSkin;
  collectionId: string;
  /** In [0, 1]; all chances add up to 1. */
  probability: number;
  float: number;
}

export const averageFloat = (inputs: TradeUpInput[]) => inputs.reduce((sum, i) => sum + i.float, 0) / inputs.length;

/** Float of the result: the average of the inputs brought into the new skin's range (DESIGN.md §5). */
export const resultFloat = (skin: Pick<DrawableSkin, 'minFloat' | 'maxFloat'>, average: number) =>
  (skin.minFloat ?? 0) + average * ((skin.maxFloat ?? 1) - (skin.minFloat ?? 0));

/**
 * Every possible result: a collection weighs (its inputs / all inputs), split evenly between its
 * next-rarity skins — (n / 10) / skins of the next rarity, as in DESIGN.md.
 */
export function tradeUpChances(inputs: TradeUpInput[], pools: TradeUpPools): TradeUpChance[] {
  if (!inputs.length) return [];
  const average = averageFloat(inputs);
  const counts = new Map<string, number>();
  for (const input of inputs) counts.set(input.collectionId, (counts.get(input.collectionId) ?? 0) + 1);
  const chances: TradeUpChance[] = [];
  for (const [collectionId, n] of counts) {
    const pool = pools.get(collectionId) ?? [];
    for (const skin of pool) chances.push({ skin, collectionId, probability: n / inputs.length / pool.length, float: resultFloat(skin, average) });
  }
  return chances.sort((a, b) => b.probability - a.probability || a.skin.id.localeCompare(b.skin.id));
}

/** The draw: one of the inputs at random gives the collection, then a skin of it uniformly. Same odds as above. */
export function drawTradeUp(inputs: TradeUpInput[], pools: TradeUpPools, rng: Rng): { skin: DrawableSkin; collectionId: string; float: number } {
  const picked = inputs[rng.int(inputs.length)]!;
  const pool = pools.get(picked.collectionId)!;
  const skin = pool[rng.int(pool.length)]!;
  return { skin, collectionId: picked.collectionId, float: resultFloat(skin, averageFloat(inputs)) };
}
