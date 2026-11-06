import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { AdminPlayerRow } from '../../../../shared/api';
import { Select } from '../../components/ui/fields';
import { useDebounced } from '../../lib/useDebounced';
import { useIsMobile } from '../../lib/useMediaQuery';
import { AdminPage } from '../AdminApp';
import { ago, cr, num, rowsOf, useAdminAction, usePlayers, utcDay } from '../lib';
import { Avatar, Btn, CLOSE, EmptyBox, ErrorBox, Header, ListFooter, Logged, SEARCH, cx, s } from '../ui';

type Type = 'all' | 'account' | 'guest';
type Status = 'all' | 'active' | 'banned' | 'flagged';
type Joined = 'any' | '7' | '30';
type Sort = 'seen' | 'balance' | 'value' | 'joined';
type Dir = 'asc' | 'desc';

const GRID = '52px minmax(0, 1.7fr) 110px repeat(2, minmax(0, 1fr)) 90px 96px 110px 150px';

/** Filters in the URL (the back link of a player page keeps them). The mockup starts on "last 30 days". */
function useFilters(mobile: boolean) {
  const [params, setParams] = useSearchParams();
  const f = {
    q: params.get('q') ?? '',
    type: (params.get('type') ?? 'all') as Type,
    status: (params.get('status') ?? 'all') as Status,
    joined: (params.get('joined') ?? (mobile ? 'any' : '30')) as Joined,
    sort: (params.get('sort') ?? 'seen') as Sort,
    dir: (params.get('dir') ?? '') as Dir | '',
  };
  const set = (patch: Partial<typeof f>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, String(v));
    setParams(next, { replace: true });
  };
  // "Last seen" reads as most recent first (↑); the others start with the largest (↓).
  const dir: Dir = f.dir || (f.sort === 'seen' ? 'asc' : 'desc');
  // The API sorts the column's value: "seen ↑" (shortest time ago) is last_seen_at descending.
  const apiDir = f.sort === 'seen' ? (dir === 'asc' ? 'desc' : 'asc') : dir;
  const query = new URLSearchParams({ q: f.q, type: f.type, status: f.status, joined: f.joined, sort: f.sort, dir: apiDir }).toString();
  return { f, set, dir, query };
}

function TypeChip({ guest }: { guest: boolean }) {
  return <span className={cx('mono', s.statusChip, guest ? s.chipDashed : s.chipOutline)} style={guest ? { color: 'var(--text-2)' } : undefined}>{guest ? 'Guest' : 'Account'}</span>;
}

function StatusCell({ row }: { row: AdminPlayerRow }) {
  if (row.ban) return <span className={cx('mono', s.statusChip, s.chipBan)}>Banned · {row.ban}</span>;
  if (row.flagged)
    return (
      <span className={s.inline}>
        <span className={s.dot} aria-hidden="true" />
        Flagged
      </span>
    );
  if (row.online)
    return (
      <span className={s.inline}>
        <span className={s.whiteDot} aria-hidden="true" />
        Online
      </span>
    );
  return null;
}

/** Server cap of one bulk delete (guestsDeleteSchema). */
const MAX_SELECTED = 200;

/** The selection box: empty, dash (some) or check (all). */
function CheckBox({ state }: { state: 'none' | 'some' | 'all' }) {
  const on = state !== 'none';
  return (
    <span
      aria-hidden="true"
      style={{ width: 18, height: 18, borderRadius: 2, display: 'grid', placeItems: 'center', border: `1px solid ${on ? 'var(--text)' : 'var(--border-hover)'}`, background: on ? 'var(--text)' : 'transparent' }}
    >
      {on && (
        <svg width="12" height="12" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'var(--page)', strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
          <path d={state === 'all' ? 'M5 12.5l4.5 4.5L19 7.5' : 'M6 12h12'} />
        </svg>
      )}
    </span>
  );
}

