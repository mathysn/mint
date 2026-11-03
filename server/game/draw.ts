import { econ, PATTERN_COUNT, TIERS, type Tier } from './economy.js';
import type { Rng } from './rng.js';

export interface DrawableSkin {
  id: string;
  minFloat: number | null;
  maxFloat: number | null;
  stattrakAvailable: boolean;
}

export type CrateContents = Record<Tier, DrawableSkin[]>;

export interface DrawResult {
  skinId: string;
  tier: Tier;
  float: number | null;
  pattern: number;
  stattrak: boolean;
}

/** Rarity first, with the shared odds. A tier missing from a crate is skipped and the others renormalised. */
export function drawTier(contents: CrateContents, rng: Rng): Tier {
  const available = TIERS.filter((tier) => contents[tier].length > 0);
  if (available.length === 0) throw new Error('Crate has no skins');
  const odds = econ().oddsBp;
  const weighted = available.filter((tier) => odds[tier] > 0);
  const pool = weighted.length ? weighted : available;
  const total = pool.reduce((sum, tier) => sum + (weighted.length ? odds[tier] : 1), 0);
  let roll = rng.int(total);
  for (const tier of pool) {
    roll -= weighted.length ? odds[tier] : 1;
    if (roll < 0) return tier;
  }
  return pool[pool.length - 1]!;
}

/** Uniform in [min, max) — never above the skin's max_float. Null for vanilla knives. */
export function drawFloat(skin: DrawableSkin, rng: Rng): number | null {
  if (skin.minFloat === null || skin.maxFloat === null) return null;
  return skin.minFloat + rng.unit() * (skin.maxFloat - skin.minFloat);
}

/** Full draw of one opening: rarity → skin (uniform within the rarity) → float → pattern → StatTrak. */
export function drawFromCrate(contents: CrateContents, rng: Rng): DrawResult {
  const tier = drawTier(contents, rng);
  const pool = contents[tier];
  const skin = pool[rng.int(pool.length)]!;
  return {
    skinId: skin.id,
    tier,
    float: drawFloat(skin, rng),
    pattern: rng.int(PATTERN_COUNT),
    stattrak: skin.stattrakAvailable && rng.int(econ().stattrakOneIn) === 0,
  };
}

export const STRIP_LENGTH = 48;
export const STRIP_RESULT_INDEX = 40;
/** Marker for the generic "★ Rare special" teaser card (DESIGN.md §5). */
export const RARE_SPECIAL_CARD = '*';
/** Chance (in %) that a ★ teaser lands right next to the result, before or after it. */
export const NEAR_MISS_PERCENT = 20;
/** Other ★ teasers per strip: 0 to this many, spread over the strip away from the result. */
export const EXTRA_TEASERS_MAX = 2;
const EXTRA_TEASER_FROM = 6;
const RESULT_CLEARANCE = 2;

// Decorative mix of the filler cards (same as the mockup): mostly blue, a bit of everything else.
const FILLER_MIX: [Tier, number][] = [
  ['milspec', 70],
  ['restricted', 17],
  ['classified', 8],
  ['covert', 5],
];

/** Where the ★ teasers go: sometimes right beside the result, a few elsewhere, never predictable. */
function teaserSlots(rng: Rng): Set<number> {
  const slots = new Set<number>();
  if (rng.int(100) < NEAR_MISS_PERCENT) slots.add(STRIP_RESULT_INDEX + (rng.int(2) === 0 ? -1 : 1));
  const free: number[] = [];
  for (let i = EXTRA_TEASER_FROM; i < STRIP_LENGTH; i++) {
    if (Math.abs(i - STRIP_RESULT_INDEX) > RESULT_CLEARANCE) free.push(i);
  }
  for (let n = rng.int(EXTRA_TEASERS_MAX + 1); n > 0; n--) {
    const [slot] = free.splice(rng.int(free.length), 1);
    slots.add(slot!);
  }
  return slots;
}

/** The roulette strip, built by the server: filler cards, a few ★ teasers, the result at index 40. */
export function buildStrip(contents: CrateContents, result: DrawResult, rng: Rng): string[] {
  const fillers = FILLER_MIX.filter(([tier]) => contents[tier].length > 0);
  const fillerTotal = fillers.reduce((sum, [, weight]) => sum + weight, 0);
  const teasers = teaserSlots(rng);
  const strip: string[] = [];
  for (let i = 0; i < STRIP_LENGTH; i++) {
    if (i === STRIP_RESULT_INDEX) {
      strip.push(result.skinId);
    } else if (teasers.has(i)) {
      strip.push(RARE_SPECIAL_CARD);
    } else {
      let roll = rng.int(fillerTotal);
      const [tier] = fillers.find(([, weight]) => (roll -= weight) < 0) ?? fillers[0]!;
      const pool = contents[tier];
      strip.push(pool[rng.int(pool.length)]!.id);
    }
  }
  return strip;
}
