import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { GlobalDrop, Leaderboard, LeaderboardBoard, LeaderboardScope, Tier, TradeUpOptions, TradeUpQuote, TradeUpResult } from '../../../shared/api';
import { api } from './api';
import { useRefreshPlayerData } from './queries';

export const tradeUpKeys = {
  options: (tier: Tier, stattrak: boolean) => ['tradeUpOptions', tier, stattrak] as const,
  quote: (ids: string[]) => ['tradeUpQuote', ids] as const,
  leaderboard: (board: LeaderboardBoard, scope: LeaderboardScope) => ['leaderboard', board, scope] as const,
  drop: ['globalDrop'] as const,
};

export function useTradeUpOptions(tier: Tier, stattrak: boolean) {
  return useQuery({
    queryKey: tradeUpKeys.options(tier, stattrak),
    queryFn: () => api<TradeUpOptions>(`/tradeup/options?tier=${tier}&stattrak=${stattrak ? 1 : 0}`),
    placeholderData: keepPreviousData,
  });
}

/** Odds, average float and results come from the server for the items picked so far. */
export function useTradeUpQuote(ids: string[]) {
  return useQuery({
    queryKey: tradeUpKeys.quote(ids),
    queryFn: () => api<TradeUpQuote>('/tradeup/quote', { method: 'POST', json: { itemIds: ids } }),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  });
}

/** Signs the contract. Same key while a request is retried: the server never draws twice. */
export function useSignTradeUp() {
  const client = useQueryClient();
  const refresh = useRefreshPlayerData();
  const key = useRef<string | null>(null);
  return useMutation({
    mutationFn: (itemIds: string[]) => {
      key.current ??= crypto.randomUUID();
      return api<TradeUpResult>('/tradeup', { method: 'POST', headers: { 'idempotency-key': key.current }, json: { itemIds } });
    },
    onSettled: () => {
      key.current = null;
      void client.invalidateQueries({ queryKey: ['tradeUpOptions'] });
      void client.invalidateQueries({ queryKey: ['profile'] });
      void client.invalidateQueries({ queryKey: ['leaderboard'] });
      refresh();
    },
  });
}

export function useLeaderboard(board: LeaderboardBoard, scope: LeaderboardScope) {
  return useQuery({
    queryKey: tradeUpKeys.leaderboard(board, scope),
    queryFn: () => api<Leaderboard>(`/leaderboard?board=${board}&scope=${scope}`),
    placeholderData: keepPreviousData,
  });
}

/** Global drop banner: the latest knife or gloves, checked every minute. */
export function useLatestDrop(enabled = true) {
  return useQuery({
    queryKey: tradeUpKeys.drop,
    queryFn: () => api<{ drop: GlobalDrop | null }>('/drops/latest').then((r) => r.drop),
    refetchInterval: 60_000,
    enabled,
  });
}

/** "01", "02"… as on the mockup. */
export const rankLabel = (rank: number) => String(rank).padStart(2, '0');
