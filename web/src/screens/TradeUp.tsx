import { useState } from 'react';
import type { Item, Tier, TradeUpResult } from '../../../shared/api';
import { Page } from '../components/layout/AppShell';
import { FloatBar, SkinArt } from '../components/items/items';
import { ContractPick, ContractSlot, OutcomeRow, RarityRadio } from '../components/tradeup/tradeup';
import { Button } from '../components/ui/Button';
import { Halo, HudLabel } from '../components/ui/primitives';
import { errorText } from '../lib/market';
import { formatFloat } from '../lib/format';
import { useEconomyText } from '../lib/queries';
import { RARITY, finishLabel } from '../lib/rarity';
import { useSignTradeUp, useTradeUpOptions, useTradeUpQuote } from '../lib/tradeup';
import { useDebounced } from '../lib/useDebounced';
import { useIsMobile } from '../lib/useMediaQuery';

const RARITIES: Tier[] = ['milspec', 'restricted', 'classified', 'covert'];
const MOBILE_OUTCOMES = 5;

export function TradeUp() {
  const mobile = useIsMobile();
  const word = useEconomyText().tradeupWord;
  const [tier, setTier] = useState<Tier>('milspec');
  const [stattrak, setStattrak] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [result, setResult] = useState<TradeUpResult | null>(null);
  const [problem, setProblem] = useState('');
  const { data: options } = useTradeUpOptions(tier, stattrak);
  const quoteIds = useDebounced(picked, 150);
  const { data: quote } = useTradeUpQuote(quoteIds);
  const sign = useSignTradeUp();

  const size = options?.size ?? 10;
  const allowed = options?.tiers ?? ['milspec', 'restricted', 'classified'];
  const pool = options && options.tier === tier && options.stattrak === stattrak ? options.items : [];
  const byId = new Map(pool.map((i) => [i.id, i]));
  const slots: (Item | undefined)[] = Array.from({ length: size }, (_, i) => byId.get(picked[i] ?? ''));
  const count = picked.length;
  const outcomes = picked.length && quote ? quote.outcomes : [];
  const next = options ? options.next : 'restricted';
  const nextName = RARITY[next].name;
  const available = pool.filter((i) => i.status === 'available').length;

  const reset = (patch: { tier?: Tier; stattrak?: boolean }) => {
    if (patch.tier) setTier(patch.tier);
    if (patch.stattrak !== undefined) setStattrak(patch.stattrak);
    setPicked([]);
    setResult(null);
    setProblem('');
  };
  const toggle = (id: string) => {
    setProblem('');
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < size ? [...p, id] : p));
  };
  const signNow = () => {
    setProblem('');
    sign.mutate(picked, {
      onSuccess: (r) => {
        setResult(r);
        setPicked([]);
        // The result shows above the slots.
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      onError: (e) => setProblem(errorText(e, 'Couldn’t sign the contract. Try again.')),
    });
  };
  const ready = count === size;
  const signLabel = count === size ? 'Sign contract' : `Add ${size - count} more`;

  const rarityPicker = (
    <>
      <div role="radiogroup" aria-label="Rarity to trade up" style={{ display: 'flex', gap: 6 }}>
        {RARITIES.map((t) => (
          <RarityRadio key={t} tier={t} on={tier === t} allowed={allowed.includes(t)} mobile={mobile} onPick={() => reset({ tier: t })} />
        ))}
      </div>
      <button
        type="button"
        aria-pressed={stattrak}
        onClick={() => reset({ stattrak: !stattrak })}
        className="chip-quick"
        style={{
          flex: 'none',
          height: mobile ? 36 : 40,
          padding: '0 12px',
          borderRadius: 'var(--radius-control)',
          font: 'inherit',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          ...(stattrak ? { background: 'var(--primary-bg)', color: 'var(--primary-text)', border: '1px solid var(--primary-bg)' } : { background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border-strong)' }),
        }}
      >
        StatTrak™
      </button>
    </>
  );

  const resultBox = result && (
    <ResultBox result={result} mobile={mobile} onAgain={() => setResult(null)} />
  );

  const slotGrid = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: mobile ? 6 : 10 }}>
      {slots.map((item, i) => (
        <ContractSlot key={i} index={i} item={item} mobile={mobile} onRemove={() => item && toggle(item.id)} />
      ))}
    </div>
  );

  const poolGrid = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: mobile ? 0 : 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="lbl">
          Your {RARITY[tier].name} items{stattrak ? ' · StatTrak™' : ''}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{mobile ? 'Tap' : 'Click'} to add or remove</span>
      </div>
      {options && available < size && (
        <p style={{ padding: 24, border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-card)', fontSize: 14, color: 'var(--text-2)', textAlign: 'center' }}>
          Not enough of these to fill a contract yet. Open cases or trade for more.
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(${mobile ? 104 : 132}px, 100%), 1fr))`, gap: 8 }}>
        {pool.map((item) => {
          const on = picked.includes(item.id);
          return <ContractPick key={item.id} item={item} on={on} mobile={mobile} disabled={item.status !== 'available' || (!on && count >= size)} onToggle={() => toggle(item.id)} />;
        })}
      </div>
    </div>
  );

  const avg = count && quote?.avgFloat !== null && quote?.avgFloat !== undefined ? quote.avgFloat : null;
  const problemLine = problem && (
    <p role="alert" style={{ fontSize: 13, color: 'var(--error)' }}>
      {problem}
    </p>
  );

  if (mobile) {
    const shown = outcomes.slice(0, MOBILE_OUTCOMES);
    const rest = outcomes.slice(MOBILE_OUTCOMES);
    const restCollections = [...new Set(rest.map((o) => o.collection.name))];
    return (
      <Page gap={18} back={{ to: '/more', label: 'More' }} mobilePadding="8px 20px 112px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <HudLabel>// Trade-up contract</HudLabel>
          <h1 style={{ fontSize: 30, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>Trade-up</h1>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>{word.charAt(0).toUpperCase() + word.slice(1)} skins of one rarity in, one skin of the next rarity out.</p>
        </div>
        <div className="hscroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', margin: '0 -20px', padding: '0 20px' }}>
          {rarityPicker}
        </div>
        {resultBox}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="lbl">Contract</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {count} / {size} {RARITY[tier].name}
          </span>
        </div>
        {slotGrid}
        <section aria-label="Result preview" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, background: RARITY[next].color }} />1 {nextName} skin{stattrak ? ', StatTrak™' : ''}
            </span>
            <span className="mono" style={{ fontSize: 13 }}>
              Average float {avg !== null ? formatFloat(avg, 4) : '—'}
            </span>
          </div>
          <FloatBar float={avg ?? 0} min={null} max={null} labels={false} size="contractMobile" cursorHeight={avg === null ? 0 : undefined} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="lbl" style={{ fontSize: 10, paddingBottom: 4 }}>
              Possible results{outcomes.length ? ` · ${outcomes.length} skins` : ''}
            </span>
            {!outcomes.length && <p style={{ fontSize: 13, color: 'var(--text-2)', paddingTop: 4 }}>Add skins to see what can come out.</p>}
            {shown.map((o) => (
              <OutcomeRow key={o.skin.id} outcome={o} mobile />
            ))}
            {rest.length > 0 && (
              <span style={{ paddingTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
                + {rest.length} more{restCollections.length === 1 ? ` from ${restCollections[0]}` : ''}
              </span>
            )}
          </div>
        </section>
        {poolGrid}
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'var(--tabbar)', zIndex: 5, minHeight: 76, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: '10px 16px', background: 'var(--page)', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1, fontSize: 12, lineHeight: 1.4, color: 'var(--text-3)' }}>The {word} skins are destroyed when you sign. Covert, knives and gloves can’t go in a contract for now.</span>
            <Button size={48} bevel={count === size ? 12 : 'none'} onClick={signNow} disabled={!ready || sign.isPending} style={{ paddingInline: 20, fontSize: 15 }}>
              {signLabel}
            </Button>
          </div>
          {problemLine}
        </div>
      </Page>
    );
  }

  return (
    <Page gap={28}>
      <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <HudLabel>// Trade-up contract</HudLabel>
          <h1 style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>Trade-up</h1>
          <p style={{ maxWidth: 620, fontSize: 14, lineHeight: 1.55, color: 'var(--text-2)' }}>
            {word.charAt(0).toUpperCase() + word.slice(1)} skins of the same rarity become one skin of the next rarity, drawn from their collections in proportion. All StatTrak™ or none. Its float is the average of the {word}, brought into the new skin’s range.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{rarityPicker}</div>
      </header>

      {resultBox}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <section aria-label="Contract slots" style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="lbl">Contract</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>
              {count} / {size} {RARITY[tier].name}
            </span>
          </div>
          {slotGrid}
          {poolGrid}
        </section>

        <aside aria-label="Contract result preview" style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18, padding: 22, border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="lbl">You receive</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 20, fontWeight: 600 }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, background: RARITY[next].color }} />1 {nextName} skin{stattrak ? ', StatTrak™' : ''}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="lbl">Average float</span>
              <span className="mono" style={{ fontSize: 22, fontWeight: 500 }}>
                {avg !== null ? formatFloat(avg, 4) : '—'}
              </span>
            </div>
            <FloatBar float={avg ?? 0} min={null} max={null} labels={false} size="contract" cursorHeight={avg === null ? 0 : undefined} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 6 }}>
              <span className="lbl">Possible results</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {outcomes.length ? `${outcomes.length} skins` : ''}
              </span>
            </div>
            {!outcomes.length && <p style={{ fontSize: 13, color: 'var(--text-2)' }}>Add skins to see what can come out.</p>}
            <ul className="stagger-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
              {outcomes.map((o) => (
                <OutcomeRow key={o.skin.id} outcome={o} />
              ))}
            </ul>
          </div>
          {problemLine}
          <Button size={52} block onClick={signNow} disabled={!ready || sign.isPending} style={{ fontSize: 16 }}>
            {signLabel}
          </Button>
          <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-3)' }}>The {word} skins are destroyed when you sign. Covert, knives and gloves can’t go in a contract for now.</p>
        </aside>
      </div>
    </Page>
  );
}

/** "Contract signed · Classified": the new skin, with Inventory / New contract. */
function ResultBox({ result, mobile, onAgain }: { result: TradeUpResult; mobile: boolean; onAgain: () => void }) {
  const item = result.item;
  const rarity = RARITY[item.skin.tier];
  const meta = [item.stattrak ? 'StatTrak™' : null, item.wear?.code ?? 'Vanilla', item.float !== null ? formatFloat(item.float, 9) : null].filter(Boolean).join(' · ');
  return (
    <section
      role="status"
      className="anim"
      style={{
        position: 'relative',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: mobile ? 16 : '24px 40px',
        padding: mobile ? 18 : '28px 36px',
        border: `1px solid ${rarity.text}`,
        borderRadius: 'var(--radius-panel)',
        overflow: 'hidden',
        background: `radial-gradient(ellipse at 20% 50%, color-mix(in srgb, ${rarity.color} 12%, transparent), color-mix(in srgb, var(--surface) 0%, transparent) 60%), var(--surface)`,
        animation: 'mint-pop 500ms var(--pop-ease) both',
      }}
    >
      <div style={{ position: 'relative', flex: mobile ? '1 1 100%' : '0 1 320px', height: mobile ? 110 : 150, display: 'grid', placeItems: 'center' }}>
        <Halo color={rarity.halo} inset="0" />
        <SkinArt skin={item.skin} width="100%" style={{ position: 'relative', maxHeight: '100%', objectFit: 'contain' }} />
      </div>
      <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="lbl" style={{ color: rarity.text }}>
          Contract signed · {rarity.name}
        </span>
        <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{item.skin.weaponName}</span>
        <span style={{ fontSize: mobile ? 28 : 36, fontWeight: 600, letterSpacing: '-0.02em' }}>{finishLabel(item.skin)}</span>
        <span className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {meta}
        </span>
        {result.albumGain && <span style={{ fontSize: 13 }}>New in your album.</span>}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Button variant="secondary" size={44} to="/inventory" style={{ paddingInline: 16, fontSize: 14 }}>
          Inventory
        </Button>
        <Button size={44} bevel="none" onClick={onAgain} style={{ paddingInline: 18, fontSize: 14 }}>
          New contract
        </Button>
      </div>
    </section>
  );
}
