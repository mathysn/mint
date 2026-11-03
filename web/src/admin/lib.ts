import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type {
  AdminActionResult,
  AdminCatalog,
  AdminCrateDetail,
  AdminItemDetail,
  AdminItemsPage,
  AdminLogPage,
  AdminMe,
  AdminOverview,
  AdminPeriod,
  AdminPlayer,
  AdminPlayersPage,
  AdminPlayerTab,
  AdminPlayerTabData,
  AdminSearch,
  AdminAuctionDetail,
  AdminAuctionsPage,
  AdminEconomy,
  AdminErrors,
  AdminFlags,
  AdminJobCard,
  AdminLedgerPage,
  AdminModeration,
  AdminTradesPage,
  StaffRole,
} from '../../../shared/api';
import { useToast } from '../components/ui/Toast';
import { ApiRequestError, api } from '../lib/api';
import { formatCredits } from '../lib/format';

// ── Roles ───────────────────────────────────────────────────────────────────

const RANK: Record<StaffRole, number> = { viewer: 0, moderator: 1, admin: 2 };

/** The server decides; the panel shows an action disabled (never hidden) when the role is too low. */
export const can = (role: StaffRole | undefined, min: StaffRole) => !!role && RANK[role] >= RANK[min];

export const ROLE_HINT: Record<'moderator' | 'admin', string> = { moderator: 'Moderators and admins', admin: 'Admins only' };
export const ROLE_LABEL: Record<StaffRole, string> = { viewer: 'Viewer', moderator: 'Moderator', admin: 'Admin' };

// ── Formatting (display only: every number comes from the server) ───────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "4,870 CR" */
export const cr = (n: number) => `${formatCredits(n)} CR`;
/** "+5,000 CR", "−5,000 CR": a true minus sign. */
export const signedCr = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatCredits(Math.abs(n))} CR`;
export const num = (n: number) => formatCredits(n);
/** "Oct 23" */
export const utcDay = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
/** "14:10" */
export const utcTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
/** "Oct 23, 14:10" */
export const utcDateTime = (iso: string) => `${utcDay(iso)}, ${utcTime(iso)}`;
/** "Oct 23 14:10" (table cells) */
export const utcStamp = (iso: string) => `${utcDay(iso)} ${utcTime(iso)}`;
/** "2026-03-31" */
export const isoDay = (iso: string) => iso.slice(0, 10);

/** "just now", "12 min ago", "1 h ago", "yesterday", "3 d ago" */
export function ago(iso: string, now = Date.now()): string {
  const min = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? 'yesterday' : `${days} d ago`;
}

/** First letter for the round placeholder avatars ("G" for guests). */
export const initial = (label: string, guest?: boolean) => (guest ? 'G' : (label.replace(/^★\s*/, '')[0] ?? '?').toUpperCase());

export const errorText = (error: unknown) => (error instanceof ApiRequestError ? error.message : 'The server didn’t answer.');

// ── Queries ─────────────────────────────────────────────────────────────────

/** Everything of the panel lives under ['admin']: one invalidation after an action refreshes it all. */
export const adminKeys = {
  me: ['admin', 'me'] as const,
  search: (q: string) => ['admin', 'search', q] as const,
  players: (q: string) => ['admin', 'players', q] as const,
  player: (id: string) => ['admin', 'player', id] as const,
  tab: (id: string, tab: string) => ['admin', 'player', id, tab] as const,
  items: (q: string) => ['admin', 'items', q] as const,
  item: (id: string) => ['admin', 'item', id] as const,
  overview: (p: string) => ['admin', 'overview', p] as const,
  catalog: ['admin', 'catalog'] as const,
  crate: (id: string) => ['admin', 'crate', id] as const,
  log: (q: string) => ['admin', 'log', q] as const,
  skins: (q: string) => ['admin', 'skins', q] as const,
  economy: ['admin', 'economy'] as const,
  auctions: ['admin', 'auctions'] as const,
  auction: (id: string) => ['admin', 'auction', id] as const,
  trades: ['admin', 'trades'] as const,
  flags: ['admin', 'flags'] as const,
  moderation: ['admin', 'moderation'] as const,
  ledger: (q: string) => ['admin', 'ledger', q] as const,
  jobs: ['admin', 'jobs'] as const,
  errors: ['admin', 'errors'] as const,
};

export const useAdminMe = () =>
  useQuery({ queryKey: adminKeys.me, queryFn: () => api<AdminMe>('/admin/me'), staleTime: 30_000, refetchInterval: 60_000, retry: false });

/** The staff member (the shell only renders once it is known). */
export function useStaff() {
  const me = useAdminMe().data!;
  return { ...me, can: (min: StaffRole) => can(me.role, min) };
}

export const useAdminSearch = (q: string) =>
  useQuery({
    queryKey: adminKeys.search(q),
    queryFn: () => api<AdminSearch>(`/admin/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
  });

function pages<T extends { next: number | null }>(key: readonly unknown[], path: (offset: number) => string) {
  return {
    queryKey: key,
    queryFn: ({ pageParam }: { pageParam: number }) => api<T>(path(pageParam)),
    initialPageParam: 0,
    getNextPageParam: (last: T) => last.next ?? undefined,
    placeholderData: keepPreviousData,
  };
}

