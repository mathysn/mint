import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AlbumDetail, AlbumSummary, FeedEntry, FriendsOverview, InventoryPage, Item, PlayerCard, Profile, Relation } from '../../../shared/api';
import { useToast } from '../components/ui/Toast';
import { ApiRequestError, api } from './api';
import { keys, useMe } from './queries';

export const socialKeys = {
  friends: ['friends'] as const,
  search: (q: string) => ['playerSearch', q] as const,
  profile: (username: string) => ['profile', username] as const,
  feed: ['feed'] as const,
  playerAlbums: (username: string) => ['playerAlbums', username] as const,
  playerAlbum: (username: string, id: string) => ['playerAlbums', username, id] as const,
};

/** Guests cannot use friends (DESIGN.md §7.2); the screens show a sign-in prompt instead. */
export function useIsAccount() {
  const { data: me } = useMe();
  return Boolean(me && !me.isGuest);
}

export function useFriends() {
  const enabled = useIsAccount();
  return useQuery({ queryKey: socialKeys.friends, queryFn: () => api<FriendsOverview>('/friends'), enabled });
}

export function usePlayerSearch(q: string) {
  const account = useIsAccount();
  return useQuery({
    queryKey: socialKeys.search(q),
    queryFn: () => api<PlayerCard[]>(`/players/search?q=${encodeURIComponent(q)}`),
    enabled: account && q.trim().length >= 2,
  });
}

export const useProfile = (username: string) =>
  useQuery({ queryKey: socialKeys.profile(username), queryFn: () => api<Profile>(`/players/${encodeURIComponent(username)}`), enabled: Boolean(username) });

export const useFeed = (enabled: boolean) =>
  useQuery({ queryKey: socialKeys.feed, queryFn: () => api<FeedEntry[]>('/feed'), enabled, refetchInterval: 60_000 });

export const usePlayerAlbums = (username: string, enabled = true) =>
  useQuery({ queryKey: socialKeys.playerAlbums(username), queryFn: () => api<AlbumSummary[]>(`/players/${encodeURIComponent(username)}/albums`), enabled });

export const usePlayerAlbum = (username: string, id: string, enabled = true) =>
  useQuery({ queryKey: socialKeys.playerAlbum(username, id), queryFn: () => api<AlbumDetail>(`/players/${encodeURIComponent(username)}/albums/${id}`), enabled: enabled && Boolean(id) });

export const fetchPlayerInventory = (username: string, query: string, offset: number) =>
  api<InventoryPage>(`/players/${encodeURIComponent(username)}/inventory?${query}&offset=${offset}`);

/** Friend actions; every list that shows a relation is refreshed afterwards. */
export function useFriendActions() {
  const client = useQueryClient();
  const toast = useToast();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: socialKeys.friends });
    void client.invalidateQueries({ queryKey: ['playerSearch'] });
    void client.invalidateQueries({ queryKey: ['profile'] });
    void client.invalidateQueries({ queryKey: keys.me });
    void client.invalidateQueries({ queryKey: socialKeys.feed });
  };
  const onError = (error: Error) => toast(error instanceof ApiRequestError ? error.message : 'Something went wrong.', { error: true });
  const options = { onSuccess: refresh, onError };
  return {
    add: useMutation({ mutationFn: (username: string) => api<{ relation: Relation }>('/friends/requests', { method: 'POST', json: { username } }), ...options }),
    accept: useMutation({ mutationFn: (userId: string) => api<{ relation: Relation }>(`/friends/requests/${userId}/accept`, { method: 'POST' }), ...options }),
    drop: useMutation({ mutationFn: (userId: string) => api<void>(`/friends/requests/${userId}`, { method: 'DELETE' }), ...options }),
    remove: useMutation({ mutationFn: (userId: string) => api<void>(`/friends/${userId}`, { method: 'DELETE' }), ...options }),
  };
}

/** Replace the whole showcase (ordered item ids, 5 at most). */
export function useSetShowcase() {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (itemIds: string[]) => api<Item[]>('/me/showcase', { method: 'PUT', json: { itemIds } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['profile'] });
      void client.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (error) => toast(error instanceof ApiRequestError ? error.message : 'Could not save the showcase.', { error: true }),
  });
}
