import { econ } from './economy.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CaseOfDayInput {
  /** Every case, active or not: turning one case on or off never moves today's pick. */
  allIds: readonly string[];
  activeIds: readonly string[];
  /** Picked by staff: wins over the rotation as long as it is active. */
  pick: string | null;
}

/**
 * "Free today": the staff pick if any, else a rotation over all cases (sorted by id) that changes
 * at 00:00 UTC and moves on to the next active case when today's one is off.
 */
export function dailyCrateId({ allIds, activeIds, pick }: CaseOfDayInput, now: Date): string | null {
  const active = new Set(activeIds);
  if (pick && active.has(pick)) return pick;
  if (active.size === 0) return null;
  const sorted = [...allIds].sort();
  const day = Math.floor(now.getTime() / DAY_MS);
  for (let i = 0; i < sorted.length; i++) {
    const id = sorted[(day + i) % sorted.length]!;
    if (active.has(id)) return id;
  }
  return null;
}

export interface FreeStack {
  /** Free cases ready now, from 0 to `max`. */
  count: number;
  max: number;
  /** When the next one comes; null when the stack is full. */
  nextAt: Date | null;
}

/**
 * A stack that fills itself: one case every `everyMs` since `anchor`, up to `max`. Null anchor = full.
 * Changing the interval or the max later just recomputes it (a full stack stays full).
 */
export function freeStack(anchor: Date | null, now: Date, everyMs: number, max: number): FreeStack {
  if (!anchor) return { count: max, max, nextAt: null };
  const count = Math.min(max, Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / everyMs)));
  return { count, max, nextAt: count >= max ? null : new Date(anchor.getTime() + (count + 1) * everyMs) };
}

/**
 * Anchor after taking one case. From a full stack the timer starts now for the missing one;
 * from a partial stack the time already counted towards the next case is kept.
 */
export function anchorAfterUse(anchor: Date | null, now: Date, everyMs: number, max: number): Date {
  const { count } = freeStack(anchor, now, everyMs, max);
  if (count === 0) throw new Error('No free case in the stack');
  if (count >= max) return new Date(now.getTime() - (max - 1) * everyMs);
  return new Date(anchor!.getTime() + everyMs);
}

const everyMs = () => econ().freeCaseMinutes * 60 * 1000;

/** The player's free case stack under the economy in force (10 min, up to 5 by default). */
export const freeCaseStack = (anchor: Date | null, now: Date) => freeStack(anchor, now, everyMs(), econ().freeCaseMax);

/** The anchor to save after a player opens one free case from their stack. */
export const freeCaseAnchorAfterUse = (anchor: Date | null, now: Date) => anchorAfterUse(anchor, now, everyMs(), econ().freeCaseMax);
