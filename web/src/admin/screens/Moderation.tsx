import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { AdminAnnouncement, AdminDrop, AdminReport, GiftPreview } from '../../../../shared/api';
import { useIsMobile } from '../../lib/useMediaQuery';
import { AdminPage } from '../AdminApp';
import { BanById } from '../dialogs';
import { useAdminAction, useModeration, usePreview, useStaff, utcDateTime } from '../lib';
import { Btn, CLOSE, ErrorBox, Header, Logged, cx, s } from '../ui';

const panel: CSSProperties = { border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' };

/** Reason + Cancel + the exact action button, inside a card (reports, drops, announcements, events). */
function ReasonConfirm({ title, text, button, path, body, onDone, stacked }: { title?: string; text?: ReactNode; button: string; path: string; body?: Record<string, unknown>; onDone: () => void; stacked?: boolean }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, busy } = useAdminAction();
  const go = async () => {
    const message = await run(path, { ...body, reason: reason.trim() });
    if (message) setError(message);
    else onDone();
  };
  return (
    <div
      role="group"
      aria-label={title ?? button}
      onKeyDown={(e) => e.key === 'Escape' && onDone()}
      style={{ display: 'flex', flexWrap: 'wrap', flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'stretch' : 'center', gap: stacked ? 8 : '8px 12px', padding: 12, border: '1px solid var(--text)', borderRadius: 'var(--radius-card)', background: 'var(--surface-bar)' }}
    >
      {title && <span style={{ flex: '1 1 100%', fontSize: 14, fontWeight: 600 }}>{title}</span>}
      {text && <span style={{ flex: '1 1 100%', fontSize: 13, color: 'var(--text-2)' }}>{text}</span>}
      <input
        autoFocus
        className={s.field}
        aria-label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason, shown in the admin log"
        style={{ flex: stacked ? undefined : '1 1 240px', minWidth: 0, width: stacked ? '100%' : undefined }}
        onKeyDown={(e) => e.key === 'Enter' && reason.trim() && !busy && void go()}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn variant="quiet" onClick={onDone}>
          Cancel
        </Btn>
        <Btn variant="primary" disabled={!reason.trim() || busy} onClick={() => void go()}>
          {button}
        </Btn>
      </div>
      {error && (
        <span role="alert" className={s.alertText} style={{ flexBasis: '100%' }}>
          {error}
        </span>
      )}
    </div>
  );
}

// ── Reports ─────────────────────────────────────────────────────────────────

function ReportCard({ r, revealed, onReveal, onBan }: { r: AdminReport; revealed: boolean; onReveal: () => void; onBan: (id: string) => void }) {
  const [confirm, setConfirm] = useState<'rename' | 'dismiss' | null>(null);
  const hidden = r.hideName && !revealed;
  const name = r.target.label;
  return (
    <article aria-label={`Report on ${hidden ? 'a hidden name' : name}`} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 20px', borderTop: '1px solid var(--separator)', opacity: r.open ? 1 : 0.6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
        <span className="mono" style={{ height: 22, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 7px', borderRadius: 'var(--radius-control)', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', border: '1px solid var(--border-strong)', color: r.urgent ? 'var(--text)' : 'var(--text-2)' }}>
          {r.urgent && <span aria-hidden="true" className={s.dot} style={{ width: 6, height: 6 }} />}
          {r.category}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600 }}>
          {hidden ? (
            <span style={{ color: 'var(--text-2)' }}>[offensive name hidden]</span>
          ) : (
            <Link to={`/admin/players/${r.target.id}`} style={{ color: 'var(--text)' }}>
              {name}
            </Link>
          )}
          {hidden && (
            <button type="button" onClick={onReveal} style={{ height: 28, padding: '0 8px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-control)', background: 'transparent', color: 'var(--text-2)', font: 'inherit', fontSize: 12, fontWeight: 400, cursor: 'pointer' }}>
              Show name
            </button>
          )}
        </span>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>
          {r.meta}
        </span>
      </div>
      <p style={{ paddingLeft: 12, borderLeft: '2px solid var(--border-strong)', fontSize: 14, lineHeight: 1.5, color: 'var(--text-2)' }}>“{r.message}”</p>
      {r.handled && <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>{r.handled}</span>}
      {r.open && confirm === 'rename' && r.suggestedName && (
        <ReasonConfirm
          title={`Rename ${hidden ? 'this player' : name} to ${r.suggestedName}`}
          text="They pick a new name at next sign-in. Their drops in the banner show the new name."
          button={`Rename to ${r.suggestedName}`}
          path={`/admin/players/${r.target.id}/rename`}
          body={{ name: r.suggestedName }}
          onDone={() => setConfirm(null)}
        />
      )}
      {r.open && confirm === 'dismiss' && (
        <ReasonConfirm title="Dismiss this report" text={`${r.reporter} isn’t told. The report stays in the history.`} button="Dismiss report" path={`/admin/reports/${r.id}/dismiss`} onDone={() => setConfirm(null)} />
      )}
      {r.open && !confirm && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Btn min="moderator" blocked={r.isGuest ? 'Guests have no name' : null} onClick={() => setConfirm('rename')}>
            Rename
          </Btn>
          <Btn variant="danger" min="moderator" onClick={() => onBan(r.target.id)}>
            Ban
          </Btn>
          <Btn min="moderator" onClick={() => setConfirm('dismiss')}>
            Dismiss
          </Btn>
        </div>
      )}
    </article>
  );
}

