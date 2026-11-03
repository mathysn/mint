import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { TradeItem, TradeOffer, TradeSideView, TradeStatus } from '../../../../shared/api';
import { formatCredits, shortDate } from '../../lib/format';
import { RARITY, finishLabel, fullName } from '../../lib/rarity';
import { diffLine, expiresIn, itemTag } from '../../lib/trades';
import { SkinArt } from '../items/items';
import { Avatar, Halo } from '../ui/primitives';

const STATUS_LABEL: Record<TradeStatus, string> = { pending: 'Pending', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', cancelled: 'Cancelled' };

const CHIP: Record<TradeStatus, CSSProperties> = {
  pending: { border: '1px solid var(--border-strong)', color: 'var(--text)' },
  accepted: { background: 'var(--primary-bg)', color: 'var(--primary-text)' },
  declined: { border: '1px dashed var(--border-strong)', color: 'var(--text-3)' },
  expired: { border: '1px dashed var(--border-strong)', color: 'var(--text-3)' },
  cancelled: { border: '1px dashed var(--border-strong)', color: 'var(--text-3)' },
};

export const StatusChip = ({ status, byStaff, mobile }: { status: TradeStatus; byStaff?: boolean; mobile?: boolean }) => (
  <span className="lbl" style={{ padding: mobile ? '4px 7px' : '4px 8px', borderRadius: 'var(--radius-control)', ...(mobile ? { fontSize: 10 } : {}), ...CHIP[status] }}>
    {byStaff ? 'Cancelled by staff' : STATUS_LABEL[status]}
  </span>
);

const AlbumPlus = ({ size, style }: { size: number; style?: CSSProperties }) => (
  <span className="lbl" style={{ fontSize: size, color: 'var(--text)', ...style }}>
    Album +1
  </span>
);

/** Item inside an offer card: art, weapon, name, "FT · 0.2381", rarity line at the bottom. */
export function TradeItemRow({ item, mobile }: { item: TradeItem; mobile?: boolean }) {
  const rarity = RARITY[item.skin.tier];
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: mobile ? 10 : 12,
        padding: mobile ? '6px 10px 8px 6px' : '8px 12px 10px 8px',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      <span style={{ position: 'relative', flex: 'none', width: mobile ? 60 : 72, height: mobile ? 34 : 44, display: 'grid', placeItems: 'center' }}>
        <Halo color={rarity.halo} inset="0" />
        <SkinArt skin={item.skin} width="100%" style={{ position: 'relative', maxHeight: '100%' }} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: mobile ? 1 : 2 }}>
        {!mobile && <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{item.skin.weaponName}</span>}
        <span style={{ fontSize: mobile ? 13 : 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mobile ? fullName(item.skin) : finishLabel(item.skin)}</span>
        <span className="mono" style={{ fontSize: mobile ? 10 : 11, color: 'var(--text-2)' }}>
          {itemTag(item, false, false)}
        </span>
      </span>
      {item.albumGain && <AlbumPlus size={mobile ? 8 : 9} style={mobile ? undefined : { position: 'absolute', right: 8, top: 8 }} />}
      <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: rarity.color }} />
    </div>
  );
}

function Side({ label, side, mobile, first }: { label: string; side: TradeSideView; mobile?: boolean; first?: boolean }) {
  const empty = side.items.length === 0 && side.credits === 0;
  return (
    <div
      style={
        mobile
          ? { display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--separator)' }
          : { flex: '1 1 320px', padding: 20, display: 'flex', flexDirection: 'column', gap: 12, borderRight: first ? '1px solid var(--separator)' : undefined }
      }
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="lbl" style={mobile ? { fontSize: 10 } : undefined}>
          {label}
        </span>
        <span className="mono" style={{ fontSize: mobile ? 12 : 13, color: 'var(--text-2)' }}>
          ≈ {formatCredits(side.total)} CR
        </span>
      </div>
      <div style={mobile ? { display: 'flex', flexDirection: 'column', gap: 8 } : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))', gap: 8 }}>
        {side.items.map((item) => (
          <TradeItemRow key={item.id} item={item} mobile={mobile} />
        ))}
      </div>
      {empty && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Nothing</span>}
      {side.credits > 0 && (
        <span className="mono" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 12px', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-control)', fontSize: 13 }}>
          + {formatCredits(side.credits)} CR
        </span>
      )}
    </div>
  );
}

