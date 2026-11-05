import { describe, expect, it } from 'vitest';
import { anchorAfterUse, dailyCrateId, freeCaseStack, freeStack } from '../../server/game/dailyCrate.js';
import {
  EXTRA_TEASERS_MAX,
  NEAR_MISS_PERCENT,
  RARE_SPECIAL_CARD,
  STRIP_LENGTH,
  STRIP_RESULT_INDEX,
  buildStrip,
  drawFloat,
  drawFromCrate,
  drawTier,
  type CrateContents,
  type DrawableSkin,
} from '../../server/game/draw.js';
import { DEFAULT_ECONOMY, TIERS } from '../../server/game/economy.js';
import { cryptoRng, type Rng } from '../../server/game/rng.js';
import { endAfterBid, marketFee, minNextBid, quickBids, sellerNet } from '../../server/game/market.js';
import { averageFloat, drawTradeUp, resultFloat, tradeUpChances } from '../../server/game/tradeup.js';
import { matchesTokens, searchTokens, suggestionRank } from '../../server/game/search.js';
import { recycleValue } from '../../server/game/value.js';
import { wearOf } from '../../server/game/wear.js';

const skin = (id: string, extra: Partial<DrawableSkin> = {}): DrawableSkin => ({
  id,
  minFloat: 0,
  maxFloat: 1,
  stattrakAvailable: true,
  ...extra,
});

const kilowattLike: CrateContents = {
  milspec: Array.from({ length: 7 }, (_, i) => skin(`m${i}`)),
  restricted: Array.from({ length: 5 }, (_, i) => skin(`r${i}`)),
  classified: Array.from({ length: 3 }, (_, i) => skin(`c${i}`)),
  covert: [skin('k0', { maxFloat: 0.8 }), skin('k1')],
  gold: [skin('vanilla', { minFloat: null, maxFloat: null }), skin('glove', { stattrakAvailable: false })],
};

/** Rng that replays fixed values, to test boundaries exactly. */
function scripted(ints: number[], units: number[] = []): Rng {
  return {
    int: (max) => {
      const v = ints.shift();
      if (v === undefined || v >= max) throw new Error(`scripted int ${v} out of [0, ${max})`);
      return v;
    },
    unit: () => units.shift() ?? 0,
  };
}

describe('rng', () => {
  it('unit() stays in [0, 1)', () => {
    for (let i = 0; i < 100_000; i++) {
      const u = cryptoRng.unit();
      expect(u >= 0 && u < 1).toBe(true);
    }
  });
});

describe('drawTier', () => {
  it('maps the 10 000 basis points to the five tiers in order', () => {
    expect(drawTier(kilowattLike, scripted([0]))).toBe('milspec');
    expect(drawTier(kilowattLike, scripted([7991]))).toBe('milspec');
    expect(drawTier(kilowattLike, scripted([7992]))).toBe('restricted');
    expect(drawTier(kilowattLike, scripted([9589]))).toBe('restricted');
    expect(drawTier(kilowattLike, scripted([9590]))).toBe('classified');
    expect(drawTier(kilowattLike, scripted([9910]))).toBe('covert');
    expect(drawTier(kilowattLike, scripted([9974]))).toBe('gold');
    expect(drawTier(kilowattLike, scripted([9999]))).toBe('gold');
  });

  it('renormalises when a tier is empty', () => {
    const noGold = { ...kilowattLike, gold: [] };
    // Without gold only 9 974 points remain, so 9 974 is out of range and 9 973 is covert.
    expect(() => drawTier(noGold, scripted([9974]))).toThrow();
    expect(drawTier(noGold, scripted([9973]))).toBe('covert');
  });

  it('matches the odds over 1M crypto draws (within 5 standard deviations)', () => {
    const n = 1_000_000;
    const counts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<string, number>;
    for (let i = 0; i < n; i++) counts[drawTier(kilowattLike, cryptoRng)]!++;
    for (const tier of TIERS) {
      const p = DEFAULT_ECONOMY.oddsBp[tier] / 10_000;
      const sd = Math.sqrt(n * p * (1 - p));
      expect(Math.abs(counts[tier]! - n * p)).toBeLessThan(5 * sd);
    }
  });
});

