import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecycleQuote } from '../../../../shared/api';
import { formatCredits } from '../../lib/format';
import { useAnimatedNumber } from '../../lib/useAnimatedNumber';
import { usePresence } from '../../lib/usePresence';
import { Button } from '../ui/Button';
import { ConfirmInline } from '../ui/ConfirmInline';

export type AllState = 'none' | 'some' | 'all';

interface Props {
  /** Items ticked by the player. */
  selected: number;
  /** Last server quote (it may be for the previous selection while the new one loads). */
  quote: RecycleQuote | undefined;
  /** The quote is for an older selection: amounts stay on screen, Recycle waits for the fresh one. */
  stale: boolean;
  /** Fetches (or waits for) the quote of the current selection. */
  freshQuote: () => Promise<RecycleQuote | undefined>;
  pending: boolean;
  mobile?: boolean;
  onClear: () => void;
  onRecycle: (confirm: boolean) => void;
  /** "List on market" for the selection (accounts only: guests can't sell). */
  sellLink?: string;
  /** Desktop "Select all" checkbox. */
  allState?: AllState;
  onToggleAll?: () => void;
  /** No item to select (empty view, or everything locked). */
  nothingToSelect?: boolean;
  /** "Select all" stopped at the recycle limit. */
  cap?: number | null;
}

/** 20 px box of the "Select all" checkbox: empty, dash (some) or check (all). */
function AllBox({ state }: { state: AllState }) {
  const on = state !== 'none';
  return (
    <span
      aria-hidden="true"
      style={{ width: 20, height: 20, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-control)', border: `1px solid ${on ? 'var(--text)' : 'var(--border-hover)'}`, background: on ? 'var(--text)' : 'transparent' }}
    >
      {on && (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'var(--primary-text)', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
          <path d={state === 'all' ? 'M5 12.5l4.5 4.5L19 7.5' : 'M6 12h12'} />
        </svg>
      )}
    </span>
  );
}

/**
 * Selection of the inventory (DESIGN.md §3). Desktop: a bar that is always there above the grid
 * (Select all, then count, value and actions once something is ticked), so the grid never moves.
 * Mobile: floating panel above the tab bar while something is selected.
 */
export function SelectionBar({ selected, quote, stale, freshQuote, pending, mobile, onClear, onRecycle, sellLink, allState = 'none', onToggleAll, nothingToSelect, cap }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);
  // The server's total, counted up or down to its new value.
  const counted = useAnimatedNumber(quote?.total ?? 0, 400);
  const total = quote ? formatCredits(counted) : '…';
  // Mobile panel: slides in and out; the last count stays while it leaves.
  const panel = usePresence(selected > 0, 180);
  const lastCount = useRef(selected);
  if (selected > 0) lastCount.current = selected;
  const cancel = useCallback(() => setConfirming(false), []);
  useEffect(() => setConfirming(false), [selected]);

  // Whether a confirmation is needed depends on the selection: never decide on an old quote.
  const recycle = async () => {
    let current = quote;
    if (stale || !current) {
      setChecking(true);
      current = await freshQuote().finally(() => setChecking(false));
    }
    if (!current) return;
    if (current.requiresConfirmation) setConfirming(true);
    else onRecycle(false);
  };

  const confirm = (
    <ConfirmInline
      onCancel={cancel}
      style={mobile ? { display: 'flex', flexDirection: 'column', gap: 10 } : { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}
      message={<span style={{ fontSize: mobile ? 13 : 14, lineHeight: 1.45 }}>Includes Classified or better. Recycle {selected} {selected === 1 ? 'item' : 'items'} for good?</span>}
    >
      <div style={mobile ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 } : { display: 'flex', gap: 12 }}>
        <Button variant="secondary" size={44} onClick={cancel}>
          Cancel
        </Button>
        <Button size={44} bevel="none" onClick={() => onRecycle(true)} disabled={pending}>
          {mobile ? 'Recycle' : `Recycle for ${total} CR`}
        </Button>
      </div>
    </ConfirmInline>
  );

  if (mobile) {
    if (!panel.mounted) return null;
    return (
      <div
        role="region"
        aria-label="Selection"
        style={{
          animation: panel.closing ? 'mint-sink 180ms var(--ease-in-out) both' : 'mint-rise 260ms var(--ease-out) both',
          pointerEvents: panel.closing ? 'none' : undefined,
          position: 'fixed',
          left: 12,
          right: 12,
          bottom: 96,
          zIndex: 5,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: 14,
          border: '1px solid var(--text)',
          borderRadius: 'var(--radius-panel)',
          background: 'var(--surface-bar)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{lastCount.current} selected</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
            ≈ {total} CR
          </span>
        </div>
        {confirming ? (
          confirm
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: sellLink ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 8 }}>
            {sellLink && (
              <Button variant="secondary" size={44} block to={sellLink} style={{ fontSize: 14 }}>
                List on market
              </Button>
            )}
            <Button size={44} bevel={10} block onClick={() => void recycle()} disabled={pending || checking}>
              Recycle +{total}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const active = selected > 0;
  return (
    <div
      role="region"
      aria-label="Selection"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '12px 16px',
        minHeight: 70,
        padding: '12px 12px 12px 16px',
        border: `1px solid ${active ? 'var(--text)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-card)',
        background: active ? 'var(--surface-bar)' : 'var(--surface)',
        transition: 'border-color 150ms ease, background-color 150ms ease',
      }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={allState === 'all' ? true : allState === 'some' ? 'mixed' : false}
        aria-label="Select all items shown"
        onClick={onToggleAll}
        disabled={nothingToSelect && !active}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 12, height: 44, padding: '0 4px', border: 0, background: 'none', color: 'var(--text)', font: 'inherit', cursor: nothingToSelect && !active ? 'default' : 'pointer', opacity: nothingToSelect && !active ? 0.5 : 1 }}
      >
        <AllBox state={allState} />
        <span style={{ fontSize: 15, fontWeight: 600 }}>{active ? `${selected} selected` : 'Select all'}</span>
      </button>
      {active && (
        <span className="mono" style={{ fontSize: 13, color: 'var(--text-2)', animation: 'mint-fade 200ms var(--ease-out) both' }}>
          ≈ {total} CR
        </span>
      )}
      {active && cap && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>First {cap} only (most per recycle)</span>}
      <span style={{ flex: '1 1 0' }} />
      {active &&
        (confirming ? (
          confirm
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, animation: 'mint-fade 200ms var(--ease-out) both' }}>
            <Button variant="ghost" size={44} onClick={onClear} style={{ paddingInline: 14 }}>
              Clear
            </Button>
            {sellLink && (
              <Button variant="secondary" size={44} to={sellLink} style={{ paddingInline: 18, fontSize: 14 }}>
                List on market
              </Button>
            )}
            <Button size={44} bevel={10} onClick={() => void recycle()} disabled={pending || checking} style={{ paddingInline: 20 }}>
              Recycle <span className="mono" style={{ fontSize: 13 }}>+{total} CR</span>
            </Button>
          </div>
        ))}
    </div>
  );
}
