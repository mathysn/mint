import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Item } from '../../../../shared/api';
import { formatCredits, formatFloat } from '../../lib/format';
import { RARITY, finishLabel } from '../../lib/rarity';
import { SkinArt } from '../items/items';
import itemStyles from '../items/items.module.css';
import { Modal } from '../ui/Modal';
import { Halo, HudCorners, StatTrakBadge } from '../ui/primitives';

export const SHOWCASE_SIZE = 5;

/** "FN · 0.0213 · 15,000 CR" */
export const showcaseMeta = (item: Item) =>
  [item.wear && item.float !== null ? `${item.wear.code} · ${formatFloat(item.float, 4)}` : 'Vanilla', `${formatCredits(item.value)} CR`].join(' · ');

const soft = (item: Item) => `color-mix(in srgb, ${RARITY[item.skin.tier].color} ${item.skin.tier === 'gold' ? 12 : 10}%, transparent)`;

/** Showcase slot 01: the main item, large, framed in its rarity colour. */
export function ShowcaseFeature({ item, mobile, back, footer }: { item: Item; mobile?: boolean; back: { to: string; label: string }; footer?: ReactNode }) {
  const rarity = RARITY[item.skin.tier];
  return (
    <article
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-panel)',
        overflow: 'hidden',
        background: `radial-gradient(ellipse at 50% ${mobile ? 40 : 42}%, ${soft(item)}, color-mix(in srgb, var(--surface) 0%, transparent) 70%), var(--surface)`,
        ...(mobile ? {} : { flex: '2 1 440px', minHeight: 460 }),
      }}
    >
      {mobile ? (
        <>
          <span aria-hidden="true" style={{ position: 'absolute', left: 12, top: 12, width: 16, height: 16, borderLeft: `1px solid ${rarity.text}`, borderTop: `1px solid ${rarity.text}` }} />
          <span aria-hidden="true" style={{ position: 'absolute', right: 12, bottom: 12, width: 16, height: 16, borderRight: `1px solid ${rarity.text}`, borderBottom: `1px solid ${rarity.text}` }} />
        </>
      ) : (
        <HudCorners size={22} inset={22} color={rarity.text} />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: mobile ? '22px 24px 0' : '36px 40px 0' }}>
        <span className="lbl" style={mobile ? { fontSize: 10 } : undefined}>
          01
        </span>
        <span className="lbl" style={{ color: rarity.text, ...(mobile ? { fontSize: 10 } : {}) }}>
          {rarity.name}
        </span>
      </div>
      <div style={{ position: 'relative', flex: mobile ? 'none' : 1, height: mobile ? 150 : undefined, display: 'grid', placeItems: 'center', padding: mobile ? 0 : '8px 0' }}>
        <Halo color={rarity.halo} inset={mobile ? '4% 8%' : '4% 10%'} />
        <SkinArt skin={item.skin} width={mobile ? '86%' : '78%'} style={{ position: 'relative', maxHeight: mobile ? 140 : 300 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: mobile ? 'flex-start' : 'flex-end', flexDirection: mobile ? 'column' : 'row', gap: mobile ? 2 : 16, padding: mobile ? '0 24px 22px' : '0 40px 36px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 2 : 4, minWidth: 0 }}>
          <span style={{ fontSize: mobile ? 13 : 14, color: rarity.text }}>{item.skin.weaponName}</span>
          <Link to={`/items/${item.id}`} state={{ back }} className={itemStyles.stretch} style={{ fontSize: mobile ? 24 : 30, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)', textDecoration: 'none' }}>
            {finishLabel(item.skin)}
          </Link>
        </div>
        <span className="mono" style={{ fontSize: mobile ? 11 : 12, color: 'var(--text-2)', textAlign: mobile ? 'left' : 'right', marginTop: mobile ? 4 : 0 }}>
          {showcaseMeta(item)}
        </span>
      </div>
      {footer}
    </article>
  );
}

/** Showcase slots 02–05. */
export function ShowcaseCard({ item, index, mobile, back, footer }: { item: Item; index: number; mobile?: boolean; back: { to: string; label: string }; footer?: ReactNode }) {
  const rarity = RARITY[item.skin.tier];
  return (
    <article
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-panel)',
        overflow: 'hidden',
        background: 'var(--surface)',
        ...(mobile ? { flex: 'none', width: 148 } : {}),
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: mobile ? '10px 12px 0' : '14px 16px 0' }}>
        <span className="lbl" style={{ fontSize: mobile ? 9 : 10 }}>
          {String(index).padStart(2, '0')}
        </span>
        {item.stattrak && <StatTrakBadge style={{ padding: '1px 5px', fontSize: 9 }} />}
      </div>
      <div style={{ position: 'relative', flex: mobile ? 'none' : 1, minHeight: mobile ? 70 : 110, height: mobile ? 70 : undefined, display: 'grid', placeItems: 'center' }}>
        <Halo color={rarity.halo} inset={mobile ? '6% 8%' : '6% 10%'} />
        <SkinArt skin={item.skin} width={mobile ? '84%' : '80%'} style={{ position: 'relative', maxHeight: mobile ? 64 : 120 }} />
      </div>
      <div style={{ padding: mobile ? '0 12px 12px' : '0 16px 14px', display: 'flex', flexDirection: 'column', gap: mobile ? 1 : 2, minWidth: 0 }}>
        <span style={{ fontSize: mobile ? 11 : 12, color: 'var(--text-2)' }}>{item.skin.weaponName}</span>
        <Link
          to={`/items/${item.id}`}
          state={{ back }}
          className={itemStyles.stretch}
          style={{ fontSize: mobile ? 13 : 15, fontWeight: 600, color: 'var(--text)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {finishLabel(item.skin)}
        </Link>
        <span className="mono" style={{ marginTop: mobile ? 3 : 4, fontSize: mobile ? 10 : 11, color: 'var(--text-2)' }}>
          {showcaseMeta(item)}
        </span>
      </div>
      {footer}
      <span aria-hidden="true" style={{ height: 3, background: rarity.color }} />
    </article>
  );
}