describe('drawFloat', () => {
  it('never exceeds max_float', () => {
    const capped = skin('x', { minFloat: 0, maxFloat: 0.8 });
    expect(drawFloat(capped, scripted([], [0.999999999999]))).toBeLessThan(0.8);
    for (let i = 0; i < 50_000; i++) {
      const f = drawFloat(capped, cryptoRng)!;
      expect(f >= 0 && f < 0.8).toBe(true);
    }
  });

  it('respects min_float', () => {
    expect(drawFloat(skin('x', { minFloat: 0.06, maxFloat: 0.8 }), scripted([], [0]))).toBe(0.06);
  });

  it('is null for vanilla knives', () => {
    expect(drawFloat(kilowattLike.gold[0]!, cryptoRng)).toBeNull();
  });
});

describe('drawFromCrate', () => {
  it('draws tier, then skin, then float, pattern and StatTrak', () => {
    // tier roll 9910 → covert ; skin index 0 ; float 0.5 of [0, 0.8] ; pattern 412 ; StatTrak roll 0 → yes
    const result = drawFromCrate(kilowattLike, scripted([9910, 0, 412, 0], [0.5]));
    expect(result).toEqual({ skinId: 'k0', tier: 'covert', float: 0.4, pattern: 412, stattrak: true });
  });

  it('never makes gloves StatTrak', () => {
    const onlyGloves: CrateContents = { milspec: [], restricted: [], classified: [], covert: [], gold: [kilowattLike.gold[1]!] };
    for (let i = 0; i < 2_000; i++) expect(drawFromCrate(onlyGloves, cryptoRng).stattrak).toBe(false);
  });

  it('gives StatTrak about 1 time in 10', () => {
    let st = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) if (drawFromCrate(kilowattLike, cryptoRng).stattrak) st++;
    expect(Math.abs(st / n - 0.1)).toBeLessThan(0.005);
  });

  it('draws patterns in 0..999', () => {
    for (let i = 0; i < 20_000; i++) {
      const { pattern } = drawFromCrate(kilowattLike, cryptoRng);
      expect(Number.isInteger(pattern) && pattern >= 0 && pattern <= 999).toBe(true);
    }
  });
});

describe('buildStrip', () => {
  const classified = { skinId: 'c1', tier: 'classified', float: 0.1, pattern: 1, stattrak: false } as const;

  it('always puts the result at index 40', () => {
    for (let i = 0; i < 2000; i++) {
      const strip = buildStrip(kilowattLike, classified, cryptoRng);
      expect(strip).toHaveLength(STRIP_LENGTH);
      expect(strip[STRIP_RESULT_INDEX]).toBe('c1');
    }
  });

  it('scatters a few ★ teasers, sometimes right next to the result, never predictably', () => {
    const n = 20_000;
    let nearMiss = 0;
    let after = 0;
    let none = 0;
    for (let i = 0; i < n; i++) {
      const strip = buildStrip(kilowattLike, classified, cryptoRng);
      const stars = strip.flatMap((card, index) => (card === RARE_SPECIAL_CARD ? [index] : []));
      expect(stars.length).toBeLessThanOrEqual(EXTRA_TEASERS_MAX + 1);
      expect(stars).not.toContain(STRIP_RESULT_INDEX);
      const near = stars.filter((index) => Math.abs(index - STRIP_RESULT_INDEX) <= 2);
      // Only the near-miss card can sit right beside the result, and never two cards away.
      expect(near.every((index) => Math.abs(index - STRIP_RESULT_INDEX) === 1)).toBe(true);
      expect(near.length).toBeLessThanOrEqual(1);
      if (near.length) nearMiss++;
      if (near[0] === STRIP_RESULT_INDEX + 1) after++;
      if (stars.length === 0) none++;
    }
    expect(Math.abs(nearMiss / n - NEAR_MISS_PERCENT / 100)).toBeLessThan(0.015);
    // Before or after the result, half and half.
    expect(Math.abs(after / nearMiss - 0.5)).toBeLessThan(0.03);
    expect(none).toBeGreaterThan(0);
  });

  it('can also show teasers when the result is the rare special item', () => {
    const strip = buildStrip(kilowattLike, { skinId: 'glove', tier: 'gold', float: 0.1, pattern: 1, stattrak: false }, cryptoRng);
    expect(strip[STRIP_RESULT_INDEX]).toBe('glove');
  });
});

