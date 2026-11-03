import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { AdminCrateRow, DiffRow, ImportReport } from '../../../../shared/api';
import { api } from '../../lib/api';
import { RARITY } from '../../lib/rarity';
import { useIsMobile } from '../../lib/useMediaQuery';
import { AdminPage } from '../AdminApp';
import { cr, errorText, isoDay, num, useAdminAction, useCatalog, useCrateDetail, useStaff, utcDay } from '../lib';
import { Btn, Corners, Dot, Drawer, ErrorBox, Header, InlineConfirm, Logged, ReasonField, Switch, cx, s } from '../ui';

const GRID = '84px minmax(0, 1fr) 110px 92px 70px 80px 62px 100px';
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

type Pending = { crate: AdminCrateRow; kind: 'active' | 'new'; value: boolean };

function pendingCopy(p: Pending): { title: string; text: string; button: string; diff: DiffRow[]; blocked?: boolean } {
  const { crate, kind, value } = p;
  if (kind === 'active') {
    const diff = [{ label: 'Active', before: crate.active ? 'on' : 'off', after: value ? 'on' : 'off' }];
    if (!value && crate.caseOfDay) return { title: `Turn off ${crate.name}`, text: 'It’s today’s case of the day. Pick another case of the day first, then turn it off.', button: 'OK', diff: [], blocked: true };
    if (!value) return { title: `Turn off ${crate.name}`, text: `Players can’t buy it or get it for free anymore. Items already opened stay where they are. ${plural(crate.opened7d, 'opening')} in the last 7 days.`, button: `Turn off ${crate.name}`, diff };
    if (crate.brokenImages > 0) return { title: `Turn on ${crate.name}`, text: `${plural(crate.brokenImages, 'broken image')} ${crate.brokenImages === 1 ? 'is' : 'are'} still there: players would open skins with a blank card.`, button: 'Turn on anyway', diff };
    return { title: `Turn on ${crate.name}`, text: `Players can buy it right away for ${cr(crate.price)}.`, button: `Turn on ${crate.name}`, diff };
  }
  const diff = [{ label: 'NEW badge', before: crate.isNew ? 'shown' : 'hidden', after: value ? 'shown' : 'hidden' }];
  return value
    ? { title: `Mark ${crate.name} as new`, text: 'Shows a NEW badge on it in the shop.', button: 'Mark as new', diff }
    : { title: `Remove the NEW badge from ${crate.name}`, text: 'The shop stops highlighting it. Nothing else changes.', button: 'Remove NEW badge', diff };
}

// ── Import ──────────────────────────────────────────────────────────────────

