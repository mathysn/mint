import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { AdminPlayer, AdminPlayerTab, AdminRecord, DiffRow } from '../../../../shared/api';
import { ApiRequestError } from '../../lib/api';
import { RARITY } from '../../lib/rarity';
import { useIsMobile } from '../../lib/useMediaQuery';
import { AdminPage } from '../AdminApp';
import { BanDialog, CreditsDialog, DeleteDialog, GrantDialog } from '../dialogs';
import { ROLE_HINT, ago, cr, num, signedCr, useAdminAction, usePlayer, usePlayerTab, useStaff, utcDateTime, utcStamp } from '../lib';
import { Avatar, Btn, Chip, EmptyBox, ErrorBox, InlineConfirm, ItemArt, LockIcon, StBadge, cx, s } from '../ui';

type Confirm = 'reset' | 'signout' | 'rename' | 'unban';
type DialogKind = 'credits' | 'grant' | 'ban' | 'delete';

const TABS: { key: AdminPlayerTab; label: string }[] = [
  { key: 'inventory', label: 'Inventory' },
  { key: 'openings', label: 'Openings' },
  { key: 'trades', label: 'Trades' },
  { key: 'market', label: 'Market' },
  { key: 'friends', label: 'Friends' },
  { key: 'ledger', label: 'Ledger' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'notes', label: 'Notes' },
];

const SIGNAL_LABEL = { age: 'Account age', ip: 'Other accounts on this IP', flags: 'Flagged trades', reports: 'Reports against' } as const;
const SIGNAL_SHORT = { ...SIGNAL_LABEL, ip: 'Accounts on this IP' } as const;

/** What each inline confirmation says (design/Admin-Player.dc.html), with its before → after. */
function confirmCopy(kind: Confirm, p: AdminPlayer, mobile: boolean): { title: string; text: string; button: string; diff: DiffRow[] } {
  const name = p.label;
  switch (kind) {
    case 'reset':
      return {
        title: `Reset ${name}’s free case timer`,
        text: 'The next free case becomes available right away.',
        button: 'Reset free case',
        diff: [{ label: 'Next free case', before: p.freeCaseNextAt ? `${utcDateTime(p.freeCaseNextAt)} UTC` : 'available', after: 'now' }],
      };
    case 'signout':
      return {
        title: `Sign ${name} out everywhere`,
        text: `Ends ${p.sessions} ${p.sessions === 1 ? 'session' : 'sessions'}, including the Discord activity.`,
        button: mobile ? 'Sign out' : 'Sign out everywhere',
        diff: [{ label: 'Live sessions', before: num(p.sessions), after: '0' }],
      };
    case 'rename':
      return {
        title: `Rename ${name}`,
        text: `Resets the name to ${p.renameTo}. They can pick a new one at next sign-in.`,
        button: `Rename to ${p.renameTo}`,
        diff: [{ label: 'Name', before: name, after: p.renameTo }],
      };
    case 'unban':
      return {
        title: `Unban ${name}`,
        text: 'They can sign in again right away. Cancelled listings and offers stay cancelled.',
        button: `Unban ${name}`,
        diff: [{ label: 'Status', before: p.ban?.until ? `Banned until ${utcDateTime(p.ban.until)}` : 'Banned permanently', after: 'Active' }],
      };
  }
}

const ENDPOINT: Record<Confirm, string> = { reset: 'free-case/reset', signout: 'sign-out', rename: 'rename', unban: 'unban' };

function useCopy() {
  const [copied, setCopied] = useState('');
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(''), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);
  return { copied, copy: (text: string) => void navigator.clipboard?.writeText(text).then(() => setCopied('Copied')) };
}

function CopyButton({ value, size }: { value: string; size: number }) {
  const { copied, copy } = useCopy();
  return (
    <>
      <button type="button" aria-label="Copy Discord ID" onClick={() => copy(value)} style={{ width: size, height: size, border: 0, background: 'none', color: 'var(--text-3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' }}>
          <path d="M9 9h11v11H9zM5 15H4V4h11v1" />
        </svg>
      </button>
      <span className="mono" role="status" style={{ fontSize: 11, color: 'var(--text-2)' }}>
        {copied}
      </span>
    </>
  );
}

