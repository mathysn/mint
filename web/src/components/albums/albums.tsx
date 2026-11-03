import { Link } from 'react-router';
import type { AlbumDetail, AlbumSkin, AlbumSummary } from '../../../../shared/api';
import { formatFloat } from '../../lib/format';
import { stagger } from '../../lib/motion';
import { RARITY, finishLabel, fullName } from '../../lib/rarity';
import { SkinArt } from '../items/items';
import itemStyles from '../items/items.module.css';
import { Halo, ProgressBar } from '../ui/primitives';

export const pct = (a: Pick<AlbumSummary, 'owned' | 'total'>) => (a.total ? Math.round((a.owned / a.total) * 100) : 0);

/** "Best ST™ MW 0.0934" — the lowest-float copy the player owns. */
function bestNote(skin: AlbumSkin): string {
  const b = skin.best;
  if (!b) return 'Not collected';
  const wear = b.wear && b.float !== null ? `${b.wear.code} ${formatFloat(b.float, 4)}` : 'Vanilla';
  return `Best ${b.stattrak ? 'ST™ ' : ''}${wear}`;
}

/**
 * Album card. Owned: in colour, links to the best copy. Missing: dashed frame, dark silhouette
 * (the real image darkened), rarity bar at 30 % (DESIGN.md §2), "Find on market" (desktop).
 */
export function AlbumCard({ skin, mobile, back = { to: '/albums', label: 'Albums' }, index }: { skin: AlbumSkin; mobile?: boolean; back?: { to: string; label: string }; index?: number }) {
  const rarity = RARITY[skin.tier];
  const owned = Boolean(skin.best);
  return (
    <div
      className={index !== undefined ? 'stagger' : undefined}
      style={{
        ...stagger(index),
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        background: owned ? 'var(--surface)' : 'var(--surface-missing)',
        border: owned ? '1px solid var(--border)' : '1px dashed var(--border-strong)',
      }}
    >
      <div style={{ position: 'relative', display: 'grid', placeItems: 'center', ...(mobile ? { height: 88 } : { aspectRatio: '3 / 2' }) }}>
        {owned && <Halo color={rarity.halo} inset={mobile ? '10% 12%' : '10% 14%'} />}
        <SkinArt
          skin={skin}
          width={mobile ? '80%' : '76%'}
          // Missing: dark silhouette close to --silhouette (#262A30) on --surface-missing.
          style={{ position: 'relative', maxHeight: '86%', filter: owned ? undefined : 'brightness(0) invert(0.15)' }}
        />
        {!owned && !mobile && (
          <span className="lbl" style={{ position: 'absolute', left: 10, top: 10, fontSize: 10 }}>
            Not collected
          </span>
        )}
      </div>
      <div style={{ padding: mobile ? '8px 10px 10px' : '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: mobile ? 1 : 3, minWidth: 0 }}>
        <span style={{ fontSize: mobile ? 11 : 12, color: 'var(--text-2)' }}>{skin.weaponName}</span>
        {owned ? (
          <Link
            to={`/items/${skin.best!.itemId}`}
            state={{ back }}
            aria-label={`${fullName(skin)}, best copy`}
            className={itemStyles.stretch}
            style={{ fontSize: mobile ? 13 : 14, fontWeight: 600, color: 'var(--text)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {finishLabel(skin)}
          </Link>
        ) : (
          <span style={{ fontSize: mobile ? 13 : 14, fontWeight: 600, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {finishLabel(skin)}
            <span className="sr-only">, not collected yet</span>
          </span>
        )}
        {(owned || mobile) && (
          <span className="mono" style={{ marginTop: mobile ? 3 : 4, fontSize: mobile ? 10 : 11, color: mobile ? 'var(--text-3)' : 'var(--text-2)' }}>
            {bestNote(skin)}
          </span>
        )}
        {!owned && !mobile && (
          <Link to={`/market?q=${encodeURIComponent(skin.finishName ? `${skin.weaponName} | ${skin.finishName}` : skin.weaponName)}`} style={{ marginTop: 4, fontSize: 12, color: 'var(--text-2)' }}>
            Find on market
          </Link>
        )}
      </div>
      <span aria-hidden="true" style={{ height: 3, background: owned ? rarity.color : `color-mix(in srgb, ${rarity.color} 30%, transparent)` }} />
    </div>
  );
}

/** One segment per skin, Covert → Mil-Spec, in the rarity colour when owned. Owned segments light up in order. */
export function CompletionBar({ detail, mobile }: { detail: AlbumDetail; mobile?: boolean }) {
  let lit = 0;
  return (
    <div aria-hidden="true" style={{ display: 'flex', gap: mobile ? 2 : 3, height: 6 }}>
      {detail.groups.flatMap((g) =>
        g.skins.map((s) => (
          <span key={s.id} style={{ position: 'relative', flex: '1 1 0', background: 'var(--track)' }}>
            {s.best && <span style={{ position: 'absolute', inset: 0, background: RARITY[g.tier].color, transformOrigin: 'left', animation: `mint-grow-x 320ms ${lit++ * 25}ms var(--ease-out) both` }} />}
          </span>
        )),
      )}
    </div>
  );
}

/** Albums list with completion (desktop side column, mobile sheet). */
export function AlbumList({ albums, currentId, onPick, base = '/albums' }: { albums: AlbumSummary[]; currentId: string; onPick?: () => void; base?: string }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {albums.map((a) => {
        const current = a.id === currentId;
        return (
          <li key={a.id}>
            <Link
              to={`${base}/${a.id}`}
              aria-current={current ? 'page' : undefined}
              onClick={onPick}
              className="albumLink"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 12,
                borderRadius: 'var(--radius-card)',
                textDecoration: 'none',
                background: current ? 'var(--nav-active)' : undefined,
                color: current ? 'var(--text)' : 'var(--text-2)',
              }}
            >
              {/* The % keeps its own right-hand column whatever the length of the name. */}
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: 14, fontWeight: 500 }}>
                <span title={a.name} style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {a.name}
                </span>
                <span className="mono" style={{ flex: 'none', width: '4ch', textAlign: 'right', fontSize: 12, color: 'var(--text-2)' }}>
                  {pct(a)}%
                </span>
              </span>
              <ProgressBar pct={pct(a)} style={{ flex: 'none' }} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
