import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Page } from '../components/layout/AppShell';
import { DeleteAccount } from '../components/layout/DeleteAccount';
import { LegalFooter } from '../components/layout/LegalFooter';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/primitives';
import { api } from '../lib/api';
import { isActivity } from '../lib/platform';
import { useEconomyText, useMe } from '../lib/queries';
import { useProfile } from '../lib/social';

// Sections of "Play together", in the order of the mockup.
const LINKS = [
  { to: '/market', label: 'Market', hint: 'Auctions, your listings and bids', icon: 'M3 12V3h9l9 9-9 9zM7 7h1v1H7z' },
  { to: '/trades', label: 'Trades', hint: 'Offers from and to your friends', icon: 'M4 8h15l-4-4M20 16H5l4 4' },
  { to: '/tradeup', label: 'Trade-up', hint: '10 skins in, 1 rarer skin out', icon: 'M12 20V5M6 11l6-6 6 6M5 20h14' },
  { to: '/friends', label: 'Friends', hint: 'Requests, search by name', icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a7 7 0 0 0-4-6.3' },
  { to: '/leaderboard', label: 'Leaderboard', hint: 'Inventory value and albums', icon: 'M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7' },
];

const chevron = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" style={{ flex: 'none', fill: 'none', stroke: 'var(--text-3)', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/** Mobile "More" tab: profile, the other sections, account. */
export function More() {
  const { data: me } = useMe();
  const tradeupSize = useEconomyText().tradeupSize;
  const client = useQueryClient();
  const navigate = useNavigate();
  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' });
    await client.resetQueries();
    navigate('/');
  };
  const name = me?.username ?? null;
  const { data: profile } = useProfile(me && !me.isGuest && name ? name : '');

  return (
    <Page gap={24} mobilePadding="16px 20px 32px">
      {me && !me.isGuest && name ? (
        <Link
          to={`/players/${encodeURIComponent(name)}`}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)', color: 'var(--text)', textDecoration: 'none' }}
        >
          <Avatar name={name} url={me.avatarUrl} size={48} />
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 17, fontWeight: 600 }}>{name}</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {profile ? `#${profile.ranks.value} by value · #${profile.ranks.albums} by albums` : 'View profile'}
            </span>
          </span>
          {chevron}
        </Link>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '18px 20px', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Avatar name={null} guest />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Playing as guest</span>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Sign in with Discord to trade, sell and add friends.</span>
            </div>
          </div>
          <Button variant="secondary" size={48} block to="/connect">
            Continue with Discord
          </Button>
        </div>
      )}

      <nav aria-label="More sections" style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="lbl" style={{ paddingBottom: 8 }}>
          // Play together
        </span>
        {LINKS.map((l) => {
          const count = l.to === '/friends' ? (me?.friendRequests ?? 0) : l.to === '/trades' ? (me?.tradeOffers ?? 0) : 0;
          return (
            <Link key={l.to} to={l.to} style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 56, borderTop: '1px solid var(--separator)', color: 'var(--text)', textDecoration: 'none' }}>
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" style={{ flex: 'none', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                <path d={l.icon} />
              </svg>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 16, fontWeight: 500 }}>{l.label}</span>
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{l.to === '/tradeup' ? `${tradeupSize} skins in, 1 rarer skin out` : l.hint}</span>
              </span>
              {count > 0 && (
                <span className="mono" aria-label={`${count} waiting`} style={{ minWidth: 22, height: 22, padding: '0 7px', borderRadius: 11, background: 'var(--primary-bg)', color: 'var(--primary-text)', fontSize: 12, fontWeight: 600, display: 'grid', placeItems: 'center' }}>
                  {count}
                </span>
              )}
              {chevron}
            </Link>
          );
        })}
      </nav>

      <section aria-labelledby="acc" style={{ display: 'flex', flexDirection: 'column' }}>
        <h2 id="acc" className="lbl" style={{ paddingBottom: 8 }}>
          // Account
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, borderTop: '1px solid var(--separator)' }}>
          <span style={{ fontSize: 15 }}>Discord</span>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{me && !me.isGuest ? `Signed in as ${name}` : 'Not signed in'}</span>
        </div>
        {me && !me.isGuest && !isActivity && (
          <button
            type="button"
            onClick={() => void signOut()}
            style={{ display: 'flex', alignItems: 'center', minHeight: 56, padding: 0, border: 0, borderTop: '1px solid var(--separator)', background: 'none', color: 'var(--text-2)', font: 'inherit', fontSize: 15, textAlign: 'left', cursor: 'pointer' }}
          >
            Sign out
          </button>
        )}
        {me && !me.isGuest && name && !isActivity && (
          <DeleteAccount
            username={name}
            mobile
            trigger={(open) => (
              <button
                type="button"
                onClick={open}
                style={{ display: 'flex', alignItems: 'center', minHeight: 56, padding: 0, border: 0, borderTop: '1px solid var(--separator)', background: 'none', color: 'var(--text-3)', font: 'inherit', fontSize: 15, textAlign: 'left', cursor: 'pointer' }}
              >
                Delete my account
              </button>
            )}
          />
        )}
      </section>
      <LegalFooter style={{ fontSize: 12 }} />
    </Page>
  );
}
