import { useSyncExternalStore } from 'react';

const subscribers = new Map<string, (onChange: () => void) => () => void>();

function subscribeTo(query: string) {
  let subscribe = subscribers.get(query);
  if (!subscribe) {
    subscribe = (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    };
    subscribers.set(query, subscribe);
  }
  return subscribe;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(subscribeTo(query), () => window.matchMedia(query).matches);
}

/** Mobile layout (tab bar) up to 860 px, like the mockups. */
export const useIsMobile = () => useMediaQuery('(max-width: 860px)');

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
