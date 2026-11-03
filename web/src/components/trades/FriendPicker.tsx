import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useFriends } from '../../lib/social';
import { statsLine } from '../social/social';
import { Button } from '../ui/Button';
import { SearchField } from '../ui/fields';
import { Modal } from '../ui/Modal';
import { Avatar, Spinner } from '../ui/primitives';

/** "New offer": pick the friend first, then the offer page opens with them (/trades/new?with=…). */
export function FriendPicker({ mobile, onClose }: { mobile?: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { data, isLoading } = useFriends();
  const [query, setQuery] = useState('');
  const friends = data?.friends ?? [];
  const q = query.trim().toLowerCase();
  const shown = q ? friends.filter((f) => f.username.toLowerCase().includes(q) || (f.displayName ?? '').toLowerCase().includes(q)) : friends;
  const pick = (username: string) => navigate(`/trades/new?with=${encodeURIComponent(username)}`);

  return (
    <Modal label="New offer" mobile={mobile} width={520} onClose={onClose}>
      <h2 style={{ fontSize: mobile ? 20 : 24, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.01em' }}>Who do you want to trade with?</h2>
      {isLoading && <Spinner size={28} />}
      {data && friends.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-2)' }}>Trades are between friends. Add someone by name first, then come back here.</p>
          <Button variant="secondary" size={44} to="/friends" style={{ paddingInline: 18 }}>
            Find friends
          </Button>
        </div>
      )}
      {friends.length > 0 && (
        <>
          {/* Desktop: type right away. Mobile: no keyboard over the list until the field is tapped. */}
          <SearchField label="Find a friend" hideLabel value={query} onChange={setQuery} placeholder="Search your friends" inputProps={mobile ? undefined : { autoFocus: true }} />
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {shown.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="row-link"
                  onClick={() => pick(f.username)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', border: 0, borderTop: '1px solid var(--separator)', background: 'none', color: 'var(--text)', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                >
                  <Avatar name={f.username} url={f.avatarUrl} size={36} />
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{f.username}</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
                      {statsLine(f.stats)}
                    </span>
                  </span>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" style={{ flex: 'none', fill: 'none', stroke: 'var(--text-3)', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-2)' }}>No friend called “{query.trim()}”.</p>}
        </>
      )}
    </Modal>
  );
}
