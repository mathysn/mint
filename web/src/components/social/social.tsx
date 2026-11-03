import { Link } from 'react-router';
import type { FriendCard, PlayerCard, PlayerStats, Tier } from '../../../../shared/api';
import { formatCredits, shortDate } from '../../lib/format';
import { RARITY } from '../../lib/rarity';
import { useFriendActions } from '../../lib/social';
import itemStyles from '../items/items.module.css';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/primitives';

export const FRIENDS_ICON = 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a7 7 0 0 0-4-6.3';
export const TRADES_ICON = 'M4 8h15l-4-4M20 16H5l4 4';
export const MARKET_ICON = 'M3 12V3h9l9 9-9 9zM7 7h1v1H7z';

/** Where a profile opened from the friends screen goes back to. */
export const FRIENDS_BACK = { back: { to: '/friends', label: 'Friends' } };

const profilePath = (username: string) => `/players/${encodeURIComponent(username)}`;

/** Guests: friends, trades and the market need a Discord account. Each screen says what it unlocks. */
export function AccountRequired({ title, text, icon = FRIENDS_ICON }: { title: string; text: string; icon?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, padding: 28, border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' }}>
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'var(--text-3)', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
        <path d={icon} />
      </svg>
      <p style={{ fontSize: 16, fontWeight: 600 }}>{title}</p>
      <p style={{ maxWidth: 440, fontSize: 14, lineHeight: 1.55, color: 'var(--text-2)' }}>{text}</p>
      <Button variant="secondary" size={44} to="/connect" style={{ marginTop: 6, paddingInline: 20 }}>
        Continue with Discord
      </Button>
    </div>
  );
}

/** "≈ 64,800 CR · albums 29%" */
export const statsLine = (s: PlayerStats) => `≈ ${formatCredits(s.inventoryValue)} CR · albums ${s.albumsPct}%`;

/** Showcase as small tiles with their rarity bar. */
export function MiniShowcase({ tiers, mobile }: { tiers: Tier[]; mobile?: boolean }) {
  const label = tiers.length ? `Showcase: ${tiers.map((t) => (t === 'gold' ? '★' : RARITY[t].name)).join(', ')}` : 'Showcase: empty';
  return (
    <div role="img" aria-label={label} style={{ display: 'flex', gap: mobile ? 3 : 4 }}>
      {tiers.map((tier, i) => (
        <span
          key={i}
          style={{
            ...(mobile ? { flex: 1, height: 18 } : { width: 30, height: 22 }),
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-control)',
            overflow: 'hidden',
          }}
        >
          <span style={{ height: mobile ? 2 : 3, background: RARITY[tier].color }} />
        </span>
      ))}
    </div>
  );
}

const name = (p: { displayName: string | null; username: string }) => p.username;

