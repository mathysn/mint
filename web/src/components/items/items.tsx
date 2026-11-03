import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import type { CrateGroupSkin, CrateSummary, Item, SkinCard, StripCard, Wear } from '../../../../shared/api';
import { formatCredits, formatFloat } from '../../lib/format';
import { stagger } from '../../lib/motion';
import { RARITY, WEAR_COLOR, finishLabel, fullName } from '../../lib/rarity';
import { Halo, ProgressBar, StatTrakBadge, Tag } from '../ui/primitives';
import s from './items.module.css';

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

/** Weapon image from the API; the alt text carries the full name. */
export function SkinArt({ skin, width, style, className }: { skin: Pick<SkinCard, 'imageUrl' | 'weaponName' | 'finishName' | 'phase'>; width?: string; style?: CSSProperties; className?: string }) {
  return <img src={skin.imageUrl} alt={fullName(skin)} loading="lazy" draggable={false} className={cx(s.art, className)} style={{ width, ...style }} />;
}

/** The "★ Rare special" teaser card art (the item itself is never shown before it is drawn). */
export const RareStar = ({ size }: { size?: number }) => (
  <span aria-hidden="true" className={s.rareStar} style={{ fontSize: size }}>
    ★
  </span>
);

/** "FT · 0.2381" with the wear square; "Vanilla" for knives without wear. */
export function WearLine({ wear, float, mobile }: { wear: Wear | null; float: number | null; mobile?: boolean }) {
  return (
    <span className={`mono ${s.wearLine}`}>
      {wear && <span aria-hidden="true" className={s.wearSquare} style={{ background: WEAR_COLOR[wear.code] }} />}
      {wear && float !== null ? (mobile ? `${wear.code} ${formatFloat(float, 4)}` : `${wear.code} · ${formatFloat(float, 4)}`) : 'Vanilla'}
    </span>
  );
}

/**
 * Inventory card. The name links to the item page (its click area covers the card); the
 * selection checkbox is its own 44 px button above it. Locked items (listed, in a trade) have none.
 */
export function ItemCard({
  item,
  mobile,
  selectable,
  selected,
  onToggle,
  back = { to: '/inventory', label: 'Inventory' },
  index,
}: {
  item: Item;
  mobile?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  back?: { to: string; label: string };
  /** Entrance order in its grid. */
  index?: number;
}) {
  const rarity = RARITY[item.skin.tier];
  const locked = item.status === 'listed' || item.status === 'in_trade';
  const artOpacity = locked ? 0.4 : 1;
  return (
    <div className={cx(s.card, mobile && s.mobile, index !== undefined && 'stagger')} style={stagger(index)} data-selected={selected ? 'true' : undefined}>
      <div className={s.cardImage}>
        <Halo color={rarity.halo} inset={mobile ? '10% 10%' : '10% 12%'} style={{ opacity: artOpacity }} />
        <SkinArt skin={item.skin} style={{ opacity: artOpacity }} />
        {item.stattrak && <StatTrakBadge style={{ position: 'absolute', right: mobile ? 8 : 12, top: mobile ? 10 : 14, ...(mobile ? { padding: '1px 5px', fontSize: 9 } : {}) }} />}
        {locked && (
          <span className={`lbl ${s.cardLock}`}>
            <svg aria-hidden="true" width={mobile ? 10 : 12} height={mobile ? 10 : 12} viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2 }}>
              <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
            </svg>
            {item.status === 'listed' ? 'Listed' : 'In trade'}
          </span>
        )}
      </div>
      <div className={s.cardBody}>
        <span className={s.weapon}>{item.skin.weaponName}</span>
        <Link to={`/items/${item.id}`} state={{ back }} className={`${s.skinName} ${s.stretch}`}>
          {finishLabel(item.skin)}
        </Link>
        <div className={s.cardMeta}>
          <WearLine wear={item.wear} float={item.float} mobile={mobile} />
          <span className={`mono ${s.value}`}>{mobile ? formatCredits(item.value) : `${formatCredits(item.value)} CR`}</span>
        </div>
      </div>
      <span aria-hidden="true" className={s.rarityBar} style={{ background: rarity.color }} />
      {selectable && !locked && onToggle && (
        <button type="button" aria-pressed={Boolean(selected)} aria-label={`Select ${fullName(item.skin)}`} onClick={onToggle} className={s.check} style={mobile ? { left: 0, top: 0 } : undefined}>
          <span aria-hidden="true" className={s.checkBox}>
            {selected && (
              <svg width="14" height="14" viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            )}
          </span>
        </button>
      )}
    </div>
  );
}

