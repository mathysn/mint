import { useEffect, useRef, useState } from 'react';
import type { AdminPlayer, AdminSkinHit, BanDuration, BanPreview, CreditsPreview, DeletePreview, GrantQuote, WearCode } from '../../../shared/api';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useConfig } from '../lib/queries';
import { RARITY } from '../lib/rarity';
import { useDebounced } from '../lib/useDebounced';
import { adminKeys, cr, num, useAdminAction, usePlayer, usePreview, useStaff, utcDateTime } from './lib';
import { Btn, Dialog, FloatBar, ItemArt, Logged, ReasonField, SEARCH, StBadge, Switch, TypeName, cx, s } from './ui';

interface DialogProps {
  player: AdminPlayer;
  onClose: () => void;
  mobile?: boolean;
}

function Footer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <Logged />
      <Btn size={44} onClick={onClose}>
        Cancel
      </Btn>
      {children}
    </>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <span role="alert" className={s.alertText}>
      {error}
    </span>
  ) : null;
}

// ── Adjust credits (design/Admin-Dlg-Credits.dc.html) ───────────────────────

const digits = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 9);

export function CreditsDialog({ player, onClose, mobile }: DialogProps) {
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const action = useAdminAction();
  const n = Number(digits(amount)) || 0;
  const preview = usePreview<CreditsPreview>(`/admin/players/${player.id}/credits/preview`, { mode, amount: n });
  const p = preview.data;
  const blocked = mode === 'remove' && n > 0 ? (p?.blocked ?? null) : null;
  const add = mode === 'add';
  const name = player.label;
  const go = async () => {
    const message = await action.run(`/admin/players/${player.id}/credits`, { mode, amount: n, reason: reason.trim() });
    if (message) setError(message);
    else onClose();
  };
  return (
    <Dialog
      mobile={mobile}
      label="Adjust credits"
      title={n > 0 ? (add ? `Add ${num(n)} CR to ${name}` : `Remove ${num(n)} CR from ${name}`) : `Adjust ${name}’s credits`}
      onClose={onClose}
      footer={
        <Footer onClose={onClose}>
          <Btn size={44} variant="primary" min="admin" onClick={() => void go()} disabled={n === 0 || !!blocked || !reason.trim() || action.busy || preview.isFetching}>
            {n > 0 ? `${add ? 'Add' : 'Remove'} ${num(n)} CR` : add ? 'Add credits' : 'Remove credits'}
          </Btn>
        </Footer>
      }
    >
      <div role="radiogroup" aria-label="Add or remove" className={cx(s.seg, s.segPage)} style={{ display: 'inline-flex', alignSelf: 'flex-start' }}>
        {(['add', 'remove'] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={s.segBtn} style={{ height: 38, padding: '0 20px', fontSize: 14, fontWeight: 500 }} onClick={() => setMode(m)}>
            {m === 'add' ? 'Add' : 'Remove'}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor="credits-amount" style={{ fontSize: 13, color: 'var(--text-2)' }}>
          Amount
        </label>
        <div style={{ position: 'relative' }}>
          <input
            id="credits-amount"
            data-autofocus
            inputMode="numeric"
            className={cx('mono', s.field)}
            style={{ width: '100%', height: 56, padding: '0 60px 0 16px', fontSize: 24 }}
            value={amount}
            aria-invalid={Boolean(blocked)}
            onChange={(e) => {
              const d = digits(e.target.value);
              setAmount(d ? num(Number(d)) : '');
            }}
          />
          <span className="mono" aria-hidden="true" style={{ position: 'absolute', right: 16, top: 18, fontSize: 15, color: 'var(--text-3)' }}>
            CR
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[500, 1000, 5000, 10000].map((v) => (
            <button key={v} type="button" className={cx(s.btn, s.h36, 'mono')} style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 400 }} onClick={() => setAmount(num(v))}>
              {num(v)}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 18px', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--page)' }}>
        <span className={cx('lbl', s.lbl10)}>{name}'s balance</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '8px 14px' }}>
          <span className="mono" style={{ fontSize: 20, color: 'var(--text-2)' }}>
            {p ? cr(p.before) : '—'}
          </span>
          <span aria-hidden="true" style={{ fontSize: 18, color: 'var(--text-3)' }}>
            →
          </span>
          <span className="sr-only">becomes</span>
          <span className="mono" style={{ fontSize: 28, fontWeight: 500, color: blocked ? 'var(--error)' : 'var(--text)', textDecoration: blocked ? 'line-through' : undefined }}>
            {p ? `${p.after < 0 ? '−' : ''}${num(Math.abs(p.after))} CR` : '—'}
          </span>
        </div>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>
          {blocked ? 'A balance can’t go below 0 CR.' : `Held in bids (${cr(p?.held ?? 0)}) stays as it is. Adds a ${add ? 'admin_grant' : 'admin_remove'} entry to ${name}’s ledger.`}
        </span>
      </div>
      {blocked && p && (
        <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: -8 }}>
          <span className={s.alertText}>{blocked}</span>
          <Btn size={36} onClick={() => setAmount(num(p.max))}>
            Remove {cr(p.max)} instead
          </Btn>
        </div>
      )}
      <ReasonField value={reason} onChange={setReason} hint={`required, shown in the admin log and ${name}'s ledger`} placeholder="e.g. compensation, outage" />
      <ErrorLine error={error} />
    </Dialog>
  );
}

