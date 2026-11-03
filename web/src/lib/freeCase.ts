import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { FreeCase } from '../../../shared/api';
import { countdown } from './format';
import { keys, useNow } from './queries';

/** "Ready" or the time left, as sent by the server; asks the server again once the wait is over. */
export function useFreeCase(freeCase: FreeCase | undefined) {
  const waiting = Boolean(freeCase && !freeCase.available && freeCase.nextAt);
  const now = useNow(waiting);
  const client = useQueryClient();
  const nextAt = freeCase?.nextAt ? new Date(freeCase.nextAt) : null;
  const elapsed = waiting && nextAt !== null && nextAt <= now;

  useEffect(() => {
    if (elapsed) void client.invalidateQueries({ queryKey: keys.me });
  }, [elapsed, client]);

  const ready = Boolean(freeCase?.available);
  return { ready, label: ready ? 'Ready' : nextAt ? countdown(nextAt, now) : '—', crateId: freeCase?.crateId ?? null };
}
