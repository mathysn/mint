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

export interface CooldownState {
  available: boolean;
  nextAt: Date | null;
}

/** Available again `cooldownMs` after the last use (rolling, not calendar days). */
export function cooldownState(last: Date | null, now: Date, cooldownMs: number): CooldownState {
  if (!last) return { available: true, nextAt: null };
  const nextAt = new Date(last.getTime() + cooldownMs);
  return nextAt <= now ? { available: true, nextAt: null } : { available: false, nextAt };
}

/** One free case every N hours (4 by default), counted from the last free opening. */
export const freeCaseState = (lastFreeCaseAt: Date | null, now: Date) => cooldownState(lastFreeCaseAt, now, econ().freeCaseHours * 60 * 60 * 1000);
