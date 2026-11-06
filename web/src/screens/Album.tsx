import { useLayoutEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import type { AlbumDetail, AlbumSkin, Tier } from '../../../shared/api';
import { AlbumCard, AlbumList, CompletionBar, pct } from '../components/albums/albums';
import { Page } from '../components/layout/AppShell';
import { Chip } from '../components/ui/fields';
import { ScrollArea } from '../components/ui/Scrollbar';
import { EmptyState, HudLabel } from '../components/ui/primitives';
import { useAlbum, useAlbums } from '../lib/queries';
import { usePlayerAlbum, usePlayerAlbums } from '../lib/social';
import { RARITY } from '../lib/rarity';
import { useIsMobile } from '../lib/useMediaQuery';
import { usePresence } from '../lib/usePresence';
import s from './screens.module.css';

interface Group {
  key: string;
  tier: Tier;
  name: string;
  owned: number;
  total: number | 'any';
  skins: AlbumSkin[];
}

/** Covert → Mil-Spec, then the ★ finishes found (not counted, total "any"). */
function groupsOf(detail: AlbumDetail, missingOnly: boolean): Group[] {
  const groups: Group[] = detail.groups.map((g) => ({ key: g.tier, tier: g.tier, name: RARITY[g.tier].name, owned: g.owned, total: g.total, skins: g.skins }));
  if (detail.special.length) {
    groups.push({ key: 'gold', tier: 'gold', name: '★ Rare special · finishes found', owned: detail.special.length, total: 'any', skins: detail.special });
  }
  return groups.map((g) => ({ ...g, skins: missingOnly ? g.skins.filter((x) => !x.best) : g.skins })).filter((g) => g.skins.length > 0);
}

/** Your albums, or a friend's (read-only) under /players/:username/albums. */
function useAlbumData(id: string) {
  const { username: player } = useParams();
  const own = !player;
  const mine = useAlbums(own);
  const theirs = usePlayerAlbums(player ?? '', !own);
  const ownDetail = useAlbum(id, own);
  const theirDetail = usePlayerAlbum(player ?? '', id, !own);
  const base = player ? `/players/${encodeURIComponent(player)}/albums` : '/albums';
  return {
    player,
    base,
    albums: own ? mine.data : theirs.data,
    detail: own ? ownDetail.data : theirDetail.data,
    error: own ? ownDetail.error : theirDetail.error,
  };
}

/**
 * Document offset of the album row: the pinned list sticks exactly there, so it never moves
 * when the page scrolls (the global-drop banner above it can come and go, hence the observer).
 */
function usePinTop(active: boolean) {
  const row = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => setTop(Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [active]);
  return { row, top };
}

/** /albums → the first album of the list (most complete). */
export function AlbumsIndex() {
  const { albums, base } = useAlbumData('');
  if (!albums) return null;
  return albums[0] ? <Navigate to={`${base}/${albums[0].id}`} replace /> : <EmptyState title="No albums yet" />;
}

export function Album() {
  const { id = '' } = useParams();
  const mobile = useIsMobile();
  const [missingOnly, setMissingOnly] = useState(false);
  const pin = usePinTop(!mobile);
  const [picker, setPicker] = useState(false);
  const pickerPresence = usePresence(picker, 180);
  const { player, base, albums, detail, error } = useAlbumData(id);
  const playerBack = player ? { to: `/players/${encodeURIComponent(player)}`, label: player } : undefined;
  const cardBack = { to: `${base}/${id}`, label: 'Albums' };

  if (error) return <Navigate to={playerBack?.to ?? '/albums'} replace />;

  const album = detail?.album;
  const groups = detail ? groupsOf(detail, missingOnly) : [];
  const summary = detail?.groups ?? [];

  const chips = (
    <div role="group" aria-label="Show" style={mobile ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 } : { display: 'flex', gap: 8 }}>
      {[
        { on: !missingOnly, label: 'All', pick: () => setMissingOnly(false) },
        { on: missingOnly, label: 'Missing only', pick: () => setMissingOnly(true) },
      ].map((c) => (
        <Chip key={c.label} pressed={c.on} onClick={c.pick} style={{ ...(c.on ? {} : { color: 'var(--text-2)' }), ...(mobile ? { height: 40, justifyContent: 'center' } : {}) }}>
          {c.label}
        </Chip>
      ))}
    </div>
  );

  const groupSections = groups.map((g) => {
    const rarity = RARITY[g.tier];
    return (
      <section key={g.key} aria-label={g.name} style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 10 : 14, paddingTop: mobile ? 6 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 8 : 10 }}>
          <span aria-hidden="true" style={{ width: mobile ? 8 : 10, height: mobile ? 8 : 10, background: rarity.color, flex: 'none' }} />
          <h2 style={{ fontSize: mobile ? 13 : 14, fontWeight: 600, color: rarity.text }}>{g.name}</h2>
          <span aria-hidden="true" style={{ flex: 1, height: 1, background: 'var(--separator)' }} />
          <span className="mono" style={{ fontSize: mobile ? 11 : 12, color: 'var(--text-3)' }}>
            {`${g.owned} / ${g.total}`}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))', gap: mobile ? 10 : 14 }}>
          {g.skins.map((skin, i) => (
            <AlbumCard key={skin.id} skin={skin} mobile={mobile} back={cardBack} index={i} />
          ))}
        </div>
      </section>
    );
  });

  const summaryList = (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, ...(mobile ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 16px' } : { display: 'flex', flexWrap: 'wrap', gap: 20 }) }}>
      {summary.map((g) => (
        <li key={g.tier} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, background: RARITY[g.tier].color, flex: 'none' }} />
          <span style={{ color: 'var(--text-2)' }}>{RARITY[g.tier].name}</span>
          <span className="mono" style={mobile ? { marginLeft: 'auto' } : undefined}>
            {g.owned} / {g.total}
          </span>
          {g.owned === g.total && (
            <span className="lbl" style={{ color: 'var(--text)' }}>
              Complete
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  if (mobile) {
    return (
      <Page gap={18} mobilePadding="12px 20px 32px" back={playerBack}>
        <button
          type="button"
          aria-haspopup="listbox"
          onClick={() => setPicker(true)}
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: 0, border: 0, background: 'none', color: 'var(--text-2)', fontSize: 14, cursor: 'pointer' }}
        >
          <span className="lbl">// Albums</span>
          <span>· {albums?.length ?? 0}</span>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2 }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {album && detail && (
          <>
            <h1 style={{ marginTop: -10, fontSize: 30, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>{album.name}</h1>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span className="mono" style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.02em' }}>
                {album.owned}
                <span style={{ color: 'var(--hud)' }}> / {album.total}</span>
              </span>
              <span className="mono" style={{ fontSize: 15, color: 'var(--text-2)' }}>
                {pct(album)}%
              </span>
            </div>
            <CompletionBar detail={detail} mobile />
            {summaryList}
            {chips}
            {groupSections}
            {groups.length === 0 && <EmptyState title="Album complete" />}
          </>
        )}
        {pickerPresence.mounted && albums && (
          <>
            <div className={s.sheetBackdrop} data-closing={pickerPresence.closing || undefined} onClick={() => setPicker(false)} />
            <div role="dialog" aria-modal="true" aria-label="Albums" className={s.sheet} data-closing={pickerPresence.closing || undefined} style={{ maxHeight: '75vh', overflowY: 'auto' }}>
              <HudLabel>// Albums</HudLabel>
              <AlbumList albums={albums} currentId={id} base={base} onPick={() => setPicker(false)} />
            </div>
          </>
        )}
      </Page>
    );
  }

  return (
    <Page gap={0} top={0} bottom={0}>
      {/* The list is pinned: sticky at its own starting offset, one viewport high, scrolling on its own. */}
      <div ref={pin.row} style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 40, alignItems: 'start' }}>
        <ScrollArea
          as="aside"
          aria-labelledby="albums-title"
          style={{ position: 'sticky', top: pin.top, height: `calc(100vh - ${pin.top}px)` }}
          viewportStyle={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '40px 10px 24px 0' }}
        >
          {playerBack && (
            <Link to={playerBack.to} className="mono" style={{ fontSize: 12, color: 'var(--text-2)', textDecoration: 'none' }}>
              ← {playerBack.label}
            </Link>
          )}
          <h2 id="albums-title" className="lbl">
            {player ? `// ${player}’s albums` : '// Albums'}
          </h2>
          {albums && <AlbumList albums={albums} currentId={id} base={base} />}
        </ScrollArea>
        {album && detail && (
          // Keyed by album: switching albums fades the new one in.
          <div key={album.id} className="page-enter" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 32, padding: '40px 0 72px' }}>
            <header style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Title on the left (wraps if long), completion always in its own right-hand column. */}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'end', gap: 20 }}>
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ fontSize: 14, color: 'var(--text-2)' }}>From the {album.crate.name}</span>
                  <h1 style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>{album.name}</h1>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, whiteSpace: 'nowrap' }}>
                  <span className="mono" style={{ fontSize: 44, fontWeight: 500, letterSpacing: '-0.02em' }}>
                    {album.owned}
                    <span style={{ color: 'var(--hud)' }}> / {album.total}</span>
                  </span>
                  <span className="mono" style={{ fontSize: 16, color: 'var(--text-2)' }}>
                    {pct(album)}%
                  </span>
                </div>
              </div>
              <CompletionBar detail={detail} />
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                {summaryList}
                {chips}
              </div>
            </header>
            {groupSections}
            {groups.length === 0 && <EmptyState title="Album complete" />}
          </div>
        )}
      </div>
    </Page>
  );
}
