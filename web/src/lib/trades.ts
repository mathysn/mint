import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTradeBody, Item, Me, TradeActionResult, TradeOffer, TradeOptions, TradeQuote } from '../../../shared/api';
import { useToast } from '../components/ui/Toast';
import { ApiRequestError, api } from './api';
import { formatFloat } from './format';
import { keys, useRefreshPlayerData } from './queries';
import { useIsAccount } from './social';

export type Box = 'received' | 'sent' | 'history';

export const tradeKeys = {
  box: (box: Box) => ['trades', box] as const,
  options: (username: string) => ['tradeOptions', username] as const,
  quote: (body: unknown) => ['tradeQuote', body] as const,
};

export function useTrades(box: Box) {
  const enabled = useIsAccount();
  return useQuery({ queryKey: tradeKeys.box(box), queryFn: () => api<TradeOffer[]>(`/trades?box=${box}`), enabled });
}

export function useTradeOptions(username: string) {
  const account = useIsAccount();
  return useQuery({
    queryKey: tradeKeys.options(username),
    queryFn: () => api<TradeOptions>(`/trades/options?with=${encodeURIComponent(username)}`),
    enabled: account && Boolean(username),
  });
}

/** Summary bar of "New offer": totals come from the server, never added up here. */
export function useTradeQuote(body: Omit<CreateTradeBody, 'expiresInDays' | 'counterOf'>) {
  return useQuery({
    queryKey: tradeKeys.quote(body),
    queryFn: () => api<TradeQuote>('/trades/quote', { method: 'POST', json: body }),
    enabled: Boolean(body.to),
    placeholderData: keepPreviousData,
  });
}

/** After any trade action: offers, balances, inventories, albums and badges change. */
function useAfterTrade() {
  const client = useQueryClient();
  const refresh = useRefreshPlayerData();
  return (balance?: number) => {
    if (balance !== undefined) client.setQueryData<Me>(keys.me, (m) => (m ? { ...m, balance } : m));
    void client.invalidateQueries({ queryKey: ['trades'] });
    void client.invalidateQueries({ queryKey: ['tradeOptions'] });
    void client.invalidateQueries({ queryKey: keys.me });
    void client.invalidateQueries({ queryKey: ['profile'] });
    void client.invalidateQueries({ queryKey: ['playerInventory'] });
    refresh();
  };
}

export function useSendTrade() {
  const after = useAfterTrade();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: CreateTradeBody) => api<{ id: string }>('/trades', { method: 'POST', json: body }),
    onSuccess: () => after(),
    onError: (error) => toast(error instanceof ApiRequestError ? error.message : 'Couldn’t send the offer. Try again.', { error: true }),
  });
}

export function useTradeAction() {
  const after = useAfterTrade();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'decline' | 'cancel' }) =>
      api<TradeActionResult>(`/trades/${id}/${action}`, { method: 'POST' }),
    onSuccess: (result) => after(result.balance),
    onError: (error) => {
      after();
      toast(error instanceof ApiRequestError ? error.message : 'Couldn’t update the offer. Try again.', { error: true });
    },
  });
}

/** "Expires in 2 d 04 h" / "Expires in 18 h" / "Expires in 12 min". */
export function expiresIn(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((new Date(iso).getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `Expires in ${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Expires in ${hours} h`;
  return `Expires in ${Math.floor(hours / 24)} d ${String(hours % 24).padStart(2, '0')} h`;
}

/** "ST™ · FT · 0.1876" (cards) or "ST™ FT 0.1876" (picker tiles). */
export function itemTag(item: Item, short = false, lock = true): string {
  if (lock && item.status === 'listed') return 'Listed';
  if (lock && item.status === 'in_trade') return 'In a trade';
  const wear = item.wear && item.float !== null ? (short ? `${item.wear.code} ${formatFloat(item.float, 4)}` : `${item.wear.code} · ${formatFloat(item.float, 4)}`) : 'Vanilla';
  return item.stattrak ? (short ? `ST™ ${wear}` : `ST™ · ${wear}`) : wear;
}

/** "Estimated +500 CR for you" / "−300 CR for you". */
export const diffLine = (diff: number, format: (n: number) => string) => `${diff >= 0 ? '+' : '−'}${format(Math.abs(diff))} CR for you`;
