import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { AdminItemDetail, DiffRow, MovePreview, Tier } from '../../../../shared/api';
import { Select } from '../../components/ui/fields';
import { RARITY, TIER_ORDER } from '../../lib/rarity';
import { useDebounced } from '../../lib/useDebounced';
import { useIsMobile } from '../../lib/useMediaQuery';
import { AdminPage } from '../AdminApp';
import { cr, num, rowsOf, useAdminAction, useItem, useItems, usePreview, useStaff, utcDateTime, utcDay } from '../lib';
import { Btn, Chip, Corners, DiffBox, Drawer, EmptyBox, FloatBar, Header, ListFooter, LockIcon, Logged, ReasonField, SEARCH, cx, s } from '../ui';

type Status = 'any' | 'available' | 'listed' | 'in_trade' | 'destroyed' | 'stuck';
const STATUS_LABEL: Record<Exclude<Status, 'any' | 'stuck'>, string> = { available: 'Available', listed: 'Listed', in_trade: 'In trade', destroyed: 'Destroyed' };
const WEAR_NAME = { FN: 'Factory New', MW: 'Minimal Wear', FT: 'Field-Tested', WW: 'Well-Worn', BS: 'Battle-Scarred' } as const;
const GRID = '116px minmax(0, 1fr) 132px 56px 110px 170px 84px';

function StatusChip({ status }: { status: AdminItemDetail['status'] }) {
  const text = STATUS_LABEL[status];
  if (status === 'available') return <Chip style="outline">{text}</Chip>;
  if (status === 'destroyed') return <Chip style="dashed">{text}</Chip>;
  return (
    <Chip style="bare" icon={<LockIcon size={10} />}>
      {text}
    </Chip>
  );
}

// ── Drawer ──────────────────────────────────────────────────────────────────

type Fix = 'unlock' | 'restore' | 'move' | 'showcase';

function ItemDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const staff = useStaff();
  const q = useItem(id);
  const d = q.data;
  const [fix, setFix] = useState<Fix | null>(null);
  const [reason, setReason] = useState('');
  const [to, setTo] = useState('');
  const [claw, setClaw] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const action = useAdminAction();
  const target = useDebounced(to.trim(), 250);
  const move = usePreview<MovePreview>(fix === 'move' && target ? `/admin/items/${id}/move/preview` : null, { to: target });
  useEffect(() => {
    setFix(null);
    setError(null);
  }, [id]);
  const ask = (k: Fix) => () => {
    setFix(k);
    setReason('');
    setError(null);
    setTo('');
    setClaw(!d?.restore?.clawback?.blocked);
  };

  if (!d) {
    return (
      <Drawer label="// Item" onClose={onClose}>
        {q.isError ? (
          <EmptyBox action={{ label: 'Retry', onClick: () => void q.refetch() }}>{q.error.message}</EmptyBox>
        ) : (
          <>
            <span className={s.skel} style={{ width: '100%', height: 210 }} />
            <span className={s.skel} style={{ width: 220, height: 28 }} />
            <span className={s.skel} style={{ width: '100%', height: 120 }} />
          </>
        )}
      </Drawer>
    );
  }

  const name = d.name;
  const owner = d.owner?.label ?? '—';
  const destroyed = d.status === 'destroyed';
  const statusText = destroyed ? 'Destroyed' : STATUS_LABEL[d.status];
  const targetLabel = move.data?.target?.label ?? (to.trim() || '…');
  const confirm: { title: string; diff: DiffRow[]; note: string; button: string } | null =
    fix === 'unlock'
      ? { title: `Unlock ${name}`, diff: [{ label: 'Status', before: statusText, after: 'Available' }, { label: 'Owner', before: `${owner} (unchanged)`, after: `${owner} (unchanged)` }], note: 'No live listing or offer holds it, so nothing else changes.', button: 'Unlock item' }
      : fix === 'restore' && d.restore
        ? { title: `Restore ${name} to ${d.restore.owner}`, diff: [{ label: 'Status', before: 'Destroyed', after: 'Available' }, { label: 'Owner', before: '—', after: d.restore.owner }], note: `${d.restore.owner} was the last owner. The item keeps its ID, float and pattern.`, button: `Restore to ${d.restore.owner}` }
        : fix === 'move'
          ? {
              title: `Move ${name} to ${targetLabel}`,
              diff: [
                { label: 'Owner', before: owner, after: targetLabel },
                d.status === 'listed' || d.status === 'in_trade' ? { label: 'Status', before: statusText, after: 'Available' } : { label: 'Status', before: `${statusText} (unchanged)`, after: `${statusText} (unchanged)` },
              ],
              note: d.listing
                ? d.listing.bid
                  ? `Its listing is cancelled first and the leading bid (${cr(d.listing.bid)}, ${d.listing.leader}) is refunded.`
                  : 'Its listing is cancelled first.'
                : d.offer
                  ? `Offer #${d.offer.number} is cancelled first: its items and credits go back to the sender.`
                  : d.status === 'in_trade'
                    ? 'No live offer holds it, so no offer is cancelled.'
                    : '',
              button: `Move to ${targetLabel}`,
            }
          : fix === 'showcase'
            ? { title: `Remove ${name} from ${owner}’s showcase`, diff: [{ label: 'Showcase', before: 'shown', after: 'hidden' }, { label: 'Inventory', before: 'unchanged', after: 'unchanged' }], note: 'The player can’t put it back for 24 h.', button: 'Remove from showcase' }
            : null;

  const run = async () => {
    const path = `/admin/items/${id}/${fix === 'showcase' ? 'showcase-remove' : fix}`;
    const body = fix === 'restore' ? { clawback: Boolean(d.restore?.clawback) && claw, reason: reason.trim() } : fix === 'move' ? { to: target, reason: reason.trim() } : { reason: reason.trim() };
    const message = await action.run(path, body);
    if (message) setError(message);
    else setFix(null);
  };
  const clawBlocked = d.restore?.clawback?.blocked ?? null;
  const cantGo = !reason.trim() || action.busy || (fix === 'move' && !move.data?.target) || (fix === 'restore' && claw && Boolean(clawBlocked));
  const roleHint = staff.role === 'viewer' ? 'Read-only: you’re a Viewer. Unlock, Restore and Move to player: Admins only. Remove from showcase: Moderators and admins.' : staff.role === 'moderator' ? 'Unlock, Restore and Move to player: Admins only.' : '';

  return (
    <Drawer
      label={
        <>
          // Item{' '}
          <span className="mono" style={{ color: 'var(--text)', letterSpacing: '0.04em' }}>
            {d.serial}
          </span>
        </>
      }
      onClose={onClose}
      footer={
        confirm ? (
          <div role="group" aria-label={confirm.title} className={s.stacked}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{confirm.title}</span>
            {fix === 'move' && (
              <label className={s.fieldLabel}>
                <span>Move to</span>
                <input className={s.field} autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="Username or Discord ID" aria-invalid={Boolean(move.data?.error)} />
                {move.data?.error && target && <span className={s.alertText} style={{ fontSize: 13 }}>{move.data.error}</span>}
              </label>
            )}
            <DiffBox rows={confirm.diff} />
            {confirm.note && <span className={s.note}>{confirm.note}</span>}
            {fix === 'restore' && d.restore?.clawback && (
              <label style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, minHeight: 44, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={claw} onChange={(e) => setClaw(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--text)' }} />
                Also take back the {cr(d.restore.clawback.amount)} {d.restore.owner} got for recycling it{' '}
                <span className="mono" style={{ color: 'var(--text-2)' }}>
                  {num(d.restore.clawback.before)} → {num(d.restore.clawback.after)} CR
                </span>
              </label>
            )}
            {fix === 'restore' && claw && clawBlocked && <span className={s.alertText} style={{ fontSize: 13 }}>{clawBlocked}</span>}
            <ReasonField value={reason} onChange={setReason} placeholder="e.g. support ticket #58" />
            {error && (
              <span role="alert" className={s.alertText}>
                {error}
              </span>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn size={44} onClick={() => setFix(null)}>
                Cancel
              </Btn>
              <Btn size={44} variant="primary" min={fix === 'showcase' ? 'moderator' : 'admin'} onClick={() => void run()} disabled={cantGo}>
                {confirm.button}
              </Btn>
            </div>
            <Logged />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {d.stuck && (
                <Btn size={44} variant="primary" min="admin" onClick={ask('unlock')}>
                  Unlock
                </Btn>
              )}
              {destroyed && (
                <Btn size={44} variant="primary" min="admin" blocked={d.restore?.blocked} onClick={ask('restore')}>
                  Restore
                </Btn>
              )}
              <Btn size={44} min="admin" blocked={destroyed ? 'Restore it first' : null} onClick={ask('move')}>
                Move to player
              </Btn>
              <Btn size={44} min="moderator" blocked={d.inShowcase ? null : 'Not in a showcase'} onClick={ask('showcase')}>
                Remove from showcase
              </Btn>
            </div>
            {roleHint && <span className={cx('mono', s.hint)}>{roleHint}</span>}
            {destroyed && d.restore?.blocked && <span className={s.note}>{d.restore.blocked}</span>}
          </div>
        )
      }
    >
      <div className={s.stage} style={{ height: 210 }}>
        <span aria-hidden="true" className={s.halo} style={{ background: `radial-gradient(closest-side, ${RARITY[d.tier].halo}, transparent)`, opacity: destroyed ? 0.35 : 1 }} />
        <Corners />
        <img src={d.imageUrl} alt={name} style={{ position: 'relative', width: '64%', maxHeight: 150, objectFit: 'contain', opacity: destroyed ? 0.35 : 1 }} />
        <span aria-hidden="true" className={s.rarityBar} style={{ background: RARITY[d.tier].color }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {d.weaponName} · <span style={{ color: RARITY[d.tier].text }}>{RARITY[d.tier].name}</span>
        </span>
        <h2 style={{ fontSize: 28, lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.01em' }}>{d.finishName ?? 'Vanilla'}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <span className={cx('mono', s.statusChip, s.chipOutline)} style={{ height: 26 }}>
            {d.wear ? WEAR_NAME[d.wear] : 'Vanilla'}
          </span>
          {d.stattrak && (
            <span className={cx('mono', s.statusChip, s.chipSolid)} style={{ height: 26, fontWeight: 600 }}>
              StatTrak™
            </span>
          )}
          <span className={cx('mono', s.statusChip, s.chipOutline)} style={{ height: 26, color: 'var(--text-2)' }}>
            Pattern {d.pattern}
          </span>
        </div>
        {d.float !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            <FloatBar float={d.float} />
            <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-2)' }}>
              <span>Float</span>
              <span className="mono" style={{ color: 'var(--text)' }}>
                {d.float.toFixed(9)}
              </span>
            </span>
          </div>
        )}
      </div>
      {d.stuckNote && (
        <div role="note" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-card)', background: 'var(--surface-bar)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
            <span className={s.dot} aria-hidden="true" />
            Stuck in “{statusText}”
          </span>
          <span className={s.note}>{d.stuckNote}</span>
        </div>
      )}
      <dl className={s.facts}>
        {(
          [
            ['ID', d.serial, true],
            ['Origin case', d.grantedBy ? `Granted by ${d.grantedBy}` : (d.originCase ?? '—'), false],
            ['Original owner', d.originalOwner?.label ?? '—', false],
            ['Current owner', destroyed ? '— (destroyed)' : owner, false],
            ['Status', `${statusText}${d.stuck ? ' · stuck' : ''}`, false],
            ['Obtained', utcDateTime(d.obtainedAt), true],
            ['Market value', cr(d.value), true],
            ['Recycle value', cr(d.recycleValue), true],
          ] as [string, string, boolean][]
        ).map(([k, v, mono]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={mono ? 'mono' : undefined} style={k === 'Status' && destroyed ? { color: 'var(--text-3)' } : undefined}>
              {k === 'Current owner' && d.owner && !destroyed ? (
                <Link to={`/admin/players/${d.owner.id}`} style={{ color: 'var(--text)' }}>
                  {v}
                </Link>
              ) : k === 'Original owner' && d.originalOwner ? (
                <Link to={`/admin/players/${d.originalOwner.id}`} style={{ color: 'var(--text)' }}>
                  {v}
                </Link>
              ) : (
                v
              )}
            </dd>
          </div>
        ))}
      </dl>
      <section aria-label="Timeline" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 className="lbl">// Timeline</h3>
        <ol className={s.timeline}>
          {d.timeline.map((t, i) => (
            <li key={i}>
              <span aria-hidden="true" className={s.tlMark}>
                {i < d.timeline.length - 1 && <span className={s.tlLine} />}
                <span className={s.tlDot} data-kind={t.kind} />
              </span>
              <span className={s.tlText}>
                {t.to ? (
                  <Link to={t.to} style={t.kind === 'alert' ? { fontWeight: 600 } : undefined}>
                    {t.text}
                  </Link>
                ) : (
                  <span style={t.kind === 'alert' ? { fontWeight: 600 } : undefined}>{t.text}</span>
                )}
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {t.when ?? utcDateTime(t.at)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </Drawer>
  );
}

// ── List ────────────────────────────────────────────────────────────────────

export function Items() {
  const mobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const tiers = (params.get('tiers') ?? '').split(',').filter(Boolean) as Tier[];
  const status = (params.get('status') ?? 'any') as Status;
  const stOnly = params.get('stattrak') === 'true';
  const open = params.get('item');
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text.trim(), 250);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if ((params.get('q') ?? '') !== q) set({ q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const query = new URLSearchParams({ q, tiers: tiers.join(','), status, ...(stOnly ? { stattrak: 'true' } : {}) }).toString();
  const list = useItems(query);
  const rows = rowsOf(list.data);
  const page = list.data?.pages[0];
  const hasFilters = tiers.length > 0 || status !== 'any' || stOnly || Boolean(q);
  const clearAll = () => {
    setText('');
    set({ q: null, tiers: null, status: null, stattrak: null });
  };
  const idSearch = /^\d+$/.test(q);

  return (
    <AdminPage gap={24}>
      <Header
        label="Items"
        title="Items"
        sub={`Look up any item by ID, follow its history and fix its status.${page ? ` ${num(page.counts.all)} items, ${num(page.counts.destroyedWeek)} destroyed this week.` : ''} All times UTC.`}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ position: 'relative', maxWidth: 760 }}>
          <label htmlFor="item-q" className="sr-only">
            Item ID or skin name
          </label>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" className={s.searchIcon} style={{ left: 18, top: 16 }}>
            <path d={SEARCH} />
          </svg>
          <input id="item-q" className={cx('mono', s.field)} style={{ width: '100%', height: 52, padding: '0 52px 0 50px', fontSize: 16, background: 'var(--surface)' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Item ID or skin name" />
          {text && (
            <button type="button" aria-label="Clear search" className={s.close} style={{ position: 'absolute', right: 4, top: 4, margin: 0, color: 'var(--text-2)' }} onClick={() => setText('')}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <div role="group" aria-label="Rarity" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {TIER_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tiers.includes(t)}
                className={cx(s.toggle, s.toggleRarity)}
                onClick={() => set({ tiers: (tiers.includes(t) ? tiers.filter((x) => x !== t) : [...tiers, t]).join(',') })}
              >
                <span aria-hidden="true" className={s.square} style={{ background: RARITY[t].color }} />
                {t === 'gold' ? '★' : RARITY[t].name}
              </button>
            ))}
          </div>
          <span aria-hidden="true" style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 4px' }} />
          <Select<Status>
            ariaLabel="Status"
            value={status}
            onChange={(v) => set({ status: v === 'any' ? null : v })}
            options={[
              { value: 'any', label: 'Any status' },
              { value: 'available', label: 'Available' },
              { value: 'listed', label: 'Listed' },
              { value: 'in_trade', label: 'In trade' },
              { value: 'destroyed', label: 'Destroyed' },
              { value: 'stuck', label: 'Stuck (no live listing or offer)' },
            ]}
          />
          <button type="button" aria-pressed={stOnly} className={s.toggle} onClick={() => set({ stattrak: stOnly ? null : 'true' })}>
            StatTrak™ only
          </button>
          {hasFilters && (
            <button type="button" className={cx(s.btn, s.link)} style={{ height: 40, padding: '0 10px' }} onClick={clearAll}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {list.isError ? (
        <div role="alert" className={s.error} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Couldn’t load the items</span>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{list.error.message} Nothing was changed.</span>
          <Btn size={44} variant="primary" onClick={() => void list.refetch()}>
            Retry
          </Btn>
        </div>
      ) : list.isPending ? (
        <div aria-busy="true" aria-label="Loading items" className={s.panel}>
          <div style={{ height: 44, borderBottom: '1px solid var(--border)', background: 'var(--rail)' }} />
          {['60%', '45%', '55%', '40%', '65%', '50%', '58%', '42%'].map((w, i) => (
            <div key={i} className={s.skelRow}>
              <span className={s.skel} style={{ width: 84 }} />
              <span className={s.skel} style={{ width: w }} />
              <span className={s.skel} style={{ width: 90, marginLeft: 'auto' }} />
              <span className={s.skel} style={{ width: 70, height: 20 }} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        idSearch ? (
          <EmptyBox sub="IDs have 9 digits. Destroyed items keep their ID, so check the number." action={{ label: 'Clear search', onClick: clearAll }}>
            No item has the ID <span className="mono">{q.padStart(9, '0')}</span>.
          </EmptyBox>
        ) : (
          <EmptyBox action={{ label: 'Clear filters', onClick: clearAll }}>No item matches these filters.</EmptyBox>
        )
      ) : (
        <div className={s.tableWrap}>
          <div role="table" aria-label="Items" style={{ minWidth: mobile ? 760 : 980 }}>
            <div role="row" className={s.thead} style={{ gridTemplateColumns: GRID, padding: '0 18px', position: 'sticky', top: 0, zIndex: 3 }}>
              {['ID', 'Item', 'Wear · float', 'ST™', 'Owner', 'Status'].map((h) => (
                <span key={h} role="columnheader" className={cx('lbl', s.th)}>
                  {h}
                </span>
              ))}
              <span role="columnheader" className={cx('lbl', s.th)} style={{ textAlign: 'right' }}>
                Obtained ↓
              </span>
            </div>
            {rows.map((r) => (
              <div key={r.id} role="row" className={s.tr} data-current={open === r.id || undefined} style={{ gridTemplateColumns: GRID, padding: '0 18px' }}>
                <span role="cell" className="mono" style={{ fontSize: 13 }}>
                  {r.serial}
                </span>
                <span role="cell" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span aria-hidden="true" className={s.square} style={{ background: RARITY[r.tier].color }} />
                  <button type="button" className={cx(s.stretch, s.ellipsis)} onClick={() => set({ item: r.id })}>
                    {r.name}
                  </button>
                </span>
                <span role="cell" className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>
                  {r.wear && r.float !== null ? `${r.wear} ${r.float.toFixed(4)}` : 'Vanilla'}
                </span>
                <span role="cell">{r.stattrak && <span className={s.stBadge}>ST™</span>}</span>
                <span role="cell" className={s.ellipsis}>
                  {r.owner ? (
                    <Link to={`/admin/players/${r.owner.id}`} className={s.above} style={{ fontSize: 14, color: 'var(--text)' }}>
                      {r.owner.label}
                    </Link>
                  ) : (
                    <span style={{ color: 'var(--text-3)' }}>—</span>
                  )}
                </span>
                <span role="cell" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <StatusChip status={r.status} />
                  {r.stuck && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-2)' }}>
                      <span className={s.dot} aria-hidden="true" style={{ width: 6, height: 6 }} />
                      No live {r.status === 'listed' ? 'listing' : 'offer'}
                    </span>
                  )}
                </span>
                <span role="cell" className="mono" style={{ fontSize: 13, color: 'var(--text-2)', textAlign: 'right' }}>
                  {utcDay(r.obtainedAt)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ padding: '12px 18px' }}>
            <ListFooter text={`1–${num(rows.length)} of ${num(page?.total ?? rows.length)}`} more={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
          </div>
        </div>
      )}
      {open && <ItemDrawer id={open} onClose={() => set({ item: null })} />}
    </AdminPage>
  );
}

