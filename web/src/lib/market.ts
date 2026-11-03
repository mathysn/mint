import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
  AuctionCard,
  AuctionDetail,
  AuctionRole,
  BidResult,
  BuyNowResult,
  CreateListingBody,
  CreateListingResult,
  ListingQuote,
  MarketPage,
  Me,
  SalesHistory,
  SellInfo,
} from '../../../shared/api';
import { useToast } from '../components/ui/Toast';
import { ApiRequestError, api } from './api';
import { keys, useConfig, useRefreshPlayerData } from './queries';

export const marketKeys = {
  page: (query: string) => ['market', query] as const,
  auction: (id: string) => ['auction', id] as const,
  sell: (itemId: string) => ['sellInfo', itemId] as const,
  quote: (body: unknown) => ['listingQuote', body] as const,
};

// Countdowns run on the server's clock: each response carries `serverNow`, the client keeps the gap.
let clockOffset = 0;
const syncClock = <T extends { serverNow: string }>(data: T): T => {
  clockOffset = new Date(data.serverNow).getTime() - Date.now();
  return data;
};

/** Server time, re-rendered every second (auction timers). */
export function useServerNow(): Date {
  const [now, setNow] = useState(() => new Date(Date.now() + clockOffset));
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date(Date.now() + clockOffset)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Market tabs, page after page ("Show more"); refreshed every 15 s (other players bid and list). */
export function useMarket(query: string) {
  return useInfiniteQuery({
    queryKey: marketKeys.page(query),
    queryFn: ({ pageParam }) => api<MarketPage>(`/market?${query}&offset=${pageParam}`).then(syncClock),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.hasMore ? all.reduce((n, p) => n + p.auctions.length, 0) : undefined),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
}

/** Auction page: every 5 s, every 2 s in the last stretch (outbid toasts, anti-sniping). */
export function useAuction(id: string) {
  const urgentMs = useConfig().data?.antiSnipeMs ?? 0;
  return useQuery({
    queryKey: marketKeys.auction(id),
    queryFn: () => api<AuctionDetail>(`/market/auctions/${id}`).then(syncClock),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const a = query.state.data;
      if (!a || a.status !== 'active') return false;
      return new Date(a.endsAt).getTime() - (Date.now() + clockOffset) <= urgentMs ? 2_000 : 5_000;
    },
  });
}

export function useSellInfo(itemId: string) {
  return useQuery({ queryKey: marketKeys.sell(itemId), queryFn: () => api<SellInfo>(`/market/sell?item=${itemId}`), enabled: Boolean(itemId) });
}

/** "What you get": nets after the fee come from the server. */
export function useListingQuote(body: { itemId: string; startPrice: number; buyNowPrice: number | null }) {
  return useQuery({
    queryKey: marketKeys.quote(body),
    queryFn: () => api<ListingQuote>('/market/quote', { method: 'POST', json: body }),
    enabled: Boolean(body.itemId),
    placeholderData: keepPreviousData,
  });
}

/** After a listing, bid or purchase: balance, held bids, market, inventory and item pages change. */
function useAfterMarket() {
  const client = useQueryClient();
  const refresh = useRefreshPlayerData();
  return (money?: { balance: number; heldInBids?: number }) => {
    if (money) client.setQueryData<Me>(keys.me, (m) => (m ? { ...m, balance: money.balance, heldInBids: money.heldInBids ?? m.heldInBids } : m));
    void client.invalidateQueries({ queryKey: ['market'] });
    void client.invalidateQueries({ queryKey: ['sellInfo'] });
    void client.invalidateQueries({ queryKey: keys.me });
    void client.invalidateQueries({ queryKey: ['profile'] });
    refresh();
  };
}

const errorText = (error: unknown, fallback: string) => (error instanceof ApiRequestError ? error.message : fallback);

export function useCreateListing() {
  const after = useAfterMarket();
  return useMutation({
    mutationFn: (body: CreateListingBody) => api<CreateListingResult>('/market/listings', { method: 'POST', json: body }),
    onSuccess: () => after(),
  });
}

function useAuctionMutation<T extends { auction: AuctionDetail; balance: number; heldInBids: number }>(path: 'bid' | 'buy') {
  const client = useQueryClient();
  const after = useAfterMarket();
  return useMutation({
    mutationFn: ({ id, amount }: { id: string; amount?: number }) =>
      api<T>(`/market/auctions/${id}/${path}`, { method: 'POST', json: path === 'bid' ? { amount } : {} }),
    onSuccess: (result) => {
      client.setQueryData(marketKeys.auction(result.auction.id), syncClock(result.auction));
      after(result);
    },
    onError: (_error, { id }) => {
      void client.invalidateQueries({ queryKey: marketKeys.auction(id) });
      after();
    },
  });
}

export const usePlaceBid = () => useAuctionMutation<BidResult>('bid');
export const useBuyNow = () => useAuctionMutation<BuyNowResult>('buy');

export function useCancelListing() {
  const client = useQueryClient();
  const after = useAfterMarket();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: string) => api<AuctionDetail>(`/market/auctions/${id}/cancel`, { method: 'POST' }),
    onSuccess: (auction) => {
      client.setQueryData(marketKeys.auction(auction.id), syncClock(auction));
      after();
    },
    onError: (error, id) => {
      void client.invalidateQueries({ queryKey: marketKeys.auction(id) });
      toast(errorText(error, 'Could not cancel the listing.'), { error: true });
    },
  });
}

