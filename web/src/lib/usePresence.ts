import { useEffect, useState } from 'react';

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Keeps an element mounted for its exit animation. `mounted` stays true for `ms` after `show`
 * turns false, with `closing` true meanwhile: render `data-closing` and let the CSS play the exit.
 */
export function usePresence(show: boolean, ms: number) {
  const [present, setPresent] = useState(show);
  if (show && !present) setPresent(true);
  useEffect(() => {
    if (show || !present) return;
    const timer = window.setTimeout(() => setPresent(false), prefersReducedMotion() ? 0 : ms);
    return () => window.clearTimeout(timer);
  }, [show, present, ms]);
  return { mounted: show || present, closing: !show && present };
}
