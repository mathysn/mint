// The economy settings staff can edit (design/Admin-Economy.dc.html): keys, labels, units, how a
// value is read from / written to `Economy`, and validation. Pure: no database here.
import { DEFAULT_ECONOMY, TIERS, type Economy, type Tier } from './economy.js';

export type SettingValue = number | number[];

export interface SettingDef {
  key: string;
  group: 'cases' | 'rarity' | 'stattrak' | 'market' | 'trades';
  label: string;
  help: string;
  unit: string;
  /** Decimals shown; lists are shown joined by "·". */
  decimals: number;
  list?: { length?: number; min: number; max: number };
  /** Only these values are allowed (a single number). */
  choices?: readonly number[];
  min: number;
  max: number;
  tier?: Tier;
  read: (e: Economy) => SettingValue;
  write: (e: Economy, v: SettingValue) => Economy;
}

/** Rotation lengths that divide a day, so every slot starts on the same UTC hours each day. */
export const CASE_ROTATION_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

const TIER_LABEL: Record<Tier, string> = { milspec: 'Mil-Spec', restricted: 'Restricted', classified: 'Classified', covert: 'Covert', gold: '★ Rare special' };

const n = (v: SettingValue) => v as number;
const list = (v: SettingValue) => v as number[];

export const SETTINGS: SettingDef[] = [
  { key: 'cases.price', group: 'cases', label: 'Case price', help: 'What one case costs.', unit: 'CR', decimals: 0, min: 1, max: 1_000_000, read: (e) => e.casePrice, write: (e, v) => ({ ...e, casePrice: n(v) }) },
  { key: 'start.balance', group: 'cases', label: 'Starting balance', help: 'Credits a new player gets.', unit: 'CR', decimals: 0, min: 0, max: 1_000_000, read: (e) => e.startingBalance, write: (e, v) => ({ ...e, startingBalance: n(v) }) },
  // New keys (the old `free_case.every` was in hours): a value saved in hours is never read as minutes.
  { key: 'free_case.every_min', group: 'cases', label: 'Free case every', help: 'Time for the stack to gain one free case.', unit: 'min', decimals: 0, min: 1, max: 10_080, read: (e) => e.freeCaseMinutes, write: (e, v) => ({ ...e, freeCaseMinutes: n(v) }) },
  { key: 'free_case.max', group: 'cases', label: 'Free case stack', help: 'Free cases a player can save up.', unit: 'max', decimals: 0, min: 1, max: 50, read: (e) => e.freeCaseMax, write: (e, v) => ({ ...e, freeCaseMax: n(v) }) },
  // Divisors of 24 only, so the rotation always restarts at 00:00 UTC (game/dailyCrate.ts).
  { key: 'case_of_day.every_h', group: 'cases', label: 'Case of the day every', help: 'Time before the free case moves to the next case. 1, 2, 3, 4, 6, 8, 12 or 24.', unit: 'h', decimals: 0, min: 1, max: 24, choices: CASE_ROTATION_HOURS, read: (e) => e.caseRotationHours, write: (e, v) => ({ ...e, caseRotationHours: n(v) }) },
  ...TIERS.map(
    (tier): SettingDef => ({
      key: `odds.${tier}`,
      group: 'rarity',
      label: TIER_LABEL[tier],
      help: 'Chance per opening.',
      unit: '%',
      decimals: 2,
      min: 0,
      max: 100,
      tier,
      read: (e) => e.oddsBp[tier] / 100,
      write: (e, v) => ({ ...e, oddsBp: { ...e.oddsBp, [tier]: Math.round(n(v) * 100) } }),
    }),
  ),
  ...TIERS.map(
    (tier): SettingDef => ({
      key: `recycle.${tier}`,
      group: 'rarity',
      label: TIER_LABEL[tier],
      help: 'Recycle value.',
      unit: 'CR',
      decimals: 0,
      min: 0,
      max: 10_000_000,
      tier,
      read: (e) => e.recycle[tier],
      write: (e, v) => ({ ...e, recycle: { ...e.recycle, [tier]: n(v) } }),
    }),
  ),
  { key: 'stattrak.chance', group: 'stattrak', label: 'StatTrak™ chance', help: '1 item in N opened is StatTrak™.', unit: 'N', decimals: 0, min: 1, max: 1000, read: (e) => e.stattrakOneIn, write: (e, v) => ({ ...e, stattrakOneIn: n(v) }) },
  { key: 'stattrak.value', group: 'stattrak', label: 'StatTrak™ value', help: 'Multiplier on market and recycle value.', unit: '×', decimals: 1, min: 1, max: 10, read: (e) => e.stattrakMultiplier, write: (e, v) => ({ ...e, stattrakMultiplier: n(v) }) },
  {
    key: 'recycle.wear',
    group: 'stattrak',
    label: 'Wear multipliers',
    help: 'On recycle value, FN · MW · FT · WW · BS.',
    unit: '×',
    decimals: 2,
    list: { length: 5, min: 0.01, max: 10 },
    min: 0.01,
    max: 10,
    read: (e) => [...e.wearMultipliers],
    write: (e, v) => ({ ...e, wearMultipliers: list(v) as Economy['wearMultipliers'] }),
  },
  { key: 'market.fee', group: 'market', label: 'Sale fee', help: 'Taken from the seller when an auction ends.', unit: '%', decimals: 0, min: 0, max: 50, read: (e) => e.marketFeeBp / 100, write: (e, v) => ({ ...e, marketFeeBp: Math.round(n(v) * 100) }) },
  { key: 'market.min_raise', group: 'market', label: 'Minimum raise', help: 'Each bid beats the last one by at least this.', unit: '%', decimals: 0, min: 1, max: 100, read: (e) => e.bidStepBp / 100, write: (e, v) => ({ ...e, bidStepBp: Math.round(n(v) * 100) }) },
  { key: 'market.anti_sniping', group: 'market', label: 'Anti-sniping', help: 'A late bid extends the auction by this.', unit: 'min', decimals: 0, min: 0, max: 60, read: (e) => e.antiSnipeMinutes, write: (e, v) => ({ ...e, antiSnipeMinutes: n(v) }) },
  { key: 'market.listings', group: 'market', label: 'Active listings', help: 'Per player.', unit: 'max', decimals: 0, min: 1, max: 100, read: (e) => e.maxListings, write: (e, v) => ({ ...e, maxListings: n(v) }) },
  { key: 'market.durations', group: 'market', label: 'Durations', help: 'Choices when listing.', unit: 'h', decimals: 0, list: { min: 1, max: 168 }, min: 1, max: 168, read: (e) => [...e.durationsH], write: (e, v) => ({ ...e, durationsH: list(v) }) },
  { key: 'market.max_price', group: 'market', label: 'Max price', help: 'Highest start or buy-now price.', unit: 'CR', decimals: 0, min: 1, max: 1_000_000_000, read: (e) => e.maxPrice, write: (e, v) => ({ ...e, maxPrice: n(v) }) },
  { key: 'trades.expiry', group: 'trades', label: 'Offer expiry', help: 'Choices when sending an offer.', unit: 'days', decimals: 0, list: { min: 1, max: 30 }, min: 1, max: 30, read: (e) => [...e.tradeExpiryDays], write: (e, v) => ({ ...e, tradeExpiryDays: list(v) }) },
  { key: 'trades.items', group: 'trades', label: 'Items per side', help: 'In one offer.', unit: 'max', decimals: 0, min: 1, max: 100, read: (e) => e.tradeMaxItems, write: (e, v) => ({ ...e, tradeMaxItems: n(v) }) },
  { key: 'trades.pending', group: 'trades', label: 'Pending offers', help: 'Per player at once.', unit: 'max', decimals: 0, min: 1, max: 100, read: (e) => e.tradeMaxPending, write: (e, v) => ({ ...e, tradeMaxPending: n(v) }) },
  { key: 'tradeup.items', group: 'trades', label: 'Trade-up contract', help: 'Items it takes.', unit: 'items', decimals: 0, min: 2, max: 20, read: (e) => e.tradeupSize, write: (e, v) => ({ ...e, tradeupSize: n(v) }) },
];