function BanBand({ p, onUnban, mobile }: { p: AdminPlayer; onUnban: () => void; mobile?: boolean }) {
  if (!p.ban) return null;
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: mobile ? 'column' : 'row',
        flexWrap: 'wrap',
        alignItems: mobile ? 'stretch' : 'center',
        gap: mobile ? 10 : '12px 20px',
        padding: mobile ? '12px 14px' : '14px 18px',
        border: '1px solid var(--error)',
        borderRadius: 'var(--radius-card)',
        background: 'color-mix(in srgb, var(--error) 6%, transparent)',
      }}
    >
      <span style={{ flex: mobile ? undefined : '1 1 400px', fontSize: 14, lineHeight: 1.45 }}>
        <strong style={{ color: 'var(--error)' }}>{p.ban.until ? `Banned until ${utcDateTime(p.ban.until)}` : 'Banned permanently'}</strong>{' '}
        <span style={{ color: 'var(--text-2)' }}>
          · by {p.ban.by} · Reason: {p.ban.reason}
        </span>
      </span>
      <Btn min="moderator" onClick={onUnban} style={mobile ? { alignSelf: 'flex-start' } : undefined}>
        Unban
      </Btn>
    </div>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

const CHIP_STYLE = { solid: 'solid', outline: 'outline', dashed: 'dashed', flag: 'flag' } as const;

