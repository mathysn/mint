import { useState } from 'react';
import { Link } from 'react-router';
import type { AdminJob, AdminKpi, AdminOverview, AdminPeriod, FlowBucket } from '../../../../shared/api';
import { RARITY } from '../../lib/rarity';
import { useIsMobile } from '../../lib/useMediaQuery';
import { AdminPage } from '../AdminApp';
import { ago, cr, num, useAdminAction, useOverview, useStaff, utcDateTime, utcDay, utcStamp, utcTime } from '../lib';
import { Btn, Dot, ErrorBox, Header, InlineConfirm, Sparkline, cx, s } from '../ui';

const PERIODS: { key: AdminPeriod; label: string }[] = [
  { key: '24h', label: '24 h' },
  { key: '7d', label: '7 d' },
  { key: '30d', label: '30 d' },
];

const KPI_LABEL: Record<AdminKpi['key'], string> = {
  players: 'Players',
  active: 'Active today',
  cases: 'Cases opened today',
  circulation: 'Credits in circulation',
  sales: 'Market sales 24 h',
  flags: 'Open flags',
};

/** "44.2k", "1.25M", with a true minus sign. */
function k(n: number): string {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}${(a / 1_000).toFixed(1)}k`;
  return `${sign}${num(a)}`;
}

const signed = (n: number) => (n > 0 ? `+${num(n)}` : n < 0 ? `−${num(-n)}` : '0');

const created = (b: FlowBucket) => b.starting + b.recycle + b.admin;
const destroyed = (b: FlowBucket) => b.cases + b.fees + b.removed;

function PeriodChips({ value, onChange }: { value: AdminPeriod; onChange: (p: AdminPeriod) => void }) {
  return (
    <div role="radiogroup" aria-label="Period" style={{ display: 'flex', gap: 6 }}>
      {PERIODS.map((p) => (
        <button key={p.key} type="button" role="radio" aria-checked={value === p.key} className={cx(s.toggle, 'mono')} style={{ height: 36, fontSize: 12, color: value === p.key ? undefined : 'var(--text-2)' }} onClick={() => onChange(p.key)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

function kpiValue(kpi: AdminKpi) {
  return kpi.key === 'circulation' ? cr(kpi.value) : num(kpi.value);
}

// ── Credits flow ────────────────────────────────────────────────────────────

const CREATED_PARTS: { key: keyof FlowBucket; color: string; label: string }[] = [
  { key: 'starting', color: 'var(--text)', label: 'Starting balances' },
  { key: 'recycle', color: 'var(--text-2)', label: 'Recycling' },
  { key: 'admin', color: 'var(--hud)', label: 'Admin grants' },
];
const DESTROYED_PARTS: { key: keyof FlowBucket; color: string; label: string }[] = [
  { key: 'cases', color: 'var(--text-3)', label: 'Case purchases' },
  { key: 'fees', color: 'var(--hud)', label: 'Market fees' },
  { key: 'removed', color: 'var(--border-hover)', label: 'Admin removals' },
];

function FlowChart({ flow }: { flow: AdminOverview['flow'] }) {
  const buckets = flow.buckets;
  const maxAbs = Math.max(1, ...buckets.map(created), ...buckets.map(destroyed));
  const h = (v: number) => (v > 0 ? Math.max(1, (v / maxAbs) * 120) : 0);
  const net = buckets.map((b, i) => `${(((i + 0.5) / buckets.length) * 100).toFixed(2)},${(120 - ((created(b) - destroyed(b)) / maxAbs) * 120).toFixed(2)}`).join(' ');
  const x = (iso: string) => (flow.unit === 'hour' ? `${utcDay(iso)}, ${utcTime(iso)}` : utcDay(iso));
  return (
    <>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="mono" aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 240, fontSize: 10, color: 'var(--text-3)', textAlign: 'right' }}>
          <span>+{k(maxAbs)}</span>
          <span>0</span>
          <span>−{k(maxAbs)}</span>
        </div>
        <div
          role="img"
          aria-label={`Credits created and destroyed per ${flow.unit}, net ${signed(flow.net)} CR over the period`}
          style={{ position: 'relative', flex: 1, minWidth: 0, height: 240, display: 'flex', gap: buckets.length > 20 ? 2 : 10 }}
        >
          {buckets.map((b) => (
            <div key={b.start} title={`${x(b.start)} · created ${num(created(b))} · destroyed ${num(destroyed(b))}`} style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ height: 120, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 1 }}>
                {[...CREATED_PARTS].reverse().map((p) => (
                  <span key={p.key} style={{ height: h(b[p.key] as number), background: p.color }} />
                ))}
              </div>
              <div style={{ height: 120, display: 'flex', flexDirection: 'column', gap: 1, borderTop: '1px solid var(--border-hover)' }}>
                {DESTROYED_PARTS.map((p) => (
                  <span key={p.key} style={{ height: h(b[p.key] as number), background: p.color }} />
                ))}
              </div>
            </div>
          ))}
          <svg aria-hidden="true" viewBox="0 0 100 240" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: 240, overflow: 'visible', pointerEvents: 'none' }}>
            <polyline points={net} style={{ fill: 'none', stroke: 'var(--text)', strokeWidth: 1.5, strokeDasharray: '4 3', vectorEffect: 'non-scaling-stroke' }} />
          </svg>
        </div>
      </div>
      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 40, fontSize: 10, color: 'var(--text-3)' }}>
        <span>{buckets[0] ? x(buckets[0].start) : ''}</span>
        <span>{buckets.at(-1) ? x(buckets.at(-1)!.start) : ''}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', fontSize: 12, color: 'var(--text-2)' }}>
        <span className={cx('lbl', s.lbl10)}>Created</span>
        {CREATED_PARTS.map((p) => (
          <span key={p.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, background: p.color }} />
            {p.label}
          </span>
        ))}
        <span className={cx('lbl', s.lbl10)} style={{ marginLeft: 8 }}>
          Destroyed
        </span>
        {DESTROYED_PARTS.map((p) => (
          <span key={p.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, background: p.color }} />
            {p.label}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden="true" style={{ width: 14, height: 0, borderTop: '1.5px dashed var(--text)' }} />
          Net
        </span>
      </div>
    </>
  );
}

// ── Jobs ────────────────────────────────────────────────────────────────────

function whenLine(job: AdminJob) {
  if (!job.lastRunAt) return `never run · ${job.schedule}`;
  const minutes = (Date.now() - new Date(job.lastRunAt).getTime()) / 60_000;
  if (minutes < 2) return `ran just now · ${job.schedule}`;
  const today = utcDay(job.lastRunAt) === utcDay(new Date().toISOString());
  return `last run ${today ? 'today' : utcDay(job.lastRunAt)} · ${job.schedule}`;
}

function JobRow({ job }: { job: AdminJob }) {
  const [confirm, setConfirm] = useState(false);
  const action = useAdminAction();
  return (
    <div style={{ borderTop: '1px solid var(--separator)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56 }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 0' }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{job.name}</span>
          <span className="mono" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {job.ok === false && <Dot />}
            {action.busy ? 'Running…' : (job.result ?? '—')}
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {whenLine(job)}
          </span>
        </span>
        <Btn size={36} min="admin" disabled={action.busy || confirm} onClick={() => setConfirm(true)} style={{ fontSize: 12 }}>
          {action.busy && <span aria-hidden="true" className="anim" style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid var(--border-hover)', borderTopColor: 'var(--text)', animation: 'mint-spin 800ms linear infinite' }} />}
          {action.busy ? 'Running…' : 'Run now'}
        </Btn>
      </div>
      {confirm && (
        <div style={{ paddingBottom: 12 }}>
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
        </div>
      )}
    </div>
  );
}

// ── Desktop ─────────────────────────────────────────────────────────────────

function Desktop() {
  const [period, setPeriod] = useState<AdminPeriod>('7d');
  const q = useOverview(period);
  const o = q.data;
  return (
    <AdminPage gap={24}>
      <Header label="Overview" title="Overview" sub="Health of the game at a glance. All times UTC." right={<PeriodChips value={period} onChange={setPeriod} />} />
      {q.isError && !o ? (
        <ErrorBox title="Couldn’t load the overview" error={q.error} onRetry={() => void q.refetch()} />
      ) : !o ? (
        <OverviewSkeleton />
      ) : (
        <>
          <section aria-label="Key numbers" style={{ display: 'flex', flexWrap: 'wrap', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', overflow: 'hidden' }}>
            {o.kpis.map((kpi) => (
              <div key={kpi.key} style={{ flex: '1 1 calc(33.333% - 1px)', minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8, padding: '18px 20px 16px', background: 'var(--surface)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)' }}>
                  {kpi.alert && <Dot />}
                  {KPI_LABEL[kpi.key]}
                </span>
                <span className="mono" style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.01em' }}>
                  {kpiValue(kpi)}
                </span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {kpi.delta}
                </span>
                <Sparkline values={kpi.spark} />
              </div>
            ))}
          </section>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
            <section aria-labelledby="flow-title" className={s.section} style={{ flex: '2 1 560px' }}>
              <div className={s.sectionHead}>
                <h2 id="flow-title" className={s.sectionTitle}>
                  Credits flow
                </h2>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  created {num(o.flow.created)} · destroyed {num(o.flow.destroyed)} · net {signed(o.flow.net)} CR
                </span>
              </div>
              <FlowChart flow={o.flow} />
            </section>
            <section aria-labelledby="drops-title" className={s.section} style={{ flex: '1 1 380px', gap: 14 }}>
              <div className={s.sectionHead}>
                <h2 id="drops-title" className={s.sectionTitle}>
                  Drop rates
                </h2>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  last {num(10_000)} openings
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) 70px 70px minmax(0, 1fr)', gap: '0 12px', alignItems: 'center', fontSize: 13 }}>
                <span className={cx('lbl', s.lbl10)} style={{ paddingBottom: 8 }}>
                  Rarity
                </span>
                <span className={cx('lbl', s.lbl10)} style={{ paddingBottom: 8, textAlign: 'right' }}>
                  Set
                </span>
                <span className={cx('lbl', s.lbl10)} style={{ paddingBottom: 8, textAlign: 'right' }}>
                  Actual
                </span>
                <span className={cx('lbl', s.lbl10)} style={{ paddingBottom: 8, textAlign: 'center', whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>
                  0.8×  ·  1×  ·  1.2×
                </span>
                {o.drops.rows.map((d) => {
                  const pos = Math.min(98, Math.max(2, 50 + ((d.ratio - 1) / 0.2) * 50));
                  const cell = { minHeight: 40, display: 'flex', alignItems: 'center', borderTop: '1px solid var(--separator)' } as const;
                  return [
                    <span key={`${d.tier}-n`} style={{ ...cell, gap: 8 }}>
                      <span aria-hidden="true" className={s.square} style={{ background: RARITY[d.tier].color }} />
                      <span style={{ color: RARITY[d.tier].text }}>{RARITY[d.tier].name}</span>
                    </span>,
                    <span key={`${d.tier}-s`} className="mono" style={{ ...cell, justifyContent: 'flex-end', color: 'var(--text-2)' }}>
                      {d.setPct.toFixed(2)}%
                    </span>,
                    <span key={`${d.tier}-a`} className="mono" style={{ ...cell, justifyContent: 'flex-end' }}>
                      {o.drops.sample ? `${d.actualPct.toFixed(2)}%` : '—'}
                    </span>,
                    <span key={`${d.tier}-m`} role="img" aria-label={`Actual is ${d.ratio.toFixed(2)} times the configured rate`} style={{ position: 'relative', minHeight: 40, borderTop: '1px solid var(--separator)' }}>
                      <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: 19, height: 2, background: 'var(--track)' }} />
                      <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: 13, width: 1, height: 14, background: 'var(--hud)' }} />
                      {o.drops.sample > 0 && <span aria-hidden="true" style={{ position: 'absolute', left: `${pos}%`, top: 15, width: 10, height: 10, marginLeft: -5, borderRadius: '50%', background: 'var(--text)' }} />}
                    </span>,
                  ];
                })}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                {!o.drops.normal && <Dot />}
                {o.drops.verdict}
              </p>
            </section>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: 20 }}>
            <section aria-labelledby="jobs-title" className={s.section} style={{ padding: '22px 22px 10px', gap: 0 }}>
              <div className={s.sectionHead} style={{ paddingBottom: 10 }}>
                <h2 id="jobs-title" className={s.sectionTitle}>
                  Scheduled jobs
                </h2>
                <Link to="/admin/logs">All jobs</Link>
              </div>
              {o.jobs.map((j) => (
                <JobRow key={j.job} job={j} />
              ))}
            </section>
            <CatalogCard o={o} />
            <section aria-labelledby="recent-title" className={s.section} style={{ padding: '22px 22px 10px', gap: 0 }}>
              <div className={s.sectionHead} style={{ paddingBottom: 10 }}>
                <h2 id="recent-title" className={s.sectionTitle}>
                  Recent admin actions
                </h2>
                <Link to="/admin/logs">Admin log</Link>
              </div>
              {o.recent.length === 0 && <span style={{ padding: '14px 0', borderTop: '1px solid var(--separator)', fontSize: 13, color: 'var(--text-2)' }}>No staff action yet.</span>}
              {o.recent.map((a) => (
                <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 0', borderTop: '1px solid var(--separator)' }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {a.action}
                    </span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {utcStamp(a.at)}
                    </span>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                    {a.staff} · {a.targetLabel} · {a.change}
                  </span>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </AdminPage>
  );
}

function CatalogCard({ o }: { o: AdminOverview }) {
  const c = o.catalog;
  const facts: [string, string, boolean][] = [
    ['Source', c.commit ? `ByMykel ${c.commit}` : '—', true],
    ['Imported', c.importedAt ? utcDateTime(c.importedAt) : '—', true],
    ['Cases', `${num(c.cases)} · ${num(c.active)} active`, true],
    ['Case of the day', c.caseOfDay ?? '—', false],
  ];
  return (
    <section aria-labelledby="catalog-title" className={s.section} style={{ gap: 14 }}>
      <div className={s.sectionHead}>
        <h2 id="catalog-title" className={s.sectionTitle}>
          Catalog
        </h2>
        <Link to="/admin/catalog">Open catalog</Link>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, background: 'var(--separator)', border: '1px solid var(--separator)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
        {facts.map(([k2, v, mono]) => (
          <div key={k2} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 4, padding: '12px 14px', background: 'var(--surface)' }}>
            <dt style={{ fontSize: 12, color: 'var(--text-2)' }}>{k2}</dt>
            <dd className={mono ? 'mono' : undefined} style={{ fontSize: 14 }}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {c.warnings.map((w) => (
        <Link key={w.crateId} to={`/admin/catalog?case=${encodeURIComponent(w.crateId)}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-card)', color: 'var(--text)', textDecoration: 'none', fontSize: 13 }}>
          <Dot />
          <span style={{ flex: 1 }}>{w.text}</span>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'var(--text-3)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      ))}
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the overview" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', overflow: 'hidden' }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 20px', background: 'var(--surface)' }}>
            <span className={s.skel} style={{ width: 100 }} />
            <span className={s.skel} style={{ width: 120, height: 26 }} />
            <span className={s.skel} style={{ width: 150 }} />
          </div>
        ))}
      </div>
      <span className={s.skel} style={{ width: '100%', height: 320, borderRadius: 6 }} />
    </div>
  );
}