function ImportPanel({ current, importedOn, caseCount, skinCount, imports }: { current: string | null; importedOn: string; caseCount: number; skinCount: number; imports: { commit: string; what: string; by: string | null; at: string }[] }) {
  const [commit, setCommit] = useState('');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [applied, setApplied] = useState<string | null>(null);
  const action = useAdminAction();
  const dry = async () => {
    setRunning(true);
    setError(null);
    setReport(null);
    setConfirming(false);
    try {
      setReport(await api<ImportReport>('/admin/catalog/import/dry-run', { method: 'POST', json: { commit: commit.trim() || undefined } }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRunning(false);
    }
  };
  const apply = async () => {
    if (!report) return;
    const message = await action.run('/admin/catalog/import/apply', { dryRunId: report.id, reason: reason.trim() });
    if (message) return setError(message);
    setApplied(report.to);
    setReport(null);
    setConfirming(false);
    setReason('');
  };
  const lines = report
    ? [
        { sign: '+', head: plural(report.casesAdded, 'case'), text: 'added. They start off: you turn them on when ready.' },
        { sign: '+', head: plural(report.skinsAdded, 'skin'), text: `added: ${num(report.skinsAddedInNewCases)} in the new cases, ${num(report.skinsAdded - report.skinsAddedInNewCases)} new finishes in existing ones.` },
        { sign: '−', head: plural(report.skinsRemoved, 'skin'), text: 'gone from the source. Players keep the copies they own, they just stop dropping.' },
        ...(report.brokenImages.length || report.fixedImages.length
          ? [
              {
                sign: '!',
                head: `${plural(report.brokenImages.length, 'broken image')}:`,
                text: [report.brokenImages.length ? `${report.brokenImages.join(', ')} still ${report.brokenImages.length === 1 ? 'has' : 'have'} none.` : null, report.fixedImages.length ? `${report.fixedImages.join(', ')} ${report.fixedImages.length === 1 ? 'is' : 'are'} fixed.` : null]
                  .filter(Boolean)
                  .join(' '),
              },
            ]
          : []),
      ]
    : [];
  return (
    <section aria-labelledby="import-title" className={s.panel} style={{ flex: '1 1 340px', display: 'flex', flexWrap: 'wrap', gap: '20px 40px', padding: '20px 22px 22px' }}>
      <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 id="import-title" className="lbl">
            // Import catalog from ByMykel
          </h2>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>
            Now on <span className="mono" style={{ color: 'var(--text)' }}>{current ?? '—'}</span> · {importedOn} · {num(caseCount)} cases, {num(skinCount)} skins. A dry run changes nothing.
          </p>
        </div>
        <label className={s.fieldLabel}>
          <span>Commit</span>
          <input
            className={cx('mono', s.field)}
            value={commit}
            onChange={(e) => {
              setCommit(e.target.value);
              setReport(null);
              setConfirming(false);
            }}
            placeholder="main or a commit hash"
          />
        </label>
        <Btn size={44} onClick={() => void dry()} disabled={running} style={{ alignSelf: 'flex-start' }}>
          {running && <span aria-hidden="true" className="anim" style={{ width: 12, height: 12, border: '2px solid var(--border-hover)', borderTopColor: 'var(--text)', borderRadius: '50%', animation: 'mint-spin .8s linear infinite' }} />}
          {running ? 'Running dry run…' : report ? 'Run the dry run again' : 'Dry run'}
        </Btn>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 14, borderTop: '1px solid var(--separator)' }}>
          <span className={cx('lbl', s.lbl10)}>Previous imports</span>
          {imports.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>None yet.</span>}
          {imports.map((h) => (
            <span key={h.at} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--text-2)' }}>
              <span>
                <span className="mono" style={{ color: 'var(--text)' }}>
                  {h.commit}
                </span>{' '}
                · {h.what}
                {h.by ? ` · by ${h.by}` : ''}
              </span>
              <span className="mono" style={{ fontSize: 12 }}>
                {utcDay(h.at)}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div style={{ flex: '2 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && (
          <span role="alert" className={s.alertText}>
            {error}
          </span>
        )}
        {report ? (
          <>
            <span className={cx('lbl', s.lbl10)}>
              Dry run · {report.from ?? '—'} → {report.to}
            </span>
            <dl className={s.facts}>
              {(
                [
                  ['cases', `+${num(report.casesAdded)}`, false],
                  ['skins', `+${num(report.skinsAdded)}`, false],
                  ['skins removed', num(report.skinsRemoved), false],
                  [report.brokenImages.length === 1 ? 'broken image' : 'broken images', num(report.brokenImages.length), report.brokenImages.length > 0],
                ] as [string, string, boolean][]
              ).map(([k, v, alert]) => (
                <div key={k} style={{ flexDirection: 'column-reverse', background: 'var(--surface-raised)' }}>
                  <dt>{k}</dt>
                  <dd className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 500 }}>
                    {alert && <Dot />}
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            <ul style={{ display: 'flex', flexDirection: 'column' }}>
              {lines.map((l, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--separator)', fontSize: 13, lineHeight: 1.45 }}>
                  <span className="mono" style={{ flex: 'none', width: 14, color: 'var(--text-3)' }}>
                    {l.sign}
                  </span>
                  <span style={{ color: 'var(--text-2)' }}>
                    <span style={{ color: 'var(--text)' }}>{l.head}</span> {l.text}
                  </span>
                </li>
              ))}
            </ul>
            {confirming ? (
              <div role="group" aria-label="Apply import" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, border: '1px solid var(--text)', borderRadius: 'var(--radius-card)', background: 'var(--surface-bar)' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Apply import {report.to}</span>
                <span className={s.note}>New cases start off. Odds and prices don't change. Items players own are never touched.</span>
                <span className={s.confirmDiff}>
                  Commit {report.from ?? '—'} → {report.to} · Cases {num(caseCount)} → {num(caseCount + report.casesAdded)}
                </span>
                <input className={s.field} aria-label="Reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, shown in the admin log" />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Btn size={44} onClick={() => setConfirming(false)}>
                    Cancel
                  </Btn>
                  <Btn size={44} variant="primary" min="admin" onClick={() => void apply()} disabled={!reason.trim() || action.busy}>
                    Apply import
                  </Btn>
                </div>
                <Logged />
              </div>
            ) : (
              <Btn size={48} variant="primary" bevel min="admin" onClick={() => setConfirming(true)} style={{ alignSelf: 'flex-start', fontSize: 14 }}>
                Apply import…
              </Btn>
            )}
          </>
        ) : (
          <div style={{ flex: 1, minHeight: 160, display: 'grid', placeItems: 'center', padding: 24, border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-card)', fontSize: 14, color: 'var(--text-2)', textAlign: 'center' }}>
            {running ? `Comparing ${commit.trim() || 'main'} with ${current ?? 'the database'}…` : applied ? `Catalog is on ${applied}. Run a dry run to check a newer commit.` : 'Run a dry run to see what would change.'}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Drawers ─────────────────────────────────────────────────────────────────

function CaseDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useCrateDetail(id);
  const c = q.data;
  return (
    <Drawer label={c?.caseOfDay ? '// Case of the day' : '// Case'} onClose={onClose}>
      {!c ? (
        q.isError ? (
          <ErrorBox title="Couldn't load this case" error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <span className={s.skel} style={{ width: '100%', height: 180 }} />
            <span className={s.skel} style={{ width: 220, height: 28 }} />
          </>
        )
      ) : (
        <>
          <div className={s.stage} style={{ height: 180 }}>
            <span aria-hidden="true" style={{ position: 'absolute', inset: '8% 18%', background: 'radial-gradient(closest-side, color-mix(in srgb, var(--text) 14%, transparent), transparent)' }} />
            <Corners />
            <img src={c.imageUrl} alt={c.name} style={{ position: 'relative', width: '46%', maxHeight: 140, objectFit: 'contain', opacity: c.active ? 1 : 0.45 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ fontSize: 28, lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.01em' }}>{c.name}</h2>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
              Released <span className="mono">{c.releasedOn ?? '—'}</span> · <span className="mono">{cr(c.price)}</span> · {plural(c.normalCount, 'skin')}
              {c.hasGold ? ' + ★' : ''}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span className={cx('mono', s.statusChip, c.active ? s.chipOutline : s.chipDashed)} style={{ height: 26 }}>
                {c.active ? 'Active' : 'Off'}
              </span>
              {c.isNew && (
                <span className={cx('mono', s.statusChip, s.chipSolid)} style={{ height: 26, fontWeight: 600 }}>
                  New
                </span>
              )}
              {c.caseOfDay && (
                <span className={cx('mono', s.statusChip, s.chipSolid)} style={{ height: 26, fontWeight: 600 }}>
                  Case of the day
                </span>
              )}
            </div>
          </div>
          {c.broken.length > 0 && (
            <div role="note" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-card)', background: 'var(--surface-bar)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
                <Dot />
                {plural(c.broken.length, 'broken image')}
              </span>
              {c.broken.map((b) => (
                <span key={b.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                  <span>{b.name}</span>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {b.reason}
                  </span>
                </span>
              ))}
              <span className={s.note}>
                {c.off ? `Turned off by ${c.off.by} on ${utcDay(c.off.at)} so nobody opens a skin without art. ` : ''}Re-run the import once ByMykel has the images.
              </span>
            </div>
          )}
          <section aria-label="Contents" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {c.groups.map((g) => (
              <div key={g.tier} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span aria-hidden="true" className={s.square} style={{ background: RARITY[g.tier].color }} />
                  <span style={{ color: RARITY[g.tier].text }}>{RARITY[g.tier].name}</span>
                  <span className="mono" style={{ color: 'var(--text-3)', fontSize: 12 }}>
                    {g.gold ? plural(g.gold.finishes, 'finish', 'finishes') : num(g.count)}
                  </span>
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                  {g.gold ? (
                    <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-card)', overflow: 'hidden', background: 'var(--surface-raised)' }}>
                      <span style={{ display: 'flex', flexDirection: 'column', padding: '10px 10px 8px' }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{g.gold.title}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{plural(g.gold.finishes, 'finish', 'finishes')}</span>
                      </span>
                      <span aria-hidden="true" style={{ height: 3, background: RARITY.gold.color }} />
                    </div>
                  ) : (
                    g.skins.map((sk) => (
                      <div key={sk.id} style={{ display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-card)', overflow: 'hidden', background: 'var(--surface-raised)', border: sk.broken ? '1px dashed var(--border-hover)' : undefined }}>
                        <span style={{ position: 'relative', height: 58, display: 'grid', placeItems: 'center' }}>
                          {sk.broken ? (
                            <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-2)' }}>
                              <Dot />
                              No image
                            </span>
                          ) : (
                            <>
                              <span aria-hidden="true" style={{ position: 'absolute', inset: '6% 12%', background: `radial-gradient(closest-side, ${RARITY[g.tier].halo}, transparent)` }} />
                              <img src={sk.imageUrl} alt="" loading="lazy" style={{ position: 'relative', width: '70%', height: 48, objectFit: 'contain' }} />
                            </>
                          )}
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', padding: '6px 10px 8px' }}>
                          <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{sk.weaponName}</span>
                          <span className={s.ellipsis} style={{ fontSize: 12, fontWeight: 600 }}>
                            {sk.finishName ?? 'Vanilla'}
                          </span>
                        </span>
                        <span aria-hidden="true" style={{ height: 3, background: RARITY[g.tier].color }} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </section>
          <section aria-label="Last 30 days" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h3 className="lbl">// Last 30 days · {num(c.last30.total)} openings</h3>
            <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)' }}>
              {c.last30.rows.map((x) => (
                <div key={x.tier} style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr) 64px 64px', alignItems: 'center', gap: 12, minHeight: 40, padding: '0 14px', borderBottom: '1px solid var(--separator)', fontSize: 13 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span aria-hidden="true" className={s.square} style={{ background: RARITY[x.tier].color }} />
                    {x.tier === 'gold' ? '★' : RARITY[x.tier].name}
                  </span>
                  <span aria-hidden="true" style={{ height: 4, background: 'var(--track)' }}>
                    <span style={{ display: 'block', height: 4, width: `${x.pct}%`, background: RARITY[x.tier].color }} />
                  </span>
                  <span className="mono" style={{ textAlign: 'right' }}>
                    {num(x.count)}
                  </span>
                  <span className="mono" style={{ textAlign: 'right', color: 'var(--text-2)' }}>
                    {x.pct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </Drawer>
  );
}

function CaseOfDayDrawer({ rows, onClose }: { rows: AdminCrateRow[]; onClose: () => void }) {
  const current = rows.find((r) => r.caseOfDay)?.id ?? null;
  const [pick, setPick] = useState<string | null>(current);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const action = useAdminAction();
  const picked = rows.find((r) => r.id === pick);
  const save = async () => {
    const message = await action.run('/admin/catalog/case-of-day', { crateId: pick, reason: reason.trim() });
    if (message) setError(message);
    else onClose();
  };
  return (
    <Drawer label="// Case of the day" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ fontSize: 28, lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.01em' }}>Change case of the day</h2>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-2)' }}>The case players get for free every 4 hours. The change applies right away. Cases that are off can't be picked.</p>
      </div>
      <div role="radiogroup" aria-label="Case of the day" style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)' }}>
        {rows.map((o) => {
          const on = pick === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!o.active}
              onClick={() => setPick(o.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 56, padding: '0 14px', border: 0, borderBottom: '1px solid var(--separator)', background: on ? 'var(--surface-raised)' : 'none', color: 'var(--text)', font: 'inherit', textAlign: 'left', cursor: o.active ? 'pointer' : 'not-allowed' }}
            >
              <span aria-hidden="true" style={{ flex: 'none', width: 18, height: 18, borderRadius: '50%', border: `1px solid ${on ? 'var(--text)' : 'var(--border-hover)'}`, display: 'grid', placeItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: on ? 'var(--text)' : 'transparent' }} />
              </span>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: o.active ? 'var(--text)' : 'var(--text-3)' }}>{o.name}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {o.active ? `${plural(o.opened7d, 'opening')} in 7 d · ${o.normalCount}${o.hasGold ? ' + ★' : ''}` : 'Off · can’t be picked'}
                </span>
              </span>
              {o.id === current && (
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
                  Current
                </span>
              )}
            </button>
          );
        })}
      </div>
      <ReasonField value={reason} onChange={setReason} placeholder="e.g. weekly rotation" />
      {picked && pick !== current && (
        <span className={s.confirmDiff}>
          Case of the day {rows.find((r) => r.id === current)?.name ?? '—'} → {picked.name}
        </span>
      )}
      {error && (
        <span role="alert" className={s.alertText}>
          {error}
        </span>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn size={44} onClick={onClose}>
          Cancel
        </Btn>
        <Btn size={44} variant="primary" min="admin" onClick={() => void save()} disabled={!picked || pick === current || !reason.trim() || action.busy}>
          {!picked || pick === current ? 'Pick another case' : `Make it ${picked.name}`}
        </Btn>
      </div>
      <Logged />
    </Drawer>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function Catalog() {
  const staff = useStaff();
  const mobile = useIsMobile();
  const q = useCatalog();
  const [params, setParams] = useSearchParams();
  const open = params.get('case');
  const [cotd, setCotd] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const action = useAdminAction();
  const c = q.data;
  const admin = staff.can('admin');
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('case', id);
    else next.delete('case');
    setParams(next, { replace: true });
  };
  const copy = pending ? pendingCopy(pending) : null;
  return (
    <AdminPage gap={24}>
      <Header
        label="Catalog"
        title="Catalog"
        sub={
          c ? (
            <>
              {num(c.caseCount)} cases from ByMykel <span className="mono" style={{ color: 'var(--text)' }}>{c.commit ?? '—'}</span>, imported {c.importedAt ? utcDay(c.importedAt) : '—'}. Changes reach players right away. All times UTC.
            </>
          ) : (
            'All times UTC.'
          )
        }
        right={
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <Btn size={44} min="admin" onClick={() => setCotd(true)} disabled={!c}>
              Change case of the day
            </Btn>
            {!admin && <span className={cx('mono', s.hint)}>Read-only: catalog changes are for admins.</span>}
          </div>
        }
      />
      {copy && pending && (
        <InlineConfirm
          key={`${pending.crate.id}-${pending.kind}`}
          title={copy.title}
          text={copy.text}
          diff={copy.diff}
          button={copy.button}
          blocked={copy.blocked}
          onCancel={() => setPending(null)}
          onConfirm={async (reason) => {
            const message = await action.run(`/admin/catalog/cases/${encodeURIComponent(pending.crate.id)}/${pending.kind}`, { value: pending.value, reason });
            if (!message) setPending(null);
            return message;
          }}
        />
      )}
      {q.isError && !c ? (
        <ErrorBox title="Couldn't load the catalog" error={q.error} onRetry={() => void q.refetch()} />
      ) : !c ? (
        <div aria-busy="true" aria-label="Loading the catalog" className={s.panel}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={s.skelRow} style={{ height: 72 }}>
              <span className={s.skel} style={{ width: 64, height: 48 }} />
              <span className={s.skel} style={{ width: 180 }} />
              <span className={s.skel} style={{ width: 80, marginLeft: 'auto' }} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          <section aria-label="Cases" className={s.tableWrap} style={{ flex: '999 1 920px', minWidth: 0 }}>
            {c.rows.length === 0 ? (
              <div style={{ padding: 18 }}>
                <div className={s.empty}>
                  <span>No case yet.</span>
                  <span className={s.emptySub}>Run a dry run, then apply the import.</span>
                </div>
              </div>
            ) : (
              <div role="table" aria-label="Cases" style={{ minWidth: mobile ? 760 : 920 }}>
                <div role="row" className={s.thead} style={{ gridTemplateColumns: GRID, padding: '0 18px' }}>
                  <span role="columnheader">
                    <span className="sr-only">Image</span>
                  </span>
                  <span role="columnheader" className={cx('lbl', s.th)}>
                    Case
                  </span>
                  <span role="columnheader" className={cx('lbl', s.th)}>
                    Released ↓
                  </span>
                  <span role="columnheader" className={cx('lbl', s.th)}>
                    Contents
                  </span>
                  <span role="columnheader" className={cx('lbl', s.th)}>
                    Active
                  </span>
                  <span role="columnheader" className={cx('lbl', s.th)} style={{ textAlign: 'right', paddingRight: 18 }}>
                    Price
                  </span>
                  <span role="columnheader" className={cx('lbl', s.th)}>
                    New
                  </span>
                  <span role="columnheader" className={cx('lbl', s.th)} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    Opened 7 d
                  </span>
                </div>
                {c.rows.map((r) => (
                  <div key={r.id} role="row" className={s.tr} data-current={open === r.id || undefined} style={{ gridTemplateColumns: GRID, padding: '0 18px', minHeight: 72 }}>
                    <span role="cell">
                      <span style={{ width: 64, height: 48, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-card)', background: 'radial-gradient(closest-side, color-mix(in srgb, var(--text) 16%, transparent), transparent)' }}>
                        <img src={r.imageUrl} alt="" style={{ width: 54, height: 40, objectFit: 'contain', opacity: r.active ? 1 : 0.4 }} />
                      </span>
                    </span>
                    <span role="cell" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5, minWidth: 0 }}>
                      <button type="button" className={cx(s.stretch, s.ellipsis)} onClick={() => setOpen(r.id)} style={{ fontSize: 15, fontWeight: 500, color: r.active ? 'var(--text)' : 'var(--text-3)', maxWidth: '100%' }}>
                        {r.name}
                      </button>
                      {(r.caseOfDay || r.brokenImages > 0) && (
                        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px' }}>
                          {r.caseOfDay && (
                            <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 6px', background: 'var(--primary-bg)', color: 'var(--primary-text)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                              Case of the day
                            </span>
                          )}
                          {r.brokenImages > 0 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
                              <span className={s.dot} aria-hidden="true" style={{ width: 6, height: 6 }} />
                              {plural(r.brokenImages, 'broken image')}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <span role="cell" className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>
                      {r.releasedOn ? isoDay(r.releasedOn) : '—'}
                    </span>
                    <span role="cell" className="mono" style={{ fontSize: 13 }}>
                      {r.normalCount}
                      {r.hasGold ? ' + ★' : ''}
                    </span>
                    <span role="cell">
                      <Switch checked={r.active} label={r.active ? `Turn off ${r.name}` : `Turn on ${r.name}`} disabled={!admin} title={admin ? undefined : 'Admins only'} onChange={() => setPending({ crate: r, kind: 'active', value: !r.active })} />
                    </span>
                    <span role="cell" className="mono" style={{ fontSize: 13, textAlign: 'right', paddingRight: 18 }}>
                      {cr(r.price)}
                    </span>
                    <span role="cell">
                      <Switch checked={r.isNew} label={r.isNew ? `Remove NEW badge from ${r.name}` : `Mark as new: ${r.name}`} disabled={!admin} title={admin ? undefined : 'Admins only'} onChange={() => setPending({ crate: r, kind: 'new', value: !r.isNew })} />
                    </span>
                    <span role="cell" className="mono" style={{ fontSize: 14, textAlign: 'right' }}>
                      {num(r.opened7d)}
                    </span>
                  </div>
                ))}
                <div style={{ padding: '12px 18px' }}>
                  <span className={cx('mono', s.footerText)}>
                    {num(c.rows.length)} of {num(c.caseCount)} cases · newest first
                  </span>
                </div>
              </div>
            )}
          </section>
          <ImportPanel current={c.commit} importedOn={c.importedAt ? utcDay(c.importedAt) : '—'} caseCount={c.caseCount} skinCount={c.skinCount} imports={c.imports} />
        </div>
      )}
      {open && <CaseDrawer id={open} onClose={() => setOpen(null)} />}
      {cotd && c && <CaseOfDayDrawer rows={c.rows} onClose={() => setCotd(false)} />}
    </AdminPage>
  );
}
