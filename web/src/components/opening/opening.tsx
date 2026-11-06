import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CrateDetail, Item, OddsRow, SkinCard, StripCard, Tier } from '../../../../shared/api';
import { formatCredits, formatFloat, formatPct } from '../../lib/format';
import { RARITY, finishLabel } from '../../lib/rarity';
import { setSoundMuted, useSoundMuted } from '../../lib/sound';
import { cardUnderMarker, idleIndex, spinPlan, spinProgress, stripX, type SpinGeometry } from '../../lib/spin';
import { useReducedMotion } from '../../lib/useMediaQuery';
import { FloatBar, PatternPill, RouletteCard, SkinArt, SkinTile, StatTrakPill, WearPill } from '../items/items';
import { Halo, HudCorners } from '../ui/primitives';
import s from './opening.module.css';

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');


/** The odds every case shares (Cases screen). */
export function OddsStrip({ odds, mobile }: { odds: OddsRow[]; mobile?: boolean }) {
  return (
    <section aria-label="Odds, shared by every case" className={cx(mobile ? `hscroll ${s.oddsMobile}` : s.odds)} role={mobile ? 'list' : undefined}>
      {odds.map((o) => (
        <div key={o.tier} className={s.oddsCell} role={mobile ? 'listitem' : undefined}>
          <span aria-hidden="true" className={s.oddsBar} style={{ background: RARITY[o.tier].color }} />
          <span className={s.oddsName}>{RARITY[o.tier].name}</span>
          <span className={`mono ${s.oddsPct}`}>{formatPct(o.pct)}</span>
        </div>
      ))}
    </section>
  );
}

function RarityGroup({ tier, name, pct, count, mobile, children }: { tier: Tier; name: string; pct: number; count: string; mobile?: boolean; children: ReactNode }) {
  const rarity = RARITY[tier];
  return (
    <div className={cx(s.group, mobile && s.mobile)}>
      <div className={s.groupHead}>
        <span aria-hidden="true" className={s.groupSquare} style={{ background: rarity.color }} />
        <h3 className={s.groupName} style={{ color: rarity.text }}>
          {name}
        </h3>
        <span className="mono" style={{ fontSize: mobile ? 11 : 12, color: 'var(--text-2)' }}>
          {formatPct(pct)}
        </span>
        <span aria-hidden="true" className={s.groupLine} />
        {!mobile && (
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {count}
          </span>
        )}
      </div>
      <div className={s.groupGrid}>{children}</div>
    </div>
  );
}

function specialCount(types: CrateDetail['special']['types']): string {
  const gloves = types.every((t) => t.category === 'Gloves');
  const knives = types.every((t) => t.category === 'Knives');
  if (types.length === 1) return gloves ? 'Gloves' : knives ? 'Knife' : '1 item';
  return gloves ? `${types.length} gloves` : knives ? `${types.length} knives` : `${types.length} types`;
}

/** Skins found by the weapon finder (Cases screen): a ★ type matches when one of its finishes does. */
export function finderMatch(matches: SkinCard[] | undefined) {
  if (!matches?.length) return undefined;
  const names = new Set(matches.map((m) => m.name));
  const gold = new Set(matches.filter((m) => m.tier === 'gold').map((m) => m.weaponName));
  return (skin: Pick<SkinCard, 'tier' | 'name' | 'weaponName'>) => (skin.tier === 'gold' ? gold.has(skin.weaponName) : names.has(skin.name));
}

