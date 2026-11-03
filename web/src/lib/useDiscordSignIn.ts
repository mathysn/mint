import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthFlowStart, AuthFlowState, Me } from '../../../shared/api';
import { api } from './api';
import { keys } from './queries';

export type SignInState = 'idle' | 'waiting' | 'success' | 'error';

const POLL_MS = 1500;

/**
 * Web sign-in (Connect states idle / waiting / success / error).
 * A popup (a tab on mobile) goes through Discord; this tab polls the server, which hands
 * the session only to the tab holding the poll secret.
 */
export function useDiscordSignIn() {
  const client = useQueryClient();
  const [state, setState] = useState<SignInState>('idle');
  const [me, setMe] = useState<Me | null>(null);
  const flow = useRef<AuthFlowStart | null>(null);
  const popup = useRef<Window | null>(null);
  const timer = useRef<number | null>(null);
  const busy = useRef(false);
  const again = useRef(false);

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const finish = useCallback(
    (result: AuthFlowState) => {
      stop();
      popup.current?.close();
      if (result.status === 'success' && result.me) {
        // A different player now (guest progress never moves): drop everything cached for the guest.
        client.setQueryData(keys.me, result.me);
        void client.resetQueries({ predicate: (q) => !(q.queryKey.length === 1 && q.queryKey[0] === keys.me[0]) });
        setMe(result.me);
        setState('success');
      } else {
        setState('error');
      }
    },
    [client, stop],
  );

  const poll = useCallback(async () => {
    // One request at a time: the first one to see the result consumes the flow, so a parallel
    // one would answer "already used" and show an error over a sign-in that worked.
    // A poll asked meanwhile (popup message, timer) runs as soon as the current one returns.
    if (busy.current) {
      again.current = true;
      return;
    }
    const current = flow.current;
    if (!current) return;
    stop();
    busy.current = true;
    again.current = false;
    let delay: number | null = null;
    try {
      const result = await api<AuthFlowState>(`/auth/discord/flows/${current.flowId}`, { headers: { 'x-poll-secret': current.pollSecret } });
      if (flow.current === current) {
        if (result.status === 'pending') delay = POLL_MS;
        else finish(result);
      }
    } catch {
      if (flow.current === current) delay = POLL_MS * 2;
    }
    busy.current = false;
    // Poll again now if asked meanwhile and there is still something to wait for
    // (this flow is still pending, or a new flow started while this request ran).
    if (again.current && flow.current && (flow.current !== current || delay !== null)) void poll();
    else if (delay !== null) timer.current = window.setTimeout(poll, delay);
  }, [finish, stop]);

  // The popup's last page posts a message when Discord is done: poll right away.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === 'mint-auth') void poll();
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      stop();
    };
  }, [poll, stop]);

  /** Must run inside the click handler so the popup is not blocked. */
  const start = useCallback(
    async (prompt: 'none' | 'consent' = 'none') => {
      stop();
      popup.current = window.open('', 'mint-discord', 'popup,width=500,height=780');
      setState('waiting');
      try {
        const started = await api<AuthFlowStart>('/auth/discord/flows', { method: 'POST', json: { prompt } });
        flow.current = started;
        if (popup.current && !popup.current.closed) popup.current.location.href = started.authorizeUrl;
        timer.current = window.setTimeout(poll, POLL_MS);
      } catch {
        popup.current?.close();
        setState('error');
      }
    },
    [poll, stop],
  );

  /** "No window? Open it again" */
  const reopen = useCallback(() => {
    if (flow.current) popup.current = window.open(flow.current.authorizeUrl, 'mint-discord', 'popup,width=500,height=780');
  }, []);

  const cancel = useCallback(() => {
    stop();
    flow.current = null;
    popup.current?.close();
    setState('idle');
  }, [stop]);

  return { state, me, start, reopen, cancel };
}
