import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './usePresence';

/**
 * Counts from the value shown to a new one (ease-out, `ms`). Display only: the value itself
 * always comes from the server; with reduced motion it is shown at once.
 */
export function useAnimatedNumber(value: number, ms = 600): number {
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    const from = current.current;
    if (from === value || prefersReducedMotion()) {
      current.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / ms);
      const next = Math.round(from + (value - from) * (1 - (1 - t) ** 3));
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

/**
 * Number of times `value` changed since it was first known: a `key` that replays a highlight on
 * each change. `undefined` (still loading) is not a value, so the first data never counts.
 */
export function useChangeCount(value: unknown): number {
  const [state, setState] = useState({ value, count: 0 });
  if (Object.is(state.value, value)) return state.count;
  const count = state.value === undefined ? state.count : state.count + 1;
  setState({ value, count });
  return count;
}