/** List rows that open a profile: the name link covers the row, buttons sit above it. */
const ROW = { position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', margin: '0 -8px', borderTop: '1px solid var(--separator)' } as const;
const ABOVE = { position: 'relative', zIndex: 2 } as const;

/** Friends list row (desktop): the whole row opens the profile, Trade stays its own button. */
export function FriendRow({ friend }: { friend: FriendCard }) {
  return (
    <li
      className="tile-link"
      style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 20px', padding: '16px 18px', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' }}
    >
      <Avatar name={name(friend)} url={friend.avatarUrl} size={44} />
      <div style={{ flex: '1 1 160px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Link to={profilePath(friend.username)} state={FRIENDS_BACK} className={itemStyles.stretch} style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>
          {name(friend)}
        </Link>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {statsLine(friend.stats)} · since {shortDate(friend.since)}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="lbl" style={{ fontSize: 10 }}>
          Showcase
        </span>
        <MiniShowcase tiers={friend.showcase} />
      </div>
      <Button variant="secondary" size={44} to={`/trades/new?with=${encodeURIComponent(friend.username)}`} style={{ ...ABOVE, height: 40, fontSize: 13, paddingInline: 14 }}>
        Trade
      </Button>
    </li>
  );
}

/** Friends list card (mobile): whole card links to the profile. */
export function FriendCardMobile({ friend }: { friend: FriendCard }) {
  return (
    <Link
      to={profilePath(friend.username)}
      state={FRIENDS_BACK}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)', color: 'var(--text)', textDecoration: 'none' }}
    >
      <Avatar name={name(friend)} url={friend.avatarUrl} size={40} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{name(friend)}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
            {formatCredits(friend.stats.inventoryValue)} CR · {friend.stats.albumsPct}%
          </span>
        </span>
        <MiniShowcase tiers={friend.showcase} mobile />
      </span>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" style={{ flex: 'none', fill: 'none', stroke: 'var(--text-3)', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  );
}

/** "Add a friend" search results: Add / Accept, or a Friend / Requested tag. */
export function SearchResults({ results }: { results: PlayerCard[] }) {
  const { add, accept } = useFriendActions();
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
      {results.map((r) => (
        <li key={r.id} className="row-link" style={ROW}>
          <Avatar name={name(r)} url={r.avatarUrl} />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Link to={profilePath(r.username)} state={FRIENDS_BACK} className={itemStyles.stretch} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>
              {name(r)}
            </Link>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{r.relation === 'incoming' ? 'Wants to be your friend' : statsLine(r.stats)}</span>
          </span>
          {r.relation === 'none' && (
            <Button variant="secondary" size={44} onClick={() => add.mutate(r.username)} disabled={add.isPending} style={{ ...ABOVE, height: 36, fontSize: 13, paddingInline: 12 }}>
              Add
            </Button>
          )}
          {r.relation === 'incoming' && (
            <Button size={44} bevel="none" onClick={() => accept.mutate(r.id)} disabled={accept.isPending} style={{ ...ABOVE, height: 36, fontSize: 13, paddingInline: 12 }}>
              Accept
            </Button>
          )}
          {(r.relation === 'friend' || r.relation === 'outgoing') && (
            <span className="lbl" style={{ fontSize: 10 }}>
              {r.relation === 'friend' ? 'Friend' : 'Requested'}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Received request: Decline / Accept. Mobile uses a × button, as in the mockup. */
export function IncomingRow({ player, mobile }: { player: PlayerCard; mobile?: boolean }) {
  const { accept, drop } = useFriendActions();
  return (
    <li className="row-link" style={{ ...ROW, flexWrap: 'wrap', gap: mobile ? 12 : '10px 12px', padding: '12px 8px' }}>
      <Avatar name={name(player)} url={player.avatarUrl} size={mobile ? 36 : 32} />
      <span style={{ flex: '1 1 100px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Link to={profilePath(player.username)} state={FRIENDS_BACK} className={itemStyles.stretch} style={{ fontSize: mobile ? 15 : 14, fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>
          {name(player)}
        </Link>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {statsLine(player.stats)}
        </span>
      </span>
      <span style={{ ...ABOVE, display: 'flex', gap: mobile ? 8 : 6 }}>
        {mobile ? (
          <button
            type="button"
            aria-label={`Decline ${name(player)}`}
            onClick={() => drop.mutate(player.id)}
            style={{ width: 44, height: 44, border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-control)', background: 'transparent', color: 'var(--text-2)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : (
          <Button variant="ghost" size={44} onClick={() => drop.mutate(player.id)} style={{ height: 36, fontSize: 13, paddingInline: 10 }}>
            Decline
          </Button>
        )}
        <Button size={44} bevel="none" onClick={() => accept.mutate(player.id)} disabled={accept.isPending} style={mobile ? { fontSize: 14, paddingInline: 14 } : { height: 36, fontSize: 13, paddingInline: 12 }}>
          Accept
        </Button>
      </span>
    </li>
  );
}

/** Sent request: Pending / Cancel. */
export function OutgoingRow({ player }: { player: PlayerCard }) {
  const { drop } = useFriendActions();
  return (
    <li className="row-link" style={ROW}>
      <Avatar name={name(player)} url={player.avatarUrl} />
      <Link to={profilePath(player.username)} state={FRIENDS_BACK} className={itemStyles.stretch} style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>
        {name(player)}
      </Link>
      <span className="lbl" style={{ fontSize: 10 }}>
        Pending
      </span>
      <Button variant="ghost" size={44} onClick={() => drop.mutate(player.id)} style={{ ...ABOVE, height: 36, fontSize: 13, paddingInline: 8 }}>
        Cancel
      </Button>
    </li>
  );
}