export const SETTING_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

/** Group headings; the admin screen adds the HUD "// " prefix itself. */
export const GROUP_TITLE: Record<SettingDef['group'], string> = {
  cases: 'Cases',
  rarity: 'Odds and recycle',
  stattrak: 'StatTrak™ and wear',
  market: 'Market',
  trades: 'Trades and trade-up',
};

/** Label used in diffs and the history ("Odds Mil-Spec", "Recycle Covert", "Case price"). */
export const longLabel = (def: SettingDef) => (def.group === 'rarity' ? `${def.key.startsWith('odds.') ? 'Odds' : 'Recycle'} ${def.label}` : def.label);

const fmtNumber = (v: number, decimals: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 2) });

/** "250", "79.92", "1.5 · 1.2 · 1 · 0.9 · 0.8", "24 · 48". */
export function formatSetting(def: SettingDef, v: SettingValue): string {
  if (Array.isArray(v)) return v.map((x) => x.toLocaleString('en-US', { maximumFractionDigits: Math.max(def.decimals, 2) })).join(' · ');
  return fmtNumber(v, def.decimals);
}

/** A value with its unit, the way the game writes it: "250 CR", "5%", "2×", "max 10", "1 in 10", "24 · 48 h". */
export function withUnit(def: SettingDef, v: SettingValue): string {
  const text = formatSetting(def, v);
  if (def.unit === '%' || def.unit === '×') return `${text}${def.unit}`;
  if (def.unit === 'max') return `max ${text}`;
  if (def.unit === 'N') return `1 in ${text}`;
  return `${text} ${def.unit}`;
}

