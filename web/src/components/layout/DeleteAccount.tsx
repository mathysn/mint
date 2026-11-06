import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { DeleteOwnAccountBody } from '../../../../shared/api';
import { ApiRequestError, api } from '../../lib/api';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

/**
 * "Delete my account" (privacy page): a modal that lists what goes and what stays, and asks for the
 * player's name. Afterwards the browser starts over as a new guest.
 */
export function DeleteAccount({ username, mobile, trigger }: { username: string; mobile?: boolean; trigger: (open: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const navigate = useNavigate();
  const matches = name.trim().toLowerCase() === username;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/me/delete', { method: 'POST', json: { confirmName: name.trim() } satisfies DeleteOwnAccountBody });
      await client.resetQueries();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Couldn’t delete your account. Try again.');
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    setName('');
    setError(null);
  };

  return (
    <>
      {trigger(() => setOpen(true))}
      {open && (
        <Modal label="Delete my account" mobile={mobile} width={520} onClose={close}>
          <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>Delete {username}’s account?</h2>
            <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, lineHeight: 1.5, color: 'var(--text-2)' }}>
              <li>Your items, credits, friends and showcase are gone for good.</li>
              <li>Your listings, bids and pending offers are cancelled.</li>
              <li>Past trades and sales stay for the other players, under “Deleted player”.</li>
              <li>Signing in with Discord again starts a new collection.</li>
            </ul>
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
              This can’t be undone. See the <Link to="/privacy" style={{ color: 'var(--text-2)' }}>privacy page</Link>.
            </p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="lbl">Type {username} to confirm</span>
              <input
                className="mono"
                data-autofocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                maxLength={32}
                style={{ height: 48, padding: '0 14px', border: `1px solid ${error ? 'var(--error)' : 'var(--border-strong)'}`, borderRadius: 'var(--radius-control)', background: 'var(--surface)', color: 'var(--text)', fontSize: 16 }}
              />
            </label>
            <span role="alert" style={{ minHeight: 18, fontSize: 13, color: 'var(--error)' }}>
              {error}
            </span>
            <div style={{ display: 'flex', gap: 10, flexDirection: mobile ? 'column-reverse' : 'row', justifyContent: 'flex-end' }}>
              <Button variant="secondary" size={48} block={mobile} onClick={close} disabled={busy}>
                Keep my account
              </Button>
              <Button type="submit" variant="secondary" size={48} block={mobile} disabled={!matches || busy} style={{ color: 'var(--error)' }}>
                {busy ? 'Deleting…' : 'Delete forever'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
