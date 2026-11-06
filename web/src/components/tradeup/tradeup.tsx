import type { CSSProperties } from 'react';
import type { Item, Tier, TradeUpOutcome } from '../../../../shared/api';
import { formatFloat, formatPct } from '../../lib/format';
import { RARITY, finishLabel, fullName } from '../../lib/rarity';
import { SkinArt } from '../items/items';
import { Halo } from '../ui/primitives';

const slotIndex = (i: number) => String(i + 1).padStart(2, '0');

/** One of the 10 slots: the item (click removes it) or a dashed empty slot with its number. */
export function ContractSlot({ item, index, mobile, onRemove }: { item: Item | undefined; index: number; mobile?: boolean; onRemove: () => void }) {
  if (!item) {
    return (
      <div style={{ minHeight: mobile ? 64 : 122, height: mobile ? 64 : undefined, display: 'grid', placeItems: 'center', border: '1px dashed var(--border-strong)', borderRadius: mobile ? 3 : 'var(--radius-card)' }}>
        <span className="lbl" style={{ fontSize: mobile ? 9 : 10 }}>
          {slotIndex(index)}
        </span>
      </div>
    );
  }
  const rarity = RARITY[item.skin.tier];
  const float = item.float !== null ? formatFloat(item.float, 4) : 'Vanilla';
  return (
    <button
      type="button"
      className="slot-btn"
      aria-label={`Remove ${fullName(item.skin)} from the contract`}
      onClick={onRemove}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: mobile ? 64 : undefined,
        padding: 0,
        border: '1px solid var(--border-strong)',
        borderRadius: mobile ? 3 : 'var(--radius-card)',
        overflow: 'hidden',
        background: 'var(--surface-raised)',
        color: 'var(--text)',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        // Pops in when the item is added.
        animation: 'mint-pop 260ms var(--pop-ease) both',
      }}
    >
      <span style={{ position: 'relative', flex: mobile ? 1 : undefined, height: mobile ? undefined : 74, display: 'grid', placeItems: 'center' }}>
        <Halo color={rarity.halo} inset="8% 8%" />
        <SkinArt skin={item.skin} width={mobile ? '86%' : '84%'} style={{ position: 'relative', maxHeight: mobile ? 40 : 66 }} />
      </span>
      {mobile ? (
        <span className="mono" style={{ padding: '0 0 4px', fontSize: 8, color: 'var(--text-2)', textAlign: 'center' }}>
          {float}
        </span>
      ) : (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 10px 10px', minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{finishLabel(item.skin)}</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-2)' }}>
            {float}
          </span>
        </span>
      )}
      {!mobile && (
        <span className="lbl" style={{ position: 'absolute', left: 8, top: 6, fontSize: 9 }}>
          {slotIndex(index)}
        </span>
      )}
      <span aria-hidden="true" style={{ height: 2, background: rarity.color }} />
    </button>
  );
}

/** Item of the pool: tap to add or remove; locked items (listed, in a trade) are disabled. */
export function ContractPick({ item, on, disabled, mobile, onToggle }: { item: Item; on: boolean; disabled: boolean; mobile?: boolean; onToggle: () => void }) {
  const rarity = RARITY[item.skin.tier];
  const locked = item.status !== 'available';
  const tag = locked
    ? item.status === 'listed'
      ? 'Listed'
      : 'In a trade'
    : `${item.stattrak ? 'ST™ ' : ''}${item.wear && item.float !== null ? `${item.wear.code} ${formatFloat(item.float, 4)}` : 'Vanilla'}`;
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        border: `1px solid ${on ? 'var(--text)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        background: 'var(--surface)',
        color: 'var(--text)',
        font: 'inherit',
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span style={{ position: 'relative', height: mobile ? 54 : 58, display: 'grid', placeItems: 'center', opacity: locked ? 0.35 : 1 }}>
        <Halo color={rarity.halo} inset="8% 10%" />
        <SkinArt skin={item.skin} width="80%" style={{ position: 'relative', maxHeight: '90%' }} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 8px 8px', minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{finishLabel(item.skin)}</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-2)' }}>
          {tag}
        </span>
      </span>
      {on && (
        <span className="lbl" style={{ position: 'absolute', right: 6, top: 6, fontSize: 8, color: 'var(--text)' }}>
          In contract
        </span>
      )}
      <span aria-hidden="true" style={{ height: 2, background: rarity.color }} />
    </button>
  );
}

/** "Possible results" row: art, name, float it would land at, Album +1, chance and its bar. */
export function OutcomeRow({ outcome, mobile }: { outcome: TradeUpOutcome; mobile?: boolean }) {
  const rarity = RARITY[outcome.skin.tier];
  const meta = `would land ${outcome.wear.code} ${formatFloat(outcome.float, 4)}`;
  const pct = formatPct(outcome.pct);
  const album = outcome.albumGain && (
    <span className="lbl" style={{ fontSize: 8, color: 'var(--text)' }}>
      Album +1
    </span>
  );
  if (mobile) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--separator)' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName(outcome.skin)}</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-2)' }}>
            {meta}
          </span>
        </span>
        {album}
        <span className="mono" style={{ fontSize: 12, minWidth: 44, textAlign: 'right' }}>
          {pct}
        </span>
      </div>
    );
  }
  return (
    <li style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderTop: '1px solid var(--separator)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ position: 'relative', flex: 'none', width: 48, height: 26, display: 'grid', placeItems: 'center' }}>
          <Halo color={rarity.halo} inset="0" />
          <SkinArt skin={outcome.skin} width="100%" style={{ position: 'relative', maxHeight: '100%' }} />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName(outcome.skin)}</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-2)' }}>
            {meta}
          </span>
        </span>
        {album}
        <span className="mono" style={{ fontSize: 13, minWidth: 52, textAlign: 'right' }}>
          {pct}
        </span>
      </div>
      <span aria-hidden="true" style={{ position: 'relative', height: 2, background: 'var(--track)' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${outcome.pct}%`, background: rarity.color, transformOrigin: 'left', animation: 'mint-grow-x 600ms var(--ease-out) both', transition: 'width 400ms var(--ease-out)' }} />
      </span>
    </li>
  );
}

/** Rarity radio of the contract; Covert and above are disabled ("Not allowed yet"). */
export function RarityRadio({ tier, on, allowed, mobile, onPick }: { tier: Tier; on: boolean; allowed: boolean; mobile?: boolean; onPick: () => void }) {
  const look: CSSProperties = !allowed
    ? { background: 'transparent', color: 'var(--hud)', border: '1px dashed var(--border-strong)', cursor: 'not-allowed' }
    : on
      ? { background: 'var(--track)', color: 'var(--text)', border: '1px solid var(--text)' }
      : { background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border-strong)' };
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={!allowed}
      title={allowed ? `Trade up ${RARITY[tier].name}` : 'Not allowed yet'}
      onClick={onPick}
      className={allowed ? 'chip-quick' : undefined}
      style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: mobile ? 7 : 8, height: mobile ? 36 : 40, padding: '0 12px', borderRadius: 'var(--radius-control)', font: 'inherit', fontSize: 13, fontWeight: 500, cursor: allowed ? 'pointer' : 'not-allowed', ...look }}
    >
      <span aria-hidden="true" style={{ width: mobile ? 7 : 8, height: mobile ? 7 : 8, background: RARITY[tier].color }} />
      {RARITY[tier].name}
    </button>
  );
}