/** "What's inside": ★ first, then Covert → Mil-Spec, each with its odds. */
export function WhatsInside({ detail, mobile, match }: { detail: CrateDetail; mobile?: boolean; match?: (skin: Pick<SkinCard, 'tier' | 'name' | 'weaponName'>) => boolean }) {
  return (
    <>
      {detail.special.types.length > 0 && (
        <RarityGroup tier="gold" name="★ Rare special" pct={detail.special.pct} count={specialCount(detail.special.types)} mobile={mobile}>
          {detail.special.types.map((t) => (
            <SkinTile
              key={t.weaponName}
              mobile={mobile}
              match={match?.({ tier: 'gold', name: t.weaponName, weaponName: t.weaponName })}
              skin={{ id: t.weaponName, name: t.weaponName, weaponName: t.weaponName, finishName: null, phase: null, imageUrl: t.imageUrl, tier: 'gold', finishOverride: 'Any finish' }}
            />
          ))}
        </RarityGroup>
      )}
      {detail.groups.map((g) => (
        <RarityGroup key={g.tier} tier={g.tier} name={RARITY[g.tier].name} pct={g.pct} count={`${g.skins.length} ${g.skins.length > 1 ? 'skins' : 'skin'}`} mobile={mobile}>
          {g.skins.map((skin) => (
            <SkinTile key={skin.id} skin={skin} mobile={mobile} match={match?.(skin)} />
          ))}
        </RarityGroup>
      ))}
    </>
  );
}

// Geometry from the mockups: desktop cards 152 px with a 160 px step, mobile 112 / 120.
const GEOMETRY: Record<'desktop' | 'mobile', SpinGeometry> = {
  desktop: { step: 160, half: 76, start: 3 },
  mobile: { step: 120, half: 56, start: 2 },
};

/** Pause on the result card (its lock-in) before the reveal. */
const LOCK_MS = 450;

const cardTier = (card: StripCard | undefined): Tier => (!card || 'rareSpecial' in card ? 'gold' : card.tier);

/**
 * Horizontal roulette. `rollKey` changes for every new opening: the strip jumps back to a start
 * card, then glides to the card at `resultIndex`, each spin with its own length and curve
 * (lib/spin.ts). It calls onTick at every card edge, onLand when it stops, onDone after the lock-in.
 * The result was drawn by the server before this starts.
 */
