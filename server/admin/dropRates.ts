import type { Tier } from '../../shared/api.js';
import { econ, TIERS } from '../game/economy.js';

const NAMES: Record<Tier, string> = { milspec: 'Mil-Spec', restricted: 'Restricted', classified: 'Classified', covert: 'Covert', gold: '★ Rare special' };
/** Beyond 3 standard deviations, a rarity is "outside normal variance" for the sample. */
const Z_LIMIT = 3;

export interface DropRow {
  tier: Tier;
  setPct: number;
  actualPct: number;
  ratio: number;
}

/**
 * Configured vs observed drop rates over `sample` openings. A tier is suspicious when its count is
 * more than 3 standard deviations away from what the odds give (binomial: √(n·p·(1−p))).
 */
export function dropRates(counts: Partial<Record<Tier, number>>, sample: number): { rows: DropRow[]; normal: boolean; verdict: string } {
  const rows = TIERS.map((tier) => {
    const p = econ().oddsBp[tier] / 10_000;
    const k = counts[tier] ?? 0;
    const actual = sample ? k / sample : 0;
    return { tier, setPct: p * 100, actualPct: Math.round(actual * 10_000) / 100, ratio: p && sample ? actual / p : 0, z: sample ? (k - sample * p) / Math.sqrt(sample * p * (1 - p)) : 0 };
  });
  const off = rows.filter((r) => Math.abs(r.z) > Z_LIMIT).map((r) => NAMES[r.tier]);
  const verdict = !sample
    ? 'No openings yet.'
    : off.length === 0
      ? 'Every rarity is within normal variance for this sample size.'
      : `${off.join(', ')} ${off.length === 1 ? 'is' : 'are'} outside normal variance for this sample size.`;
  return { rows: rows.map(({ z: _z, ...r }) => r), normal: off.length === 0, verdict };
}
