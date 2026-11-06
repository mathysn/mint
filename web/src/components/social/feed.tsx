import { Link } from 'react-router';
import type { FeedEntry } from '../../../../shared/api';
import { formatCredits, formatFloat, timeAgo } from '../../lib/format';
import { RARITY, fullName } from '../../lib/rarity';
import { useNow } from '../../lib/queries';
import { useFeed } from '../../lib/social';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/primitives';

/** "Covert · StatTrak™ · FT · 0.2210"; a sale ends with its price: "Classified · FN · 3,400 CR". */
function meta(entry: FeedEntry) {
  const item = entry.item;
  const sale = entry.type === 'sale' && entry.price !== null;
  return [
    RARITY[item.skin.tier].name,
    item.stattrak ? 'StatTrak™' : null,
    item.wear && item.float !== null ? (sale ? item.wear.code : `${item.wear.code} · ${formatFloat(item.float, 4)}`) : 'Vanilla',
    sale ? `${formatCredits(entry.price!)} CR` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const VERB: Record<FeedEntry['type'], string> = { unbox: 'unboxed', sale: 'sold', tradeup: 'traded up to' };

/** Mobile puts the price in the verb: "sold for 3,400 CR". */
const mobileVerb = (entry: FeedEntry) => (entry.type === 'sale' && entry.price !== null ? `sold for ${formatCredits(entry.price)} CR` : VERB[entry.type]);

/** Friends' activity on the home screen (signed-in players). Refreshed every minute. */
const HOME_BACK = { back: { to: '/', label: 'Home' } };

export function FriendsFeed({ mobile }: { mobile?: boolean }) {
  const { data: feed } = useFeed(true);
  const now = useNow(true);
  if (!feed) return null;
  if (feed.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: mobile ? '8px 0 12px' : '24px 0 4px' }}>
        <p style={{ fontSize: mobile ? 14 : 16, fontWeight: 600 }}>No activity yet</p>
        <p style={{ fontSize: mobile ? 13 : 14, lineHeight: 1.55, color: 'var(--text-2)' }}>Your friends’ Classified, Covert and ★ pulls and sales show up here.</p>
        <Button variant="secondary" size={44} to="/friends" style={{ marginTop: 4, paddingInline: 20 }}>
          Find friends
        </Button>
      </div>
    );
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
      {feed.map((entry) => {
        const text = RARITY[entry.item.skin.tier].text;
        const profile = `/players/${encodeURIComponent(entry.player.username)}`;
        return (
          <li key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: mobile ? 12 : 14, padding: mobile ? '12px 0' : '14px 0', borderTop: '1px solid var(--separator)' }}>
            <Link to={profile} state={HOME_BACK} aria-label={entry.player.username} style={{ flex: 'none' }}>
              <Avatar name={entry.player.username} url={entry.player.avatarUrl} size={mobile ? 32 : 36} />
            </Link>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: mobile ? 2 : 3 }}>
              {mobile ? (
                <>
                  <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <strong>{entry.player.username}</strong> <span style={{ color: 'var(--text-2)' }}>{mobileVerb(entry)}</span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName(entry.item.skin)}</span>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 14 }}>
                    <Link to={profile} state={HOME_BACK} style={{ fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>
                      {entry.player.username}
                    </Link>
                    <span style={{ color: 'var(--text-2)' }}>{VERB[entry.type]}</span>
                    <span style={{ fontWeight: 600, color: text }}>{fullName(entry.item.skin)}</span>
                  </div>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {meta(entry)}
                  </span>
                </>
              )}
            </div>
            <span className="mono" style={{ flex: 'none', fontSize: mobile ? 11 : 12, color: 'var(--text-3)' }}>
              {timeAgo(entry.createdAt, now, mobile)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