const boxButton = { width: 44, height: 44, padding: 0, border: 0, background: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center' } as const;

function SkeletonTable() {
  return (
    <div className={s.tableWrap}>
      <div role="table" aria-label="Players" aria-busy="true" style={{ minWidth: 1100 }}>
        <div className={s.thead} style={{ gridTemplateColumns: GRID }} />
        {[180, 120, 150, 110, 170, 130, 160, 140].map((w, i) => (
          <div key={i} className={s.tr} style={{ gridTemplateColumns: GRID }}>
            <span />
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className={s.skel} style={{ width: 28, height: 28, borderRadius: '50%' }} />
              <span className={s.skel} style={{ width: w }} />
            </span>
            <span className={s.skel} style={{ width: 60 }} />
            <span className={s.skel} style={{ width: 70, justifySelf: 'end', marginRight: 12 }} />
            <span className={s.skel} style={{ width: 80, justifySelf: 'end', marginRight: 12 }} />
            <span className={s.skel} style={{ width: 30, justifySelf: 'end', marginRight: 12 }} />
            <span className={s.skel} style={{ width: 50, marginLeft: 12 }} />
            <span className={s.skel} style={{ width: 70, marginLeft: 12 }} />
            <span className={s.skel} style={{ width: 60, marginLeft: 12 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Desktop() {
  const { f, set, dir, query } = useFilters(false);
  const [text, setText] = useState(f.q);
  const debounced = useDebounced(text, 250);
  useEffect(() => {
    if (debounced !== f.q) set({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const list = usePlayers(query);
  const rows = rowsOf(list.data);
  const page = list.data?.pages[0];
  const [selected, setSelected] = useState<Map<string, AdminPlayerRow>>(new Map());
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const action = useAdminAction();
  useEffect(() => {
    setSelected(new Map());
    setConfirming(false);
  }, [query]);

  const chips: { label: string; clear: () => void }[] = [];
  if (f.type !== 'all') chips.push({ label: `Type: ${f.type === 'guest' ? 'Guests' : 'Accounts'}`, clear: () => set({ type: 'all' }) });
  if (f.status !== 'all') chips.push({ label: `Status: ${f.status === 'banned' ? 'Banned' : f.status === 'flagged' ? 'Flagged' : 'Active'}`, clear: () => set({ status: 'all' }) });
  if (f.joined !== 'any') chips.push({ label: `Joined: last ${f.joined} days`, clear: () => set({ joined: 'any' }) });
  if (f.q) chips.push({ label: `“${f.q}”`, clear: () => (setText(''), set({ q: '' })) });
  const clearFilters = () => {
    setText('');
    set({ q: '', type: 'all', status: 'all', joined: 'any' });
  };

  const sel = [...selected.values()];
  // "Select all" = the guest rows already loaded, up to the bulk delete cap.
  const selectable = rows.filter((r) => r.isGuest).slice(0, MAX_SELECTED);
  const allOn = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const headState = allOn ? 'all' : sel.length > 0 ? 'some' : 'none';
  const toggleAll = () => setSelected(allOn ? new Map() : new Map(selectable.map((r) => [r.id, r])));
  const guestsLoaded = rows.filter((r) => r.isGuest).length;
  const capHint = allOn && guestsLoaded > MAX_SELECTED ? `First ${MAX_SELECTED} only` : allOn && list.hasNextPage ? 'Only loaded rows · Show more to add the rest' : null;
  const deleteLabel = sel.length > 1 ? `Delete ${sel.length} guests` : 'Delete guest';
  const heads: [Sort | 'cases', string, 'flex-end' | 'flex-start'][] = [
    ['balance', 'Balance', 'flex-end'],
    ['value', 'Inventory value', 'flex-end'],
    ['cases', 'Cases', 'flex-end'],
    ['joined', 'Joined', 'flex-start'],
    ['seen', 'Last seen', 'flex-start'],
  ];
  const toggle = (row: AdminPlayerRow) =>
    setSelected((m) => {
      const next = new Map(m);
      if (next.has(row.id)) next.delete(row.id);
      else if (next.size < MAX_SELECTED) next.set(row.id, row);
      return next;
    });
  const deleteGuests = async () => {
    const message = await action.run('/admin/guests/delete', { ids: sel.map((g) => g.id), reason: reason.trim() });
    if (message) return setError(message);
    setSelected(new Map());
    setConfirming(false);
    setReason('');
    setError(null);
  };

  return (
    <AdminPage gap={20}>
      <Header
        label="Players"
        title="Players"
        subMono
        sub={page ? `${num(page.counts.all)} players · ${num(page.counts.accounts)} accounts · ${num(page.counts.guests)} guests. All times UTC.` : 'All times UTC.'}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <label className={s.filterSearch} style={{ flex: '1 1 280px', maxWidth: 380 }}>
          <span className="sr-only">Filter by name or Discord ID</span>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" className={s.searchIcon}>
            <path d={SEARCH} />
          </svg>
          <input type="search" className={s.field} value={text} onChange={(e) => setText(e.target.value)} placeholder="Name or Discord ID" />
        </label>
        <Select<Type> label="Type" value={f.type} onChange={(v) => set({ type: v })} options={[{ value: 'all', label: 'All' }, { value: 'account', label: 'Accounts' }, { value: 'guest', label: 'Guests' }]} />
        <Select<Status> label="Status" value={f.status} onChange={(v) => set({ status: v })} options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'flagged', label: 'Flagged' }, { value: 'banned', label: 'Banned' }]} />
        <Select<Joined> label="Joined" value={f.joined} onChange={(v) => set({ joined: v })} options={[{ value: 'any', label: 'Any time' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }]} />
        <div style={{ marginLeft: 'auto' }}>
          <Select<Sort>
            label="Sort"
            value={f.sort}
            onChange={(v) => set({ sort: v, dir: '' })}
            options={[{ value: 'seen', label: 'Last seen' }, { value: 'balance', label: 'Balance' }, { value: 'value', label: 'Inventory value' }, { value: 'joined', label: 'Joined' }]}
          />
        </div>
      </div>

      {chips.length > 0 && (
        <div className={s.chips}>
          {chips.map((c) => (
            <button key={c.label} type="button" className={s.removable} aria-label={`Remove filter ${c.label}`} onClick={c.clear}>
              {c.label}
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24">
                <path d={CLOSE} />
              </svg>
            </button>
          ))}
          <button type="button" className={cx(s.btn, s.link)} style={{ height: 32 }} onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}

      {sel.length > 0 && (
        <div role="region" aria-label="Selection" className={s.selBar}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{sel.length > 1 ? `${sel.length} guests selected` : '1 guest selected'}</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
            holding {cr(sel.reduce((n, g) => n + g.balance, 0))} and {num(sel.reduce((n, g) => n + g.casesOpened, 0))} opened cases
          </span>
          {capHint && (
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {capHint}
            </span>
          )}
          <span style={{ flex: '1 1 0' }} />
          {!confirming ? (
            <>
              <Btn variant="quiet" onClick={() => setSelected(new Map())}>
                Clear
              </Btn>
              <Btn variant="danger" min="admin" onClick={() => (setConfirming(true), setReason(''), setError(null))}>
                {deleteLabel}
              </Btn>
            </>
          ) : (
            <>
              <label className={s.reasonInline}>
                <span>Reason</span>
                <input className={s.field} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, shown in the admin log" />
              </label>
              <Btn variant="quiet" onClick={() => setConfirming(false)}>
                Cancel
              </Btn>
              <Btn variant="danger" min="admin" onClick={() => void deleteGuests()} disabled={!reason.trim() || action.busy}>
                {deleteLabel} for good
              </Btn>
              <Logged />
              {error && (
                <span role="alert" className={s.alertText} style={{ flexBasis: '100%' }}>
                  {error}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {list.isError ? (
        <ErrorBox title="Couldn’t load the players" error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyBox action={{ label: 'Clear filters', onClick: clearFilters }}>No players match these filters.</EmptyBox>
      ) : (
        <>
          <div className={s.tableWrap}>
            <div role="table" aria-label="Players" style={{ minWidth: 1100, display: 'flex', flexDirection: 'column' }}>
              <div role="row" className={s.thead} style={{ gridTemplateColumns: GRID }}>
                <span role="columnheader" style={{ display: 'grid', placeItems: 'center' }}>
                  {selectable.length > 0 ? (
                    <button type="button" aria-pressed={headState === 'all' ? true : headState === 'some' ? 'mixed' : false} aria-label="Select all guests" title="Select all guests" onClick={toggleAll} style={boxButton}>
                      <CheckBox state={headState} />
                    </button>
                  ) : (
                    <span className="sr-only">Select</span>
                  )}
                </span>
                <span role="columnheader" className={cx('lbl', s.th)}>
                  Player
                </span>
                <span role="columnheader" className={cx('lbl', s.th)}>
                  Type
                </span>
                {heads.map(([key, label, justify]) => {
                  const on = f.sort === key;
                  return (
                    <span key={key} role="columnheader" aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} style={{ display: 'flex', justifyContent: justify, padding: '0 12px' }}>
                      {key === 'cases' ? (
                        <span className={cx('lbl', s.th)} style={{ height: 36, display: 'inline-flex', alignItems: 'center' }}>
                          {label}
                        </span>
                      ) : (
                        <button type="button" className={cx('lbl', s.sortBtn)} data-on={on || undefined} onClick={() => set(on ? { dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: '' })}>
                          {label}
                          <span aria-hidden="true">{on ? (dir === 'asc' ? '↑' : '↓') : ''}</span>
                        </button>
                      )}
                    </span>
                  );
                })}
                <span role="columnheader" className={cx('lbl', s.th)} style={{ paddingLeft: 12 }}>
                  Status
                </span>
              </div>
              {rows.map((r) => {
                const on = selected.has(r.id);
                return (
                  <div key={r.id} role="row" className={s.tr} data-selected={on || undefined} style={{ gridTemplateColumns: GRID }}>
                    <span role="cell" className={s.above} style={{ display: 'grid', placeItems: 'center' }}>
                      {r.isGuest && (
                        <button type="button" aria-pressed={on} aria-label={`Select ${r.label}`} onClick={() => toggle(r)} style={boxButton}>
                          <CheckBox state={on ? 'all' : 'none'} />
                        </button>
                      )}
                    </span>
                    <span role="cell" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <Avatar label={r.label} url={r.avatarUrl} size={28} guest={r.isGuest} fontSize={12} />
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Link to={`/admin/players/${r.id}`} className={cx(s.stretch, s.ellipsis)} style={{ fontSize: 14, fontWeight: 600 }}>
                          {r.label}
                        </Link>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          {r.discordId ?? 'guest · no Discord'}
                        </span>
                      </span>
                    </span>
                    <span role="cell">
                      <TypeChip guest={r.isGuest} />
                    </span>
                    <span role="cell" className={cx('mono', s.cellRight)} style={{ fontSize: 13 }}>
                      {cr(r.balance)}
                    </span>
                    <span role="cell" className={cx('mono', s.cellRight)} style={{ fontSize: 13 }}>
                      {cr(r.inventoryValue)}
                    </span>
                    <span role="cell" className={cx('mono', s.cellRight)} style={{ fontSize: 13 }}>
                      {num(r.casesOpened)}
                    </span>
                    <span role="cell" className={cx('mono', s.cell)} style={{ fontSize: 12, color: 'var(--text-2)' }}>
                      {utcDay(r.joinedAt)}
                    </span>
                    <span role="cell" className={s.cell} style={{ fontSize: 13, color: 'var(--text-2)' }}>
                      {ago(r.lastSeenAt)}
                    </span>
                    <span role="cell" className={s.cell}>
                      <StatusCell row={r} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <ListFooter text={`1–${num(rows.length)} of ${num(page?.total ?? rows.length)}`} more={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
        </>
      )}
    </AdminPage>
  );
}

const MOBILE_CHIPS: { key: string; label: string; patch: { type: Type; status: Status }; count: (c: NonNullable<ReturnType<typeof countsOf>>) => number }[] = [
  { key: 'all', label: 'All', patch: { type: 'all', status: 'all' }, count: (c) => c.all },
  { key: 'account', label: 'Accounts', patch: { type: 'account', status: 'all' }, count: (c) => c.accounts },
  { key: 'guest', label: 'Guests', patch: { type: 'guest', status: 'all' }, count: (c) => c.guests },
  { key: 'flagged', label: 'Flagged', patch: { type: 'all', status: 'flagged' }, count: (c) => c.flagged },
  { key: 'banned', label: 'Banned', patch: { type: 'all', status: 'banned' }, count: (c) => c.banned },
];

const countsOf = (page: { counts: { all: number; accounts: number; guests: number; flagged: number; banned: number } } | undefined) => page?.counts;

function Mobile() {
  const { f, set, query } = useFilters(true);
  const [text, setText] = useState(f.q);
  const debounced = useDebounced(text, 250);
  useEffect(() => {
    if (debounced !== f.q) set({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const list = usePlayers(query);
  const rows = rowsOf(list.data);
  const counts = countsOf(list.data?.pages[0]);
  const activeChip = f.status === 'flagged' ? 'flagged' : f.status === 'banned' ? 'banned' : f.type === 'all' ? 'all' : f.type;
  return (
    <AdminPage gap={20}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className={cx('lbl', s.lbl10)}>// Players</span>
        <h1 className={s.mTitle}>Players</h1>
        {counts && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {num(counts.all)} · {num(counts.accounts)} accounts · {num(counts.guests)} guests
          </span>
        )}
      </div>
      <label className={s.filterSearch}>
        <span className="sr-only">Search players</span>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" className={s.searchIcon} style={{ left: 12 }}>
          <path d={SEARCH} />
        </svg>
        <input type="search" className={s.field} style={{ paddingLeft: 36, fontSize: 16 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Name or Discord ID" />
      </label>
      <div role="group" aria-label="Filter" className={s.hscroll}>
        {MOBILE_CHIPS.map((c) => (
          <button key={c.key} type="button" aria-pressed={activeChip === c.key} className={s.toggle} style={{ height: 36, padding: '0 12px', flex: 'none' }} onClick={() => set(c.patch)}>
            {c.label} <span className={cx('mono', s.count)}>{counts ? num(c.count(counts)) : ''}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {list.isPending ? 'Loading…' : `${num(rows.length)} shown`}
        </span>
        <Select<Sort>
          variant="inline"
          prefix="Sort"
          ariaLabel="Sort"
          value={f.sort}
          onChange={(v) => set({ sort: v, dir: '' })}
          options={[{ value: 'seen', label: 'Last seen' }, { value: 'balance', label: 'Balance' }, { value: 'value', label: 'Inventory value' }, { value: 'joined', label: 'Joined' }]}
        />
      </div>
      {list.isError ? (
        <ErrorBox title="Couldn’t load the players" error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div aria-busy="true" aria-label="Loading players" className={s.mList} style={{ marginTop: -8 }}>
          {['60%', '45%', '55%', '40%', '65%', '50%', '58%', '42%'].map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 64, padding: '0 16px', borderBottom: '1px solid var(--separator)' }}>
              <span className={s.skel} style={{ width: 36, height: 36, borderRadius: '50%' }} />
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className={s.skel} style={{ width: w }} />
                <span className={s.skel} style={{ width: '70%', height: 10 }} />
              </span>
              <span className={s.skel} style={{ width: 56, height: 22 }} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyBox action={{ label: 'Clear search', onClick: () => (setText(''), set({ q: '', type: 'all', status: 'all' })) }}>
          {f.q ? `No player matches “${f.q}”.` : 'No players match these filters.'}
        </EmptyBox>
      ) : (
        <>
          <div className={s.mList} style={{ marginTop: -8 }}>
            {rows.map((r) => (
              <Link key={r.id} to={`/admin/players/${r.id}`} className={s.mListRow}>
                <Avatar label={r.label} url={r.avatarUrl} size={36} guest={r.isGuest} fontSize={13} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 500 }}>
                    {r.label}
                    {r.online && (
                      <>
                        <span className={s.whiteDot} aria-hidden="true" />
                        <span className="sr-only">online</span>
                      </>
                    )}
                  </span>
                  <span className={cx('mono', s.ellipsis)} style={{ fontSize: 11, color: 'var(--text-2)' }}>
                    {cr(r.balance)} · inv {cr(r.inventoryValue)} · {ago(r.lastSeenAt)}
                  </span>
                </span>
                {r.ban ? (
                  <span className={cx('mono', s.statusChip, s.chipBan)} style={{ fontSize: 10 }}>
                    Banned · {r.ban}
                  </span>
                ) : r.flagged ? (
                  <span className={cx('mono', s.statusChip, s.chipOutline)} style={{ fontSize: 10 }}>
                    <span className={s.dot} aria-hidden="true" style={{ width: 6, height: 6 }} />
                    Flagged
                  </span>
                ) : (
                  <TypeChip guest={r.isGuest} />
                )}
              </Link>
            ))}
          </div>
          {list.hasNextPage && (
            <Btn size={44} onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              Show more
            </Btn>
          )}
        </>
      )}
    </AdminPage>
  );
}

export function Players() {
  return useIsMobile() ? <Mobile /> : <Desktop />;
}
