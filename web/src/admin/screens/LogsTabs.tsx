import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import type { AdminJobCard, LedgerCheckResult } from '../../../../shared/api';
import { api } from '../../lib/api';
import { useDebounced } from '../../lib/useDebounced';
import { errorText, rowsOf, signedCr, cr, num, useAdminAction, useErrors, useJobs, useLedger, utcDay, utcStamp, utcTime } from '../lib';
import { Btn, Dot, EmptyBox, ErrorBox, InlineConfirm, ListFooter, SEARCH, cx, s } from '../ui';

const panel: CSSProperties = { border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' };
const spinner = (size: number): CSSProperties => ({ width: size, height: size, border: '2px solid var(--border-hover)', borderTopColor: 'var(--text)', borderRadius: '50%', animation: 'mint-spin .8s linear infinite' });

// ── Ledger ──────────────────────────────────────────────────────────────────

const LEDGER_GRID = '90px 120px 110px 140px 120px 120px minmax(0, 1fr)';

function CheckCard({ last }: { last: { ok: boolean; at: string; result: string } | null | undefined }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LedgerCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<LedgerCheckResult>('/admin/ledger/check', { method: 'POST', json: {} }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const today = (iso: string) => (utcDay(iso) === utcDay(new Date().toISOString()) ? `today ${utcTime(iso)}` : utcStamp(iso));
  return (
    <div style={{ ...panel, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', padding: '16px 18px' }}>
      <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Check ledger</span>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Adds up every player’s entries and compares them with balances and held bids. Read-only, about 20 s.</span>
      </div>
      <Btn size={44} onClick={() => void run()} disabled={busy}>
        {busy && <span aria-hidden="true" className="anim" style={spinner(12)} />}
        {busy ? 'Checking…' : 'Check ledger'}
      </Btn>
      {error && (
        <span role="alert" className={s.alertText} style={{ flexBasis: '100%' }}>
          {error}
        </span>
      )}
      {result?.ok && (
        <span role="status" style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '1px solid var(--separator)', fontSize: 14 }}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'var(--text)', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          Ledger OK: <span className="mono">{num(result.players)}</span> players, <span className="mono">{num(result.entries)}</span> entries{' '}
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
            · checked just now
          </span>
        </span>
      )}
      {result && !result.ok && (
        <div role="alert" style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid var(--separator)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
            <Dot />
            {num(result.mismatches.length)} mismatch{result.mismatches.length === 1 ? '' : 'es'} out of {num(result.players)} players
          </span>
          {result.mismatches.map((m) => (
            <span key={m.text} style={{ fontSize: 13 }}>
              <Link to={`/admin/players/${m.userId}`} style={{ color: 'var(--text)' }}>
                {m.label}
              </Link>{' '}
              <span style={{ color: 'var(--text-2)' }}>{m.text.slice(m.label.length + 1)}</span>
            </span>
          ))}
        </div>
      )}
      {!result && last && (
        <span style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '1px solid var(--separator)', fontSize: 14 }}>
          {!last.ok && <Dot />}
          Last check: <span className="mono">{last.result}</span>{' '}
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
            · {today(last.at)}
          </span>
        </span>
      )}
    </div>
  );
}