// ── Grant item (design/Admin-Dlg-Grant.dc.html) ─────────────────────────────

const WEARS: { code: WearCode; name: string; lo: number; hi: number }[] = [
  { code: 'FN', name: 'Factory New', lo: 0, hi: 0.07 },
  { code: 'MW', name: 'Minimal Wear', lo: 0.07, hi: 0.15 },
  { code: 'FT', name: 'Field-Tested', lo: 0.15, hi: 0.38 },
  { code: 'WW', name: 'Well-Worn', lo: 0.38, hi: 0.45 },
  { code: 'BS', name: 'Battle-Scarred', lo: 0.45, hi: 1 },
];
const f2 = (n: number) => n.toFixed(2);

/** Middle of the wear's floats that the skin can have (capped at 0.6, like the mockup). */
function floatFor(code: WearCode, skin: AdminSkinHit | null): string {
  const w = WEARS.find((x) => x.code === code)!;
  const lo = Math.max(w.lo, skin?.minFloat ?? 0);
  const hi = Math.min(w.hi, skin?.maxFloat ?? 1, 0.6);
  return ((lo + Math.max(lo, hi)) / 2).toFixed(9);
}

export function GrantDialog({ player, onClose, mobile }: DialogProps) {
  const staff = useStaff();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [skin, setSkin] = useState<AdminSkinHit | null>(null);
  const [wear, setWear] = useState<WearCode>('FT');
  const [float, setFloat] = useState(floatFor('FT', null));
  const [pattern, setPattern] = useState('');
  const [st, setSt] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const action = useAdminAction();
  const q = useDebounced(query.trim(), 200);
  const suggestions = useQuery({ queryKey: adminKeys.skins(q), queryFn: () => api<AdminSkinHit[]>(`/admin/skins?q=${encodeURIComponent(q)}`), enabled: q.length >= 2 });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);
  const vanilla = skin !== null && skin.minFloat === null;
  const floatNum = vanilla ? null : Number(float);
  const quote = usePreview<GrantQuote>(
    `/admin/players/${player.id}/grant/quote`,
    { skinId: skin?.id ?? '', wear: vanilla ? null : wear, float: floatNum === null || Number.isNaN(floatNum) ? 2 : floatNum, stattrak: st },
    Boolean(skin),
  );
  const g = quote.data;
  const bad = Boolean(skin && g?.error);
  const range = WEARS.find((w) => w.code === wear)!;
  const pick = (hit: AdminSkinHit) => {
    setSkin(hit);
    setQuery(hit.name);
    setOpen(false);
    const first = WEARS.find((w) => w.code === 'FT' && (hit.minFloat ?? 0) < w.hi && (hit.maxFloat ?? 1) > w.lo) ?? WEARS.find((w) => (hit.minFloat ?? 0) < w.hi && (hit.maxFloat ?? 1) > w.lo) ?? WEARS[2]!;
    setWear(first.code);
    setFloat(floatFor(first.code, hit));
    if (!hit.stattrakAvailable) setSt(false);
  };
  const go = async () => {
    const message = await action.run(`/admin/players/${player.id}/grant`, {
      skinId: skin!.id,
      wear: vanilla ? null : wear,
      float: floatNum,
      stattrak: st,
      pattern: pattern ? Number(pattern) : null,
      reason: reason.trim(),
    });
    if (message) setError(message);
    else onClose();
  };
  const tier = skin?.tier ?? 'milspec';
  return (
    <Dialog
      mobile={mobile}
      label="Grant item"
      title={skin ? `Grant ${skin.name} to ${player.label}` : `Grant an item to ${player.label}`}
      onClose={onClose}
      footer={
        <Footer onClose={onClose}>
          <Btn size={44} variant="primary" min="admin" onClick={() => void go()} disabled={!skin || bad || !g || !reason.trim() || action.busy || quote.isFetching}>
            {skin ? `Grant ${skin.name}` : 'Grant item'}
          </Btn>
        </Footer>
      }
    >
      <div ref={box} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="grant-skin" style={{ fontSize: 13, color: 'var(--text-2)' }}>
          Skin
        </label>
        <div style={{ position: 'relative' }}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" className={s.searchIcon}>
            <path d={SEARCH} />
          </svg>
          <input
            id="grant-skin"
            data-autofocus
            role="combobox"
            aria-expanded={open && q.length >= 2}
            aria-controls="grant-skins"
            className={s.field}
            style={{ width: '100%', paddingLeft: 40 }}
            placeholder="Weapon or skin name"
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && open) {
                e.preventDefault();
                setOpen(false);
              }
              if (e.key === 'Enter' && suggestions.data?.[0]) {
                e.preventDefault();
                pick(suggestions.data[0]);
              }
            }}
          />
        </div>
        {open && q.length >= 2 && suggestions.data && (
          <div id="grant-skins" role="listbox" aria-label="Skins" className={s.results} style={{ top: 74, zIndex: 5, padding: 6 }}>
            {suggestions.data.map((hit) => (
              <button
                key={hit.id}
                type="button"
                role="option"
                aria-selected={skin?.id === hit.id}
                onClick={() => pick(hit)}
                style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 56, padding: '6px 10px', border: 0, borderRadius: 2, background: skin?.id === hit.id ? 'var(--separator)' : 'none', color: 'var(--text)', font: 'inherit', textAlign: 'left', cursor: 'pointer', overflow: 'hidden' }}
              >
                <span style={{ flex: 'none', width: 72, height: 40 }}>
                  <ItemArt tier={hit.tier} imageUrl={hit.imageUrl} alt="" height={40} />
                </span>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{hit.name}</span>
                  <span style={{ fontSize: 12, color: RARITY[hit.tier].text }}>{RARITY[hit.tier].name}</span>
                </span>
                <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, background: RARITY[hit.tier].color }} />
              </button>
            ))}
            {suggestions.data.length === 0 && <span style={{ display: 'block', padding: '14px 10px', fontSize: 13, color: 'var(--text-2)' }}>No skin matches “{q}”.</span>}
          </div>
        )}
      </div>

      {!vanilla && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Wear</span>
            <div role="radiogroup" aria-label="Wear" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {WEARS.map((w) => (
                <button
                  key={w.code}
                  type="button"
                  role="radio"
                  aria-checked={wear === w.code}
                  title={`${w.name}: ${f2(w.lo)} to ${f2(w.hi)}`}
                  className={cx(s.toggle, 'mono')}
                  style={{ minWidth: 56, justifyContent: 'center' }}
                  onClick={() => {
                    setWear(w.code);
                    setFloat(floatFor(w.code, skin));
                  }}
                >
                  {w.code}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <label className={s.fieldLabel} style={{ flex: '1 1 160px', minWidth: 0 }}>
              <span>
                Float{' '}
                <span className={s.muted}>
                  · {wear} is {f2(range.lo)} to {f2(range.hi)}
                </span>
              </span>
              <input className={cx('mono', s.field)} style={{ fontSize: 15 }} value={float} onChange={(e) => setFloat(e.target.value.replace(/[^0-9.]/g, '').slice(0, 11))} aria-invalid={bad} />
            </label>
            <label className={s.fieldLabel} style={{ flex: '0 0 96px', minWidth: 0 }}>
              <span>Pattern</span>
              <input className={cx('mono', s.field)} style={{ fontSize: 15 }} value={pattern} placeholder="Random" inputMode="numeric" onChange={(e) => setPattern(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} />
            </label>
            <div style={{ flex: '0 0 112px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span id="grant-st" style={{ fontSize: 13, color: 'var(--text-2)' }}>
                StatTrak™
              </span>
              <span style={{ height: 44, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Switch checked={st} label="StatTrak™" onChange={() => setSt(!st)} disabled={skin !== null && !skin.stattrakAvailable} />
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {st ? 'On · value ×2' : 'Off'}
                </span>
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: -4 }}>
            <FloatBar float={floatNum !== null && floatNum >= 0 && floatNum <= 1 ? floatNum : null} />
            {bad && g?.error && (
              <span role="alert" className={s.alertText} style={{ fontSize: 13 }}>
                {g.error}
              </span>
            )}
          </div>
        </>
      )}
      {vanilla && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <label className={s.fieldLabel} style={{ flex: '0 0 96px' }}>
            <span>Pattern</span>
            <input className={cx('mono', s.field)} value={pattern} placeholder="Random" inputMode="numeric" onChange={(e) => setPattern(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} />
          </label>
          <span style={{ fontSize: 13, color: 'var(--text-2)', paddingBottom: 12 }}>Vanilla: no float.</span>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', padding: 14, border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--page)' }}>
        <div className={s.itemCard} style={{ flex: 'none', width: 196 }}>
          {skin ? <ItemArt tier={tier} imageUrl={skin.imageUrl} alt={skin.name} height={80} /> : <span className={s.itemArt} style={{ height: 80 }} />}
          {st && (
            <span style={{ position: 'absolute', right: 8, top: 8 }}>
              <StBadge />
            </span>
          )}
          <span className={s.itemBody} style={{ padding: '8px 12px 10px' }}>
            <span className={s.itemWeapon}>{skin?.weaponName ?? '—'}</span>
            <span className={s.itemSkin}>{skin ? (skin.finishName ?? 'Vanilla') : 'Pick a skin'}</span>
            <span className={cx('mono', s.itemMeta)}>
              <span style={{ color: 'var(--text-2)' }}>{vanilla ? 'Vanilla' : floatNum !== null && !Number.isNaN(floatNum) ? `${wear} · ${floatNum.toFixed(4)}` : wear}</span>
              <span>{g && !g.error ? cr(g.value) : '—'}</span>
            </span>
          </span>
          <span className={s.itemBar} style={{ background: skin ? RARITY[tier].color : 'var(--border)' }} />
        </div>
        <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>
          <span className={cx('lbl', s.lbl10)}>Preview</span>
          <span>
            Lands in {player.label}'s inventory as <span style={{ color: 'var(--text)' }}>Available</span>, with a new 9-digit ID. Origin shows “Granted by {staff.name}”.
          </span>
          <span>
            Inventory value{' '}
            <span className="mono" style={{ color: 'var(--text)' }}>
              {num(g?.inventoryBefore ?? player.stats.inventoryValue)} → {g && !g.error ? num(g.inventoryAfter) : '—'} CR
            </span>
          </span>
        </div>
      </div>
      <ReasonField value={reason} onChange={setReason} placeholder="e.g. support ticket #61, lost drop" />
      <ErrorLine error={error} />
    </Dialog>
  );
}

// ── Ban (design/Admin-Dlg-Ban.dc.html, mobile design/Admin-M-Ban.dc.html) ───

const DURATIONS: { key: BanDuration; label: string; short: string; title: string; chip: string }[] = [
  { key: '24h', label: '24 hours', short: '24 h', title: 'for 24 hours', chip: '24 h' },
  { key: '7d', label: '7 days', short: '7 d', title: 'for 7 days', chip: '7 d' },
  { key: '30d', label: '30 days', short: '30 d', title: 'for 30 days', chip: '30 d' },
  { key: 'permanent', label: 'Permanent', short: 'Perm', title: 'permanently', chip: 'Permanent' },
];

function banEffects(p: BanPreview, name: string, mobile?: boolean): { n: number; head: string; text: string }[] {
  const lines: { n: number; head: string; text: string }[] = [];
  if (p.sessions === 0) lines.push({ n: 0, head: 'sessions', text: 'to sign out.' });
  else lines.push({ n: p.sessions, head: p.sessions === 1 ? 'session signed out,' : 'sessions signed out,', text: mobile ? 'Discord activity included.' : 'including the Discord activity.' });
  if (p.listings.length === 0) lines.push({ n: 0, head: 'listings', text: 'to cancel.' });
  else if (p.listings.length === 1) {
    const l = p.listings[0]!;
    const refunds = l.bids > 0 ? (mobile ? `, ${l.bids} bid${l.bids === 1 ? '' : 's'} refunded.` : ` ${l.bids} bid${l.bids === 1 ? '' : 's'} refunded, the leading ${cr(l.leading ?? 0)} to ${l.leader}.`) : mobile ? '.' : '';
    lines.push({ n: 1, head: 'listing cancelled:', text: mobile ? `${l.item} back to ${name}${refunds}` : `${l.item} goes back to ${name}’s inventory.${refunds}` });
  } else {
    lines.push({ n: p.listings.length, head: 'listings cancelled:', text: `${p.listings.map((l) => l.item).join(', ')} go back to ${name}’s inventory. Every leading bid is refunded.` });
  }
  if (p.bids.length > 0) {
    const total = p.bids.reduce((n, b) => n + b.amount, 0);
    lines.push({
      n: p.bids.length,
      head: p.bids.length === 1 ? 'bid cancelled:' : 'bids cancelled:',
      text: mobile ? `${cr(total)} back to ${name}.` : `${p.bids.map((b) => b.item).join(', ')}. ${cr(total)} goes back to ${name}’s balance.`,
    });
  }
  lines.push({ n: p.offers, head: p.offers === 1 ? 'open offer' : 'open offers', text: p.offers === 0 ? 'to cancel.' : 'cancelled: items and credits go back to their senders.' });
  return lines;
}

export function BanDialog({ player, onClose, mobile }: DialogProps) {
  const [duration, setDuration] = useState<BanDuration>('7d');
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const action = useAdminAction();
  const preview = usePreview<BanPreview>(`/admin/players/${player.id}/ban/preview`, undefined);
  const d = DURATIONS.find((x) => x.key === duration)!;
  const perm = duration === 'permanent';
  const until = !perm && preview.data ? preview.data.until[duration as Exclude<BanDuration, 'permanent'>] : null;
  const name = player.label;
  const title = `Ban ${name} ${d.title}`;
  const cantGo = !reason.trim() || (perm && typed.trim() !== name) || action.busy || !preview.data;
  const go = async () => {
    const message = await action.run(`/admin/players/${player.id}/ban`, { duration, reason: reason.trim(), confirmName: perm ? typed.trim() : undefined });
    if (message) setError(message);
    else onClose();
  };
  const effects = preview.data ? banEffects(preview.data, name, mobile) : [];
  const banButton = (
    <Btn size={mobile ? 48 : 44} variant="danger" min="moderator" onClick={() => void go()} disabled={cantGo} style={mobile ? { width: '100%' } : undefined}>
      {title}
    </Btn>
  );
  return (
    <Dialog
      mobile={mobile}
      label="Ban"
      title={title}
      onClose={onClose}
      footer={
        mobile ? (
          <>
            {banButton}
            <div style={{ textAlign: 'center' }}>
              <Logged />
            </div>
          </>
        ) : (
          <Footer onClose={onClose}>{banButton}</Footer>
        )
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!mobile && (
          <span id="ban-dur" style={{ fontSize: 13, color: 'var(--text-2)' }}>
            Duration
          </span>
        )}
        <div role="radiogroup" aria-label="Duration" className={mobile ? cx(s.seg, s.segPage) : undefined} style={mobile ? { gridTemplateColumns: 'repeat(4, 1fr)' } : { display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {DURATIONS.map((x) => (
            <button
              key={x.key}
              type="button"
              role="radio"
              aria-checked={duration === x.key}
              className={mobile ? s.segBtn : s.toggle}
              style={mobile ? { height: 40 } : { padding: '0 16px', fontSize: 14 }}
              onClick={() => {
                setDuration(x.key);
                setTyped('');
              }}
            >
              {mobile ? x.short : x.label}
            </button>
          ))}
        </div>
        <span className="mono" style={{ fontSize: mobile ? 11 : 12, color: 'var(--text-2)', marginTop: mobile ? -8 : 0 }}>
          {perm ? 'No end date. Only an unban lifts it.' : until ? `Until ${utcDateTime(until)} UTC` : '—'}
        </span>
      </div>
      <ReasonField value={reason} onChange={setReason} hint={mobile ? `shown to ${name}` : `required, shown to ${name} and in the admin log`} placeholder="e.g. scam attempt in trades" />
      <section aria-label="Happens right away" style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)' }}>
        <h3 className={cx('lbl', s.lbl10)} style={{ padding: mobile ? '10px 12px 6px' : '12px 14px 8px' }}>
          Happens right away
        </h3>
        {preview.isPending && <span className={s.skel} style={{ margin: 14, width: '60%' }} />}
        {effects.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: mobile ? 10 : 12, padding: mobile ? '9px 12px' : '10px 14px', borderTop: '1px solid var(--separator)', fontSize: 13, lineHeight: 1.5 }}>
            <span className="mono" style={{ flex: 'none', width: mobile ? 16 : 22 }}>
              {e.n}
            </span>
            <span style={{ color: 'var(--text-2)' }}>
              <span style={{ color: 'var(--text)' }}>{e.head}</span> {e.text}
            </span>
          </div>
        ))}
      </section>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!mobile && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>What {name} sees</span>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 4 : 6, padding: mobile ? '12px 14px' : '16px 18px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-card)', background: 'var(--rail)' }}>
          <span className={cx('lbl', s.lbl10)}>{mobile ? `What ${name} sees` : '// Account'}</span>
          <span style={{ fontSize: mobile ? 15 : 16, fontWeight: 600 }}>{perm ? 'You’re banned from Mint.' : until ? `You’re banned until ${utcDateTime(until)}.` : '…'}</span>
          <span style={{ fontSize: mobile ? 13 : 14, color: 'var(--text-2)' }}>
            Reason: <span style={{ color: 'var(--text)' }}>{reason.trim() || '…'}</span>
          </span>
          {!mobile && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Your items and credits are safe. You can still look at your inventory.</span>}
        </div>
      </div>
      {perm && <TypeName name={name} value={typed} onChange={setTyped} label={mobile ? 'to confirm' : 'to confirm a permanent ban'} />}
      <ErrorLine error={error} />
    </Dialog>
  );
}

