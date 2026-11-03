import type { Item, ItemDetail } from '../../../../shared/api';
import { RARITY } from '../../lib/rarity';
import { Halo, HudCorners } from '../ui/primitives';
import { SkinArt } from './items';
import s from './items.module.css';

/** "Covert" pill with its rarity square (item page). */
export function RarityPill({ tier, mobile }: { tier: ItemDetail['skin']['tier']; mobile?: boolean }) {
  return (
    <span className={`${s.pill} ${mobile ? s.mobile : ''}`}>
      <span aria-hidden="true" className={s.pillSquare} style={{ background: RARITY[tier].color }} />
      {RARITY[tier].name}
    </span>
  );
}

/**
 * Large art panel of the item page (and the auction page, which has no ID and is 440 px high):
 * rarity glow, HUD corners, rarity / pattern / case / ID labels.
 */
export function ItemStage({ item, mobile, minHeight = 520 }: { item: Item & { serial?: number }; mobile?: boolean; minHeight?: number }) {
  const rarity = RARITY[item.skin.tier];
  const label = mobile ? { fontSize: 10 } : undefined;
  const inset = mobile ? 28 : 40;
  const top = mobile ? 28 : 38;
  return (
    <div
      style={{
        position: 'relative',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        background: `radial-gradient(ellipse at 50% 50%, color-mix(in srgb, ${rarity.color} ${mobile ? 12 : 10}%, transparent), rgba(14,16,19,0) 70%), var(--surface)`,
        ...(mobile
          ? { height: 250, margin: '0 -20px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }
          : { minHeight, border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)' }),
      }}
    >
      <Halo color={rarity.halo} inset={mobile ? '6% 4%' : '8% 6%'} />
      <HudCorners size={mobile ? 16 : 22} inset={mobile ? 16 : 24} />
      <span className="lbl" style={{ position: 'absolute', left: inset, top, color: rarity.text, ...label }}>
        {rarity.name}
      </span>
      <span className="lbl" style={{ position: 'absolute', right: inset, top, ...label }}>
        {mobile ? `#${item.pattern}` : `Pattern #${item.pattern}`}
      </span>
      <SkinArt skin={item.skin} style={{ position: 'relative', width: mobile ? '90%' : '86%', maxHeight: mobile ? 200 : 440 }} />
      {!mobile && item.crate && (
        <span className="lbl" style={{ position: 'absolute', left: inset, bottom: top }}>
          {item.crate.name}
        </span>
      )}
      {!mobile && item.serial !== undefined && (
        <span className="lbl" style={{ position: 'absolute', right: inset, bottom: top }}>
          ID {String(item.serial).padStart(9, '0')}
        </span>
      )}
    </div>
  );
}

/** Facts grid (desktop) or list (mobile): Collection, Obtained, Original owner, Status. */
export function FactsList({ facts, mobile }: { facts: { k: string; v: string }[]; mobile?: boolean }) {
  if (mobile) {
    return (
      <dl style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
        {facts.map((f) => (
          <div key={f.k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderTop: '1px solid var(--separator)', fontSize: 14 }}>
            <dt style={{ color: 'var(--text-2)' }}>{f.k}</dt>
            <dd style={{ margin: 0, textAlign: 'right' }}>{f.v}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl
      style={{
        margin: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))',
        gap: 1,
        background: 'var(--border)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-panel)',
        overflow: 'hidden',
      }}
    >
      {facts.map((f) => (
        <div key={f.k} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 18px', background: 'var(--surface)' }}>
          <dt className="lbl">{f.k}</dt>
          <dd style={{ margin: 0, fontSize: 14 }}>{f.v}</dd>
        </div>
      ))}
    </dl>
  );
}