// ── Global drop ─────────────────────────────────────────────────────────────

function DropRow({ d, revealed }: { d: AdminDrop; revealed: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const who = !d.player ? 'A guest' : d.hideName && !revealed ? '[name hidden]' : d.player.label;
  return (
    <div style={{ borderTop: '1px solid var(--separator)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '8px minmax(0, 1fr) auto auto', alignItems: 'center', gap: 14, minHeight: 60, padding: '8px 20px' }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, background: 'var(--gold)', opacity: d.hidden ? 0.4 : 1 }} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span className={s.ellipsis} style={{ fontSize: 14, color: d.hidden ? 'var(--text-2)' : 'var(--gold-text)' }}>
            {d.item}{' '}
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {d.wear}
            </span>
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
            by{' '}
            {d.player && !(d.hideName && !revealed) ? (
              <Link to={`/admin/players/${d.player.id}`} style={{ color: 'var(--text-2)' }}>
                {who}
              </Link>
            ) : (
              who
            )}{' '}
            · <span className="mono">{utcDateTime(d.at)}</span>
          </span>
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)', textAlign: 'right' }}>
          {d.state}
        </span>
        <Btn size={36} min="moderator" onClick={() => setConfirm(true)} disabled={confirm}>
          {d.hidden ? 'Show again' : 'Hide from banner'}
        </Btn>
      </div>
      {confirm && (
        <div style={{ padding: '0 20px 12px' }}>
          <ReasonConfirm button={d.hidden ? 'Show again' : 'Hide from banner'} path={`/admin/drops/${d.id}/${d.hidden ? 'show' : 'hide'}`} onDone={() => setConfirm(false)} />
        </div>
      )}
    </div>
  );
}

// ── Announcements ───────────────────────────────────────────────────────────

const ANN_CHIP: Record<AdminAnnouncement['state'], CSSProperties> = {
  Live: { background: 'var(--primary-bg)', color: 'var(--primary-text)' },
  Scheduled: { border: '1px solid var(--border-strong)', color: 'var(--text)' },
  Ended: { border: '1px dashed var(--border-hover)', color: 'var(--text-3)' },
};

/** A date as staff type it, in UTC: "2026-10-24 05:30". */
const utcInput = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

function AnnouncementRow({ a }: { a: AdminAnnouncement }) {
  const [confirm, setConfirm] = useState(false);
  const can = a.state !== 'Ended';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderBottom: '1px solid var(--separator)' }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span className="mono" style={{ height: 20, display: 'inline-flex', alignItems: 'center', padding: '0 6px', borderRadius: 'var(--radius-control)', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', ...ANN_CHIP[a.state] }}>
          {a.state}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {a.when}
          </span>
          {can && !confirm && (
            <Btn size={36} variant="link" min="moderator" onClick={() => setConfirm(true)}>
              {a.state === 'Live' ? 'End now' : 'Cancel'}
            </Btn>
          )}
        </span>
      </span>
      <span style={{ fontSize: 14, color: a.state === 'Ended' ? 'var(--text-3)' : 'var(--text)' }}>{a.text}</span>
      {confirm && (
        <div style={{ paddingTop: 6 }}>
          <ReasonConfirm button={a.state === 'Live' ? 'End announcement' : 'Cancel announcement'} path={`/admin/announcements/${a.id}/end`} onDone={() => setConfirm(false)} />
        </div>
      )}
    </div>
  );
}

/** The 40 px banner exactly as players see it. */
export function AnnouncementBar({ text, onClose, style }: { text: string; onClose?: () => void; style?: CSSProperties }) {
  return (
    <div aria-label="Announcement" style={{ display: 'flex', alignItems: 'center', gap: 12, height: 40, padding: '0 14px', border: '1px solid var(--border)', background: 'var(--rail)', overflow: 'hidden', ...style }}>
      <span className={cx('lbl', s.lbl10)} style={{ flex: 'none' }}>
        // Announcement
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
      {onClose ? (
        <button type="button" aria-label="Hide the announcement" onClick={onClose} style={{ flex: 'none', width: 32, height: 32, margin: '0 -8px 0 0', display: 'grid', placeItems: 'center', border: 0, background: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }}>
            <path d={CLOSE} />
          </svg>
        </button>
      ) : (
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" style={{ flex: 'none', fill: 'none', stroke: 'var(--text-3)', strokeWidth: 2, strokeLinecap: 'round' }}>
          <path d={CLOSE} />
        </svg>
      )}
    </div>
  );
}

function Composer({ max }: { max: number }) {
  const staff = useStaff();
  const canMod = staff.can('moderator');
  const [text, setText] = useState('');
  const [start, setStart] = useState(() => {
    const d = new Date(Math.ceil(Date.now() / 300_000) * 300_000);
    return utcInput(d);
  });
  const [end, setEnd] = useState(() => utcInput(new Date(Math.ceil(Date.now() / 300_000) * 300_000 + 3_600_000)));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, busy } = useAdminAction();
  const n = text.length;
  const tooLong = n > max;
  const go = async () => {
    const message = await run('/admin/announcements', { text: text.trim(), startsAt: start, endsAt: end, reason: reason.trim() });
    if (message) setError(message);
    else {
      setText('');
      setReason('');
      setError(null);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>New announcement</span>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-2)' }}>
          <span>Text</span>
          <span className="mono" style={{ fontSize: 12, color: tooLong ? 'var(--error)' : 'var(--text-3)' }}>
            {n} / {max}
          </span>
        </span>
        <textarea className={s.textarea} rows={2} value={text} onChange={(e) => setText(e.target.value)} disabled={!canMod} maxLength={max + 20} aria-invalid={tooLong} style={{ background: 'var(--page)', ...(tooLong ? { borderColor: 'var(--error)' } : {}) }} />
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {[
          ['Start (UTC)', start, setStart],
          ['End (UTC)', end, setEnd],
        ].map(([label, value, set]) => (
          <label key={label as string} style={{ flex: '1 1 140px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{label as string}</span>
            <input type="text" className={cx('mono', s.field)} value={value as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} disabled={!canMod} placeholder="2026-10-24 05:30" spellCheck={false} style={{ width: '100%', fontSize: 13 }} />
          </label>
        ))}
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Preview, as players see it</span>
      <AnnouncementBar text={text.trim() || 'Your announcement shows here.'} />
      {tooLong && (
        <span role="alert" style={{ fontSize: 13, color: 'var(--error)' }}>
          Keep it to {max} characters: {n - max} too many.
        </span>
      )}
      <input className={s.field} aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, shown in the admin log" disabled={!canMod} style={{ width: '100%' }} />
      {error && (
        <span role="alert" className={s.alertText}>
          {error}
        </span>
      )}
      <Btn size={44} variant="primary" min="moderator" disabled={!text.trim() || tooLong || !reason.trim() || busy} onClick={() => void go()} style={{ alignSelf: 'flex-start' }}>
        Schedule announcement
      </Btn>
    </div>
  );
}

// ── Events ──────────────────────────────────────────────────────────────────

function Costs({ rows }: { rows: { k: string; v: string }[] }) {
  return (
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 'var(--radius-control)', overflow: 'hidden' }}>
      {rows.map((c) => (
        <div key={c.k} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 2, padding: '10px 12px', background: 'var(--surface)' }}>
          <dt style={{ fontSize: 11, color: 'var(--text-2)' }}>{c.k}</dt>
          <dd className="mono" style={{ fontSize: 15 }}>
            {c.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function EventCard({ title, text, children, costs, button, path, body, blocked }: { title: string; text: string; children?: ReactNode; costs: { k: string; v: string }[]; button: string; path: string; body?: Record<string, unknown>; blocked?: string | null }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--surface-raised)' }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
      <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>{text}</span>
      {children}
      <Costs rows={costs} />
      {confirm ? (
        <ReasonConfirm stacked button={button} path={path} body={body} onDone={() => setConfirm(false)} />
      ) : (
        <Btn min="admin" blocked={blocked} onClick={() => setConfirm(true)} style={{ alignSelf: 'flex-start' }}>
          {button}…
        </Btn>
      )}
    </div>
  );
}

function GiftCard() {
  const [amount, setAmount] = useState('500');
  const n = Number(amount) || 0;
  const preview = usePreview<GiftPreview>('/admin/events/gift/preview', { amount: n }).data;
  return (
    <EventCard
      title="Gift credits to all players"
      text="Added to every balance right away, with a gift entry in each ledger."
      costs={preview?.costs ?? [
        { k: 'Total cost', v: '…' },
        { k: 'In circulation after', v: '…' },
      ]}
      button={preview?.button ?? 'Gift credits'}
      path="/admin/events/gift"
      body={{ amount: n }}
      blocked={n <= 0 ? 'Type an amount above 0 CR' : null}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Each player gets</span>
        <input className={cx('mono', s.field)} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} style={{ width: 100, textAlign: 'right' }} />
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
          CR
        </span>
      </label>
    </EventCard>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function Moderation() {
  const mobile = useIsMobile();
  const staff = useStaff();
  const data = useModeration();
  const [revealed, setRevealed] = useState(false);
  const [ban, setBan] = useState<string | null>(null);
  const hint = staff.can('admin') ? null : staff.can('moderator') ? 'Events are for admins. Reports, banner and announcements are open to moderators.' : 'Read-only: you’re a Viewer. Actions here are for moderators and admins.';
  const m = data.data;
  return (
    <AdminPage gap={24}>
      <Header label="Moderation" title="Moderation & announcements" sub="Player reports, the banner everyone sees, and game-wide events. All times UTC." />
      {hint && (
        <span className="mono" style={{ marginTop: -8, fontSize: 11, color: 'var(--text-3)' }}>
          {hint}
        </span>
      )}
      {data.isError ? (
        <ErrorBox title="Couldn't load moderation" error={data.error} onRetry={() => void data.refetch()} />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ flex: '999 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <section aria-labelledby="rep-t" style={panel}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '16px 20px 12px' }}>
                <h2 id="rep-t" className="lbl">
                  // Reports
                </h2>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {m ? `${m.openReports} open` : ''}
                </span>
              </div>
              {!m ? (
                <div aria-busy="true" aria-label="Loading the reports">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={s.skelRow} style={{ height: 96 }}>
                      <span className={s.skel} style={{ width: 90 }} />
                      <span className={s.skel} style={{ width: 220 }} />
                    </div>
                  ))}
                </div>
              ) : m.reports.length ? (
                m.reports.map((r) => <ReportCard key={r.id} r={r} revealed={revealed} onReveal={() => setRevealed(true)} onBan={setBan} />)
              ) : (
                <div style={{ padding: '18px 20px', borderTop: '1px solid var(--separator)', fontSize: 13, color: 'var(--text-2)' }}>No report in the last 30 days. Players report from a profile.</div>
              )}
            </section>
            <section aria-labelledby="gd-t" style={panel}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '16px 20px 12px' }}>
                <h2 id="gd-t" className="lbl">
                  // Global drop
                </h2>
                <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Every ★ drop shows in the players' banner until the next one. Hide one when the name or timing is a problem.</span>
              </div>
              {!m ? (
                <div aria-busy="true" aria-label="Loading the drops" style={{ height: 180 }} />
              ) : m.drops.length ? (
                m.drops.map((d) => <DropRow key={d.id} d={d} revealed={revealed} />)
              ) : (
                <div style={{ padding: '18px 20px', borderTop: '1px solid var(--separator)', fontSize: 13, color: 'var(--text-2)' }}>No ★ drop yet.</div>
              )}
            </section>
          </div>
          <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <section aria-labelledby="an-t" style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px 20px' }}>
              <h2 id="an-t" className="lbl">
                // Announcements
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {m?.announcements.map((a) => <AnnouncementRow key={a.id} a={a} />)}
                {m && !m.announcements.length && <span style={{ padding: '10px 0', fontSize: 13, color: 'var(--text-2)', borderBottom: '1px solid var(--separator)' }}>No announcement in the last 30 days.</span>}
              </div>
              <Composer max={m?.maxText ?? 140} />
              <Logged />
            </section>
            <section aria-labelledby="ev-t" style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px 20px' }}>
              <h2 id="ev-t" className="lbl">
                // Events
              </h2>
              {m ? (
                <EventCard title="Free case for everyone" text={m.freeCase.text} costs={m.freeCase.costs} button={m.freeCase.button} path="/admin/events/free-case" />
              ) : (
                <div aria-busy="true" aria-label="Loading the events" style={{ height: 160 }} />
              )}
              <GiftCard />
            </section>
          </div>
        </div>
      )}
      {ban && <BanById id={ban} onClose={() => setBan(null)} mobile={mobile} />}
    </AdminPage>
  );
}
