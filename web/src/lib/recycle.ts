import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Me, RecycleResult } from '../../../shared/api';
import { useToast } from '../components/ui/Toast';
import { ApiRequestError, api } from './api';
import { formatCredits } from './format';
import { keys, useRefreshPlayerData } from './queries';

/** Recycle items (server decides the amount); updates the balance and the lists. */
export function useRecycle(onDone?: (result: RecycleResult) => void) {
  const client = useQueryClient();
  const refresh = useRefreshPlayerData();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ itemIds, confirm }: { itemIds: string[]; confirm: boolean }) =>
      api<RecycleResult>('/items/recycle', { method: 'POST', json: { itemIds, confirm } }),
    onSuccess: (result) => {
      client.setQueryData<Me>(keys.me, (m) => (m ? { ...m, balance: result.balance } : m));
      refresh();
      toast(`Recycled ${result.count} ${result.count === 1 ? 'item' : 'items'} · +${formatCredits(result.credited)} CR`);
      onDone?.(result);
    },
    onError: (error) => {
      refresh();
      toast(error instanceof ApiRequestError ? error.message : 'Could not recycle.', { error: true });
    },
  });
}