describe('search words', () => {
  it('splits on spaces and ignores separators', () => {
    expect(searchTokens('  MP9 | Hyd ')).toEqual(['mp9', 'hyd']);
    expect(searchTokens('★ Karambit')).toEqual(['karambit']);
    expect(searchTokens('')).toEqual([]);
  });

  it('needs every word somewhere in the name', () => {
    expect(matchesTokens('MP9 | Hydra', ['mp9', 'hyd'])).toBe(true);
    expect(matchesTokens('MP9 | Hydra', ['hyd', 'mp9'])).toBe(true);
    expect(matchesTokens('MP9 | Hydra', ['mp9', 'ruby'])).toBe(false);
  });

  it('ranks the typed weapon first, then a finish that starts with a word', () => {
    expect(suggestionRank({ weaponName: 'MP9', finishName: 'Hydra' }, ['mp9'])).toBe(0);
    expect(suggestionRank({ weaponName: '★ Karambit', finishName: 'Doppler' }, ['karambit'])).toBe(0);
    expect(suggestionRank({ weaponName: 'AK-47', finishName: 'Hydra' }, ['hyd'])).toBe(1);
    expect(suggestionRank({ weaponName: 'AK-47', finishName: 'Redline' }, ['line'])).toBe(2);
  });
});

describe('wearOf', () => {
  it('uses the exact CS2 boundaries', () => {
    expect(wearOf(0)?.code).toBe('FN');
    expect(wearOf(0.0699999)?.code).toBe('FN');
    expect(wearOf(0.07)?.code).toBe('MW');
    expect(wearOf(0.15)?.code).toBe('FT');
    expect(wearOf(0.38)?.code).toBe('WW');
    expect(wearOf(0.45)?.code).toBe('BS');
    expect(wearOf(1)?.code).toBe('BS');
    expect(wearOf(null)).toBeNull();
  });
});

describe('recycleValue', () => {
  it('follows the economy grid', () => {
    expect(recycleValue({ tier: 'milspec', stattrak: false, float: 0.2 })).toBe(30);
    expect(recycleValue({ tier: 'milspec', stattrak: false, float: 0.01 })).toBe(45);
    expect(recycleValue({ tier: 'restricted', stattrak: true, float: 0.1876 })).toBe(240);
    expect(recycleValue({ tier: 'classified', stattrak: false, float: 0.4012 })).toBe(450);
    expect(recycleValue({ tier: 'covert', stattrak: true, float: 0.0934 })).toBe(6000);
    expect(recycleValue({ tier: 'gold', stattrak: false, float: 0.0213 })).toBe(15000);
    expect(recycleValue({ tier: 'gold', stattrak: false, float: 0.6 })).toBe(8000);
    expect(recycleValue({ tier: 'gold', stattrak: true, float: null })).toBe(20000);
  });
});

