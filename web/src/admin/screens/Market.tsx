import { useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { AdminAuctionDetail, AdminAuctionKind, AdminAuctionRow, AdminFlag, AdminTradeRow } from '../../../../shared/api';
import { RARITY } from '../../lib/rarity';
import { useIsMobile } from '../../lib/useMediaQuery';
import { AdminPage } from '../AdminApp';
import { BanById } from '../dialogs';
import { ROLE_HINT, cr, rowsOf, useAdminAction, useAdminTrades, useAuction, useAuctions, useFlags, useStaff, utcTime } from '../lib';
import { Btn, Chip, Dot, Drawer, EmptyBox, ErrorBox, Header, ItemArt, ListFooter, Logged, StBadge, cx, s } from '../ui';

type Tab = 'auctions' | 'trades' | 'flags';

const AUCTION_GRID = '70px minmax(0, 1fr) 90px 150px 100px 130px 140px';
const TRADE_GRID = '70px 170px minmax(0, 1fr) minmax(0, 1fr) 150px 110px 120px';

const ENDED: AdminAuctionKind[] = ['sold', 'unsold', 'cancelled'];

function timerStyle(kind: AdminAuctionKind): CSSProperties {
  if (kind === 'urgent') return { background: 'var(--primary-bg)', color: 'var(--primary-text)' };
  if (ENDED.includes(kind)) return { color: 'var(--text-3)', paddingLeft: 0 };
  if (kind === 'overdue') return { border: '1px dashed var(--border-hover)', color: 'var(--text)' };
  return { border: '1px solid var(--border-strong)', color: 'var(--text)' };
}

function TimerChip({ kind, children, size = 26 }: { kind: AdminAuctionKind; children: string; size?: number }) {
  return (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: size, padding: '0 8px', borderRadius: 'var(--radius-control)', fontSize: size > 26 ? 13 : 12, whiteSpace: 'nowrap', ...timerStyle(kind) }}>
      {kind === 'urgent' && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary-text)', animation: 'mint-blink 1s steps(1) infinite' }} />}
      {children}
    </span>
  );
}

const PlayerLink = ({ p, above }: { p: { id: string; label: string }; above?: boolean }) => (
  <Link to={`/admin/players/${p.id}`} className={above ? s.above : undefined} style={{ color: 'var(--text)' }}>
    {p.label}
  </Link>
);

function Skeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className={s.panel}>
      <div style={{ height: 44, borderBottom: '1px solid var(--border)', background: 'var(--rail)' }} />
      {[180, 120, 150, 110, 170, 130].map((w, i) => (
        <div key={i} className={s.skelRow}>
          <span className={s.skel} style={{ width: 50 }} />
          <span className={s.skel} style={{ width: w }} />
          <span className={s.skel} style={{ width: 90, marginLeft: 'auto' }} />
          <span className={s.skel} style={{ width: 80, height: 20 }} />
        </div>
      ))}
    </div>
  );
}

// ── Auctions ────────────────────────────────────────────────────────────────

function AuctionRowView({ a, current, onOpen }: { a: AdminAuctionRow; current: boolean; onOpen: () => void }) {
  const ended = ENDED.includes(a.kind);
  return (
    <div role="row" className={s.tr} data-current={current || undefined} style={{ gridTemplateColumns: AUCTION_GRID, padding: '0 18px' }}>
      <span role="cell" className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
        {a.number}
      </span>
      <span role="cell" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span aria-hidden="true" style={{ flex: 'none', width: 8, height: 8, background: RARITY[a.tier].color }} />
        <button type="button" className={cx(s.stretch, s.ellipsis)} onClick={onOpen} style={{ color: ended ? 'var(--text-2)' : 'var(--text)' }}>
          {a.name}
        </button>
        {a.stattrak && <StBadge />}
        {a.wear && (
          <span className="mono" style={{ flex: 'none', fontSize: 11, color: 'var(--text-3)' }}>
            {a.wear}
          </span>
        )}
      </span>
      <span role="cell" className={s.ellipsis}>
        <PlayerLink p={a.seller} above />
      </span>
      <span role="cell" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
        <span className="mono">{cr(a.bid)}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {a.bidsLine}
        </span>
      </span>
      <span role="cell" className="mono" style={{ textAlign: 'right', color: 'var(--text-2)' }}>
        {a.buyNow !== null ? cr(a.buyNow) : '—'}
      </span>
      <span role="cell" style={{ paddingLeft: 24 }}>
        <TimerChip kind={a.kind}>{a.ends}</TimerChip>
      </span>
      <span role="cell" className={s.ellipsis} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: ended ? 'var(--text-3)' : 'var(--text)' }}>
        {a.flagged && <Dot />}
        {a.status}
      </span>
    </div>
  );
}

