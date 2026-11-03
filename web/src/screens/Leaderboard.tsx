import type { CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { LeaderboardBoard, LeaderboardEntry, LeaderboardScope } from '../../../shared/api';
import { Page } from '../components/layout/AppShell';
import { SkinArt } from '../components/items/items';
import itemStyles from '../components/items/items.module.css';
import { Tabs } from '../components/trades/trades';
import { Avatar, Halo, HudLabel } from '../components/ui/primitives';
import { formatCredits } from '../lib/format';
import { RARITY, fullName } from '../lib/rarity';
import { useIsAccount } from '../lib/social';
import { rankLabel, useLeaderboard } from '../lib/tradeup';
import { useIsMobile } from '../lib/useMediaQuery';

const EXPLAIN: Record<LeaderboardBoard, string> = {
  value: 'Each item counts at its recent average sale price, or its recycle value if it has never sold.',
  albums: 'Skins collected across every album, with the number of albums completed.',
};

const metricText = (board: LeaderboardBoard, e: LeaderboardEntry, compact = false) =>
  board === 'value' ? (compact ? (e.metric >= 1000 ? `${(e.metric / 1000).toFixed(1)}k CR` : `${formatCredits(e.metric)} CR`) : `${formatCredits(e.metric)} CR`) : `${formatCredits(e.metric)} skins`;

const albumsText = (e: LeaderboardEntry) => (e.completeAlbums === 0 ? 'No complete album yet' : `${e.completeAlbums} complete album${e.completeAlbums > 1 ? 's' : ''}`);

const subOf = (board: LeaderboardBoard, e: LeaderboardEntry) =>
  board === 'value'
    ? e.best
      ? { text: fullName(e.best), color: RARITY[e.best.tier].text, dot: RARITY[e.best.tier].color }
      : { text: 'No items yet', color: 'var(--text-3)', dot: null }
    : { text: albumsText(e), color: 'var(--text-2)', dot: null };

const profileLink = (e: LeaderboardEntry) => `/players/${encodeURIComponent(e.player.username)}`;

function Tag({ e, scope }: { e: LeaderboardEntry; scope: LeaderboardScope }) {
  if (!e.isYou && !(e.isFriend && scope === 'all')) return null;
  return (
    <span className="lbl" style={{ fontSize: 9, color: 'var(--text)' }}>
      {e.isYou ? 'You' : 'Friend'}
    </span>
  );
}

export function Leaderboard() {
  const mobile = useIsMobile();
  const account = useIsAccount();
  const [params, setParams] = useSearchParams();
  const board: LeaderboardBoard = params.get('board') === 'albums' ? 'albums' : 'value';
  const scope: LeaderboardScope = account && params.get('scope') === 'friends' ? 'friends' : 'all';
  const { data } = useLeaderboard(board, scope);
  const set = (patch: { board?: LeaderboardBoard; scope?: LeaderboardScope }) => {
    const next = new URLSearchParams(params);
    const b = patch.board ?? board;
    const s = patch.scope ?? scope;
    if (b === 'value') next.delete('board');
    else next.set('board', b);
    if (s === 'all') next.delete('scope');
    else next.set('scope', s);
    setParams(next, { replace: true });
  };
  // Profiles opened from here come back to this exact board ("← Leaderboard").
  const lbBack = { back: { to: `/leaderboard${params.toString() ? `?${params}` : ''}`, label: 'Leaderboard' } };
  const entries = data && data.board === board && data.scope === scope ? data.entries : [];
  const you = data?.you ?? null;
  const pinYou = you !== null && !entries.some((e) => e.isYou);
  const podium = entries.slice(0, 3);
  const rows = entries.slice(3);

  const scopes = account && (
    <div role="radiogroup" aria-label="Who" style={{ display: 'flex', gap: 6, paddingBottom: mobile ? 0 : 8 }}>
      {(['all', 'friends'] as const).map((s) => {
        const on = scope === s;
        const look: CSSProperties = mobile
          ? on
            ? { border: '1px solid var(--text)', background: 'var(--track)', color: 'var(--text)' }
            : { border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--text-2)' }
          : on
            ? { border: '1px solid var(--primary-bg)', background: 'var(--primary-bg)', color: 'var(--primary-text)' }
            : { border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--text-2)' };
        return (
          <button key={s} type="button" role="radio" aria-checked={on} className={on ? undefined : 'chip-quick'} onClick={() => set({ scope: s })} style={{ height: 36, padding: '0 14px', borderRadius: 'var(--radius-control)', font: 'inherit', fontSize: 13, fontWeight: mobile ? undefined : 500, cursor: 'pointer', ...look }}>
            {s === 'all' ? 'Everyone' : 'Friends'}
          </button>
        );
      })}
    </div>
  );

  const empty = data && entries.length === 0 && (
    <div style={{ padding: '48px 24px', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-panel)', textAlign: 'center', fontSize: 14, color: 'var(--text-2)' }}>
      {scope === 'friends' ? 'Add friends to compare your collections.' : 'Nobody is ranked yet.'}
    </div>
  );

  if (mobile) {
    const order = [podium[1], podium[0], podium[2]].filter((e): e is LeaderboardEntry => Boolean(e));
    return (
      <Page gap={16} back={{ to: '/more', label: 'More' }} mobilePadding={`8px 20px ${you ? 96 : 24}px`}>
        <h1 style={{ fontSize: 30, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>Leaderboard</h1>
        <Tabs<LeaderboardBoard>
          label="Ranking"
          mobile
          value={board}
          onChange={(b) => set({ board: b })}
          tabs={[
            { value: 'value', label: 'Inventory value' },
            { value: 'albums', label: 'Albums' },
          ]}
        />
        {scopes}
        {empty}
        {order.length > 0 && (
          <div className="stagger-list" style={{ display: 'grid', gridTemplateColumns: `repeat(${order.length}, minmax(0, 1fr))`, gap: 8, alignItems: 'end' }}>
            {order.map((e) => {
              const first = e.rank === 1;
              return (
                <Link
                  key={e.player.id}
                  to={profileLink(e)}
                  state={lbBack}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: first ? '22px 8px' : '14px 8px', border: `1px solid ${e.isYou ? 'var(--text)' : first ? 'var(--border-hover)' : 'var(--border)'}`, borderRadius: 'var(--radius-panel)', background: 'var(--surface)', color: 'var(--text)', textDecoration: 'none', textAlign: 'center', minWidth: 0 }}
                >
                  <span className="mono" style={{ fontSize: 22, fontWeight: 600, color: first ? 'var(--text)' : 'var(--hud)' }}>
                    {rankLabel(e.rank)}
                  </span>
                  <Avatar name={e.player.username} url={e.player.avatarUrl} size={first ? 48 : 38} />
                  <span style={{ maxWidth: '100%', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.player.username}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
                    {metricText(board, e, true)}
                  </span>
                  {(e.isYou || (e.isFriend && scope === 'all')) && (
                    <span className="lbl" style={{ fontSize: 8 }}>
                      {e.isYou ? 'You' : 'Friend'}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
        <ol className="stagger-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
          {rows.map((e) => {
            const sub = subOf(board, e);
            return (
              <li key={e.player.id} style={{ borderTop: '1px solid var(--separator)' }}>
                <Link to={profileLink(e)} state={lbBack} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, color: 'var(--text)', textDecoration: 'none', background: e.isYou ? 'var(--nav-hover)' : undefined }}>
                  <span className="mono" style={{ width: 26, fontSize: 13, color: 'var(--text-3)' }}>
                    {rankLabel(e.rank)}
                  </span>
                  <Avatar name={e.player.username} url={e.player.avatarUrl} size={28} />
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: e.isYou ? 600 : 500 }}>
                      {e.player.username}
                      {e.isYou ? ' · you' : e.isFriend && scope === 'all' ? ' · friend' : ''}
                    </span>
                    <span style={{ fontSize: 11, color: sub.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub.text}</span>
                  </span>
                  <span className="mono" style={{ fontSize: 13 }}>
                    {board === 'value' ? formatCredits(e.metric) : `${formatCredits(e.metric)} skins`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
        {you && (
          <Link
            to={profileLink(you)}
            state={lbBack}
            style={{ position: 'fixed', left: 12, right: 12, bottom: 96, zIndex: 5, display: 'flex', alignItems: 'center', gap: 12, height: 48, padding: '0 14px', border: '1px solid var(--text)', borderRadius: 'var(--radius-card)', background: 'var(--nav-hover)', color: 'var(--text)', textDecoration: 'none' }}
          >
            <span className="mono" style={{ fontSize: 13 }}>
              {you.rank}
            </span>
            <Avatar name={you.player.username} url={you.player.avatarUrl} size={28} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {you.player.username}{' '}
              <span className="lbl" style={{ marginLeft: 4, fontSize: 9, color: 'var(--text)' }}>
                You
              </span>
            </span>
            <span className="mono" style={{ fontSize: 13 }}>
              {metricText(board, you)}
            </span>
          </Link>
        )}
      </Page>
    );
  }

  const grid = '72px minmax(0, 1.2fr) minmax(0, 1.6fr) 160px';
  const row = (e: LeaderboardEntry, pinned = false) => {
    const sub = subOf(board, e);
    return (
      <div
        key={`${e.player.id}${pinned ? '-pin' : ''}`}
        role="row"
        className="row-link"
        style={{ position: 'relative', display: 'grid', gridTemplateColumns: grid, alignItems: 'center', minHeight: 52, borderBottom: pinned ? undefined : '1px solid var(--separator)', ...(e.isYou ? { background: 'var(--nav-hover)', outline: '1px solid var(--text)', outlineOffset: -1 } : {}) }}
      >
        <span role="cell" className="mono" style={{ padding: '0 20px', fontSize: 14, color: e.isYou && pinned ? 'var(--text)' : 'var(--text-2)' }}>
          {rankLabel(e.rank)}
        </span>
        <span role="cell" style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Avatar name={e.player.username} url={e.player.avatarUrl} size={28} />
          <Link to={profileLink(e)} state={lbBack} className={itemStyles.stretch} style={{ fontSize: 14, fontWeight: e.isYou ? 600 : 400, color: 'var(--text)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {e.player.username}
          </Link>
          <Tag e={e} scope={scope} />
        </span>
        <span role="cell" style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, minWidth: 0 }}>
          {sub.dot && <span aria-hidden="true" style={{ flex: 'none', width: 7, height: 7, background: sub.dot }} />}
          <span style={{ color: sub.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub.text}</span>
        </span>
        <span role="cell" className="mono" style={{ padding: '0 20px', fontSize: 14, textAlign: 'right' }}>
          {metricText(board, e)}
        </span>
      </div>
    );
  };

  return (
    <Page gap={28}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <HudLabel>// Leaderboard</HudLabel>
        <h1 style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>Leaderboard</h1>
      </header>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, borderBottom: '1px solid var(--border)' }}>
        <div style={{ marginBottom: -1 }}>
          <Tabs<LeaderboardBoard>
            label="Ranking"
            value={board}
            onChange={(b) => set({ board: b })}
            tabs={[
              { value: 'value', label: 'Inventory value' },
              { value: 'albums', label: 'Album completion' },
            ]}
            bare
          />
        </div>
        {scopes}
      </div>
      <p style={{ marginTop: -8, fontSize: 13, color: 'var(--text-2)' }}>{EXPLAIN[board]}</p>
      {empty}
      {podium.length > 0 && (
        <div className="stagger-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(250px, 100%), 1fr))', gap: 16 }}>
          {podium.map((e) => {
            const first = e.rank === 1;
            const sub = subOf(board, e);
            const tier = board === 'value' && e.best ? RARITY[e.best.tier] : null;
            return (
              <article key={e.player.id} className="tile-link" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 18, padding: 26, borderRadius: 'var(--radius-panel)', background: 'var(--surface)', border: `1px solid ${e.isYou ? 'var(--text)' : first ? 'var(--border-hover)' : 'var(--border)'}` }}>
                {first && (
                  <>
                    <span aria-hidden="true" style={{ position: 'absolute', left: 10, top: 10, width: 16, height: 16, borderLeft: '1px solid var(--text)', borderTop: '1px solid var(--text)' }} />
                    <span aria-hidden="true" style={{ position: 'absolute', right: 10, bottom: 10, width: 16, height: 16, borderRight: '1px solid var(--text)', borderBottom: '1px solid var(--text)' }} />
                  </>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span className="mono" style={{ fontSize: 44, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.03em', color: first ? 'var(--text)' : 'var(--hud)' }}>
                    {rankLabel(e.rank)}
                  </span>
                  {(e.isYou || (e.isFriend && scope === 'all')) && (
                    <span className="lbl" style={{ fontSize: 10, color: 'var(--text)' }}>
                      {e.isYou ? 'You' : 'Friend'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar name={e.player.username} url={e.player.avatarUrl} size={40} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <Link to={profileLink(e)} state={lbBack} className={itemStyles.stretch} style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>
                      {e.player.username}
                    </Link>
                    <span className="mono" style={{ fontSize: 15, color: 'var(--text-2)' }}>
                      {metricText(board, e)}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 16, borderTop: '1px solid var(--separator)' }}>
                  <span style={{ position: 'relative', flex: 'none', width: 72, height: 36, display: 'grid', placeItems: 'center' }}>
                    {tier && e.best ? (
                      <>
                        <Halo color={tier.halo} inset="0" />
                        <SkinArt skin={e.best} width="100%" style={{ position: 'relative', maxHeight: '100%' }} />
                      </>
                    ) : (
                      <AlbumIcon />
                    )}
                  </span>
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="lbl" style={{ fontSize: 9 }}>
                      {board === 'value' ? 'Best item' : 'Albums'}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: sub.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub.text}</span>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {(rows.length > 0 || pinYou) && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' }}>
          <div role="table" className="stagger-list" aria-label={`${board === 'value' ? 'Inventory value' : 'Skins collected'} ranking`} style={{ minWidth: 620, display: 'flex', flexDirection: 'column' }}>
            <div role="row" style={{ display: 'grid', gridTemplateColumns: grid, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
              <span role="columnheader" className="lbl" style={{ padding: '14px 20px' }}>
                Rank
              </span>
              <span role="columnheader" className="lbl" style={{ padding: '14px 12px' }}>
                Player
              </span>
              <span role="columnheader" className="lbl" style={{ padding: '14px 12px' }}>
                {board === 'value' ? 'Best item' : 'Albums'}
              </span>
              <span role="columnheader" className="lbl" style={{ padding: '14px 20px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {board === 'value' ? 'Inventory value' : 'Skins collected'}
              </span>
            </div>
            {rows.map((e) => row(e))}
            {pinYou && you && (
              <>
                <div aria-hidden="true" className="mono" style={{ padding: '8px 20px', borderBottom: '1px solid var(--separator)', fontSize: 12, color: 'var(--hud)' }}>
                  · · ·
                </div>
                {row(you, true)}
              </>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}

/** Album glyph of the albums podium (the mockup's "album" art). */
const AlbumIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 240 100" style={{ width: '100%', fill: 'var(--text-2)', fillRule: 'evenodd' }}>
    <path d="M70 20H170V90H70Z M80 30H110V52H80Z M130 30H160V52H130Z M80 60H110V82H80Z M130 60H160V82H130Z" />
  </svg>
);