export function LedgerTab() {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 250);
  const list = useLedger(q);
  const rows = rowsOf(list.data);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <CheckCard last={list.data?.pages[0]?.lastCheck} />
      <div style={{ position: 'relative', maxWidth: 560 }}>
        <label htmlFor="lq" className="sr-only">
          Search the ledger
        </label>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" className={s.searchIcon}>
          <path d={SEARCH} />
        </svg>
        <input id="lq" type="search" className={s.field} style={{ width: '100%', height: 44, padding: '0 14px 0 40px', background: 'var(--surface)' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Player, entry ID or type (case_open, recycle…)" />
      </div>
      {list.isError ? (
        <ErrorBox title="Couldn’t load the ledger" error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div aria-busy="true" aria-label="Loading the ledger" className={s.panel}>
          <div style={{ height: 44, borderBottom: '1px solid var(--border)', background: 'var(--rail)' }} />
          {[180, 120, 150, 110, 170, 130].map((w, i) => (
            <div key={i} className={s.skelRow}>
              <span className={s.skel} style={{ width: 60 }} />
              <span className={s.skel} style={{ width: 90 }} />
              <span className={s.skel} style={{ width: w }} />
            </div>
          ))}
        </div>
      ) : (
        <div className={s.tableWrap}>
          <div role="table" aria-label="Ledger" style={{ minWidth: 900 }}>
            <div role="row" className={s.thead} style={{ gridTemplateColumns: LEDGER_GRID, padding: '0 18px' }}>
              {['Entry', 'Time', 'Player', 'Type', 'Amount', 'Balance', 'Details'].map((h, i) => (
                <span key={h} role="columnheader" className={cx('lbl', s.th)} style={{ textAlign: i === 4 || i === 5 ? 'right' : undefined, paddingLeft: i === 6 ? 24 : undefined }}>
                  {h}
                </span>
              ))}
            </div>
            {rows.map((l) => (
              <div key={l.id} role="row" className={s.tr} style={{ gridTemplateColumns: LEDGER_GRID, padding: '0 18px' }}>
                <span role="cell" className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  #{l.id}
                </span>
                <span role="cell" className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>
                  {utcStamp(l.at)}
                </span>
                <span role="cell" className={s.ellipsis}>
                  <Link to={`/admin/players/${l.player.id}`} style={{ color: 'var(--text)' }}>
                    {l.player.label}
                  </Link>
                </span>
                <span role="cell" className={cx('mono', s.ellipsis)} style={{ fontSize: 13 }}>
                  {l.type}
                </span>
                <span role="cell" className="mono" style={{ textAlign: 'right' }}>
                  {l.amount === 0 ? '0 CR' : signedCr(l.amount)}
                </span>
                <span role="cell" className="mono" style={{ textAlign: 'right', color: 'var(--text-2)' }}>
                  {cr(l.balanceAfter)}
                </span>
                <span role="cell" className={s.ellipsis} style={{ paddingLeft: 24, color: 'var(--text-2)' }}>
                  {l.details || '—'}
                </span>
              </div>
            ))}
            {rows.length === 0 && (
              <div style={{ margin: 18 }}>
                <EmptyBox action={q ? { label: 'Clear search', onClick: () => setText('') } : undefined}>{q ? 'No ledger entry matches this search.' : 'No ledger entry yet.'}</EmptyBox>
              </div>
            )}
          </div>
          {rows.length > 0 && (
            <div style={{ padding: '12px 18px' }}>
              <ListFooter text={`${num(rows.length)} entries shown · newest first · kept forever`} more={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Jobs ────────────────────────────────────────────────────────────────────

const when = (iso: string | null) => {
  if (!iso) return '—';
  return utcDay(iso) === utcDay(new Date().toISOString()) ? utcTime(iso) : utcStamp(iso);
};

function JobCard({ job }: { job: AdminJobCard }) {
  const [confirm, setConfirm] = useState(false);
  const action = useAdminAction();
  const warn = job.status === 'Warning' || job.status === 'Failed';
  const status = action.busy ? 'Running' : job.status;
  return (
    <article style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>{job.name}</h3>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {job.schedule}
          </span>
        </div>
        <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 8px', borderRadius: 'var(--radius-control)', fontSize: 11, border: '1px solid var(--border-strong)', color: warn ? 'var(--text)' : 'var(--text-2)' }}>
          {warn && !action.busy && <Dot />}
          {status}
        </span>
      </div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {[
          ['Last run', when(job.lastRunAt)],
          ['Result', job.result ?? '—'],
          ['Duration', job.durationMs !== null ? `${(job.durationMs / 1000).toFixed(1)} s` : '—'],
        ].map(([k, v]) => (
          <div key={k}>
            <dt style={{ fontSize: 12, color: 'var(--text-2)' }}>{k}</dt>
            <dd className="mono" style={{ margin: '2px 0 0', fontSize: 13 }}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {job.note && (
        <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>
          {job.note}{' '}
          {job.link && (
            <Link to={job.link.to} style={{ color: 'var(--text)' }}>
              {job.link.label}
            </Link>
          )}
        </p>
      )}
      {confirm ? (
        <InlineConfirm
          title={`Run ${job.name.toLowerCase()} now`}
          text="It runs right away, outside its schedule."
          diff={[{ label: 'Last run', before: job.lastRunAt ? `${utcStamp(job.lastRunAt)} · ${job.result ?? '—'}` : 'never', after: 'now' }]}
          button={`Run ${job.name.toLowerCase()}`}
          onCancel={() => setConfirm(false)}
          onConfirm={async (reason) => {
            setConfirm(false);
            return action.run(`/admin/jobs/${job.job}/run`, { reason });
          }}
        />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 12, borderTop: '1px solid var(--separator)' }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            Next {when(job.nextAt)}
          </span>
          <Btn min="admin" disabled={action.busy} onClick={() => setConfirm(true)}>
            {action.busy && <span aria-hidden="true" className="anim" style={spinner(10)} />}
            {action.busy ? 'Running…' : 'Run now'}
          </Btn>
        </div>
      )}
    </article>
  );
}

export function JobsTab({ canRun }: { canRun: boolean }) {
  const jobs = useJobs();
  if (jobs.isError) return <ErrorBox title="Couldn’t load the jobs" error={jobs.error} onRetry={() => void jobs.refetch()} />;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))', gap: 16 }}>
        {jobs.data ? jobs.data.map((j) => <JobCard key={j.job} job={j} />) : [0, 1, 2, 3].map((i) => <div key={i} aria-busy="true" aria-label="Loading the jobs" style={{ ...panel, height: 210 }} />)}
      </div>
      {!canRun && (
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          Run now: Admins only.
        </span>
      )}
    </>
  );
}

// ── Errors ──────────────────────────────────────────────────────────────────

export function ErrorsTab() {
  const errors = useErrors();
  if (errors.isError) return <ErrorBox title="Couldn’t load the errors" error={errors.error} onRetry={() => void errors.refetch()} />;
  const e = errors.data;
  const max = Math.max(1, ...(e?.codes.map((c) => c.count) ?? [1]));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
      <section aria-labelledby="ec-t" style={{ ...panel, flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 20px' }}>
        <h2 id="ec-t" className="lbl">
          // Top error codes · 24 h
        </h2>
        {!e ? (
          <div aria-busy="true" aria-label="Loading the error codes" style={{ height: 200 }} />
        ) : e.codes.length ? (
          e.codes.map((c) => (
            <div key={c.code} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                <span className="mono">{c.code}</span>
                <span className="mono">{num(c.count)}</span>
              </span>
              <span aria-hidden="true" style={{ height: 4, background: 'var(--track)' }}>
                <span style={{ display: 'block', height: 4, width: `${Math.max(2, (c.count / max) * 100).toFixed(1)}%`, background: c.alert ? 'var(--urgent)' : 'var(--text-2)' }} />
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{c.hint}</span>
            </div>
          ))
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>No error in the last 24 hours.</span>
        )}
      </section>
      <section aria-labelledby="se-t" style={{ ...panel, flex: '2 1 560px', minWidth: 0 }}>
        <h2 id="se-t" className="lbl" style={{ padding: '18px 20px 12px' }}>
          // Latest server errors
        </h2>
        {!e ? (
          <div aria-busy="true" aria-label="Loading the server errors" style={{ height: 200 }} />
        ) : e.errors.length ? (
          e.errors.map((x) => (
            <div key={`${x.at}-${x.route}-${x.message}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 20px', borderTop: '1px solid var(--separator)' }}>
              <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', fontSize: 13 }}>
                <span className="mono" style={{ color: 'var(--text-2)' }}>
                  {utcStamp(x.at)}
                </span>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {x.code}
                </span>
                <span className="mono" style={{ color: 'var(--text-2)' }}>
                  {x.route}
                </span>
                <span className="mono" style={{ color: 'var(--text-3)' }}>
                  ×{num(x.count)}
                </span>
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{x.message}</span>
            </div>
          ))
        ) : (
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--separator)', fontSize: 13, color: 'var(--text-2)' }}>No server error recorded. Errors are kept per hour, grouped by route and message.</div>
        )}
      </section>
    </div>
  );
}