export { errorText };

// ── Display ─────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const secondsLeft = (endsAt: string, now: Date) => Math.max(0, Math.floor((new Date(endsAt).getTime() - now.getTime()) / 1000));

/** Card timer: "01:42", "5h 12m", "Ended". */
export function cardTimer(a: Pick<AuctionCard, 'status' | 'endsAt'>, now: Date): string {
  const s = a.status === 'active' ? secondsLeft(a.endsAt, now) : 0;
  if (s <= 0) return 'Ended';
  if (s < 3600) return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
}

/** Auction page timer: "4:12:09" above an hour, "01:42" below, "00:00" once ended. */
export function pageTimer(a: Pick<AuctionCard, 'status' | 'endsAt'>, now: Date): string {
  const s = a.status === 'active' ? secondsLeft(a.endsAt, now) : 0;
  if (s >= 3600) return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export const isRunning = (a: Pick<AuctionCard, 'status' | 'endsAt'>, now: Date) => a.status === 'active' && secondsLeft(a.endsAt, now) > 0;

/** Last 2 minutes (the window comes from the server config). */
export function useIsUrgent() {
  const urgentMs = useConfig().data?.antiSnipeMs ?? 0;
  return (a: Pick<AuctionCard, 'status' | 'endsAt'>, now: Date) => isRunning(a, now) && new Date(a.endsAt).getTime() - now.getTime() <= urgentMs;
}

/** Label over the card art: your listing, your bid's state, or the outcome. */
export function roleLabel(a: Pick<AuctionCard, 'role' | 'status'>): { text: string; solid: boolean } | null {
  const labels: Record<Exclude<AuctionRole, null>, { text: string; solid: boolean }> = {
    seller: { text: a.status === 'active' ? 'Your listing' : a.status === 'sold' ? 'Sold' : a.status === 'unsold' ? 'Not sold' : 'Cancelled', solid: a.status === 'active' || a.status === 'sold' },
    leading: { text: 'Highest bid: you', solid: true },
    outbid: { text: 'Outbid', solid: false },
    won: { text: 'Won', solid: true },
    lost: { text: 'Outbid', solid: false },
  };
  return a.role ? labels[a.role] : null;
}

/** "StatTrak™ MW", "MW", "Vanilla". */
export const salesLabel = (s: Pick<SalesHistory, 'stattrak' | 'wear'>) => [s.stattrak ? 'StatTrak™' : null, s.wear ?? 'Vanilla'].filter(Boolean).join(' ');