/** Catalog skin, no float: "What's inside". `match`: found by the weapon finder of the Cases screen. */
export function SkinTile({ skin, mobile, match }: { skin: CrateGroupSkin | (SkinCard & { owned?: boolean; finishOverride?: string }); mobile?: boolean; match?: boolean }) {
  const rarity = RARITY[skin.tier];
  const finish = 'finishOverride' in skin && skin.finishOverride ? skin.finishOverride : finishLabel(skin);
  return (
    <div className={cx(s.tile, mobile && s.mobile, match && `anim ${s.tileMatch}`)}>
      <div className={s.tileImage}>
        <Halo color={rarity.halo} inset={mobile ? '10% 12%' : '10% 14%'} />
        <SkinArt skin={skin} />
        {match && <span className={`lbl ${s.matchTag}`}>Match</span>}
        {skin.owned && <span className={`lbl ${s.inAlbum}`}>In album</span>}
      </div>
      <div className={s.tileBody}>
        <span className={s.weapon}>{skin.weaponName}</span>
        <span className={s.skinName}>{finish}</span>
      </div>
      <span aria-hidden="true" className={s.rarityBar} style={{ background: rarity.color }} />
    </div>
  );
}

const ROULETTE = {
  desktop: { width: 152, height: 184, halo: '12% 10%', art: '82%', star: 56 },
  mobile: { width: 112, height: 144, halo: '12% 8%', art: '84%', star: 44 },
};

