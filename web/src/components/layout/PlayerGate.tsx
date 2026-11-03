import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { BanInfo, Me } from '../../../../shared/api';
import { ApiRequestError, api } from '../../lib/api';
import { isActivity } from '../../lib/platform';
import { keys, useMe } from '../../lib/queries';
import { useDiscordSignIn } from '../../lib/useDiscordSignIn';
import { Button } from '../ui/Button';
import { HudLabel } from '../ui/primitives';


/**
 * Staff decisions the player must see before playing: a ban that ended their session (they see
 * why, instead of silently becoming a guest) and a name reset (they pick a new name).
 */
export function PlayerGate({ children }: { children: ReactNode }) {
  const { data: me, error } = useMe();
  if (error instanceof ApiRequestError && error.code === 'banned' && error.ban) return <BanPage ban={error.ban} />;
  if (me?.mustPickName) return <PickName me={me} />;
  return children;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--page)', color: 'var(--text)' }}>
      <div style={{ width: 'min(480px, 100%)', display: 'flex', flexDirection: 'column', gap: 20 }}>{children}</div>
    </main>
  );
}

/** "What vex sees" (design/Admin-Dlg-Ban.dc.html): the ban, its reason, and what stays safe. */
export function BanCard({ ban }: { ban: BanInfo }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '16px 18px',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--rail)',
      }}
    >
      <span className="lbl" style={{ fontSize: 10 }}>
        // Account
      </span>
      <span style={{ fontSize: 16, fontWeight: 600 }}>{ban.message}</span>
      <span style={{ fontSize: 14, color: 'var(--text-2)' }}>
        Reason: <span style={{ color: 'var(--text)' }}>{ban.reason}</span>
      </span>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Your items and credits are safe. You can still look at your inventory.</span>
    </div>
  );
}

function BanPage({ ban }: { ban: BanInfo }) {
  const signIn = useDiscordSignIn();
  return (
    <Centered>
      <BanCard ban={ban} />
      {!isActivity && (
        <Button size={48} block onClick={() => void signIn.start()} disabled={signIn.state === 'waiting'}>
          {signIn.state === 'waiting' ? 'Waiting for Discord…' : 'Sign in with Discord'}
        </Button>
      )}
    </Centered>
  );
}

function PickName({ me }: { me: Me }) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      client.setQueryData(keys.me, await api<Me>('/me/username', { method: 'POST', json: { username: name } }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Centered>
      <HudLabel>// Account</HudLabel>
      <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>Pick a new name</h1>
      <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--text-2)' }}>
        Your name was reset to <span className="mono">{me.username}</span> by the Mint staff. Choose the name other players will see.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }} noValidate>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="lbl">Name</span>
          <input
            className="mono"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            style={{ height: 48, padding: '0 14px', border: `1px solid ${error ? 'var(--error)' : 'var(--border-strong)'}`, borderRadius: 'var(--radius-control)', background: 'var(--surface)', color: 'var(--text)', fontSize: 16 }}
          />
        </label>
        <span role="alert" style={{ minHeight: 20, fontSize: 13, color: 'var(--error)' }}>
          {error}
        </span>
        <Button type="submit" size={48} block disabled={busy || name.trim().length < 2}>
          Save name
        </Button>
      </form>
    </Centered>
  );
}
