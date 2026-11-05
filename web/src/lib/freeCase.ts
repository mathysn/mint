import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { FreeCase } from '../../../shared/api';
import { countdown } from './format';
import { keys, useNow } from './queries';

/**
 * The free case stack as sent by the server: how many are ready ("3/5") and the time left until the
 * next one while it isn't full. Asks the server again when the next one is due.
 */
export function useFreeCase(freeCase: FreeCase | undefined) {
  const nextAt = freeCase?.nextAt ? new Date(freeCase.nextAt) : null;
  const now = useNow(nextAt !== null);
  const client = useQueryClient();
  const elapsed = nextAt !== null && nextAt <= now;

  useEffect(() => {
    if (elapsed) void client.invalidateQueries({ queryKey: keys.me });
  }, [elapsed, client]);

  const count = freeCase?.count ?? 0;
  const max = freeCase?.max ?? 0;
  return {
    ready: Boolean(freeCase?.available),
    count,
    max,
    /** "3/5"; just "6" when staff bonus cases take it above the stack. */
    stock: freeCase ? (count > max ? String(count) : `${count}/${max}`) : '—',
    /** Countdown to the next free case; null when the stack is full. */
    next: nextAt ? countdown(nextAt, now) : null,
    crateId: freeCase?.crateId ?? null,
  };
}