/** Trade offer (DESIGN.md §3): header, "You give" / "You get" with estimates, footer with the gap and actions. */
export function OfferCard({ offer, now, mobile, actions }: { offer: TradeOffer; now: Date; mobile?: boolean; actions?: ReactNode }) {
  const who = offer.counterparty.username;
  const fromYou = offer.direction === 'sent';
  const when = offer.status === 'pending' ? expiresIn(offer.expiresAt, now) : shortDate(offer.respondedAt ?? offer.createdAt);
  const faded = offer.status !== 'pending' && offer.status !== 'accepted';
  const albumText = offer.status === 'pending' && offer.albumSlots > 0 ? `Fills ${offer.albumSlots} empty album slot${offer.albumSlots > 1 ? 's' : ''}` : null;

  return (
    <article aria-label={`Trade with ${who}`} style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)', opacity: faded ? 0.72 : 1 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: mobile ? 10 : 12, padding: mobile ? '14px 16px' : '16px 20px', borderBottom: '1px solid var(--separator)' }}>
        <Avatar name={who} url={offer.counterparty.avatarUrl} size={mobile ? 30 : 32} />
        {mobile ? (
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{fromYou ? `To ${who}` : who}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {when}
            </span>
          </span>
        ) : (
          <span style={{ fontSize: 15 }}>
            {fromYou ? (
              <>
                <strong>You</strong> <span style={{ color: 'var(--text-2)' }}>offered</span> <strong>{who}</strong>
              </>
            ) : (
              <>
                <strong>{who}</strong> <span style={{ color: 'var(--text-2)' }}>offered you a trade</span>
              </>
            )}
          </span>
        )}
        <span style={{ marginLeft: mobile ? 0 : 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {!mobile && (
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {when}
            </span>
          )}
          <StatusChip status={offer.status} byStaff={offer.byStaff} mobile={mobile} />
        </span>
      </header>
      <div style={mobile ? { display: 'flex', flexDirection: 'column' } : { display: 'flex', flexWrap: 'wrap', alignItems: 'stretch' }}>
        <Side label="You give" side={offer.give} mobile={mobile} first />
        <Side label="You get" side={offer.get} mobile={mobile} />
      </div>
      <footer
        style={
          mobile
            ? { display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px 16px' }
            : { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '14px 20px', borderTop: '1px solid var(--separator)' }
        }
      >
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
          Estimated {diffLine(offer.diff, formatCredits)}
        </span>
        {albumText && <span style={{ fontSize: 12, color: 'var(--text)' }}>{albumText}</span>}
        {!mobile && <span style={{ flex: '1 1 0' }} />}
        {actions}
      </footer>
    </article>
  );
}

/** Pickable item of "New offer" (locked ones are disabled, with their status as tag). */
export function PickTile({ item, on, mobile, onToggle }: { item: TradeItem; on: boolean; mobile?: boolean; onToggle: () => void }) {
  const rarity = RARITY[item.skin.tier];
  const locked = item.status !== 'available';
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={locked}
      onClick={onToggle}
      aria-label={`${fullName(item.skin)}${locked ? `, ${itemTag(item)}` : ''}`}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        background: mobile ? 'var(--surface)' : 'var(--surface-raised)',
        color: 'var(--text)',
        font: 'inherit',
        textAlign: 'left',
        cursor: locked ? 'default' : 'pointer',
        border: `1px solid ${on ? 'var(--text)' : 'var(--border)'}`,
      }}
    >
      <span style={{ position: 'relative', height: mobile ? 54 : 58, display: 'grid', placeItems: 'center', opacity: locked ? 0.35 : 1 }}>
        <Halo color={rarity.halo} inset={mobile ? '8% 8%' : '8% 10%'} />
        <SkinArt skin={item.skin} width={mobile ? '84%' : '80%'} style={{ position: 'relative', maxHeight: '90%' }} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: mobile ? '0 6px 7px' : '0 8px 8px', minWidth: 0 }}>
        <span style={{ fontSize: mobile ? 11 : 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{finishLabel(item.skin)}</span>
        <span className="mono" style={{ fontSize: mobile ? 9 : 10, color: 'var(--text-2)' }}>
          {itemTag(item, true)}
        </span>
      </span>
      {on && (
        <span aria-hidden="true" style={{ position: 'absolute', left: mobile ? 5 : 6, top: mobile ? 5 : 6, width: mobile ? 15 : 16, height: mobile ? 15 : 16, borderRadius: 'var(--radius-control)', background: 'var(--text)', display: 'grid', placeItems: 'center' }}>
          <svg width={mobile ? 10 : 11} height={mobile ? 10 : 11} viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'var(--primary-text)', strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
      )}
      {item.albumGain && <AlbumPlus size={mobile ? 7 : 8} style={{ position: 'absolute', right: mobile ? 4 : 6, top: mobile ? 5 : 6 }} />}
      <span aria-hidden="true" style={{ height: 2, background: rarity.color }} />
    </button>
  );
}

