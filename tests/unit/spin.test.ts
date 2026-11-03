import { describe, expect, it } from 'vitest';
import { SPIN, cardUnderMarker, fillIndex, idleIndex, peakSpeed, spinPlan, spinProgress, stripX } from '../../web/src/lib/spin.js';

const desktop = { step: 160, half: 76, start: 3 };
const mobile = { step: 120, half: 56, start: 2 };

/** Deterministic random sequence for the plans. */
function seq(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('roulette spin', () => {
  it('progress goes from 0 to 1 without going back, and speed has no jump', () => {
    for (const [ramp, power] of [
      [SPIN.ramp[0], SPIN.power[0]],
      [SPIN.ramp[1], SPIN.power[1]],
      [0.1, 3.5],
      [0, 3],
    ] as const) {
      expect(spinProgress(0, ramp, power)).toBe(0);
      expect(spinProgress(1, ramp, power)).toBe(1);
      let last = 0;
      for (let t = 0.001; t < 1; t += 0.001) {
        const p = spinProgress(t, ramp, power);
        expect(p).toBeGreaterThanOrEqual(last);
        last = p;
      }
      if (ramp > 0) {
        // Same speed just before and just after the end of the ramp.
        const h = 1e-6;
        const before = (spinProgress(ramp, ramp, power) - spinProgress(ramp - h, ramp, power)) / h;
        const after = (spinProgress(ramp + h, ramp, power) - spinProgress(ramp, ramp, power)) / h;
        expect(Math.abs(before - after)).toBeLessThan(1e-3);
        // Starts from rest.
        expect(spinProgress(1e-4, ramp, power) / 1e-4).toBeLessThan(0.01);
      }
    }
  });

  it('peaks well under the old 6.2× the average speed', () => {
    for (const ramp of SPIN.ramp) for (const power of SPIN.power) expect(peakSpeed(ramp, power)).toBeLessThan(4);
  });

  it('every plan stays in its bounds and stops inside the result card', () => {
    for (const g of [desktop, mobile]) {
      for (const width of [390, 1000, 1680]) {
        for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
          const plan = spinPlan(seq([r, 1 - r, r, r, 1 - r]), g, width, 40);
          expect(plan.durationMs).toBeGreaterThanOrEqual(SPIN.durationMs[0]);
          expect(plan.durationMs).toBeLessThanOrEqual(SPIN.durationMs[1]);
          expect(plan.startIndex).toBeGreaterThanOrEqual(fillIndex(g, width));
          expect(40 - plan.startIndex).toBeGreaterThanOrEqual(SPIN.minResultGap);
          expect(40 - plan.startIndex).toBeLessThanOrEqual(SPIN.cards[1]);
          expect(Math.abs(plan.landingPx)).toBeLessThan(g.half);
          // The marker ends on card 40, whatever the landing point.
          expect(cardUnderMarker(g, stripX(g, 40, plan.landingPx))).toBe(40);
        }
      }
    }
  });

  it('two spins differ', () => {
    const a = spinPlan(seq([0.1, 0.9, 0.2, 0.3, 0.8]), desktop, 1440, 40);
    const b = spinPlan(seq([0.8, 0.2, 0.9, 0.7, 0.1]), desktop, 1440, 40);
    expect(a.durationMs).not.toBe(b.durationMs);
    expect(a.startIndex).not.toBe(b.startIndex);
    expect(a.landingPx).not.toBe(b.landingPx);
  });

  it('reduced motion: 0.6 s', () => {
    expect(spinPlan(Math.random, desktop, 1440, 40, true).durationMs).toBe(600);
  });

  it('the idle strip fills the stage and stays clear of the result', () => {
    expect(idleIndex(desktop, 1680, 40)).toBe(5);
    expect(idleIndex(desktop, 300, 40)).toBe(3);
    expect(idleIndex(mobile, 390, 40)).toBe(2);
  });
});