describe('daily crate', () => {
  const ids = ['crate-b', 'crate-a', 'crate-c'];

  const day = (n: number, hour = 0) => new Date(Date.UTC(1970, 0, 1 + n, hour));
  const all = (activeIds: string[], pick: string | null = null) => ({ allIds: ids, activeIds, pick });

  it('rotates once per UTC day over the sorted ids', () => {
    expect(dailyCrateId(all(ids), day(0))).toBe('crate-a');
    expect(dailyCrateId(all(ids), day(0, 23))).toBe('crate-a');
    expect(dailyCrateId(all(ids), day(1))).toBe('crate-b');
    expect(dailyCrateId(all(ids), day(3))).toBe('crate-a');
    expect(dailyCrateId({ allIds: [], activeIds: [], pick: null }, day(0))).toBeNull();
  });

  it('skips to the next active case, so turning another case off never moves today’s pick', () => {
    expect(dailyCrateId(all(['crate-a', 'crate-c']), day(1))).toBe('crate-c');
    expect(dailyCrateId(all(['crate-a', 'crate-c']), day(0))).toBe('crate-a');
    expect(dailyCrateId(all(['crate-a', 'crate-b']), day(0))).toBe('crate-a');
    expect(dailyCrateId(all([]), day(0))).toBeNull();
  });

  it('uses the staff pick while it is active', () => {
    expect(dailyCrateId(all(ids, 'crate-c'), day(0))).toBe('crate-c');
    expect(dailyCrateId(all(ids, 'crate-c'), day(1))).toBe('crate-c');
    expect(dailyCrateId(all(['crate-a', 'crate-b'], 'crate-c'), day(1))).toBe('crate-b');
  });

});

describe('free case stack', () => {
  const MIN = 60_000;
  const EVERY = 10 * MIN;
  const now = new Date('2026-10-20T12:00:00Z');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MIN);
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  it('is full with no anchor, empty right after the anchor, and fills one case every 10 minutes', () => {
    expect(freeStack(null, now, EVERY, 5)).toEqual({ count: 5, max: 5, nextAt: null });
    expect(freeStack(now, now, EVERY, 5)).toMatchObject({ count: 0, nextAt: new Date('2026-10-20T12:10:00Z') });
    expect(freeStack(ago(25), now, EVERY, 5)).toMatchObject({ count: 2, nextAt: new Date('2026-10-20T12:05:00Z') });
    expect(freeStack(ago(50), now, EVERY, 5)).toEqual({ count: 5, max: 5, nextAt: null });
    expect(freeStack(ago(600), now, EVERY, 5).count).toBe(5);
  });

  it('starts the timer when a case is taken from a full stack', () => {
    for (const anchor of [null, ago(50), ago(10_000)]) {
      const next = anchorAfterUse(anchor, now, EVERY, 5);
      expect(freeStack(next, now, EVERY, 5)).toMatchObject({ count: 4, nextAt: new Date('2026-10-20T12:10:00Z') });
    }
  });

  it('keeps the time already counted when a case is taken from a partial stack', () => {
    const next = anchorAfterUse(ago(25), now, EVERY, 5);
    const stack = freeStack(next, now, EVERY, 5);
    expect(stack.count).toBe(1);
    expect(iso(stack.nextAt)).toBe('2026-10-20T12:05:00.000Z');
  });

  it('empties after five cases in a row, then refuses', () => {
    let anchor: Date | null = null;
    for (let i = 4; i >= 0; i--) {
      anchor = anchorAfterUse(anchor, now, EVERY, 5);
      expect(freeStack(anchor, now, EVERY, 5).count).toBe(i);
    }
    expect(() => anchorAfterUse(anchor, now, EVERY, 5)).toThrow();
  });

  it('with a stack of one, behaves like the old single timer', () => {
    const next = anchorAfterUse(null, now, 4 * 60 * MIN, 1);
    expect(freeStack(next, now, 4 * 60 * MIN, 1)).toMatchObject({ count: 0, nextAt: new Date('2026-10-20T16:00:00Z') });
  });

  it('follows the economy in force (10 min, up to 5 by default)', () => {
    expect(DEFAULT_ECONOMY.freeCaseMinutes).toBe(10);
    expect(DEFAULT_ECONOMY.freeCaseMax).toBe(5);
    expect(freeCaseStack(ago(30), now)).toMatchObject({ count: 3, max: 5 });
  });
});

