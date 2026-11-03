import type { CSSProperties, ReactNode } from 'react';
import { formatCredits } from '../../lib/format';
import { useAnimatedNumber } from '../../lib/useAnimatedNumber';
import s from './ui.module.css';

/** Mono 11 px uppercase label, often prefixed with "// " (DESIGN.md §2). */
export function HudLabel({ children, style, as: Tag = 'span', id }: { children: ReactNode; style?: CSSProperties; as?: 'span' | 'h2'; id?: string }) {
  return (
    <Tag className="lbl" style={style} id={id}>
      {children}
    </Tag>
  );
}

/** Four 1 px corner brackets. `inset` = distance from the edges, `size` = bracket length. */
export function HudCorners({ size = 20, inset = 28, color = 'var(--hud)', className, style }: { size?: number; inset?: number; color?: string; className?: string; style?: CSSProperties }) {
  const corner = { width: size, height: size };
  return (
    <span aria-hidden="true" className={[s.corners, className].filter(Boolean).join(' ')} style={{ inset, color, ...style }}>
      <span className={`${s.corner} ${s.tl}`} style={corner} />
      <span className={`${s.corner} ${s.tr}`} style={corner} />
      <span className={`${s.corner} ${s.bl}`} style={corner} />
      <span className={`${s.corner} ${s.br}`} style={corner} />
    </span>
  );
}

/** Rarity glow behind the art: radial-gradient(closest-side, <halo>, transparent). */
export function Halo({ color, inset, className, style }: { color: string; inset: string; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{ position: 'absolute', inset, background: `radial-gradient(closest-side, ${color}, rgba(0,0,0,0))`, ...style }}
    />
  );
}

export function Credits({ value, size, unitSize, weight, style }: { value: number; size?: number; unitSize?: number; weight?: number; style?: CSSProperties }) {
  return (
    <span className={s.credits} style={{ fontSize: size, fontWeight: weight, ...style }}>
      {formatCredits(value)} <span className={s.creditsUnit} style={{ fontSize: unitSize }}>CR</span>
    </span>
  );
}

/** Credits that count up or down when the amount changes (balance after an opening, a recycle, a sale). */
export function AnimatedCredits(props: Parameters<typeof Credits>[0]) {
  return <Credits {...props} value={useAnimatedNumber(props.value)} />;
}

export const StatTrakBadge = ({ style }: { style?: CSSProperties }) => (
  <span className={s.stBadge} style={style}>
    ST™
  </span>
);

export function Tag({ children, solid, style }: { children: ReactNode; solid?: boolean; style?: CSSProperties }) {
  return (
    <span className={`lbl ${solid ? s.tagSolid : s.tag}`} style={style}>
      {children}
    </span>
  );
}

export function ProgressBar({ pct, style }: { pct: number; style?: CSSProperties }) {
  return (
    <span aria-hidden="true" className={s.progress} style={style}>
      <span className={s.progressFill} style={{ width: `${pct}%` }} />
    </span>
  );
}

export const Spinner = ({ size = 44 }: { size?: number }) => (
  <span aria-hidden="true" className={`anim ${s.spinner}`} style={{ width: size, height: size }} />
);

export function Avatar({ name, url, size = 32, guest }: { name: string | null; url?: string | null; size?: number; guest?: boolean }) {
  return (
    <span aria-hidden="true" className={`${s.avatar} ${guest ? s.avatarGuest : ''}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {url ? <img src={url} alt="" /> : guest ? '?' : (name?.[0] ?? '?').toUpperCase()}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      <p className={s.emptyTitle}>{title}</p>
      {children}
    </div>
  );
}