export function Roulette({
  cards,
  resultIndex,
  rollKey,
  mobile,
  onDone,
  onTick,
  onLand,
}: {
  cards: StripCard[];
  resultIndex: number;
  rollKey: string | null;
  mobile?: boolean;
  onDone: () => void;
  onTick?: () => void;
  onLand?: () => void;
}) {
  const g = mobile ? GEOMETRY.mobile : GEOMETRY.desktop;
  const reduce = useReducedMotion();
  const windowRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [landed, setLanded] = useState(false);
  // Enough cards left of the marker to fill the stage, however wide it is (up to 1680 px).
  const idleX = stripX(g, idleIndex(g, width, resultIndex));
  const latest = useRef({ onDone, onTick, onLand, g, width, reduce, resultIndex });
  latest.current = { onDone, onTick, onLand, g, width, reduce, resultIndex };

  const place = (x: number) => {
    if (stripRef.current) stripRef.current.style.transform = `translate3d(${x}px, 0, 0)`;
  };

  useLayoutEffect(() => {
    const el = windowRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Idle: follow the stage width. A running roll is never moved.
  useLayoutEffect(() => {
    if (rollKey) return;
    setLanded(false);
    place(idleX);
  }, [rollKey, idleX]);

  useLayoutEffect(() => {
    if (!rollKey) return;
    const { g, width, reduce, resultIndex } = latest.current;
    const plan = spinPlan(Math.random, g, width, resultIndex, reduce);
    const startX = stripX(g, plan.startIndex);
    const endX = stripX(g, resultIndex, plan.landingPx);
    let card = cardUnderMarker(g, startX);
    let frame = 0;
    let fallback = 0;
    let lock = 0;
    let finished = false;
    setLanded(false);
    place(startX);

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
      place(endX);
      setLanded(true);
      latest.current.onLand?.();
      lock = window.setTimeout(() => latest.current.onDone(), reduce ? 150 : LOCK_MS);
    };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = (now - t0) / plan.durationMs;
      if (t >= 1) return finish();
      const x = startX + (endX - startX) * spinProgress(t, plan.ramp, plan.power);
      place(x);
      const under = cardUnderMarker(g, x);
      if (under !== card) {
        card = under;
        if (!reduce) latest.current.onTick?.();
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // rAF pauses in a background tab: the roll still ends on time, the reveal waits there.
    fallback = window.setTimeout(finish, plan.durationMs + 250);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
      window.clearTimeout(lock);
    };
  }, [rollKey]);

  const lockColor = landed ? RARITY[cardTier(cards[resultIndex])].color : undefined;
  return (
    <div ref={windowRef} className={s.window}>
      <div ref={stripRef} className={s.strip}>
        {cards.map((card, i) => (
          <RouletteCard
            key={i}
            card={card}
            mobile={mobile}
            className={landed && i === resultIndex ? `anim ${s.lockIn}` : undefined}
            style={landed && i === resultIndex ? ({ '--lock': lockColor } as CSSProperties) : undefined}
          />
        ))}
      </div>
      <span aria-hidden="true" className={s.marker} />
      <span aria-hidden="true" className={s.triangleTop} />
      <span aria-hidden="true" className={s.triangleBottom} />
    </div>
  );
}

type Grade = { bg: string; haloInset: string; pulse: boolean; brackets: boolean };

const GRADES: Record<'desktop' | 'mobile', Record<Exclude<Tier, 'gold'>, Grade>> = {
  desktop: {
    milspec: { bg: 'var(--surface)', haloInset: '22% 24%', pulse: false, brackets: false },
    restricted: { bg: 'var(--surface)', haloInset: '16% 18%', pulse: false, brackets: false },
    classified: { bg: 'radial-gradient(ellipse at 28% 50%, color-mix(in srgb, var(--classified) 13%, transparent), color-mix(in srgb, var(--surface) 0%, transparent) 62%), var(--surface)', haloInset: '8% 10%', pulse: false, brackets: true },
    covert: { bg: 'radial-gradient(ellipse at 28% 50%, color-mix(in srgb, var(--covert) 22%, transparent), color-mix(in srgb, var(--surface) 0%, transparent) 66%), var(--surface)', haloInset: '0% 2%', pulse: true, brackets: true },
  },
  mobile: {
    milspec: { bg: 'var(--surface)', haloInset: '24% 22%', pulse: false, brackets: false },
    restricted: { bg: 'var(--surface)', haloInset: '16% 16%', pulse: false, brackets: false },
    classified: { bg: 'radial-gradient(ellipse at 50% 22%, color-mix(in srgb, var(--classified) 14%, transparent), color-mix(in srgb, var(--surface) 0%, transparent) 60%), var(--surface)', haloInset: '8% 8%', pulse: false, brackets: true },
    covert: { bg: 'radial-gradient(ellipse at 50% 22%, color-mix(in srgb, var(--covert) 24%, transparent), color-mix(in srgb, var(--surface) 0%, transparent) 64%), var(--surface)', haloInset: '0% 2%', pulse: true, brackets: true },
  },
};

export const stageBackground = (item: Item | null, mobile?: boolean) =>
  item && item.skin.tier !== 'gold' ? GRADES[mobile ? 'mobile' : 'desktop'][item.skin.tier].bg : 'var(--surface)';

/** Grade colour over the stage, faded in with the reveal and out when the roulette comes back. */
export const StageGlow = ({ item, on, mobile }: { item: Item | null; on: boolean; mobile?: boolean }) => (
  <span aria-hidden="true" className={s.stageGlow} style={{ background: stageBackground(item, mobile), opacity: on ? 1 : 0 }} />
);

/** Mute / unmute the opening sounds (remembered in this browser). */
export function SoundToggle() {
  const muted = useSoundMuted();
  const label = muted ? 'Unmute sounds' : 'Mute sounds';
  return (
    <button type="button" className={s.soundToggle} aria-label={label} title={label} onClick={() => setSoundMuted(!muted)}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
        {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />}
      </svg>
    </button>
  );
}


/** Graded reveal (DESIGN.md §5): subtle for Mil-Spec, marked for Covert. Gold has its own full screen. */
export function RevealPanel({ item, mobile, actions, footer, closing }: { item: Item; mobile?: boolean; actions: ReactNode; footer?: ReactNode; closing?: boolean }) {
  const tier = item.skin.tier === 'gold' ? 'covert' : item.skin.tier;
  const grade = GRADES[mobile ? 'mobile' : 'desktop'][tier];
  const rarity = RARITY[item.skin.tier];
  return (
    <div className={cx(s.reveal, mobile && s.mobile)} data-closing={closing || undefined}>
      <div className={s.revealArt}>
        <Halo color={rarity.halo} inset={grade.haloInset} className="anim" style={grade.pulse ? { animation: 'mint-pulse 2.6s ease-in-out infinite' } : undefined} />
        {grade.brackets && (
          <HudCorners size={mobile ? 16 : 22} inset={mobile ? 18 : 32} color={rarity.text} className="anim" style={{ animation: 'mint-fade 600ms 200ms ease-out both' }} />
        )}
        <SkinArt skin={item.skin} className={`anim ${s.revealImg}`} />
      </div>
      <div className={`anim ${s.revealInfo}`}>
        <div className={s.revealRarity}>
          <span aria-hidden="true" className={s.revealSquare} style={{ background: rarity.color }} />
          <span className="lbl" style={{ color: rarity.text }}>
            {RARITY[item.skin.tier].name}
          </span>
        </div>
        <div className={s.revealTitle}>
          <span className={s.revealWeapon}>{item.skin.weaponName}</span>
          <h2 className={s.revealSkin}>{finishLabel(item.skin)}</h2>
        </div>
        <div className={s.pills}>
          <WearPill wear={item.wear} mobile={mobile} />
          {item.stattrak && <StatTrakPill mobile={mobile} />}
          <PatternPill pattern={item.pattern} mobile={mobile} />
        </div>
        {item.float !== null && (
          <div className={s.floatBlock}>
            <div className={s.floatHead}>
              <span className="lbl">Float</span>
              <span className={`mono ${s.floatValue}`}>{formatFloat(item.float, 9)}</span>
            </div>
            <FloatBar float={item.float} min={item.minFloat} max={item.maxFloat} labels={!mobile} cursorHeight={mobile ? 20 : 22} />
          </div>
        )}
        <div className={s.recycleRow}>
          <span className={s.recycleLabel}>Recycle value</span>
          <span className={`mono ${s.recycleValue}`}>{formatCredits(item.recycleValue)} CR</span>
        </div>
        <div className={s.actions}>{actions}</div>
        {footer}
      </div>
    </div>
  );
}

/** ★ knife or gloves: full screen, rotating gold rays. */
export function GoldReveal({ item, mobile, onKeep, actions, closing }: { item: Item; mobile?: boolean; onKeep: () => void; actions: ReactNode; closing?: boolean }) {
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    actionsRef.current?.querySelector('button')?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onKeep();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [onKeep]);
  const meta = [item.wear?.name ?? 'Vanilla', item.float !== null ? formatFloat(item.float, 9) : null, mobile ? null : `Pattern #${item.pattern}`]
    .filter(Boolean)
    .join(' · ');
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="gold-title" className={cx('anim', s.gold, mobile && s.mobile)} data-closing={closing || undefined}>
      <span className="lbl" style={{ fontSize: mobile ? 11 : 12, color: 'var(--gold-text)' }}>
        ★ Rare special
      </span>
      <div className={s.goldArt}>
        <span aria-hidden="true" className={`anim ${s.rays}`} />
        <Halo color="color-mix(in srgb, var(--gold) 45%, transparent)" inset={mobile ? '4% 10%' : '6% 14%'} />
        <HudCorners size={mobile ? 18 : 26} inset={0} color="var(--gold-text)" />
        <SkinArt skin={item.skin} className={`anim ${s.goldImg}`} />
      </div>
      <div className={s.goldText}>
        <span className={s.goldWeapon}>{item.skin.weaponName}</span>
        <h2 id="gold-title" className={s.goldSkin}>
          {finishLabel(item.skin)}
        </h2>
        <span className={`mono ${s.goldMeta}`}>
          {meta}
          {item.stattrak ? ' · StatTrak™' : ''}
        </span>
      </div>
      <p style={{ fontSize: mobile ? 13 : 14, color: 'var(--text-2)', textAlign: 'center' }}>{mobile ? 'Announced to every player.' : 'Announced to every player in the global drop banner.'}</p>
      <div ref={actionsRef} className={s.goldActions}>
        {actions}
      </div>
    </div>
  );
}

