/**
 * Motion of the case roulette. Cosmetic only: the item was drawn by the server before the roll
 * starts and the strip always stops on the server's result card. What changes from one spin to
 * the next is how it gets there (length, distance, curve, landing point inside the card), so no
 * two openings feel the same.
 */

export interface SpinGeometry {
  /** Card width + gap. */
  step: number;
  /** Half a card width. */
  half: number;
  /** Fewest cards left of the marker before a roll. */
  start: number;
}

export interface SpinPlan {
  durationMs: number;
  /** Card under the marker when the roll starts. */
  startIndex: number;
  /** Where the marker stops inside the result card, from its centre (px, positive = to the right). */
  landingPx: number;
  /** Share of the time spent speeding up. */
  ramp: number;
  /** Steepness of the slow-down (higher = longer crawl at the end). */
  power: number;
}

export const SPIN = {
  durationMs: [4800, 6600],
  reducedMs: 600,
  /** Cards travelled. */
  cards: [24, 34],
  /** The strip never starts closer than this to the result. */
  minResultGap: 10,
  /** The marker stops within this share of the card's half-width, either side of its centre. */
  landingShare: 0.8,
  ramp: [0.08, 0.14],
  power: [3, 4],
} as const;

const between = (r: number, [a, b]: readonly [number, number]) => a + r * (b - a);

/** First card under the marker so that cards fill the stage up to its left edge. */
export const fillIndex = (g: SpinGeometry, stageWidth: number) => Math.max(g.start, Math.ceil((stageWidth / 2 - g.half) / g.step));

/** Idle strip: as far left as the stage allows, at least `minResultGap` cards before the result. */
export const idleIndex = (g: SpinGeometry, stageWidth: number, resultIndex: number) => Math.min(resultIndex - SPIN.minResultGap, fillIndex(g, stageWidth));

/** `random` returns numbers in [0, 1). With reduced motion: 0.6 s, plain slow-down. */
export function spinPlan(random: () => number, g: SpinGeometry, stageWidth: number, resultIndex: number, reduced = false): SpinPlan {
  const travel = Math.round(between(random(), SPIN.cards));
  const startIndex = Math.min(resultIndex - SPIN.minResultGap, Math.max(fillIndex(g, stageWidth), resultIndex - travel));
  const landingPx = Math.round((random() * 2 - 1) * g.half * SPIN.landingShare);
  if (reduced) return { durationMs: SPIN.reducedMs, startIndex, landingPx, ramp: 0, power: 3 };
  return {
    durationMs: Math.round(between(random(), SPIN.durationMs)),
    startIndex,
    landingPx,
    ramp: between(random(), SPIN.ramp),
    power: between(random(), SPIN.power),
  };
}

/**
 * Share of the distance covered at time `t` (0 → 1). The speed grows linearly during `ramp`,
 * then falls as ((1 − t) / (1 − ramp))^(power − 1): smooth, without a jump at either end.
 */
export function spinProgress(t: number, ramp: number, power: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const peak = 1 / (ramp / 2 + (1 - ramp) / power);
  if (t < ramp) return (peak * t * t) / (2 * ramp);
  return peak * (ramp / 2 + ((1 - ramp) / power) * (1 - ((1 - t) / (1 - ramp)) ** power));
}

/** Highest speed of a plan, as a multiple of its average speed. */
export const peakSpeed = (ramp: number, power: number) => 1 / (ramp / 2 + (1 - ramp) / power);

/** Strip offset that puts the centre of card `index` (plus `offset` px) under the marker. */
export const stripX = (g: SpinGeometry, index: number, offset = 0) => -(index * g.step + g.half + offset);

/** Card under the marker for a strip offset (changes at every card edge: one tick each). */
export const cardUnderMarker = (g: SpinGeometry, x: number) => Math.floor(-x / g.step);
