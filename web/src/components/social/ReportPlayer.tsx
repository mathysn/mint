import { useState } from 'react';
import type { ReportCategory } from '../../../../shared/api';
import { ApiRequestError, api } from '../../lib/api';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';

const CATEGORIES: { value: ReportCategory; hint: string }[] = [
  { value: 'Offensive name', hint: 'Their name insults someone or is hateful.' },
  { value: 'Scam', hint: 'They didn’t keep their side of a deal.' },
  { value: 'Other', hint: 'Anything else staff should look at.' },
];
const MAX = 500;

/** "Report" on another player's profile: staff see it in admin › Moderation. */
export function ReportPlayer({ username, mobile }: { username: string; mobile?: boolean }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory>('Scam');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const close = () => {
    setOpen(false);
    setError(null);
  };
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/players/${encodeURIComponent(username)}/report`, { method: 'POST', json: { category, message: message.trim() } });
      toast('Report sent · staff will look at it', { check: true });
      setMessage('');
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Couldn’t send the report. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="ghost" size={44} onClick={() => setOpen(true)} style={{ paddingInline: 10, alignSelf: mobile ? 'center' : undefined, color: 'var(--text-2)' }}>
        Report
      </Button>
      {open && (
        <Modal label="Report a player" mobile={mobile} width={520} onClose={close}>
          <h2 style={{ fontSize: mobile ? 20 : 24, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.01em' }}>Report {username}</h2>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-2)' }}>Staff read every report. {username} isn’t told who sent it.</p>
          <fieldset style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <legend className="sr-only">What happened</legend>
            {CATEGORIES.map((c) => {
              const on = category === c.value;
              return (
                <label key={c.value} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 14px', border: `1px solid ${on ? 'var(--text)' : 'var(--border-strong)'}`, borderRadius: 'var(--radius-card)', background: on ? 'var(--surface-raised)' : 'transparent', cursor: 'pointer' }}>
                  <input type="radio" className="sr-only" name="report-category" value={c.value} checked={on} onChange={() => setCategory(c.value)} />
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{c.value}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{c.hint}</span>
                </label>
              );
            })}
          </fieldset>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-2)' }}>
              <span>What happened</span>
              <span className="mono" style={{ fontSize: 12, color: message.length > MAX ? 'var(--error)' : 'var(--text-3)' }}>
                {message.length} / {MAX}
              </span>
            </span>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MAX}
              placeholder="A few words, with the trade or auction if there is one."
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-control)', background: 'var(--page)', color: 'var(--text)', font: 'inherit', fontSize: 14, resize: 'vertical' }}
            />
          </label>
          {error && (
            <span role="alert" style={{ fontSize: 14, color: 'var(--error)' }}>
              {error}
            </span>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" size={44} onClick={close}>
              Cancel
            </Button>
            <Button size={44} onClick={() => void send()} disabled={busy || !message.trim()} style={{ paddingInline: 22 }}>
              {busy ? 'Sending…' : 'Send report'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