export const usePlayers = (query: string) => useInfiniteQuery(pages<AdminPlayersPage>(adminKeys.players(query), (o) => `/admin/players?${query}&offset=${o}`));
export const usePlayer = (id: string) => useQuery({ queryKey: adminKeys.player(id), queryFn: () => api<AdminPlayer>(`/admin/players/${id}`) });
export const usePlayerTab = (id: string, tab: AdminPlayerTab) =>
  useQuery({ queryKey: adminKeys.tab(id, tab), queryFn: () => api<AdminPlayerTabData>(`/admin/players/${id}/tabs/${tab}`) });
export const useItems = (query: string) => useInfiniteQuery(pages<AdminItemsPage>(adminKeys.items(query), (o) => `/admin/items?${query}&offset=${o}`));
export const useItem = (id: string | null) =>
  useQuery({ queryKey: adminKeys.item(id ?? ''), queryFn: () => api<AdminItemDetail>(`/admin/items/${id}`), enabled: Boolean(id) });
export const useOverview = (period: AdminPeriod) =>
  useQuery({ queryKey: adminKeys.overview(period), queryFn: () => api<AdminOverview>(`/admin/overview?period=${period}`), placeholderData: keepPreviousData, refetchInterval: 60_000 });
export const useCatalog = () => useQuery({ queryKey: adminKeys.catalog, queryFn: () => api<AdminCatalog>('/admin/catalog') });
export const useCrateDetail = (id: string | null) =>
  useQuery({ queryKey: adminKeys.crate(id ?? ''), queryFn: () => api<AdminCrateDetail>(`/admin/catalog/cases/${encodeURIComponent(id!)}`), enabled: Boolean(id) });
export const useAdminLog = (query: string) => useInfiniteQuery(pages<AdminLogPage>(adminKeys.log(query), (o) => `/admin/log?${query}&offset=${o}`));
export const useEconomy = () => useQuery({ queryKey: adminKeys.economy, queryFn: () => api<AdminEconomy>('/admin/economy') });
/** Live lists refresh on their own: timers, new bids, offers answered. */
export const useAuctions = () => useInfiniteQuery({ ...pages<AdminAuctionsPage>(adminKeys.auctions, (o) => `/admin/market/auctions?offset=${o}`), refetchInterval: 15_000 });
export const useAuction = (id: string | null) =>
  useQuery({ queryKey: adminKeys.auction(id ?? ''), queryFn: () => api<AdminAuctionDetail>(`/admin/market/auctions/${id}`), enabled: Boolean(id), refetchInterval: 10_000 });
export const useAdminTrades = () => useInfiniteQuery({ ...pages<AdminTradesPage>(adminKeys.trades, (o) => `/admin/market/trades?offset=${o}`), refetchInterval: 30_000 });
export const useFlags = () => useQuery({ queryKey: adminKeys.flags, queryFn: () => api<AdminFlags>('/admin/flags'), refetchInterval: 60_000 });
export const useModeration = () => useQuery({ queryKey: adminKeys.moderation, queryFn: () => api<AdminModeration>('/admin/moderation'), refetchInterval: 60_000 });
export const useLedger = (q: string) => useInfiniteQuery(pages<AdminLedgerPage>(adminKeys.ledger(q), (o) => `/admin/ledger?q=${encodeURIComponent(q)}&offset=${o}`));
export const useJobs = () => useQuery({ queryKey: adminKeys.jobs, queryFn: () => api<AdminJobCard[]>('/admin/jobs'), refetchInterval: 60_000 });
export const useErrors = () => useQuery({ queryKey: adminKeys.errors, queryFn: () => api<AdminErrors>('/admin/errors'), refetchInterval: 60_000 });

/** Rows of all loaded pages. */
export const rowsOf = <R,>(data: { pages: { rows: R[] }[] } | undefined): R[] => data?.pages.flatMap((p) => p.rows) ?? [];

// ── Actions ─────────────────────────────────────────────────────────────────

/**
 * Runs a staff action: POST, past-tense toast ("… · logged"), then every admin view reloads.
 * Returns null on success, or the server's message to show next to the confirmation.
 */
export function useAdminAction() {
  const client = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (path: string, body: unknown): Promise<string | null> => {
      setBusy(true);
      try {
        const result = await api<AdminActionResult>(path, { method: 'POST', json: body });
        toast(result.toast, { check: true });
        await client.invalidateQueries({ queryKey: ['admin'] });
        // The game's own caches (balance, inventory, cases) may have changed too.
        void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'admin' });
        return null;
      } catch (error) {
        return errorText(error);
      } finally {
        setBusy(false);
      }
    },
    [client, toast],
  );
  return { run, busy };
}

/** A server preview (before → after) for the current inputs, refreshed as they change. */
export function usePreview<T>(path: string | null, body: unknown, enabled = true) {
  const key = JSON.stringify(body);
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(key), 200);
    return () => window.clearTimeout(id);
  }, [key]);
  return useQuery({
    queryKey: ['admin', 'preview', path, debounced],
    queryFn: () => api<T>(path!, body === undefined ? {} : { method: 'POST', json: JSON.parse(debounced) }),
    // Only once the inputs have settled: the debounced body can be older than what `enabled` checked.
    enabled: enabled && Boolean(path) && debounced === key,
    placeholderData: keepPreviousData,
  });
}