/** Unit after a bare number in a sentence ("Goes from 0 to 100%."); counts get none. */
const unitAfter = (def: SettingDef) => (def.unit === '%' || def.unit === '×' ? def.unit : def.unit === 'max' || def.unit === 'N' ? '' : ` ${def.unit}`);

/** "250 CR → 300 CR", "5% → 6%". */
export const changeText = (def: SettingDef, from: SettingValue, to: SettingValue) => `${withUnit(def, from)} → ${withUnit(def, to)}`;

/** Parses what staff typed; returns the value or the reason it can't be saved. */
export function parseSetting(def: SettingDef, input: string): { value: SettingValue } | { error: string } {
  const clean = input.trim();
  if (def.list) {
    const parts = clean.split(/[·,;/\s]+/).filter(Boolean).map((p) => Number(p));
    if (!parts.length || parts.some((p) => !Number.isFinite(p))) return { error: 'Use numbers separated by “·”.' };
    if (def.list.length && parts.length !== def.list.length) return { error: `Give ${def.list.length} values.` };
    if (parts.some((p) => p < def.list!.min || p > def.list!.max)) return { error: `Each value goes from ${def.list.min} to ${def.list.max}.` };
    if (def.decimals === 0 && parts.some((p) => !Number.isInteger(p))) return { error: 'Use whole numbers.' };
    const values = def.list.length ? parts : [...new Set(parts)].sort((a, b) => a - b);
    return { value: values };
  }
  const value = Number(clean.replace(/[,\s]/g, ''));
  if (!clean || !Number.isFinite(value)) return { error: 'Type a number.' };
  if (def.decimals === 0 && !Number.isInteger(value)) return { error: 'Use a whole number.' };
  if (Math.round(value * 10 ** def.decimals) / 10 ** def.decimals !== value) return { error: `Use at most ${def.decimals} decimals.` };
  if (value < def.min || value > def.max) return { error: `Goes from ${fmtNumber(def.min, 0)} to ${fmtNumber(def.max, 0)}${unitAfter(def)}.` };
  if (def.choices && !def.choices.includes(value)) return { error: `Use ${def.choices.slice(0, -1).join(', ')} or ${def.choices.at(-1)}${unitAfter(def)}.` };
  return { value };
}

export const sameValue = (a: SettingValue, b: SettingValue) => JSON.stringify(a) === JSON.stringify(b);

/** Economy from the saved rows (unknown keys ignored, missing keys = defaults). */
export function economyFrom(rows: { key: string; value: unknown }[]): Economy {
  let e = DEFAULT_ECONOMY;
  for (const row of rows) {
    const def = SETTING_BY_KEY.get(row.key);
    if (def) e = def.write(e, row.value as SettingValue);
  }
  return e;
}

/** Odds must make exactly 100.00 %. */
export const oddsTotalBp = (e: Economy) => TIERS.reduce((s, t) => s + e.oddsBp[t], 0);