/** Card of the roulette strip (152 × 184, mobile 112 × 144). */
export function RouletteCard({ card, mobile, className, style }: { card: StripCard; mobile?: boolean; className?: string; style?: CSSProperties }) {
  const size = mobile ? ROULETTE.mobile : ROULETTE.desktop;
  const rare = 'rareSpecial' in card;
  const rarity = RARITY[rare ? 'gold' : card.tier];
  return (
    <div
      className={className}
      style={{
        ...style,
        flex: 'none',
        width: size.width,
        height: size.height,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', flex: 1, display: 'grid', placeItems: 'center', minHeight: 0 }}>
        <Halo color={rarity.halo} inset={size.halo} />
        {rare ? <RareStar size={size.star} /> : <SkinArt skin={card} width={size.art} />}
      </div>
      <div style={{ padding: mobile ? '0 8px 8px' : '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        {!mobile && <span className={s.weapon} style={{ fontSize: 11 }}>{rare ? '★' : card.weaponName}</span>}
        <span className={s.skinName} style={{ fontSize: mobile ? 11 : 13 }}>
          {rare ? 'Rare special' : finishLabel(card)}
        </span>
      </div>
      <span aria-hidden="true" className={s.rarityBar} style={{ background: rarity.color }} />
    </div>
  );
}

type CaseVariant = 'home' | 'grid' | 'scroll' | 'mobileGrid';

export type CaseDropsInfo = { matches: SkinCard[]; matchCount: number };

/** Weapon finder: the best matching skin this case drops, "+N" for the others. */
function CaseDrops({ drops, small }: { drops: CaseDropsInfo; small?: boolean }) {
  const first = drops.matches[0];
  if (!first) return null;
  const more = drops.matchCount - 1;
  return (
    <span className={s.caseDrops} style={{ fontSize: small ? 12 : 13 }}>
      {!small && <span className="lbl">Drops</span>}
      <span aria-hidden="true" className={s.dropSquare} style={{ background: RARITY[first.tier].color }} />
      <span className={s.dropName}>{fullName(first)}</span>
      {more > 0 && <span className={`mono ${s.dropMore}`}>+{more}</span>}
    </span>
  );
}

/** Case tile. `free` = today's free case is still available for this player. `drops`: weapon finder matches. */
export function CaseTile({ crate, variant, free, drops, to, index }: { crate: CrateSummary; variant: CaseVariant; free: boolean; drops?: CaseDropsInfo; to?: string; index?: number }) {
  const pct = crate.completion.total ? Math.round((crate.completion.owned / crate.completion.total) * 100) : 0;
  const price = free ? 'Free' : `${formatCredits(crate.price)} CR`;
  const small = variant === 'scroll' || variant === 'mobileGrid';
  const image: CSSProperties =
    variant === 'home'
      ? { aspectRatio: '16 / 10' }
      : variant === 'grid'
        ? { aspectRatio: '4 / 3' }
        : { height: variant === 'scroll' ? 96 : 104 };
  const glow = variant === 'grid' || variant === 'mobileGrid' ? 0.08 : 0.07;
  const artWidth = { home: '62%', grid: '64%', scroll: '66%', mobileGrid: '68%' }[variant];
  const tagStyle: CSSProperties = small ? { left: 8, top: 8, fontSize: 9, padding: free ? '3px 6px' : '2px 5px' } : {};
  return (
    <Link to={to ?? `/cases/${crate.id}`} className={cx(s.caseTile, index !== undefined && 'stagger')} style={{ ...stagger(index), ...(variant === 'scroll' ? { flex: 'none', width: 150 } : undefined) }}>
      <span className={s.caseImage} style={{ ...image, background: `radial-gradient(closest-side, rgba(236,237,239,${glow}), rgba(236,237,239,0))` }}>
        <img src={crate.imageUrl} alt={variant === 'grid' || variant === 'mobileGrid' ? crate.name : ''} loading="lazy" className={s.caseArt} style={{ width: artWidth }} />
        {variant !== 'scroll' && free && (variant === 'grid' || variant === 'mobileGrid') && (
          <span className={s.caseTag} style={tagStyle}>
            <Tag solid>Free today</Tag>
          </span>
        )}
        {variant !== 'scroll' && crate.isNew && !(free && variant !== 'home') && (
          <span className={s.caseTag} style={tagStyle}>
            <Tag>New</Tag>
          </span>
        )}
      </span>
      {variant === 'home' && (
        <span className={s.caseFooter} style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
          <span className={s.caseName} style={{ fontSize: 14 }}>
            {crate.name}
          </span>
          <span className={`mono ${s.casePrice}`} style={{ fontSize: 13 }}>
            {price}
          </span>
        </span>
      )}
      {variant === 'scroll' && (
        <span className={s.caseFooter} style={{ flexDirection: 'column', gap: 4, padding: '10px 12px 12px' }}>
          <span className={s.caseName} style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {crate.name}
          </span>
          <span className={`mono ${s.casePrice}`} style={{ fontSize: 12 }}>
            {price}
          </span>
        </span>
      )}
      {variant === 'grid' && (
        <span className={s.caseFooter} style={{ flexDirection: 'column', gap: 12, padding: 16 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <span className={s.caseName} style={{ fontSize: 15 }}>
              {crate.name}
            </span>
            <span className={`mono ${s.casePrice}`} style={{ fontSize: 13 }}>
              {price}
            </span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="lbl">Album</span>
            <ProgressBar pct={pct} />
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {pct}%
            </span>
          </span>
          {drops && <CaseDrops drops={drops} />}
        </span>
      )}
      {variant === 'mobileGrid' && (
        <span className={s.caseFooter} style={{ flexDirection: 'column', gap: 8, padding: '10px 12px 12px' }}>
          <span className={s.caseName} style={{ fontSize: 13, lineHeight: 1.25, minHeight: 32 }}>
            {crate.name}
          </span>
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span className={`mono ${s.casePrice}`} style={{ fontSize: 12 }}>
              {price}
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
              Album {pct}%
            </span>
          </span>
          <ProgressBar pct={pct} style={{ flex: 'none' }} />
          {drops && <CaseDrops drops={drops} small />}
        </span>
      )}
    </Link>
  );
}

export function WearPill({ wear, mobile }: { wear: Wear | null; mobile?: boolean }) {
  return (
    <span className={cx(s.pill, mobile && s.mobile)}>
      {wear && <span aria-hidden="true" className={s.pillSquare} style={{ background: WEAR_COLOR[wear.code] }} />}
      {wear ? wear.name : 'Vanilla'}
    </span>
  );
}

export const StatTrakPill = ({ mobile }: { mobile?: boolean }) => <span className={cx('mono', s.pillST, mobile && s.mobile)}>STATTRAK™</span>;

export const PatternPill = ({ pattern, mobile }: { pattern: number; mobile?: boolean }) => (
  <span className={cx('mono', s.pill, s.pillMono, mobile && s.mobile)}>{mobile ? `#${pattern}` : `Pattern #${pattern}`}</span>
);

const ZONES = [
  { code: 'FN', flex: 7, color: 'var(--wear-fn)' },
  { code: 'MW', flex: 8, color: 'var(--wear-mw)' },
  { code: 'FT', flex: 23, color: 'var(--wear-ft)' },
  { code: 'WW', flex: 7, color: 'var(--wear-ww)' },
  { code: 'BS', flex: 55, color: 'var(--wear-bs)' },
] as const;

// Sizes from the mockups: reveal (Opening), item page (Item), mobile item page (Mobile-Item),
// trade-up average (TradeUp, Mobile-TradeUp: no labels).
const FLOAT_BAR = {
  reveal: { pad: 8, height: 6, cursor: 22, labelGap: 10, labelSize: 10 },
  page: { pad: 10, height: 8, cursor: 28, labelGap: 12, labelSize: 10 },
  pageMobile: { pad: 8, height: 7, cursor: 23, labelGap: 10, labelSize: 9 },
  contract: { pad: 8, height: 6, cursor: 22, labelGap: 10, labelSize: 10 },
  contractMobile: { pad: 7, height: 5, cursor: 19, labelGap: 10, labelSize: 9 },
};

/** 5 wear zones to scale, cursor at the exact float, hatching outside the skin's min/max. */
export function FloatBar({ float, min, max, labels = true, cursorHeight, size = 'reveal' }: { float: number; min: number | null; max: number | null; labels?: boolean; cursorHeight?: number; size?: keyof typeof FLOAT_BAR }) {
  const g = FLOAT_BAR[size];
  return (
    <div className={s.floatBar} style={{ paddingTop: labels || size.startsWith('contract') ? g.pad : 7 }}>
      <div aria-hidden="true" className={s.zones} style={{ height: g.height }}>
        {ZONES.map((z) => (
          <span key={z.code} className={s.zone} style={{ flexGrow: z.flex, background: z.color }} />
        ))}
        {min !== null && min > 0 && <span className={s.hatch} style={{ left: 0, width: `${min * 100}%` }} />}
        {max !== null && max < 1 && <span className={s.hatch} style={{ left: `${max * 100}%`, right: 0 }} />}
      </div>
      <span aria-hidden="true" className={s.cursor} style={{ left: `${float * 100}%`, height: cursorHeight ?? g.cursor }} />
      {labels && (
        <div aria-hidden="true" className={`mono ${s.zoneLabels}`} style={{ marginTop: g.labelGap, fontSize: g.labelSize }}>
          {ZONES.map((z) => (
            <span key={z.code} style={{ flex: `${z.flex} 1 0` }}>
              {z.code}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
