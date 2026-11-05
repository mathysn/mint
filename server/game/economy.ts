// Every number of the economy (docs/cahier-des-charges.md, "Valeurs par défaut").
// The ones staff can tune (admin › Economy) live in `Economy`: `econ()` returns the current values,
// loaded from `economy_settings` (services/economySettings.ts), with DEFAULT_ECONOMY when nothing
// is saved. Item values are derived from it, never stored on items.

export const TIERS = ['milspec', 'restricted', 'classified', 'covert', 'gold'] as const;
export type Tier = (typeof TIERS)[number];

export interface Economy {
  /** One price for every case. */
  casePrice: number;
  startingBalance: number;
  /** One free case every N hours (rolling, counted from the last free opening). */
  freeCaseHours: number;
  /** Chance per opening, in basis points of 1/10 000. Sums to 10 000. */
  oddsBp: Record<Tier, number>;
  /** Recycle value of each rarity before wear and StatTrak. */
  recycle: Record<Tier, number>;
  /** 1 item in N opened is StatTrak™. */
  stattrakOneIn: number;
  /** Multiplier on recycle (and so default market) value. */
  stattrakMultiplier: number;
  /** On recycle value, FN · MW · FT · WW · BS. */
  wearMultipliers: [number, number, number, number, number];
  /** Taken from the seller when an auction ends, basis points. */
  marketFeeBp: number;
  /** Each bid beats the last one by at least this, basis points. */
  bidStepBp: number;
  /** A bid in the last N minutes pushes the end back by N minutes. */
  antiSnipeMinutes: number;
  maxListings: number;
  durationsH: number[];
  maxPrice: number;
  tradeExpiryDays: number[];
  tradeMaxItems: number;
  tradeMaxPending: number;
  tradeupSize: number;
}

export const DEFAULT_ECONOMY: Economy = {
  casePrice: 250,
  startingBalance: 1000,
  freeCaseHours: 4,
  oddsBp: { milspec: 7992, restricted: 1598, classified: 320, covert: 64, gold: 26 },
  recycle: { milspec: 30, restricted: 120, classified: 500, covert: 2500, gold: 10000 },
  stattrakOneIn: 10,
  stattrakMultiplier: 2,
  wearMultipliers: [1.5, 1.2, 1, 0.9, 0.8],
  marketFeeBp: 500,
  bidStepBp: 500,
  antiSnipeMinutes: 2,
  maxListings: 10,
  durationsH: [24, 48],
  maxPrice: 10_000_000,
  tradeExpiryDays: [1, 3, 7],
  tradeMaxItems: 20,
  tradeMaxPending: 10,
  tradeupSize: 10,
};

let current: Economy = DEFAULT_ECONOMY;

/** The economy in force (updated by services/economySettings.ts; defaults until then). */
export const econ = (): Economy => current;

export function setEconomy(next: Economy) {
  current = next;
}

/** Vanilla knives have no float, so no wear multiplier. */
export const NO_WEAR_MULTIPLIER = 1;

export const PATTERN_COUNT = 1000;

/** Recycling these tiers needs an explicit confirmation (cahier des charges: "à partir de Classified"). */
export const RECYCLE_CONFIRM_TIERS: readonly Tier[] = ['classified', 'covert', 'gold'];
export const RECYCLE_MAX_ITEMS = 200;

/** Unboxings that appear in the friends' feed (cahier des charges: "ouvertures à partir de Classified"). */
export const FEED_TIERS: readonly Tier[] = ['classified', 'covert', 'gold'];

/** Quick-bid buttons, basis points above the current bid. */
export const QUICK_BIDS_BP = [500, 1000, 2500] as const;
/** "Recent sales": average and curve over this window; the auction page shows the last N sales. */
export const SALES_WINDOW_DAYS = 30;
export const AUCTION_PAGE_SALES = 10;
/** Ended listings and bids stay in "My listings" / "My bids" this long. */
export const MARKET_ENDED_VISIBLE_DAYS = 7;
/** Market value of an item: average of the last N sales of the same skin, StatTrak and wear. */
export const MARKET_PRICE_SALES = 10;
/** An auction still open this long after its end shows as Overdue to staff. */
export const OVERDUE_AFTER_MS = 2 * 60 * 1000;

/** Trade-up contracts: one rarity in, the next one out. Covert, knives and gloves: not yet. */
export const TRADEUP_NEXT: Partial<Record<Tier, Tier>> = { milspec: 'restricted', restricted: 'classified', classified: 'covert' };

/** Leaderboard length (your own row always shows). Knives and gloves are announced to everyone. */
export const LEADERBOARD_SIZE = 50;
export const GLOBAL_DROP_TIERS: readonly Tier[] = ['gold'];

/** Flag monitors (docs/ADMIN.md §9.3, thresholds validated on 2026-10-24). */
export const MONITORS = {
  repeatedTrades: { trades: 4, windowHours: 48, oneWayShare: 0.8, minMoved: 10_000, urgentFrom: 25_000 },
  sameIp: { accounts: 3, windowDays: 7, minSent: 10_000, urgentFrom: 25_000 },
  unusualPrice: { factor: 5, windowDays: 30 },
  newAccount: { maxAgeDays: 3, minReceived: 10_000 },
} as const;
