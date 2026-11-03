import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { AdminLogEntry } from '../../../../shared/api';
import { Select } from '../../components/ui/fields';
import { useDebounced } from '../../lib/useDebounced';
import { AdminPage } from '../AdminApp';
import { num, rowsOf, useAdminLog, useStaff, utcStamp } from '../lib';
import { ErrorsTab, JobsTab, LedgerTab } from './LogsTabs';
import { CLOSE, EmptyBox, ErrorBox, Header, ListFooter, SEARCH, cx, s } from '../ui';

const GRID = '36px 120px 90px 150px 150px 170px minmax(0, 1fr)';

const ACTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Any action' },
  { value: 'credits.', label: 'credits.*' },
  { value: 'item.', label: 'item.*' },
  { value: 'player.,guests.', label: 'player.*' },
  { value: 'case.,catalog.', label: 'case.* and catalog.*' },
  { value: 'economy.', label: 'economy.*' },
  { value: 'auction.,offer.', label: 'auction.* and offer.*' },
  { value: 'job.,staff.', label: 'job.* and staff.*' },
];

type Range = '7d' | 'today' | '30d' | 'all';
const RANGES: { value: Range; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: 'today', label: 'Today' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

/** "balance   9,870 CR" lines, keys aligned. */
function lines(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined);
  if (!entries.length) return '—';
  const width = Math.max(...entries.map(([k]) => k.length));
  return entries.map(([k, v]) => `${k.padEnd(width)}   ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
}

function meta(e: AdminLogEntry): string {
  const d = e.details ?? {};
  const parts: string[] = [];
  const ledger = Array.isArray(d.ledger) ? (d.ledger as number[]) : [];
  if (ledger.length === 1) parts.push(`ledger #${ledger[0]}`);
  else if (ledger.length > 1) parts.push(`ledger #${Math.min(...ledger)}–${Math.max(...ledger)}`);
  if (typeof d.request === 'string') parts.push(`request ${d.request.slice(0, 6)}`);
  if (typeof d.dryRunAt === 'string') parts.push(`dry run ${utcStamp(d.dryRunAt)}`);
  return parts.join(' · ');
}

function Row({ e, open, toggle }: { e: AdminLogEntry; open: boolean; toggle: () => void }) {
  const sees = typeof e.details?.sees === 'string' ? (e.details.sees as string) : null;
  return (
    <div role="rowgroup" style={{ borderBottom: '1px solid var(--separator)', background: open ? 'var(--surface-raised)' : undefined }}>
      <div role="row" className={s.tr} style={{ gridTemplateColumns: GRID, padding: '0 18px 0 8px', borderBottom: 0 }}>
        <span role="cell">
          <button type="button" className={s.stretch} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} before and after for ${e.action} on ${e.targetLabel}`} onClick={toggle} style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', color: 'var(--text-2)' }}>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform var(--dur-fast) ease' }}>
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </span>
        <span role="cell" className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {utcStamp(e.at)}
        </span>
        <span role="cell">{e.staff}</span>
        <span role="cell" className="mono" style={{ fontSize: 13 }}>
          {e.action}
        </span>
        <span role="cell" className={s.ellipsis}>
          {e.to ? (
            <Link to={e.to} className={s.above} style={{ color: 'var(--text)' }}>
              {e.targetLabel}
            </Link>
          ) : (
            e.targetLabel
          )}
        </span>
        <span role="cell" className={cx('mono', s.ellipsis)} style={{ fontSize: 13 }}>
          {e.change}
        </span>
        <span role="cell" className={s.ellipsis} style={{ color: 'var(--text-2)' }}>
          {e.reason}
        </span>
      </div>
      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '4px 18px 18px 44px' }}>
          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className={cx('lbl', s.lbl10)}>Before</span>
            <pre className="mono" style={{ margin: 0, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--page)', fontSize: 12, lineHeight: 1.7, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
              {lines(e.before)}
            </pre>
          </div>
          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className={cx('lbl', s.lbl10)}>After</span>
            <pre className="mono" style={{ margin: 0, padding: '12px 14px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-card)', background: 'var(--page)', fontSize: 12, lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
              {lines(e.after)}
            </pre>
          </div>
          <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text-2)' }}>
            <span className={cx('lbl', s.lbl10)}>Details</span>
            <span>{e.reason}</span>
            {sees && (
              <span>
                {e.targetLabel} sees: “{sees}”
              </span>
            )}
            <span className="mono" style={{ fontSize: 12 }}>
              {meta(e)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

type LogsTab = 'log' | 'ledger' | 'jobs' | 'errors';
const LOG_TABS: [LogsTab, string][] = [
  ['log', 'Admin log'],
  ['ledger', 'Ledger'],
  ['jobs', 'Jobs'],
  ['errors', 'Errors'],
];

export function Logs() {
  const staff = useStaff();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: LogsTab = raw === 'ledger' || raw === 'jobs' || raw === 'errors' ? raw : 'log';
  return (
    <AdminPage gap={24}>
      <Header label="Logs & tools" title="Logs & tools" sub="Every staff action with who, why and what changed. Entries can't be edited or deleted. All times UTC." />
      <div role="tablist" aria-label="Logs and tools" className={s.tabs} style={{ gap: '4px 28px' }}>
        {LOG_TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={s.tab} onClick={() => setParams(key === 'log' ? {} : { tab: key }, { replace: true })}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'log' && <AdminLogTab />}
      {tab === 'ledger' && <LedgerTab />}
      {tab === 'jobs' && <JobsTab canRun={staff.can('admin')} />}
      {tab === 'errors' && <ErrorsTab />}
    </AdminPage>
  );
}

function AdminLogTab() {
  const [text, setText] = useState('');
  const target = useDebounced(text.trim(), 250);
  const [staffFilter, setStaffFilter] = useState('all');
  const [action, setAction] = useState('all');
  const [range, setRange] = useState<Range>('7d');
  const [openId, setOpenId] = useState<number | null>(null);
  const params = new URLSearchParams({ range, ...(target ? { target } : {}), ...(staffFilter !== 'all' ? { staff: staffFilter } : {}), ...(action !== 'all' ? { action } : {}) });
  const query = params.toString();
  const list = useAdminLog(query);
  const rows = rowsOf(list.data);
  const page = list.data?.pages[0];
  const first = rows[0]?.id ?? null;
  useEffect(() => setOpenId(first), [query, first]);
  const filtered = Boolean(target) || staffFilter !== 'all' || action !== 'all';
  const clearAll = () => {
    setText('');
    setStaffFilter('all');
    setAction('all');
  };
  const chips = [
    ...(staffFilter !== 'all' ? [{ label: `Staff: ${staffFilter}`, aria: `Remove filter Staff: ${staffFilter}`, clear: () => setStaffFilter('all') }] : []),
    ...(action !== 'all' ? [{ label: `Action: ${ACTIONS.find((a) => a.value === action)?.label}`, aria: 'Remove the action filter', clear: () => setAction('all') }] : []),
    ...(target ? [{ label: `Target: ${target}`, aria: `Remove filter Target: ${target}`, clear: () => setText('') }] : []),
  ];
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative', flex: '0 1 300px' }}>
            <label htmlFor="log-target" className="sr-only">
              Target
            </label>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" className={s.searchIcon}>
              <path d={SEARCH} />
            </svg>
            <input id="log-target" className={s.field} style={{ width: '100%', padding: '0 40px', background: 'var(--surface)' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Target: player, item ID, case" />
            {text && (
              <button type="button" aria-label="Clear target" className={s.close} style={{ position: 'absolute', right: 0, top: 0, margin: 0, color: 'var(--text-2)' }} onClick={() => setText('')}>
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24">
                  <path d={CLOSE} />
                </svg>
              </button>
            )}
          </div>
          <Select<string> ariaLabel="Staff" size={44} value={staffFilter} onChange={setStaffFilter} options={[{ value: 'all', label: 'Any staff' }, ...(page?.staff ?? []).map((n) => ({ value: n, label: n }))]} />
          <Select<string> ariaLabel="Action type" size={44} value={action} onChange={setAction} options={ACTIONS} />
          <Select<Range> ariaLabel="Date" size={44} value={range} onChange={setRange} options={RANGES} />
          <a href={`/api/admin/log.csv?${query}`} className={cx(s.btn, s.h44)} style={{ marginLeft: 'auto' }} download>
            Export CSV
          </a>
        </div>
        {chips.length > 0 && (
          <div className={s.chips}>
            {chips.map((c) => (
              <button key={c.label} type="button" className={s.removable} aria-label={c.aria} onClick={c.clear}>
                {c.label}
                <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24">
                  <path d={CLOSE} />
                </svg>
              </button>
            ))}
            <button type="button" className={cx(s.btn, s.link)} style={{ height: 32 }} onClick={clearAll}>
              Clear filters
            </button>
          </div>
        )}
        {list.isError ? (
          <ErrorBox title="Couldn't load the admin log" error={list.error} onRetry={() => void list.refetch()} />
        ) : list.isPending ? (
          <div aria-busy="true" aria-label="Loading the admin log" className={s.panel}>
            <div style={{ height: 44, borderBottom: '1px solid var(--border)', background: 'var(--rail)' }} />
            {[180, 120, 150, 110, 170, 130].map((w, i) => (
              <div key={i} className={s.skelRow}>
                <span className={s.skel} style={{ width: 96 }} />
                <span className={s.skel} style={{ width: 60 }} />
                <span className={s.skel} style={{ width: 110 }} />
                <span className={s.skel} style={{ width: w }} />
              </div>
            ))}
          </div>
        ) : (
          <div className={s.tableWrap}>
            <div role="table" aria-label="Admin log" style={{ minWidth: 1020 }}>
              <div role="row" className={s.thead} style={{ gridTemplateColumns: GRID, padding: '0 18px 0 8px' }}>
                <span role="columnheader">
                  <span className="sr-only">Expand</span>
                </span>
                {['Time ↓', 'Staff', 'Action', 'Target', 'Change', 'Reason'].map((h) => (
                  <span key={h} role="columnheader" className={cx('lbl', s.th)}>
                    {h}
                  </span>
                ))}
              </div>
              {rows.map((e) => (
                <Row key={e.id} e={e} open={openId === e.id} toggle={() => setOpenId(openId === e.id ? null : e.id)} />
              ))}
              {rows.length === 0 && (
                <div style={{ margin: 18 }}>
                  {filtered ? (
                    <EmptyBox action={{ label: 'Clear filters', onClick: clearAll }}>No staff action matches these filters.</EmptyBox>
                  ) : (
                    <EmptyBox>No staff action in this period yet.</EmptyBox>
                  )}
                </div>
              )}
            </div>
            {rows.length > 0 && (
              <div style={{ padding: '12px 18px' }}>
                <ListFooter
                  text={filtered ? `${num(page?.total ?? rows.length)} matching entries` : `1–${num(rows.length)} of ${num(page?.total ?? rows.length)} entries · kept forever`}
                  more={Boolean(list.hasNextPage)}
                  loading={list.isFetchingNextPage}
                  onMore={() => void list.fetchNextPage()}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

