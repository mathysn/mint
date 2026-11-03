import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AlbumDetail, AlbumSummary, CaseFinder, Config, CrateDetail, CrateSummary, GuestSummary, InventoryPage, ItemDetail, Me } from '../../../shared/api';
import { ApiRequestError, api } from './api';
import { isActivity } from './platform';

export const keys = {
  me: ['me'] as const,
  config: ['config'] as const,
  crates: ['crates'] as const,
  crate: (id: string) => ['crates', id] as const,
  inventory: (query: string) => ['inventory', query] as const,
  // Paged (infinite) inventory: its cache holds { pages }, not an InventoryPage, so it needs
  // its own key. Still under ['inventory'] so invalidating the inventory reaches both.
  inventoryPages: (query: string) => ['inventory', 'pages', query] as const,
  summary: ['me', 'summary'] as const,
  item: (id: string) => ['items', id] as const,
  albums: ['albums'] as const,
  album: (id: string) => ['albums', id] as const,
};

/** Current player. On the web, a first visit starts a guest account on the server. */
export async function loadMe(): Promise<Me> {
  try {
    return await api<Me>('/me');
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401 && !isActivity) {
      return api<Me>('/auth/guest', { method: 'POST' });
    }
    throw error;
  }
}

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: loadMe, staleTime: 30_000 });

export const useConfig = () => useQuery({ queryKey: keys.config, queryFn: () => api<Config>('/config'), staleTime: 5 * 60_000 });

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const pct = (n: number) => `${n.toLocaleString('en-US')}%`;

/** Economy numbers quoted in the game's copy, from /config (staff can change them). */
export function useEconomyText() {
  const c = useConfig().data;
  const hours = c?.freeCaseHours ?? 4;
  const snipe = c?.antiSnipeMinutes ?? 2;
  const size = c?.tradeupSize ?? 10;
  return {
    price: c?.cratePrice ?? 250,
    /** "4 h" */
    freeShort: `${hours} h`,
    /** "4 hours" */
    freeLong: hours === 1 ? 'hour' : `${hours} hours`,
    /** "5%" */
    fee: pct(c?.marketFeePct ?? 5),
    /** "5%" */
    bidStep: pct(c?.bidStepPct ?? 5),
    /** "2 minutes" */
    snipe: `${snipe} minute${snipe === 1 ? '' : 's'}`,
    /** "2 more minutes" */
    snipeMore: `${snipe} more minute${snipe === 1 ? '' : 's'}`,
    expiryDays: c?.tradeExpiryDays ?? [1, 3, 7],
    tradeupSize: size,
    /** "ten" */
    tradeupWord: NUMBER_WORDS[size] ?? String(size),
  };
}

export const useCrates = () => useQuery({ queryKey: keys.crates, queryFn: () => api<CrateSummary[]>('/crates') });

export const useCrate = (id: string) => useQuery({ queryKey: keys.crate(id), queryFn: () => api<CrateDetail>(`/crates/${id}`) });

/**
 * Weapon finder of the Cases screen: the cases that drop a skin matching `q` (2 characters at least).
 * With `crate`, only that case, with all its matches (highlight in "What's inside").
 */
export function useCaseFinder(q: string, crate?: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ['caseFinder', query.toLowerCase(), crate ?? null],
    queryFn: () => api<CaseFinder>(`/crates/find?${new URLSearchParams(crate ? { q: query, crate } : { q: query })}`),
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export const useInventory = (query: string, enabled = true) =>
  useQuery({
    queryKey: keys.inventory(query),
    queryFn: () => api<InventoryPage>(`/inventory${query ? `?${query}` : ''}`),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useItem = (id: string) => useQuery({ queryKey: keys.item(id), queryFn: () => api<ItemDetail>(`/items/${id}`) });

export const useAlbums = (enabled = true) => useQuery({ queryKey: keys.albums, queryFn: () => api<AlbumSummary[]>('/albums'), enabled });

export const useAlbum = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.album(id), queryFn: () => api<AlbumDetail>(`/albums/${id}`), placeholderData: keepPreviousData, enabled: enabled && Boolean(id) });

export const useGuestSummary = (enabled: boolean) =>
  useQuery({ queryKey: keys.summary, queryFn: () => api<GuestSummary>('/me/summary'), enabled });

/** Cases, inventory and album counts change after an opening or a sign-in. */
export function useRefreshPlayerData() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['inventory'] });
    void client.invalidateQueries({ queryKey: keys.crates });
    void client.invalidateQueries({ queryKey: keys.summary });
    void client.invalidateQueries({ queryKey: keys.albums });
    // A ★ drop shows in the global banner; values and albums move the leaderboard.
    void client.invalidateQueries({ queryKey: ['globalDrop'] });
    void client.invalidateQueries({ queryKey: ['leaderboard'] });
    // Item pages refresh when next opened (an open page may show an item that was just recycled).
    void client.invalidateQueries({ queryKey: ['items'], refetchType: 'none' });
  };
}

/** Re-renders every second (countdowns). */
export function useNow(active = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}