describe('market rules', () => {
  it('fee is 5 % rounded up, never on the buyer', () => {
    expect(marketFee(6500)).toBe(325);
    expect(sellerNet(6500)).toBe(6175);
    expect(marketFee(9000)).toBe(450);
    expect(marketFee(95)).toBe(5);
    expect(marketFee(1)).toBe(1);
    expect(sellerNet(1)).toBe(0);
  });

  it('next bid: starting price first, then +5 % rounded up', () => {
    expect(minNextBid(null, 2000)).toBe(2000);
    expect(minNextBid(3150, 2000)).toBe(3308);
    expect(minNextBid(1, 1)).toBe(2);
    expect(minNextBid(100, 1)).toBe(105);
    expect(quickBids(3150, 2000).map((q) => q.amount)).toEqual([3308, 3465, 3938]);
    expect(quickBids(null, 2000)).toEqual([
      { label: 'Start', amount: 2000 },
      { label: '+10%', amount: 2200 },
      { label: '+25%', amount: 2500 },
    ]);
  });

  it('a bid in the last 2 minutes adds 2 minutes', () => {
    const end = new Date('2026-10-21T12:00:00Z');
    expect(endAfterBid(end, new Date('2026-10-21T11:57:59Z'))).toEqual({ endsAt: end, extended: false });
    expect(endAfterBid(end, new Date('2026-10-21T11:58:00Z'))).toEqual({ endsAt: new Date('2026-10-21T12:02:00Z'), extended: true });
    expect(endAfterBid(end, new Date('2026-10-21T11:59:59Z')).endsAt).toEqual(new Date('2026-10-21T12:02:00Z'));
  });
});

describe('trade-up contracts', () => {
  const pools = new Map([
    ['K', [skin('k-r1'), skin('k-r2'), skin('k-r3', { minFloat: 0.1, maxFloat: 0.6 })]],
    ['R', [skin('r-r1'), skin('r-r2')]],
  ]);
  const inputs = [...Array.from({ length: 4 }, () => ({ collectionId: 'K', float: 0.2 })), ...Array.from({ length: 6 }, () => ({ collectionId: 'R', float: 0.3 }))];

  it('chances: (inputs of the collection / 10) / skins of the next rarity in it', () => {
    const chances = tradeUpChances(inputs, pools);
    expect(chances).toHaveLength(5);
    expect(chances.reduce((s, c) => s + c.probability, 0)).toBeCloseTo(1, 12);
    expect(chances.find((c) => c.skin.id === 'r-r1')!.probability).toBeCloseTo(0.3, 12);
    expect(chances.find((c) => c.skin.id === 'k-r1')!.probability).toBeCloseTo(0.4 / 3, 12);
  });

  it('float: min + average × (max − min)', () => {
    expect(averageFloat(inputs)).toBeCloseTo(0.26, 12);
    expect(resultFloat({ minFloat: 0.1, maxFloat: 0.6 }, 0.26)).toBeCloseTo(0.23, 12);
    expect(tradeUpChances(inputs, pools).find((c) => c.skin.id === 'k-r3')!.float).toBeCloseTo(0.23, 12);
  });

  it('the draw follows the chances', () => {
    const seen = new Map<string, number>();
    const runs = 60_000;
    for (let i = 0; i < runs; i++) {
      const { skin: s } = drawTradeUp(inputs, pools, cryptoRng);
      seen.set(s.id, (seen.get(s.id) ?? 0) + 1);
    }
    for (const c of tradeUpChances(inputs, pools)) expect((seen.get(c.skin.id) ?? 0) / runs).toBeCloseTo(c.probability, 1);
  });
});
