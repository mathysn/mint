// Average return of a case if the player recycles everything they open (admin › Economy). Exact,
// not estimated: odds × recycle value × the expected wear multiplier of each skin's float range
// (floats are uniform in [min, max)) × the expected StatTrak™ factor.
import { TIERS, type Economy, type Tier } from './economy.js';
import { WEARS } from './wear.js';

export interface SimSkin {
  minFloat: number | null;
  maxFloat: number | null;
  stattrakAvailable: boolean;
}

export type SimCrate = Record<Tier, SimSkin[]>;

/** Expected wear multiplier of a float drawn uniformly in [min, max); 1 for vanilla knives. */
export function expectedWear(skin: Pick<SimSkin, 'minFloat' | 'maxFloat'>, e: Economy): number {
  if (skin.minFloat === null || skin.maxFloat === null) return 1;
  const lo = skin.minFloat;
  const hi = skin.maxFloat;
  let from = 0;
  if (hi <= lo) {
    const i = WEARS.findIndex((w) => lo < w.below);
    return e.wearMultipliers[i < 0 ? WEARS.length - 1 : i]!;
  }
  let total = 0;
  WEARS.forEach((w, i) => {
    const to = Number.isFinite(w.below) ? w.below : Infinity;
    const overlap = Math.max(0, Math.min(hi, to) - Math.max(lo, from));
    total += overlap * e.wearMultipliers[i]!;
    from = to;
  });
  return total / (hi - lo);
}

/** Expected value of one opening of this case, recycled. */
export function caseReturn(crate: SimCrate, e: Economy): number {
  const present = TIERS.filter((t) => crate[t].length > 0 && e.oddsBp[t] > 0);
  const total = present.reduce((s, t) => s + e.oddsBp[t], 0);
  if (!total) return 0;
  let value = 0;
  for (const tier of present) {
    const skins = crate[tier];
    const avg =
      skins.reduce((s, skin) => {
        const st = skin.stattrakAvailable ? 1 + (e.stattrakMultiplier - 1) / e.stattrakOneIn : 1;
        return s + e.recycle[tier] * expectedWear(skin, e) * st;
      }, 0) / skins.length;
    value += (e.oddsBp[tier] / total) * avg;
  }
  return value;
}

export interface Simulation {
  /** Average over the active cases, in CR. */
  average: number;
  /** Share of the case price that comes back, 0–1. */
  share: number;
  price: number;
  min: number;
  max: number;
}

export function simulate(crates: SimCrate[], e: Economy): Simulation {
  const returns = crates.map((c) => caseReturn(c, e));
  const average = returns.length ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  return {
    average,
    share: e.casePrice ? average / e.casePrice : 0,
    price: e.casePrice,
    min: returns.length ? Math.min(...returns) : 0,
    max: returns.length ? Math.max(...returns) : 0,
  };
}
