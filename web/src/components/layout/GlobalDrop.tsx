import { Link, useLocation } from 'react-router';
import { formatFloat, timeAgo } from '../../lib/format';
import { useNow } from '../../lib/queries';
import { fullName } from '../../lib/rarity';
import { useLatestDrop } from '../../lib/tradeup';

const SECTIONS: Record<string, string> = {
  '': 'Home',
  cases: 'Cases',
  inventory: 'Inventory',
  albums: 'Albums',
  market: 'Market',
  trades: 'Trades',
  tradeup: 'Trade-up',
  friends: 'Friends',
  leaderboard: 'Leaderboard',
};

/** "★ GLOBAL DROP" banner (DESIGN.md §3): 40 px above the content of every desktop screen. */
export function GlobalDropBanner() {
  const location = useLocation();
  const { data: drop } = useLatestDrop();
  const now = useNow(Boolean(drop));
  if (!drop) return null;
  const item = drop.item;
  const wear = item.wear && item.float !== null ? `${item.wear.code} · ${formatFloat(item.float, 4)}` : 'Vanilla';
  return (
    // Keyed by the item: a new ★ drop slides in.
    <div
      key={item.id}
      role="status"
      style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, minHeight: 40, padding: '8px 32px', borderBottom: '1px solid var(--border)', background: 'var(--rail)', fontSize: 13, animation: 'mint-slide-down 420ms var(--ease-out) both' }}
    >
      <span className="lbl" style={{ color: 'var(--gold)' }}>
        ★ Global drop
      </span>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 }}>
        {drop.player ? (
          <Link
            to={`/players/${encodeURIComponent(drop.player.username)}`}
            state={{ back: { to: location.pathname + location.search, label: SECTIONS[location.pathname.split('/')[1] ?? ''] ?? 'Back' } }}
            style={{ fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}
          >
            {drop.player.username}
          </Link>
        ) : (
          <span style={{ fontWeight: 600 }}>A guest</span>
        )}
        <span style={{ color: 'var(--text-2)' }}>unboxed</span>
        <span style={{ color: 'var(--gold-text)', fontWeight: 600 }}>{fullName(item.skin)}</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {item.stattrak ? `ST™ · ${wear}` : wear}
        </span>
      </span>
      <span className="mono" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
        {timeAgo(drop.createdAt, now)}
      </span>
    </div>
  );
}