// ── Delete account (design/Admin-Dlg-Delete.dc.html) ────────────────────────

export function DeleteDialog({ player, onClose, mobile }: DialogProps) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const action = useAdminAction();
  const config = useConfig();
  const preview = usePreview<DeletePreview>(`/admin/players/${player.id}/delete/preview`, undefined);
  const p = preview.data;
  const name = player.label;
  const go = async () => {
    const message = await action.run(`/admin/players/${player.id}/delete`, { confirmName: typed.trim(), reason: reason.trim() });
    if (message) setError(message);
    else onClose();
  };
  const deleted: [string, string][] = p
    ? [
        ['Account and Discord link', ''],
        ['Balance', `${cr(p.balance)} → 0`],
        [`Inventory, ${p.items} item${p.items === 1 ? '' : 's'}`, `${cr(p.itemsValue)} → 0`],
        ['Friends', num(p.friends)],
        ['Sessions', num(p.sessions)],
        ['Showcase and albums', `${p.albumsPct}%`],
      ]
    : [];
  const kept: [string, string][] = p
    ? [
        ['Trades', num(p.trades)],
        ['Market sales', num(p.sales)],
        ['Ledger entries', num(p.ledgerEntries)],
        ['Admin log', 'all'],
      ]
    : [];
  const before = p
    ? [
        p.listing ? `the live listing (${p.listing.item}) is cancelled and its ${p.listing.bids} bid${p.listing.bids === 1 ? '' : 's'} go back to the bidders.` : null,
        p.ownBid ? `${name}'s own ${cr(p.ownBid)} bid is cancelled.` : null,
      ].filter(Boolean)
    : [];
  return (
    <Dialog
      mobile={mobile}
      label="Delete account"
      title={`Delete ${name}’s account`}
      onClose={onClose}
      footer={
        <Footer onClose={onClose}>
          <Btn size={44} variant="danger" min="admin" onClick={() => void go()} disabled={typed.trim() !== name || !reason.trim() || action.busy || !p}>
            Delete {name} for good
          </Btn>
        </Footer>
      }
    >
      <p style={{ marginTop: -8, fontSize: 14, lineHeight: 1.5, color: 'var(--error)' }}>
        This can't be undone. {name} can come back with the same Discord account, but as a new player with {cr(config.data?.startingBalance ?? 1000)}.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <section aria-label="Deleted" style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-card)' }}>
          <h3 className={cx('lbl', s.lbl10)} style={{ padding: '12px 14px 8px', color: 'var(--text)' }}>
            Deleted
          </h3>
          {deleted.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderTop: '1px solid var(--separator)', fontSize: 13 }}>
              <span>{k}</span>
              <span className="mono" style={{ color: 'var(--text-2)', textAlign: 'right' }}>
                {v}
              </span>
            </div>
          ))}
        </section>
        <section aria-label="Kept as deleted player" style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-card)' }}>
          <h3 className={cx('lbl', s.lbl10)} style={{ padding: '12px 14px 8px' }}>
            Kept as “deleted player”
          </h3>
          {kept.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderTop: '1px solid var(--separator)', fontSize: 13, color: 'var(--text-2)' }}>
              <span>{k}</span>
              <span className="mono" style={{ textAlign: 'right' }}>
                {v}
              </span>
            </div>
          ))}
        </section>
      </div>
      {before.length > 0 && <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>Before deleting: {before.join(' ')}</p>}
      <TypeName name={name} value={typed} onChange={setTyped} />
      <ReasonField value={reason} onChange={setReason} placeholder="e.g. asked to delete their data, ticket #63" />
      <ErrorLine error={error} />
    </Dialog>
  );
}


/** Ban from a list (flags, reports): loads the player, then the usual Ban dialog. */
export function BanById({ id, onClose, mobile }: { id: string; onClose: () => void; mobile?: boolean }) {
  const player = usePlayer(id);
  if (!player.data) return null;
  return <BanDialog player={player.data} onClose={onClose} mobile={mobile} />;
}