/** Item already put in the offer, with its remove button. */
export function ChosenRow({ item, mobile, onRemove }: { item: TradeItem; mobile?: boolean; onRemove: () => void }) {
  const rarity = RARITY[item.skin.tier];
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: mobile ? '6px 4px 8px 6px' : '8px 6px 10px 8px', background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-card)', overflow: 'hidden', minWidth: 0 }}>
      <span style={{ position: 'relative', flex: 'none', width: 56, height: mobile ? 32 : 34, display: 'grid', placeItems: 'center' }}>
        <Halo color={rarity.halo} inset="0" />
        <SkinArt skin={item.skin} width="100%" style={{ position: 'relative', maxHeight: '100%' }} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {!mobile && <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{item.skin.weaponName}</span>}
        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mobile ? fullName(item.skin) : finishLabel(item.skin)}</span>
        {mobile && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-2)' }}>
            {itemTag(item, true)} · {formatCredits(item.value)} CR
          </span>
        )}
      </span>
      <button
        type="button"
        aria-label={`Remove ${fullName(item.skin)}`}
        onClick={onRemove}
        style={{ flex: 'none', width: mobile ? 44 : 36, height: mobile ? 44 : 36, border: 0, background: 'none', color: 'var(--text-2)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: rarity.color }} />
    </div>
  );
}

/** Tabs (DESIGN.md §3): underline on desktop, segmented control on mobile. */
/**
 * `plain`: counts in grey mono text (Market: "12", "1 / 10") instead of white badges (Trades).
 * `bare`: no bottom border, the parent draws it (Leaderboard: tabs and filters on one line).
 */
/** Position of the selected tab, for the indicator that slides under (desktop) or behind (mobile) it. */
function useTabIndicator(value: string, mobile: boolean | undefined) {
  const list = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; width: number; animate: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => {
      const tab = el.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!tab) return setBox(null);
      // The first position is placed directly; later ones slide.
      setBox((prev) => ({ left: tab.offsetLeft, width: tab.offsetWidth, animate: prev !== null }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, mobile]);
  const style: CSSProperties | undefined = box
    ? { position: 'absolute', left: 0, width: box.width, transform: `translateX(${box.left}px)`, transition: box.animate ? 'transform 260ms var(--ease-out), width 260ms var(--ease-out)' : 'none', pointerEvents: 'none' }
    : undefined;
  return { list, style };
}

export function Tabs<T extends string>({ tabs, value, onChange, mobile, label, plain, bare }: { tabs: { value: T; label: string; count?: number | string }[]; value: T; onChange: (v: T) => void; mobile?: boolean; label: string; plain?: boolean; bare?: boolean }) {
  const indicator = useTabIndicator(value, mobile);
  if (mobile) {
    return (
      <div ref={indicator.list} role="tablist" aria-label={label} style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`, gap: 4, padding: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--surface)' }}>
        {indicator.style && <span aria-hidden="true" style={{ ...indicator.style, top: 4, bottom: 4, borderRadius: 'var(--radius-control)', background: 'var(--primary-bg)' }} />}
        {tabs.map((t) => {
          const on = t.value === value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.value)}
              style={{ position: 'relative', height: 40, border: 0, borderRadius: 'var(--radius-control)', background: on && !indicator.style ? 'var(--primary-bg)' : 'transparent', color: on ? 'var(--primary-text)' : 'var(--text-2)', font: 'inherit', fontSize: 14, fontWeight: on ? 600 : 500, cursor: 'pointer', transition: 'color 200ms ease' }}
            >
              {t.label}
              {t.count ? ` · ${t.count}` : ''}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div ref={indicator.list} role="tablist" aria-label={label} style={{ position: 'relative', display: 'flex', gap: 28, borderBottom: bare ? undefined : '1px solid var(--border)' }}>
      {indicator.style && <span aria-hidden="true" style={{ ...indicator.style, bottom: bare ? 0 : -1, height: 2, background: 'var(--text)' }} />}
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 48, padding: 0, marginBottom: -1, border: 0, borderBottom: `2px solid ${on && !indicator.style ? 'var(--text)' : 'transparent'}`, background: 'none', color: on ? 'var(--text)' : 'var(--text-2)', font: 'inherit', fontSize: 15, fontWeight: 500, cursor: 'pointer', transition: 'color 200ms ease' }}
          >
            {t.label}
            {plain && t.count !== undefined ? (
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {t.count}
              </span>
            ) : t.count ? (
              <span className="mono" style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10, background: 'var(--primary-bg)', color: 'var(--primary-text)', fontSize: 11, fontWeight: 600, display: 'inline-grid', placeItems: 'center' }}>
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Confirmation banner shown above the list after an action (mockup "Trade done with kenji…"). */
export function DoneBanner({ text }: { text: string }) {
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', border: '1px solid var(--text)', borderRadius: 'var(--radius-card)', background: 'var(--surface-bar)', fontSize: 14 }}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" style={{ flex: 'none', fill: 'none', stroke: 'var(--text)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      <span>{text}</span>
    </div>
  );
}