function TabState({ query, label, children, empty }: { query: ReturnType<typeof usePlayerTab>; label: string; children: React.ReactNode; empty: boolean }) {
  if (query.isError) return <ErrorBox title={`Couldn't load ${label}`} error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isPending)
    return (
      <div className={s.panel} aria-busy="true" aria-label={`Loading ${label}`}>
        {[180, 120, 150, 110, 170].map((w, i) => (
          <div key={i} className={s.skelRow}>
            <span className={s.skel} style={{ width: 90 }} />
            <span className={s.skel} style={{ width: w }} />
            <span className={s.skel} style={{ width: 70, marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    );
  if (empty) return <EmptyBox>Nothing in {label} yet.</EmptyBox>;
  return <>{children}</>;
}

function Records({ rows }: { rows: AdminRecord[] }) {
  return (
    <div className={s.panel}>
      {rows.map((r, i) => {
        const body = (
          <>
            <span className="mono" style={{ minWidth: 110, fontSize: 12, color: 'var(--text-2)' }}>
              {r.lead ?? (r.at ? utcStamp(r.at) : '')}
            </span>
            <span style={{ flex: '1 1 240px', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {r.tier && <span aria-hidden="true" className={s.square} style={{ background: RARITY[r.tier].color }} />}
              {r.to ? (
                <Link to={r.to} className={s.above} style={{ color: 'var(--text)', textDecoration: 'none' }}>
                  {r.title}
                </Link>
              ) : (
                r.title
              )}
            </span>
            {r.meta && (
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {r.meta}
              </span>
            )}
            {r.chip ? (
              <span style={{ minWidth: 120, display: 'flex', justifyContent: 'flex-end' }}>
                <Chip style={CHIP_STYLE[r.chip.style]}>{r.chip.text}</Chip>
              </span>
            ) : r.value ? (
              <span className="mono" style={{ minWidth: 120, textAlign: 'right', fontSize: 12 }}>
                {r.value}
              </span>
            ) : null}
          </>
        );
        return (
          <div key={i} className={s.tr} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', padding: '8px 18px', fontSize: 13 }}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

function LedgerTable({ id }: { id: string }) {
  const q = usePlayerTab(id, 'ledger');
  const rows = q.data?.ledger ?? [];
  const grid = '130px 140px 120px 120px minmax(0, 1fr)';
  return (
    <TabState query={q} label="the ledger" empty={rows.length === 0}>
      <div className={s.tableWrap}>
        <div role="table" aria-label="Ledger" style={{ minWidth: 760 }}>
          <div role="row" className={s.thead} style={{ gridTemplateColumns: grid, minHeight: 40, padding: '0 16px' }}>
            <span role="columnheader" className={cx('lbl', s.th)}>
              Time
            </span>
            <span role="columnheader" className={cx('lbl', s.th)}>
              Type
            </span>
            <span role="columnheader" className={cx('lbl', s.th)} style={{ textAlign: 'right' }}>
              Amount
            </span>
            <span role="columnheader" className={cx('lbl', s.th)} style={{ textAlign: 'right' }}>
              Balance
            </span>
            <span role="columnheader" className={cx('lbl', s.th)} style={{ paddingLeft: 20 }}>
              Details
            </span>
          </div>
          {rows.map((l) => (
            <div key={l.id} role="row" className={s.tr} style={{ gridTemplateColumns: grid, minHeight: 48, padding: '0 16px', fontSize: 13 }}>
              <span role="cell" className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {utcStamp(l.at)}
              </span>
              <span role="cell" className="mono" style={{ fontSize: 12 }}>
                {l.type}
              </span>
              <span role="cell" className="mono" style={{ textAlign: 'right' }}>
                {l.amount === 0 ? '0 CR' : signedCr(l.amount)}
              </span>
              <span role="cell" className="mono" style={{ textAlign: 'right', color: 'var(--text-2)' }}>
                {cr(l.balanceAfter)}
              </span>
              <span role="cell" style={{ paddingLeft: 20, color: 'var(--text-2)' }}>
                {l.details}
              </span>
            </div>
          ))}
        </div>
      </div>
    </TabState>
  );
}

type InvFilter = 'all' | 'available' | 'listed' | 'in_trade';
const INV_LABEL: Record<InvFilter, string> = { all: 'All', available: 'Available', listed: 'Listed', in_trade: 'In trade' };

function InventoryTab({ id }: { id: string }) {
  const q = usePlayerTab(id, 'inventory');
  const [filter, setFilter] = useState<InvFilter>('all');
  const inv = q.data?.inventory;
  const items = (inv?.items ?? []).filter((i) => filter === 'all' || i.status === filter);
  return (
    <TabState query={q} label="the inventory" empty={!inv || inv.items.length === 0}>
      <div role="group" aria-label="Filter by status" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {(Object.keys(INV_LABEL) as InvFilter[]).map((k) => (
          <button key={k} type="button" aria-pressed={filter === k} className={s.toggle} style={{ height: 36 }} onClick={() => setFilter(k)}>
            {INV_LABEL[k]} <span className={cx('mono', s.count)}>{num(inv?.counts[k] ?? 0)}</span>
          </button>
        ))}
      </div>
      <div className={s.itemGrid}>
        {items.map((it) => {
          const locked = it.status === 'listed' || it.status === 'in_trade';
          return (
            <Link key={it.id} to={`/admin/items?item=${it.id}`} className={s.itemCard}>
              <ItemArt tier={it.tier} imageUrl={it.imageUrl} alt={`${it.weaponName} | ${it.finishName ?? 'Vanilla'}`} dim={locked ? 0.4 : 1} />
              {it.stattrak && (
                <span style={{ position: 'absolute', right: 8, top: 8 }}>
                  <StBadge />
                </span>
              )}
              {locked && (
                <span className={cx('lbl', s.lockLabel)}>
                  <LockIcon size={10} />
                  {it.status === 'listed' ? 'Listed' : 'In trade'}
                  {it.stuck && ' · stuck'}
                </span>
              )}
              <span className={s.itemBody}>
                <span className={s.itemWeapon}>{it.weaponName}</span>
                <span className={s.itemSkin}>{it.finishName ?? 'Vanilla'}</span>
                <span className={cx('mono', s.itemMeta)}>
                  <span style={{ color: 'var(--text-2)' }}>{it.wear && it.float !== null ? `${it.wear} ${it.float.toFixed(4)}` : 'Vanilla'}</span>
                  <span>{cr(it.value)}</span>
                </span>
              </span>
              <span className={s.itemBar} style={{ background: RARITY[it.tier].color }} />
            </Link>
          );
        })}
      </div>
    </TabState>
  );
}

function RecordsTab({ id, tab, label }: { id: string; tab: AdminPlayerTab; label: string }) {
  const q = usePlayerTab(id, tab);
  const rows = q.data?.records ?? [];
  return (
    <TabState query={q} label={label} empty={rows.length === 0}>
      <Records rows={rows} />
    </TabState>
  );
}

function NotesTab({ id, mobile }: { id: string; mobile?: boolean }) {
  const staff = useStaff();
  const q = usePlayerTab(id, 'notes');
  const notes = q.data?.notes ?? [];
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const action = useAdminAction();
  const add = async () => {
    const message = await action.run(`/admin/players/${id}/notes`, { text: text.trim() });
    if (message) setError(message);
    else {
      setText('');
      setError(null);
    }
  };
  const canWrite = staff.can('moderator');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {q.isError && <ErrorBox title="Couldn't load the notes" error={q.error} onRetry={() => void q.refetch()} />}
      {notes.map((n) => (
        <article key={n.id} className={s.panel} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px', borderRadius: 'var(--radius-card)' }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {n.staffName} · {utcDateTime(n.at)}
          </span>
          <p style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{n.text}</p>
        </article>
      ))}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className={cx('lbl', s.lbl10)}>New note · staff only</span>
        <textarea className={s.textarea} rows={mobile ? 4 : 3} disabled={!canWrite} placeholder="What should the next moderator know?" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {error && (
        <span role="alert" className={s.alertText}>
          {error}
        </span>
      )}
      <Btn min="moderator" onClick={() => void add()} disabled={!text.trim() || action.busy} style={{ alignSelf: 'flex-start' }}>
        Add note
      </Btn>
    </div>
  );
}

function TabBody({ id, tab, mobile }: { id: string; tab: AdminPlayerTab; mobile?: boolean }) {
  switch (tab) {
    case 'ledger':
      return mobile ? <MobileRecords id={id} tab="ledger" /> : <LedgerTable id={id} />;
    case 'inventory':
      return mobile ? <MobileRecords id={id} tab="inventory" /> : <InventoryTab id={id} />;
    case 'notes':
      return <NotesTab id={id} mobile={mobile} />;
    default:
      return mobile ? <MobileRecords id={id} tab={tab} /> : <RecordsTab id={id} tab={tab} label={`the ${tab}`} />;
  }
}

// ── Desktop ─────────────────────────────────────────────────────────────────

function Desktop({ p }: { p: AdminPlayer }) {
  const staff = useStaff();
  const [tab, setTab] = useState<AdminPlayerTab>('ledger');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const action = useAdminAction();
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);
  const gone = p.deleted ? 'This account was deleted.' : null;
  const ask = (k: Confirm) => () => {
    setConfirm(k);
    setMenu(false);
  };
  const roleHint =
    staff.role === 'viewer'
      ? 'Read-only: you’re a Viewer. Adjust credits, Grant item and Reset free case are for admins; Ban and Sign out everywhere for moderators and admins.'
      : staff.role === 'moderator'
        ? 'Adjust credits, Grant item, Reset free case and Delete account: Admins only.'
        : '';
  const copy = confirm ? confirmCopy(confirm, p, false) : null;
  const stats: [string, string][] = [
    ['Balance', cr(p.stats.balance)],
    ['Held in bids', cr(p.stats.heldInBids)],
    ['Inventory value', cr(p.stats.inventoryValue)],
    ['Cases opened', num(p.stats.casesOpened)],
    ['Trades completed', num(p.stats.tradesCompleted)],
    ['Albums', `${p.stats.albumsPct}%`],
  ];
  return (
    <AdminPage gap={22} top={28}>
      <Link to="/admin/players" className={cx('mono', s.back)}>
        ← Players
      </Link>
      <header className={s.header} style={{ alignItems: 'flex-start', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Avatar label={p.label} url={p.avatarUrl} size={80} guest={p.isGuest} fontSize={30} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
              <h1 className={s.title} style={{ lineHeight: 1 }}>
                {p.label}
              </h1>
              {p.deleted ? <Chip style="dashed">Deleted</Chip> : <Chip style={p.isGuest ? 'dashed' : 'outline'}>{p.isGuest ? 'Guest' : 'Account'}</Chip>}
              {p.online && (
                <span className={s.inline}>
                  <span className={s.whiteDot} aria-hidden="true" />
                  Online
                </span>
              )}
              {p.ban && <Chip style="ban">Banned · {p.ban.duration}</Chip>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', fontSize: 13, color: 'var(--text-2)' }}>
              {p.discordId && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="mono" style={{ color: 'var(--text)' }}>
                    {p.discordId}
                  </span>
                  <CopyButton value={p.discordId} size={32} />
                </span>
              )}
              <span>Joined {utcDateTime(p.joinedAt)}</span>
              <span>Last seen {ago(p.lastSeenAt)}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div ref={menuRef} style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
            <Btn min="admin" blocked={gone} onClick={() => setDialog('credits')}>
              Adjust credits
            </Btn>
            <Btn min="admin" blocked={gone} onClick={() => setDialog('grant')}>
              Grant item
            </Btn>
            <Btn min="admin" blocked={gone} onClick={ask('reset')}>
              Reset free case
            </Btn>
            <Btn min="moderator" blocked={gone} onClick={ask('signout')}>
              Sign out everywhere
            </Btn>
            {p.ban ? (
              <Btn min="moderator" onClick={ask('unban')}>
                Unban
              </Btn>
            ) : (
              <Btn min="moderator" variant="danger" blocked={gone} onClick={() => setDialog('ban')}>
                Ban
              </Btn>
            )}
            <button type="button" className={cx(s.btn, s.iconBtn)} aria-label="More actions" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" style={{ fill: 'currentColor', stroke: 'none' }}>
                <path d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM19 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" />
              </svg>
            </button>
            {menu && (
              <div role="menu" style={{ position: 'absolute', right: 0, top: 46, zIndex: 20, width: 220, padding: 6, border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-card)', background: 'var(--surface-raised)', boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }}>
                <MenuItem disabled={!staff.can('moderator') || !!gone || p.isGuest} hint={!staff.can('moderator') ? ROLE_HINT.moderator : p.isGuest ? 'Guests have no name' : undefined} onClick={ask('rename')}>
                  Rename
                </MenuItem>
                <MenuItem danger disabled={!staff.can('admin') || !!gone} hint={!staff.can('admin') ? ROLE_HINT.admin : undefined} onClick={() => (setDialog('delete'), setMenu(false))}>
                  Delete account
                </MenuItem>
              </div>
            )}
          </div>
          {roleHint && <span className={cx('mono', s.hint)} style={{ maxWidth: 560, textAlign: 'right' }}>{roleHint}</span>}
        </div>
      </header>

      <BanBand p={p} onUnban={ask('unban')} />

      {copy && confirm && (
        <InlineConfirm
          key={confirm}
          title={copy.title}
          text={copy.text}
          diff={copy.diff}
          button={copy.button}
          onCancel={() => setConfirm(null)}
          onConfirm={async (reason) => {
            const body = confirm === 'rename' ? { name: p.renameTo, reason } : { reason };
            const message = await action.run(`/admin/players/${p.id}/${ENDPOINT[confirm]}`, body);
            if (!message) setConfirm(null);
            return message;
          }}
        />
      )}

      <dl className={s.statBand}>
        {stats.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <section aria-label="Player records" style={{ flex: '999 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div role="tablist" aria-label="Records" className={s.tabs}>
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={s.tab} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          <TabBody id={p.id} tab={tab} />
        </section>
        <aside aria-labelledby="signals-title" className={s.panel} style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', padding: '18px 20px 8px' }}>
          <h2 id="signals-title" className="lbl" style={{ margin: '0 0 10px' }}>
            // Signals
          </h2>
          {p.signals.map((sig) => (
            <div key={sig.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 0', borderTop: '1px solid var(--separator)' }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 13 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-2)' }}>
                  {sig.alert && <span className={s.dot} aria-label="Worth a look" role="img" />}
                  {SIGNAL_LABEL[sig.key]}
                </span>
                <span className="mono" style={{ fontSize: 14 }}>
                  {sig.value}
                </span>
              </span>
              {sig.sub && (sig.to ? <Link to={sig.to} style={{ fontSize: 12, color: 'var(--text-2)' }}>{sig.sub}</Link> : <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{sig.sub}</span>)}
            </div>
          ))}
        </aside>
      </div>

      {dialog === 'credits' && <CreditsDialog player={p} onClose={() => setDialog(null)} />}
      {dialog === 'grant' && <GrantDialog player={p} onClose={() => setDialog(null)} />}
      {dialog === 'ban' && <BanDialog player={p} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeleteDialog player={p} onClose={() => setDialog(null)} />}
    </AdminPage>
  );
}

function MenuItem({ children, onClick, disabled, hint, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; hint?: string; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: 40, padding: '0 10px', border: 0, borderRadius: 2, background: 'none', color: danger ? 'var(--error)' : 'var(--text)', font: 'inherit', fontSize: 14, textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {disabled && hint && <LockIcon />}
        {children}
      </span>
      {disabled && hint && (
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
          {hint}
        </span>
      )}
    </button>
  );
}

// ── Mobile ──────────────────────────────────────────────────────────────────

const MOBILE_TABS: { key: AdminPlayerTab; label: string }[] = [
  { key: 'ledger', label: 'Ledger' },
  { key: 'inventory', label: 'Items' },
  { key: 'trades', label: 'Trades' },
  { key: 'notes', label: 'Notes' },
];

function MobileRow({ a, b, c, d, tier }: { a: string; b: string; c?: string; d?: string; tier?: AdminRecord['tier'] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '6px 0', borderBottom: '1px solid var(--separator)' }}>
      {tier && <span aria-hidden="true" className={s.square} style={{ background: RARITY[tier].color }} />}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className={s.ellipsis} style={{ fontSize: 13 }}>
          {a}
        </span>
        <span className={s.ellipsis} style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {b}
        </span>
      </span>
      <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span className="mono" style={{ fontSize: 13 }}>
          {c}
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {d}
        </span>
      </span>
    </div>
  );
}

function MobileRecords({ id, tab }: { id: string; tab: AdminPlayerTab }) {
  const q = usePlayerTab(id, tab);
  const data = q.data;
  const empty = !data || (data.ledger ?? data.records ?? data.inventory?.items ?? []).length === 0;
  return (
    <TabState query={q} label={tab === 'inventory' ? 'the items' : `the ${tab}`} empty={empty}>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: -8 }}>
        {data?.ledger?.map((l) => <MobileRow key={l.id} a={l.type} b={l.details} c={l.amount === 0 ? '0 CR' : signedCr(l.amount)} d={utcStamp(l.at)} />)}
        {data?.inventory?.items.map((it) => (
          <Link key={it.id} to={`/admin/items?item=${it.id}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>
            <MobileRow
              tier={it.tier}
              a={`${it.weaponName} | ${it.finishName ?? 'Vanilla'}`}
              b={[it.stattrak ? 'ST™' : null, it.wear && it.float !== null ? `${it.wear} ${it.float.toFixed(4)}` : 'Vanilla'].filter(Boolean).join(' · ')}
              c={cr(it.value)}
              d={it.status === 'available' ? 'Available' : `${it.status === 'listed' ? 'Listed' : 'In trade'}${it.stuck ? ' · stuck' : ''}`}
            />
          </Link>
        ))}
        {data?.records?.map((r, i) => <MobileRow key={i} tier={r.tier} a={r.lead ?? (r.at ? utcStamp(r.at) : '')} b={r.title} c={r.chip?.text ?? r.value ?? ''} d={r.meta ?? ''} />)}
      </div>
    </TabState>
  );
}

function Mobile({ p }: { p: AdminPlayer }) {
  const staff = useStaff();
  const [tab, setTab] = useState<AdminPlayerTab>('ledger');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const action = useAdminAction();
  const gone = p.deleted ? 'This account was deleted.' : null;
  const copy = confirm ? confirmCopy(confirm, p, true) : null;
  const ask = (k: Confirm) => {
    setConfirm(k);
    setReason('');
    setError(null);
  };
  const doConfirm = async () => {
    if (!confirm) return;
    const body = confirm === 'rename' ? { name: p.renameTo, reason: reason.trim() } : { reason: reason.trim() };
    const message = await action.run(`/admin/players/${p.id}/${ENDPOINT[confirm]}`, body);
    if (message) setError(message);
    else setConfirm(null);
  };
  const admin = staff.can('admin');
  const stats: [string, string][] = [
    ['Balance', cr(p.stats.balance)],
    ['Held in bids', cr(p.stats.heldInBids)],
    ['Inventory', cr(p.stats.inventoryValue)],
    ['Cases opened', num(p.stats.casesOpened)],
    ['Trades', num(p.stats.tradesCompleted)],
    ['Albums', `${p.stats.albumsPct}%`],
  ];
  const more: { label: string; go: () => void; danger?: boolean }[] = [
    { label: 'Adjust credits', go: () => setDialog('credits') },
    { label: 'Grant item', go: () => setDialog('grant') },
    { label: 'Reset free case', go: () => ask('reset') },
    { label: 'Delete account', go: () => setDialog('delete'), danger: true },
  ];
  return (
    <AdminPage gap={20}>
      <Link to="/admin/players" className={cx('mono', s.back)} style={{ display: 'inline-flex', alignItems: 'center', height: 32, margin: '-8px 0 -12px' }}>
        ← Players
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar label={p.label} url={p.avatarUrl} size={64} guest={p.isGuest} fontSize={24} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <h1 className={s.mTitle} style={{ lineHeight: 1 }}>
            {p.label}
          </h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <Chip style={p.isGuest || p.deleted ? 'dashed' : 'outline'}>{p.deleted ? 'Deleted' : p.isGuest ? 'Guest' : 'Account'}</Chip>
            {p.online && (
              <span className={s.inline} style={{ fontSize: 12 }}>
                <span className={s.whiteDot} aria-hidden="true" />
                Online
              </span>
            )}
            {p.ban && <Chip style="ban">Banned · {p.ban.duration}</Chip>}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: -6 }}>
        {p.discordId && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span className="mono" style={{ fontSize: 12 }}>
              {p.discordId}
            </span>
            <CopyButton value={p.discordId} size={36} />
          </span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
          Joined {utcDateTime(p.joinedAt).split(',')[0]} · last seen {ago(p.lastSeenAt)}
        </span>
      </div>
      <BanBand p={p} onUnban={() => ask('unban')} mobile />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
        {stats.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 12px', background: 'var(--surface)' }}>
            <span className="mono" style={{ fontSize: 16, fontWeight: 500 }}>
              {v}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{k}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {!p.ban && (
          <Btn size={48} variant="danger" min="moderator" blocked={gone} onClick={() => setDialog('ban')}>
            Ban
          </Btn>
        )}
        <Btn size={48} min="moderator" blocked={gone} onClick={() => ask('signout')} style={{ fontSize: 14, fontWeight: 400 }}>
          Sign out everywhere
        </Btn>
      </div>
      <details className={s.panel} style={{ borderRadius: 'var(--radius-card)' }}>
        <summary style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, padding: '0 14px', fontSize: 14, cursor: 'pointer', listStyle: 'none' }}>
          More actions{' '}
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {admin ? '4' : ROLE_HINT.admin}
          </span>
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', padding: '0 14px 6px' }}>
          {more.map((m) => (
            <button
              key={m.label}
              type="button"
              disabled={!admin || !!gone}
              aria-disabled={!admin || !!gone}
              onClick={m.go}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, padding: 0, border: 0, borderTop: '1px solid var(--separator)', background: 'none', color: m.danger ? 'var(--error)' : 'var(--text)', font: 'inherit', fontSize: 14, textAlign: 'left', opacity: admin ? 1 : 0.45, cursor: admin ? 'pointer' : 'not-allowed' }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {!admin && <LockIcon />}
                {m.label}
              </span>
              {!admin && (
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
                  {ROLE_HINT.admin}
                </span>
              )}
            </button>
          ))}
        </div>
      </details>
      {staff.role === 'viewer' && (
        <span className={cx('mono', s.hint)} style={{ marginTop: -10 }}>
          Read-only: you’re a Viewer. Ban and sign out are for moderators and admins.
        </span>
      )}
      {copy && (
        <div role="group" aria-label={copy.title} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, border: '1px solid var(--text)', borderRadius: 'var(--radius-card)', background: 'var(--surface-bar)' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{copy.title}</span>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>{copy.text}</span>
          <span className={s.confirmDiff}>{copy.diff.map((d) => `${d.label} ${d.before} → ${d.after}`).join(' · ')}</span>
          <input className={s.field} style={{ width: '100%', fontSize: 16 }} aria-label="Reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, shown in the admin log" />
          {error && (
            <span role="alert" className={s.alertText}>
              {error}
            </span>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Btn size={44} onClick={() => setConfirm(null)}>
              Cancel
            </Btn>
            <Btn size={44} variant="primary" onClick={() => void doConfirm()} disabled={!reason.trim() || action.busy}>
              {copy.button}
            </Btn>
          </div>
        </div>
      )}
      <section aria-labelledby="m-signals" className={s.panel} style={{ display: 'flex', flexDirection: 'column', padding: '12px 14px 4px' }}>
        <h2 id="m-signals" className={cx('lbl', s.lbl10)} style={{ margin: '0 0 6px' }}>
          // Signals
        </h2>
        {p.signals.map((sig) => (
          <div key={sig.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, minHeight: 40, borderTop: '1px solid var(--separator)', fontSize: 13 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-2)' }}>
              {sig.alert && <span className={s.dot} aria-hidden="true" style={{ width: 6, height: 6 }} />}
              {SIGNAL_SHORT[sig.key]}
            </span>
            <span className="mono">{sig.value}</span>
          </div>
        ))}
      </section>
      <div role="tablist" aria-label="Records" className={s.seg} style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {MOBILE_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={s.segBtn} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <TabBody id={p.id} tab={tab} mobile />
      {dialog === 'credits' && <CreditsDialog player={p} mobile onClose={() => setDialog(null)} />}
      {dialog === 'grant' && <GrantDialog player={p} mobile onClose={() => setDialog(null)} />}
      {dialog === 'ban' && <BanDialog player={p} mobile onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeleteDialog player={p} mobile onClose={() => setDialog(null)} />}
    </AdminPage>
  );
}

export function Player() {
  const { id = '' } = useParams();
  const mobile = useIsMobile();
  const q = usePlayer(id);
  if (q.isPending) {
    return (
      <AdminPage>
        <span className={s.skel} style={{ width: 90 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span className={s.skel} style={{ width: mobile ? 64 : 80, height: mobile ? 64 : 80, borderRadius: '50%' }} />
          <span className={s.skel} style={{ width: 200, height: 32 }} />
        </div>
        <span className={s.skel} style={{ width: '100%', height: 80 }} />
      </AdminPage>
    );
  }
  if (q.isError) {
    const missing = q.error instanceof ApiRequestError && q.error.status === 404;
    return (
      <AdminPage>
        <Link to="/admin/players" className={cx('mono', s.back)}>
          ← Players
        </Link>
        {missing ? <EmptyBox>No player has this ID.</EmptyBox> : <ErrorBox title="Couldn't load this player" error={q.error} onRetry={() => void q.refetch()} />}
      </AdminPage>
    );
  }
  return mobile ? <Mobile p={q.data} /> : <Desktop p={q.data} />;
}