/** Empty slot in edit mode: opens the item picker. */
/** Height of a showcase card with its Make main / Remove bar: empty slots match it in edit mode. */
const EDIT_CARD_HEIGHT = 267;

export function EmptySlot({ big, mobile, onAdd }: { big?: boolean; mobile?: boolean; onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      style={{
        display: 'grid',
        placeItems: 'center',
        border: '1px dashed var(--border-strong)',
        borderRadius: 'var(--radius-panel)',
        background: 'var(--surface-missing)',
        color: 'var(--text-2)',
        font: 'inherit',
        fontSize: 14,
        cursor: 'pointer',
        ...(big ? (mobile ? { height: 240 } : { flex: '2 1 440px', minHeight: 460 }) : mobile ? { flex: 'none', width: 148, minHeight: 190 } : { minHeight: EDIT_CARD_HEIGHT }),
      }}
    >
      + Add to showcase
    </button>
  );
}

/** Remove / Make main, under a slot in edit mode (above the card's stretched link). */
export function SlotActions({ main, onRemove, onMain }: { main: boolean; onRemove: () => void; onMain: () => void }) {
  const style = { height: 44, padding: '0 12px', border: 0, background: 'none', color: 'var(--text-2)', font: 'inherit', fontSize: 13, cursor: 'pointer' } as const;
  return (
    <div style={{ position: 'relative', zIndex: 2, display: 'flex', justifyContent: 'flex-end', gap: 4, padding: '0 8px', borderTop: '1px solid var(--separator)', background: 'var(--surface)' }}>
      {!main && (
        <button type="button" onClick={onMain} style={style}>
          Make main
        </button>
      )}
      <button type="button" onClick={onRemove} style={style}>
        Remove
      </button>
    </div>
  );
}

/** Pick one of your items for an empty slot (desktop dialog, mobile bottom sheet). */
export function ShowcasePicker({ items, mobile, onPick, onClose }: { items: Item[]; mobile?: boolean; onPick: (item: Item) => void; onClose: () => void }) {
  return (
    <Modal label="Add to showcase" mobile={mobile} onClose={onClose}>
      {items.length === 0 && <p style={{ fontSize: 14, color: 'var(--text-2)' }}>No other item to show. Open a case to get more.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item)}
            style={{ display: 'flex', flexDirection: 'column', padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--surface-raised)', color: 'var(--text)', font: 'inherit', textAlign: 'left', cursor: 'pointer', overflow: 'hidden' }}
          >
            <span style={{ position: 'relative', height: 80, display: 'grid', placeItems: 'center' }}>
              <Halo color={RARITY[item.skin.tier].halo} inset="8% 10%" />
              <SkinArt skin={item.skin} width="80%" style={{ position: 'relative', maxHeight: 70 }} />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 10px 10px', minWidth: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{item.skin.weaponName}</span>
              <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{finishLabel(item.skin)}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-2)' }}>
                {showcaseMeta(item)}
              </span>
            </span>
            <span aria-hidden="true" style={{ height: 3, background: RARITY[item.skin.tier].color }} />
          </button>
        ))}
      </div>
    </Modal>
  );
}