function AuctionConfirm({ text, path, onDone, onBack }: { text: { title: string; lines: string[]; button: string }; path: string; onDone: () => void; onBack: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, busy } = useAdminAction();
  const go = async () => {
    const message = await run(path, { reason: reason.trim() });
    if (message) setError(message);
    else onDone();
  };
  return (
    <div role="group" aria-label={text.title} className={s.stacked} style={{ gap: 12, padding: 16 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{text.title}</span>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>
        {text.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <input autoFocus className={s.field} aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, shown in the admin log" style={{ width: '100%', height: 44 }} />
      {error && (
        <span role="alert" className={s.alertText}>
          {error}
        </span>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {/* "Cancel" next to "Cancel auction #12" would read twice: keep the thing instead. */}
        <Btn size={44} onClick={onBack}>
          {text.button.startsWith('Cancel') ? 'Keep auction' : 'Cancel'}
        </Btn>
        <Btn size={44} variant="primary" min="moderator" disabled={!reason.trim() || busy} onClick={() => void go()}>
          {text.button}
        </Btn>
      </div>
      <Logged />
    </div>
  );
}

function AuctionDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const auction = useAuction(id);
  const [confirm, setConfirm] = useState<'cancel' | 'settle' | null>(null);
  const a: AdminAuctionDetail | undefined = auction.data;
  const footer = a ? (
    confirm && a[confirm] ? (
      <AuctionConfirm text={a[confirm]!} path={`/admin/market/auctions/${a.id}/${confirm}`} onBack={() => setConfirm(null)} onDone={() => setConfirm(null)} />
    ) : (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {a.settle && (
          <Btn size={44} variant="primary" min="moderator" onClick={() => setConfirm('settle')}>
            Settle now
          </Btn>
        )}
        <Btn size={44} min="moderator" blocked={a.cancel ? null : a.cancelHint} onClick={() => setConfirm('cancel')}>
          Cancel auction
        </Btn>
      </div>
    )
  ) : undefined;
  return (
    <Drawer
      label={
        <>
          // Auction{' '}
          <span className="mono" style={{ color: 'var(--text)', letterSpacing: '.04em' }}>
            {a?.number ?? ''}
          </span>
        </>
      }
      onClose={onClose}
      footer={footer}
    >
      {auction.isError ? (
        <ErrorBox title="Couldn’t load this auction" error={auction.error} onRetry={() => void auction.refetch()} />
      ) : !a ? (
        <div aria-busy="true" aria-label="Loading the auction" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className={s.skel} style={{ width: 240, height: 110 }} />
          <span className={s.skel} style={{ width: 180 }} />
          <span className={s.skel} style={{ width: '100%', height: 160 }} />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 'none', width: 160, height: 110, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--page)', overflow: 'hidden' }}>
              <ItemArt tier={a.tier} imageUrl={a.imageUrl} alt={a.name} height={100} />
              <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: RARITY[a.tier].color }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{a.weaponName}</span>
              <h2 style={{ fontSize: 24, lineHeight: 1.1, fontWeight: 600 }}>{a.finishName}</h2>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {a.wearName && <Chip style="outline">{a.wearName}</Chip>}
                {a.stattrak && <Chip style="solid">StatTrak™</Chip>}
              </span>
            </div>
          </div>
          <span style={{ alignSelf: 'flex-start' }}>
            <TimerChip kind={a.kind === 'urgent' ? 'live' : a.kind} size={28}>
              {a.timer}
            </TimerChip>
          </span>
          <dl className={s.facts}>
            {a.facts.map((f) => (
              <div key={f.k}>
                <dt>{f.k}</dt>
                <dd className="mono" style={{ fontSize: 13 }}>
                  {f.v}
                </dd>
              </div>
            ))}
          </dl>
          <section aria-labelledby="bh-t" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3 id="bh-t" className="lbl">
              // Bids · {a.bidCount}
            </h3>
            {a.bids.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)' }}>
                {a.bids.map((b, i) => (
                  <div key={`${b.at}-${i}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px 110px', gap: 10, alignItems: 'center', minHeight: 44, padding: '0 14px', borderBottom: i < a.bids.length - 1 ? '1px solid var(--separator)' : 0, fontSize: 13 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <PlayerLink p={b.who} />
                      {b.leading && (
                        <span className="mono" style={{ padding: '1px 5px', background: 'var(--primary-bg)', color: 'var(--primary-text)', fontSize: 9, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                          Leading
                        </span>
                      )}
                    </span>
                    <span className="mono" style={{ textAlign: 'right' }}>
                      {cr(b.amount)}
                    </span>
                    <span className="mono" style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-3)' }}>
                      {utcTime(b.at)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ padding: 14, border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-card)', fontSize: 13, color: 'var(--text-2)' }}>Nobody bid on it.</span>
            )}
          </section>
        </>
      )}
    </Drawer>
  );
}

function Auctions() {
  const list = useAuctions();
  const [params, setParams] = useSearchParams();
  const open = params.get('auction');
  const setOpen = (id: string | null) =>
    setParams(
      (p) => {
        if (id) p.set('auction', id);
        else p.delete('auction');
        return p;
      },
      { replace: true },
    );
  const rows = rowsOf(list.data);
  if (list.isError) return <ErrorBox title="Couldn’t load the auctions" error={list.error} onRetry={() => void list.refetch()} />;
  if (list.isPending) return <Skeleton label="Loading the auctions" />;
  return (
    <>
      <div className={s.tableWrap}>
        <div role="table" aria-label="Auctions" style={{ minWidth: 1000 }}>
          <div role="row" className={s.thead} style={{ gridTemplateColumns: AUCTION_GRID, padding: '0 18px' }}>
            {['#', 'Item', 'Seller', 'Current bid', 'Buy now', 'Ends ↑', 'Status'].map((h, i) => (
              <span key={h} role="columnheader" className={cx('lbl', s.th)} style={{ textAlign: i === 3 || i === 4 ? 'right' : undefined, paddingLeft: i === 5 ? 24 : undefined }}>
                {h}
              </span>
            ))}
          </div>
          {rows.map((a) => (
            <AuctionRowView key={a.id} a={a} current={open === a.id} onOpen={() => setOpen(a.id)} />
          ))}
          {rows.length === 0 && (
            <div style={{ margin: 18 }}>
              <EmptyBox sub="Listings show here as soon as a player puts an item up for auction.">No auction in the last 30 days.</EmptyBox>
            </div>
          )}
        </div>
        <div style={{ padding: '12px 18px' }}>
          <ListFooter text={list.data?.pages[0]?.summary ?? ''} more={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
        </div>
      </div>
      {open && <AuctionDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

// ── Trades ──────────────────────────────────────────────────────────────────

function TradeCancel({ t, onDone }: { t: AdminTradeRow; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, busy } = useAdminAction();
  const go = async () => {
    const message = await run(`/admin/market/trades/${t.id}/cancel`, { reason: reason.trim() });
    if (message) setError(message);
    else onDone();
  };
  return (
    <div role="alertdialog" aria-labelledby="tc-t" className={s.confirm} onKeyDown={(e) => e.key === 'Escape' && onDone()}>
      <div className={s.confirmText} style={{ flex: '1 1 380px' }}>
        <span id="tc-t" className={s.confirmTitle}>
          Cancel offer {t.number} ({t.from.label} → {t.to.label})
        </span>
        <span>{t.cancelText}</span>
        {error && (
          <span role="alert" className={s.alertText}>
            {error}
          </span>
        )}
      </div>
      <label className={s.reasonInline}>
        <span>Reason</span>
        <input autoFocus className={s.field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, shown in the admin log" onKeyDown={(e) => e.key === 'Enter' && reason.trim() && !busy && void go()} />
      </label>
      <Btn variant="quiet" onClick={onDone}>
        Keep offer
      </Btn>
      <Btn variant="primary" min="moderator" disabled={!reason.trim() || busy} onClick={() => void go()}>
        Cancel offer
      </Btn>
      <Logged />
    </div>
  );
}

function Trades() {
  const list = useAdminTrades();
  const [confirm, setConfirm] = useState<AdminTradeRow | null>(null);
  const rows = rowsOf(list.data);
  if (list.isError) return <ErrorBox title="Couldn’t load the trade offers" error={list.error} onRetry={() => void list.refetch()} />;
  if (list.isPending) return <Skeleton label="Loading the trade offers" />;
  return (
    <>
      {confirm && <TradeCancel t={confirm} onDone={() => setConfirm(null)} />}
      <div className={s.tableWrap}>
        <div role="table" aria-label="Trade offers" style={{ minWidth: 1000 }}>
          <div role="row" className={s.thead} style={{ gridTemplateColumns: TRADE_GRID, columnGap: 12, padding: '0 18px' }}>
            {['Offer', 'From → to', 'Sender gives', 'Receiver gives', 'Status', 'Expires'].map((h) => (
              <span key={h} role="columnheader" className={cx('lbl', s.th)}>
                {h}
              </span>
            ))}
            <span role="columnheader">
              <span className="sr-only">Action</span>
            </span>
          </div>
          {rows.map((t) => (
            <div key={t.id} role="row" className={s.tr} style={{ gridTemplateColumns: TRADE_GRID, columnGap: 12, minHeight: 60, padding: '6px 18px' }}>
              <span role="cell" className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {t.number}
              </span>
              <span role="cell" className={s.ellipsis}>
                <PlayerLink p={t.from} /> <span style={{ color: 'var(--text-3)' }}>→</span> <PlayerLink p={t.to} />
              </span>
              {[
                [t.give, t.giveValue],
                [t.get, t.getValue],
              ].map(([text, value], i) => (
                <span key={i} role="cell" style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span className={s.ellipsis}>{text}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {value}
                  </span>
                </span>
              ))}
              <span role="cell" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
                <Chip style={t.chip}>{t.status}</Chip>
                {t.note && (
                  <Link to="/admin/items?status=stuck" style={{ fontSize: 11, color: 'var(--text-2)' }}>
                    {t.note}
                  </Link>
                )}
              </span>
              <span role="cell" className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {t.expires}
              </span>
              <span role="cell" style={{ textAlign: 'right' }}>
                {t.live && (
                  <Btn size={36} min="moderator" onClick={() => setConfirm(t)}>
                    Cancel offer
                  </Btn>
                )}
              </span>
            </div>
          ))}
          {rows.length === 0 && (
            <div style={{ margin: 18 }}>
              <EmptyBox sub="Offers between friends show here, pending ones first.">No trade offer in the last 30 days.</EmptyBox>
            </div>
          )}
        </div>
        {rows.length > 0 && (
          <div style={{ padding: '12px 18px' }}>
            <ListFooter text={`${list.data?.pages[0]?.pending ?? 0} pending · last 30 days`} more={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
          </div>
        )}
      </div>
    </>
  );
}

// ── Flags ───────────────────────────────────────────────────────────────────

function FlagCard({ f, onBan }: { f: AdminFlag; onBan: (id: string) => void }) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, busy } = useAdminAction();
  const subject = f.players[0];
  const go = async () => {
    const message = await run(`/admin/flags/${f.id}/dismiss`, { reason: reason.trim() });
    if (message) setError(message);
    else setDismissing(false);
  };
  return (
    <article
      aria-labelledby={`fl-${f.id}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 20px', border: `1px ${f.open ? 'solid' : 'dashed'} var(--border-strong)`, borderRadius: 'var(--radius-panel)', background: f.open ? 'var(--surface)' : 'transparent' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 id={`fl-${f.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 600, color: f.open ? 'var(--text)' : 'var(--text-2)' }}>
            {f.urgent && <Dot size={8} />}
            {f.kind}
          </h2>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {f.raised}
          </span>
        </div>
        <Chip style={f.open ? 'outline' : 'dashed'}>{f.state}</Chip>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {f.players.map((p) => (
          <Link key={p.id} to={`/admin/players/${p.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', border: `1px ${p.banned ? 'dashed' : 'solid'} var(--border-strong)`, borderRadius: 'var(--radius-control)', fontSize: 13, textDecoration: 'none', color: 'var(--text)' }}>
            {p.label}
            {p.banned ? ' · banned' : ''}
          </Link>
        ))}
        {f.morePlayers > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', height: 28, padding: '0 10px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-control)', fontSize: 13, color: 'var(--text-2)' }}>+{f.morePlayers} more</span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
        {f.evidence.map((e) => (
          <div key={e.k} style={{ flex: '1 1 120px', display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 14px', background: 'var(--surface-raised)' }}>
            <span className="mono" style={{ fontSize: 20, fontWeight: 500 }}>
              {e.v}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{e.k}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>{f.text}</p>
      {f.open &&
        (dismissing ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, border: '1px solid var(--text)', borderRadius: 'var(--radius-card)', background: 'var(--surface-bar)' }}>
            <input autoFocus className={s.field} aria-label="Reason to dismiss" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, shown in the admin log" style={{ flex: '1 1 220px', minWidth: 0 }} onKeyDown={(e) => e.key === 'Escape' && setDismissing(false)} />
            <Btn variant="quiet" onClick={() => setDismissing(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" min="moderator" disabled={!reason.trim() || busy} onClick={() => void go()}>
              Dismiss flag
            </Btn>
            <Logged />
            {error && (
              <span role="alert" className={s.alertText} style={{ flexBasis: '100%' }}>
                {error}
              </span>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 12, borderTop: '1px solid var(--separator)' }}>
            {subject && <Btn to={`/admin/players/${subject.id}`}>Review player</Btn>}
            <Btn min="moderator" onClick={() => setDismissing(true)}>
              Dismiss
            </Btn>
            {subject && (
              <Btn variant="danger" min="moderator" blocked={subject.banned ? `${subject.label} is already banned` : null} onClick={() => onBan(subject.id)}>
                Ban
              </Btn>
            )}
          </div>
        ))}
    </article>
  );
}

function Flags() {
  const flags = useFlags();
  const mobile = useIsMobile();
  const [ban, setBan] = useState<string | null>(null);
  if (flags.isError) return <ErrorBox title="Couldn’t load the flags" error={flags.error} onRetry={() => void flags.refetch()} />;
  if (flags.isPending)
    return (
      <div aria-busy="true" aria-label="Loading the flags" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(520px, 100%), 1fr))', gap: 16 }}>
        {[0, 1].map((i) => (
          <div key={i} className={s.panel} style={{ height: 260 }} />
        ))}
      </div>
    );
  if (!flags.data.rows.length) return <EmptyBox sub="The monitors check trades, sign-ups and sales as they happen.">Nothing flagged in the last 30 days.</EmptyBox>;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(520px, 100%), 1fr))', gap: 16 }}>
        {flags.data.rows.map((f) => (
          <FlagCard key={f.id} f={f} onBan={setBan} />
        ))}
      </div>
      {ban && <BanById id={ban} onClose={() => setBan(null)} mobile={mobile} />}
    </>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function Market() {
  const staff = useStaff();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'trades' ? 'trades' : params.get('tab') === 'flags' ? 'flags' : 'auctions';
  const auctions = useAuctions();
  const trades = useAdminTrades();
  const flags = useFlags();
  const openFlags = flags.data?.open ?? staff.badges.flags;
  const tabs: [Tab, string, string][] = [
    ['auctions', 'Auctions', auctions.data ? `${auctions.data.pages[0]?.live ?? 0} live` : ''],
    ['trades', 'Trades', trades.data ? `${trades.data.pages[0]?.pending ?? 0} pending` : ''],
    ['flags', 'Flags', String(openFlags)],
  ];
  const pick = (t: Tab) => setParams(t === 'auctions' ? {} : { tab: t }, { replace: true });
  return (
    <AdminPage gap={24}>
      <Header label="Market & trades" title="Market & trades" sub="Live auctions, trade offers and what the monitors flagged. Every cancel refunds bids and releases items. All times UTC." />
      <div role="tablist" aria-label="Market and trades" className={s.tabs} style={{ gap: '4px 28px' }}>
        {tabs.map(([key, label, count]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={s.tab} onClick={() => pick(key)}>
            {label}
            {key === 'flags' && openFlags > 0 ? (
              <span className="mono" style={{ minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 9, background: 'var(--primary-bg)', color: 'var(--primary-text)', display: 'inline-grid', placeItems: 'center', fontSize: 11, fontWeight: 600 }}>
                {count}
              </span>
            ) : (
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>
      {!staff.can('moderator') && (
        <span className="mono" style={{ marginTop: -8, fontSize: 11, color: 'var(--text-3)' }}>
          Read-only: you’re a Viewer. Cancelling, settling and dismissing are for {ROLE_HINT.moderator.toLowerCase()}.
        </span>
      )}
      {tab === 'auctions' && <Auctions />}
      {tab === 'trades' && <Trades />}
      {tab === 'flags' && <Flags />}
    </AdminPage>
  );
}
