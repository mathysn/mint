import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import type { DiffRow, StaffRole, Tier, WearCode } from '../../../shared/api';
import { RARITY, WEAR_COLOR } from '../lib/rarity';
import { ROLE_HINT, can, initial, useStaff } from './lib';
import s from './admin.module.css';

export { s };

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

// ── Icons ───────────────────────────────────────────────────────────────────

export function Icon({ d, size = 18, className, style }: { d: string; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" className={cx(s.icon, className)} style={style}>
      <path d={d} />
    </svg>
  );
}

export const LOCK = 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3';
export const SEARCH = 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4';
export const CLOSE = 'M6 6l12 12M18 6L6 18';

export const LockIcon = ({ size = 12 }: { size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24">
    <path d={LOCK} />
  </svg>
);

// ── Buttons ─────────────────────────────────────────────────────────────────

type Variant = 'secondary' | 'primary' | 'danger' | 'quiet' | 'link';

interface ActionProps {
  children: ReactNode;
  onClick?: () => void;
  /** Role needed. Below it the button stays visible, disabled, with a lock and the hint. */
  min?: StaffRole;
  /** Disabled for another reason ("Restore it first"), shown as its title. */
  blocked?: string | null;
  variant?: Variant;
  size?: 36 | 40 | 44 | 48;
  disabled?: boolean;
  type?: 'button' | 'submit';
  bevel?: boolean;
  style?: CSSProperties;
  className?: string;
  ariaLabel?: string;
  to?: string;
}

export function Btn({ children, onClick, min, blocked, variant = 'secondary', size = 40, disabled, type = 'button', bevel, style, className, ariaLabel, to }: ActionProps) {
  const staff = useStaff();
  const locked = min ? !can(staff.role, min) : false;
  const classes = cx(
    s.btn,
    variant === 'primary' && s.primary,
    variant === 'danger' && s.danger,
    variant === 'quiet' && s.quiet,
    variant === 'link' && s.link,
    size === 44 && s.h44,
    size === 36 && s.h36,
    size === 48 && s.h48,
    bevel && s.bevel,
    className,
  );
  const title = locked ? ROLE_HINT[min as 'moderator' | 'admin'] : blocked || undefined;
  if (to && !locked && !blocked && !disabled) {
    return (
      <Link to={to} className={classes} style={style} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={classes} onClick={onClick} disabled={locked || !!blocked || disabled} title={title} style={style} aria-label={ariaLabel}>
      {locked && <LockIcon />}
      {children}
    </button>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────

export function Avatar({ label, url, size = 32, guest, fontSize }: { label: string; url?: string | null; size?: number; guest?: boolean; fontSize?: number }) {
  return (
    <span aria-hidden="true" className={cx(s.avatar, guest && s.avatarGuest)} style={{ width: size, height: size, fontSize: fontSize ?? Math.round(size * 0.4) }}>
      {url ? <img src={url} alt="" /> : initial(label, guest)}
    </span>
  );
}

export const Dot = ({ label }: { label?: string }) => <span className={s.dot} aria-label={label} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} />;

export function Chip({ children, style: variant, icon }: { children: ReactNode; style: 'outline' | 'dashed' | 'solid' | 'ban' | 'bare' | 'flag'; icon?: ReactNode }) {
  const cls = { outline: s.chipOutline, flag: s.chipOutline, dashed: s.chipDashed, solid: s.chipSolid, ban: s.chipBan, bare: s.chipBare }[variant];
  return (
    <span className={cx('mono', s.statusChip, cls)}>
      {variant === 'flag' && <span className={s.dot} aria-hidden="true" style={{ width: 6, height: 6 }} />}
      {icon}
      {children}
    </span>
  );
}

export const StBadge = () => <span className={s.stBadge}>ST™</span>;

export function RaritySquare({ tier, size = 8 }: { tier: Tier; size?: number }) {
  return <span aria-hidden="true" className={s.square} style={{ width: size, height: size, background: RARITY[tier].color }} />;
}

export function Switch({ checked, label, onChange, disabled, title }: { checked: boolean; label: string; onChange: () => void; disabled?: boolean; title?: string }) {
  return <button type="button" role="switch" className={cx(s.sw, s.above)} aria-checked={checked} aria-label={label} onClick={onChange} disabled={disabled} title={title} />;
}

/** 5 wear zones to scale, white marker at the float (DESIGN.md §3). */
export function FloatBar({ float }: { float: number | null }) {
  const zones: [WearCode, number][] = [
    ['FN', 7],
    ['MW', 8],
    ['FT', 23],
    ['WW', 7],
    ['BS', 55],
  ];
  return (
    <div className={s.floatBar}>
      {zones.map(([code, flex]) => (
        <span key={code} style={{ flex, background: WEAR_COLOR[code] }} />
      ))}
      {float !== null && <span aria-hidden="true" className={s.floatMarker} style={{ left: `${(float * 100).toFixed(2)}%` }} />}
    </div>
  );
}

/** Skin image on its rarity halo (the API images; the mockups use silhouettes). */
export function ItemArt({ tier, imageUrl, alt, dim, height = 96, broken }: { tier: Tier; imageUrl: string; alt: string; dim?: number; height?: number; broken?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={s.itemArt} style={{ height }}>
      <span aria-hidden="true" className={s.itemGlow} style={{ background: `radial-gradient(closest-side, ${RARITY[tier].halo}, transparent)`, opacity: dim ?? 1 }} />
      {broken || failed ? (
        <span className="mono" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-2)' }}>
          <span className={s.dot} aria-hidden="true" style={{ width: 6, height: 6 }} />
          No image
        </span>
      ) : (
        <img src={imageUrl} alt={alt} loading="lazy" style={{ opacity: dim ?? 1 }} onError={() => setFailed(true)} />
      )}
    </span>
  );
}

/** 14 px HUD corners of the item and case stages. */
export function Corners() {
  const at: CSSProperties[] = [
    { left: 14, top: 14, borderLeftWidth: 1, borderTopWidth: 1 },
    { right: 14, top: 14, borderRightWidth: 1, borderTopWidth: 1 },
    { left: 14, bottom: 14, borderLeftWidth: 1, borderBottomWidth: 1 },
    { right: 14, bottom: 14, borderRightWidth: 1, borderBottomWidth: 1 },
  ];
  return (
    <>
      {at.map((style, i) => (
        <span key={i} aria-hidden="true" className={s.corner} style={style} />
      ))}
    </>
  );
}

/** White polyline on a #1E2227 track; values are scaled to the box. */
export function Sparkline({ values, height = 24 }: { values: number[]; height?: number }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${values.length > 1 ? ((i / (values.length - 1)) * 100).toFixed(2) : 50},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(2)}`)
    .join(' ');
  return (
    <svg aria-hidden="true" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, marginTop: 2 }}>
      <line x1="0" y1={height - 1} x2="100" y2={height - 1} style={{ stroke: 'var(--track)', strokeWidth: 2, vectorEffect: 'non-scaling-stroke' }} />
      <polyline points={points} style={{ fill: 'none', stroke: 'var(--text)', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }} />
    </svg>
  );
}

// ── Page header ─────────────────────────────────────────────────────────────

export function Header({ label, title, sub, subMono, right }: { label: string; title: string; sub?: ReactNode; subMono?: boolean; right?: ReactNode }) {
  return (
    <header className={s.header}>
      <div className={s.headerText}>
        <span className="lbl">// {label}</span>
        <h1 className={s.title}>{title}</h1>
        {sub && <p className={cx(subMono ? 'mono' : undefined, subMono ? s.subMono : s.sub)}>{sub}</p>}
      </div>
      {right}
    </header>
  );
}

// ── Loading, empty, error ───────────────────────────────────────────────────

const WIDTHS = [180, 120, 150, 110, 170, 130, 160, 140];

export function SkeletonRows({ rows = 8, label }: { rows?: number; label: string }) {
  return (
    <div className={s.tableWrap} aria-busy="true" aria-label={label}>
      <div style={{ height: 44, borderBottom: '1px solid var(--border)', background: 'var(--rail)' }} />
      {WIDTHS.slice(0, rows).map((w, i) => (
        <div key={i} className={s.skelRow}>
          <span className={s.skel} style={{ width: 84 }} />
          <span className={s.skel} style={{ width: w }} />
          <span className={s.skel} style={{ width: 90, marginLeft: 'auto' }} />
          <span className={s.skel} style={{ width: 70, height: 20 }} />
        </div>
      ))}
    </div>
  );
}

export function EmptyBox({ children, sub, action }: { children: ReactNode; sub?: ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div className={s.empty}>
      <span>{children}</span>
      {sub && <span className={s.emptySub}>{sub}</span>}
      {action && (
        <Btn size={44} onClick={action.onClick}>
          {action.label}
        </Btn>
      )}
    </div>
  );
}

export function ErrorBox({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : 'The server didn’t answer.';
  return (
    <div role="alert" className={s.error}>
      <div className={s.errorText}>
        <span className={s.errorTitle}>{title}</span>
        <span>{message} Nothing was changed.</span>
      </div>
      <Btn size={44} onClick={onRetry}>
        Retry
      </Btn>
    </div>
  );
}

// ── Confirmations ───────────────────────────────────────────────────────────

/** "Balance 4,870 → 9,870 CR" in a line. */
export const diffLine = (rows: DiffRow[]) => rows.map((r) => `${r.label} ${r.before} → ${r.after}`).join(' · ');

/**
 * One-line confirmation above the content (player header actions, catalog switches): title,
 * explanation, before → after, Reason, Cancel and the exact action button.
 */
export function InlineConfirm({
  title,
  text,
  diff,
  button,
  danger,
  onConfirm,
  onCancel,
  blocked,
}: {
  title: string;
  text: ReactNode;
  diff?: DiffRow[];
  button: string;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<string | null>;
  onCancel: () => void;
  /** Can't be done: only the explanation and OK. */
  blocked?: boolean;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const go = async () => {
    setBusy(true);
    const message = await onConfirm(reason.trim());
    setBusy(false);
    if (message) setError(message);
  };
  return (
    <div
      role="alertdialog"
      aria-label={title}
      className={s.confirm}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className={s.confirmText}>
        <span className={s.confirmTitle}>{title}</span>
        <span>{text}</span>
        {diff && diff.length > 0 && <span className={s.confirmDiff}>{diffLine(diff)}</span>}
        {error && <span className={s.alertText} role="alert">{error}</span>}
      </div>
      {blocked ? (
        <Btn onClick={onCancel}>OK</Btn>
      ) : (
        <>
          <label className={s.reasonInline}>
            <span>Reason</span>
            <input ref={input} className={s.field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Shown in the admin log" onKeyDown={(e) => e.key === 'Enter' && reason.trim() && !busy && void go()} />
          </label>
          <Btn variant="quiet" onClick={onCancel}>
            Cancel
          </Btn>
          <Btn variant={danger ? 'danger' : 'primary'} onClick={() => void go()} disabled={!reason.trim() || busy}>
            {button}
          </Btn>
        </>
      )}
    </div>
  );
}

export function ReasonField({ value, onChange, hint = 'required, shown in the admin log', placeholder, inputRef }: { value: string; onChange: (v: string) => void; hint?: string; placeholder: string; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <label className={s.fieldLabel}>
      <span>
        Reason <span className={s.muted}>· {hint}</span>
      </span>
      <input ref={inputRef} className={s.field} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function TypeName({ name, value, onChange, label }: { name: string; value: string; onChange: (v: string) => void; label?: string }) {
  const wrong = value.length > 0 && value.trim() !== name;
  return (
    <label className={s.fieldLabel}>
      <span>
        Type <span className="mono" style={{ color: 'var(--text)' }}>{name}</span> {label ?? 'to confirm'}
      </span>
      <input className={cx('mono', s.field)} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={wrong} />
    </label>
  );
}

export function DiffBox({ rows }: { rows: DiffRow[] }) {
  return (
    <div className={s.diff}>
      {rows.map((r) => (
        <div key={r.label} className={s.diffRow}>
          <span>{r.label}</span>
          <span className="mono">
            {r.before === r.after ? r.after : `${r.before} → ${r.after}`}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Dialog, sheet, drawer ───────────────────────────────────────────────────

function useEscape(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, []);
}

/**
 * Staff dialog (design/Admin-Dlg-*.dc.html): 560 px panel 56 px from the top on desktop, sheet
 * on mobile; label + close, 24 px title, body, pinned footer with "Logged as …" and the actions.
 */
export function Dialog({
  label,
  title,
  onClose,
  children,
  footer,
  mobile,
}: {
  label: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  mobile?: boolean;
}) {
  useEscape(onClose);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    body.current?.querySelector<HTMLElement>('[data-autofocus], input, button:not([aria-label="Close"])')?.focus();
  }, []);
  return createPortal(
    <>
      <div className={s.backdrop} onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className={mobile ? s.sheet : s.dialog}>
        <div ref={body} className={mobile ? s.sheetBody : s.dialogBody}>
          {mobile && <span aria-hidden="true" className={s.handle} />}
          <div className={s.dialogHead}>
            <span className={cx('lbl', mobile && s.lbl10)}>// {label}</span>
            <button type="button" aria-label="Close" className={s.close} onClick={onClose}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
                <path d={CLOSE} />
              </svg>
            </button>
          </div>
          <h2 className={s.dialogTitle} style={mobile ? { fontSize: 22, marginTop: -8 } : undefined}>
            {title}
          </h2>
          {children}
        </div>
        <div className={mobile ? s.sheetFoot : s.dialogFoot}>{footer}</div>
      </div>
    </>,
    document.body,
  );
}

export function Logged() {
  const staff = useStaff();
  return <span className={cx('mono', s.logged)}>Logged as {staff.name}</span>;
}

/** 520 px panel on the right over the dimmed page, actions pinned at the bottom. */
export function Drawer({ label, onClose, children, footer }: { label: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  return createPortal(
    <>
      <div className={s.backdrop} onClick={onClose} style={{ background: 'color-mix(in srgb, var(--page) 62%, transparent)' }} />
      <aside role="dialog" aria-modal="true" aria-label={typeof label === 'string' ? label : 'Details'} className={s.drawer}>
        <div className={s.drawerBody}>
          <div className={s.dialogHead}>
            <span className="lbl">{label}</span>
            <button type="button" aria-label="Close" className={s.close} onClick={onClose}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
                <path d={CLOSE} />
              </svg>
            </button>
          </div>
          {children}
        </div>
        {footer && <div className={s.drawerFoot}>{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}

/** Small "Show more" footer of the lists. */
export function ListFooter({ text, onMore, more, loading }: { text: string; onMore: () => void; more: boolean; loading?: boolean }) {
  return (
    <div className={s.footer}>
      <span className={cx('mono', s.footerText)}>{text}</span>
      {more && (
        <Btn onClick={onMore} disabled={loading}>
          Show more
        </Btn>
      )}
    </div>
  );
}
