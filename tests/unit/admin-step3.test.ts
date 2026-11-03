import { describe, expect, it } from 'vitest';
import { DEFAULT_ECONOMY, type Economy } from '../../server/game/economy.js';
import { changeText, economyFrom, formatSetting, oddsTotalBp, parseSetting, SETTING_BY_KEY } from '../../server/game/economySettings.js';
import { caseReturn, expectedWear, simulate, type SimCrate } from '../../server/game/simulator.js';

const def = (key: string) => SETTING_BY_KEY.get(key)!;
const empty = (): SimCrate => ({ milspec: [], restricted: [], classified: [], covert: [], gold: [] });
const fullRange = { minFloat: 0, maxFloat: 1, stattrakAvailable: true };

describe('simulator', () => {
  it('averages the wear multiplier over the float range', () => {
    // FN 0.07 × 1.5 + MW 0.08 × 1.2 + FT 0.23 × 1 + WW 0.07 × 0.9 + BS 0.55 × 0.8
    expect(expectedWear(fullRange, DEFAULT_ECONOMY)).toBeCloseTo(0.934, 6);
    expect(expectedWear({ minFloat: 0, maxFloat: 0.07 }, DEFAULT_ECONOMY)).toBeCloseTo(1.5, 6);
    expect(expectedWear({ minFloat: 0.1, maxFloat: 0.2 }, DEFAULT_ECONOMY)).toBeCloseTo((0.05 * 1.2 + 0.05 * 1) / 0.1, 6);
    expect(expectedWear({ minFloat: null, maxFloat: null }, DEFAULT_ECONOMY)).toBe(1);
  });

  it('computes the exact return of a case: odds × recycle × wear × StatTrak™', () => {
    const e: Economy = { ...DEFAULT_ECONOMY, oddsBp: { milspec: 10_000, restricted: 0, classified: 0, covert: 0, gold: 0 } };
    const crate = empty();
    crate.milspec.push(fullRange);
    // 30 CR × 0.934 × (1 + (2 − 1) / 10)
    expect(caseReturn(crate, e)).toBeCloseTo(30 * 0.934 * 1.1, 6);
    crate.milspec.push({ minFloat: null, maxFloat: null, stattrakAvailable: false });
    expect(caseReturn(crate, e)).toBeCloseTo((30 * 0.934 * 1.1 + 30) / 2, 6);
  });

  it('renormalises the odds over the tiers a case has', () => {
    const crate = empty();
    crate.milspec.push({ minFloat: null, maxFloat: null, stattrakAvailable: false });
    crate.covert.push({ minFloat: null, maxFloat: null, stattrakAvailable: false });
    const e = DEFAULT_ECONOMY;
    const total = e.oddsBp.milspec + e.oddsBp.covert;
    expect(caseReturn(crate, e)).toBeCloseTo((e.oddsBp.milspec / total) * 30 + (e.oddsBp.covert / total) * 2500, 6);
  });

  it('gives the average, range and share of the case price', () => {
    const a = empty();
    a.milspec.push({ minFloat: null, maxFloat: null, stattrakAvailable: false });
    const b = empty();
    b.restricted.push({ minFloat: null, maxFloat: null, stattrakAvailable: false });
    const sim = simulate([a, b], DEFAULT_ECONOMY);
    expect(sim).toMatchObject({ average: 75, min: 30, max: 120, price: 250 });
    expect(sim.share).toBeCloseTo(0.3, 6);
  });
});

describe('economy settings', () => {
  it('parses what staff type, and explains what it refuses', () => {
    expect(parseSetting(def('cases.price'), '300')).toEqual({ value: 300 });
    expect(parseSetting(def('cases.price'), '1,500')).toEqual({ value: 1500 });
    expect(parseSetting(def('cases.price'), 'abc')).toEqual({ error: 'Type a number.' });
    expect(parseSetting(def('cases.price'), '12.5')).toEqual({ error: 'Use a whole number.' });
    expect(parseSetting(def('cases.price'), '0')).toMatchObject({ error: expect.stringContaining('Goes from 1') });
    expect(parseSetting(def('odds.milspec'), '79.92')).toEqual({ value: 79.92 });
    expect(parseSetting(def('odds.milspec'), '79.925')).toEqual({ error: 'Use at most 2 decimals.' });
    expect(parseSetting(def('recycle.wear'), '1.5·1.2·1·0.9')).toEqual({ error: 'Give 5 values.' });
    expect(parseSetting(def('recycle.wear'), '1.5 · 1.25 · 1 · 0.9 · 0.85')).toEqual({ value: [1.5, 1.25, 1, 0.9, 0.85] });
    expect(parseSetting(def('market.durations'), '48·24·24')).toEqual({ value: [24, 48] });
    expect(parseSetting(def('trades.expiry'), '1·2.5')).toEqual({ error: 'Use whole numbers.' });
  });

  it('writes the saved rows over the defaults, and formats the changes', () => {
    const e = economyFrom([
      { key: 'cases.price', value: 300 },
      { key: 'odds.gold', value: 0.3 },
      { key: 'market.fee', value: 6 },
      { key: 'unknown.key', value: 1 },
    ]);
    expect(e.casePrice).toBe(300);
    expect(e.oddsBp.gold).toBe(30);
    expect(e.marketFeeBp).toBe(600);
    expect(oddsTotalBp(e)).toBe(10_004);
    expect(oddsTotalBp(DEFAULT_ECONOMY)).toBe(10_000);
    expect(changeText(def('cases.price'), 250, 300)).toBe('250 → 300 CR');
    expect(formatSetting(def('odds.milspec'), 79.92)).toBe('79.92');
    expect(formatSetting(def('recycle.wear'), [1.5, 1.2, 1, 0.9, 0.8])).toBe('1.5·1.2·1·0.9·0.8');
  });
});