// ── Mobile ──────────────────────────────────────────────────────────────────

const MOBILE_KPI: Record<AdminKpi['key'], { label: string; to: string }> = {
  players: { label: 'Players', to: '/admin/players' },
  active: { label: 'Active today', to: '/admin/players' },
  cases: { label: 'Cases opened today', to: '/admin/catalog' },
  circulation: { label: 'Credits in circulation', to: '/admin/economy' },
  sales: { label: 'Market sales 24 h', to: '/admin/market' },
  flags: { label: 'Open flags', to: '/admin/market' },
};

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Mobile() {
  const staff = useStaff();
  const [period, setPeriod] = useState<AdminPeriod>('24h');
  const q = useOverview(period);
  const week = useOverview('7d');
  const o = q.data;
  const flow = week.data?.flow;
  const maxFlow = flow ? Math.max(1, ...flow.buckets.map(created), ...flow.buckets.map(destroyed)) : 1;
  const now = new Date(staff.now).toISOString();
  return (
    <AdminPage gap={20}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className={cx('lbl', s.lbl10)}>// Overview</span>
        <h1 className={s.mTitle}>Overview</h1>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {utcDay(now)} · {utcTime(now)} UTC
        </span>
      </div>
      <div role="radiogroup" aria-label="Period" className={s.seg} style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {PERIODS.map((p) => (
          <button key={p.key} type="button" role="radio" aria-checked={period === p.key} className={cx(s.segBtn, 'mono')} style={{ height: 38 }} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      {q.isError && !o ? (
        <ErrorBox title="Couldn’t load the overview" error={q.error} onRetry={() => void q.refetch()} />
      ) : !o ? (
        <OverviewSkeleton />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {o.kpis.map((kpi) => {
              const value = kpi.key === 'circulation' ? num(kpi.value) : num(kpi.value);
              const delta = kpi.key === 'cases' ? 'today' : kpi.key === 'circulation' ? `CR · ${kpi.delta}` : kpi.delta;
              return (
                <Link key={kpi.key} to={MOBILE_KPI[kpi.key].to} style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 112, padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--surface)', color: 'var(--text)', textDecoration: 'none' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
                    {kpi.alert && <Dot size={6} />}
                    {MOBILE_KPI[kpi.key].label}
                  </span>
                  <span className="mono" style={{ fontSize: value.length > 7 ? 20 : 24, fontWeight: 500, lineHeight: 1.1 }}>
                    {value}
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {delta}
                  </span>
                  <span style={{ marginTop: 'auto' }}>
                    <Sparkline values={kpi.spark} height={16} />
                  </span>
                </Link>
              );
            })}
          </div>

          {flow && (
            <section aria-labelledby="m-flow" className={s.panel} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h2 id="m-flow" className={cx('lbl', s.lbl10)}>
                  // Credits flow · 7 d
                </h2>
                <span className="mono" style={{ fontSize: 12 }}>
                  net {signed(flow.net)} CR
                </span>
              </div>
              <div role="img" aria-label={`Credits created and destroyed per day, last 7 days. Net ${signed(flow.net)} CR.`} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, height: 120 }}>
                {flow.buckets.map((b) => (
                  <div key={b.start} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ height: 54, display: 'flex', alignItems: 'flex-end' }}>
                      <span style={{ width: '100%', height: `${(created(b) / maxFlow) * 100}%`, background: 'var(--text)' }} />
                    </div>
                    <div style={{ height: 1, background: 'var(--border-hover)' }} />
                    <div style={{ height: 54, display: 'flex', alignItems: 'flex-start' }}>
                      <span style={{ width: '100%', height: `${(destroyed(b) / maxFlow) * 100}%`, background: 'var(--hud)' }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                {flow.buckets.map((b) => (
                  <span key={b.start} className="mono" style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'center' }}>
                    {WEEKDAY[new Date(b.start).getUTCDay()]}
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-2)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, background: 'var(--text)' }} />
                  Created
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, background: 'var(--hud)' }} />
                  Destroyed
                </span>
              </div>
            </section>
          )}

          <section aria-labelledby="m-drops" className={s.panel} style={{ display: 'flex', flexDirection: 'column', padding: '14px 14px 4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 8 }}>
              <h2 id="m-drops" className={cx('lbl', s.lbl10)}>
                // Drop rates · last 10,000
              </h2>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
                set → actual
              </span>
            </div>
            {o.drops.rows.map((d) => (
              <div key={d.tier} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, borderTop: '1px solid var(--separator)', fontSize: 13 }}>
                <span aria-hidden="true" className={s.square} style={{ background: RARITY[d.tier].color }} />
                <span style={{ flex: 1, color: RARITY[d.tier].text }}>{RARITY[d.tier].name}</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {d.setPct.toFixed(2)}%
                </span>
                <span aria-hidden="true" style={{ color: 'var(--text-3)' }}>
                  →
                </span>
                <span className="mono" style={{ width: 58, textAlign: 'right', fontSize: 12 }}>
                  {o.drops.sample ? `${d.actualPct.toFixed(2)}%` : '—'}
                </span>
              </div>
            ))}
          </section>

          <section aria-labelledby="m-jobs" className={s.panel} style={{ display: 'flex', flexDirection: 'column', padding: '14px 14px 4px' }}>
            <h2 id="m-jobs" className={cx('lbl', s.lbl10)} style={{ marginBottom: 8 }}>
              // Scheduled jobs
            </h2>
            {o.jobs.map((j) => (
              <div key={j.job} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, borderTop: '1px solid var(--separator)' }}>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14 }}>{j.name}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {j.schedule.replace('daily ', '')} · {j.result ? j.result.replace(/^OK · /, '') : 'never run'}
                  </span>
                </span>
                <span className={cx('mono', s.statusChip, s.chipOutline)} style={{ color: j.ok === false ? 'var(--text)' : 'var(--text-2)' }}>
                  {j.ok === false && <Dot size={6} />}
                  {j.ok === null ? '—' : j.ok ? 'OK' : 'Warning'}
                </span>
              </div>
            ))}
          </section>

          <section aria-labelledby="m-recent" className={s.panel} style={{ display: 'flex', flexDirection: 'column', padding: '14px 14px 6px' }}>
            <h2 id="m-recent" className={cx('lbl', s.lbl10)} style={{ marginBottom: 8 }}>
              // Recent admin actions
            </h2>
            {o.recent.slice(0, 3).map((a) => (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 0', borderTop: '1px solid var(--separator)' }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {a.action}
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {ago(a.at)}
                  </span>
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                  {a.staff} · <span style={{ color: 'var(--text)' }}>{a.targetLabel}</span> · <span className="mono">{a.change}</span>
                </span>
              </div>
            ))}
            <Link to="/admin/logs" style={{ display: 'flex', alignItems: 'center', minHeight: 44, borderTop: '1px solid var(--separator)', fontSize: 13, color: 'var(--text-2)' }}>
              Open the admin log
            </Link>
          </section>
        </>
      )}
    </AdminPage>
  );
}

export function Overview() {
  return useIsMobile() ? <Mobile /> : <Desktop />;
}
