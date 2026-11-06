import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { ItemDetail } from '../../../shared/api';
import { Page } from '../components/layout/AppShell';
import { FactsList, ItemStage, RarityPill } from '../components/items/detail';
import { FloatBar, StatTrakPill, WearPill } from '../components/items/items';
import { SalesChart, salesAria, salesDates } from '../components/market/market';
import { SHOWCASE_SIZE } from '../components/social/showcase';
import { Button, ButtonNote } from '../components/ui/Button';
import { ConfirmInline } from '../components/ui/ConfirmInline';
import { EmptyState } from '../components/ui/primitives';
import { formatCredits, formatFloat, longDate } from '../lib/format';
import { salesLabel } from '../lib/market';
import { useEconomyText, useItem, useMe } from '../lib/queries';
import { finishLabel, fullName } from '../lib/rarity';
import { useRecycle } from '../lib/recycle';
import { useProfile, useSetShowcase } from '../lib/social';
import { useIsMobile } from '../lib/useMediaQuery';

type Back = { to: string; label: string };

const STATUS: Record<ItemDetail['status'], string> = { available: 'Available', listed: 'Listed', in_trade: 'In a trade', destroyed: 'Recycled' };

function facts(item: ItemDetail) {
  const list = [
    { k: 'Collection', v: item.collection?.name ?? '—' },
    { k: 'Obtained', v: `${longDate(item.obtainedAt)} · from ${item.acquiredVia === 'trade' ? 'a trade' : item.acquiredVia === 'market' ? 'the market' : item.acquiredVia === 'tradeup' ? 'a trade-up' : item.acquiredVia === 'admin' ? 'Mint staff' : 'a case'}` },
    { k: 'Original owner', v: item.originalOwner ? `${item.originalOwner.name}${item.originalOwner.isYou ? ' (you)' : ''}` : '—' },
    { k: 'Status', v: STATUS[item.status] },
  ];
  if (!item.owner.isYou) list.splice(2, 0, { k: 'Owner', v: item.owner.username ?? '—' });
  return list;
}

/** "2,500 × 2 StatTrak™ × 1.2 MW", printed from the server's breakdown. */
function formula(item: ItemDetail) {
  const b = item.recycleBreakdown;
  return [formatCredits(b.base), b.stattrakMultiplier ? `${b.stattrakMultiplier} StatTrak™` : null, b.wear ? `${b.wear.multiplier} ${b.wear.code}` : null]
    .filter(Boolean)
    .join(' × ');
}

/** "This skin drops between 0.00 and 0.70." */
const range = (item: ItemDetail) => [item.minFloat ?? 0, item.maxFloat ?? 1].map((f) => f.toFixed(2));

/** Add to / remove from your showcase (SHOWCASE_SIZE items; adding goes to the first free slot). */
function useShowcaseToggle(item: ItemDetail | undefined) {
  const { data: me } = useMe();
  const own = Boolean(item?.owner.isYou && me && !me.isGuest && me.username);
  const { data: profile } = useProfile(own ? me!.username! : '');
  const save = useSetShowcase();
  const ids = profile?.showcase.map((i) => i.id) ?? [];
  if (!own || !item || !profile || item.status !== 'available') return null;
  const full = !item.inShowcase && ids.length >= SHOWCASE_SIZE;
  return {
    itemId: item.id,
    inShowcase: item.inShowcase,
    full,
    pending: save.isPending,
    toggle: () => save.mutate(item.inShowcase ? ids.filter((id) => id !== item.id) : [...ids, item.id]),
  };
}

/** Mobile "⋯" menu of the item page (showcase; trades join it in phase 5). */
function MoreMenu({ showcase }: { showcase: NonNullable<ReturnType<typeof useShowcaseToggle>> }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button type="button" aria-label="More actions" aria-expanded={open} onClick={() => setOpen(!open)} style={{ width: 44, height: 44, border: 0, background: 'none', color: 'var(--text-2)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" style={{ fill: 'currentColor' }}>
          <path d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM19 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" />
        </svg>
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: 44, zIndex: 20, minWidth: 220, padding: 6, border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-card)', background: 'var(--surface-bar)', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }}>
          <button
            type="button"
            role="menuitem"
            disabled={showcase.full || showcase.pending}
            onClick={() => {
              showcase.toggle();
              setOpen(false);
            }}
            style={{ width: '100%', height: 44, padding: '0 12px', border: 0, background: 'none', color: showcase.full ? 'var(--text-3)' : 'var(--text)', font: 'inherit', fontSize: 14, textAlign: 'left', cursor: 'pointer' }}
          >
            {showcase.inShowcase ? 'Remove from showcase' : showcase.full ? `Showcase is full (${SHOWCASE_SIZE})` : 'Add to showcase'}
          </button>
          <Link
            to={`/trades/new?give=${showcase.itemId}`}
            role="menuitem"
            style={{ display: 'flex', alignItems: 'center', height: 44, padding: '0 12px', color: 'var(--text)', textDecoration: 'none', fontSize: 14 }}
          >
            Offer in a trade
          </Link>
        </div>
      )}
    </div>
  );
}

export function Item() {
  const { id = '' } = useParams();
  const mobile = useIsMobile();
  const economy = useEconomyText();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { back?: Back; from?: string } | null;
  const back: Back = state?.back ?? (state?.from === 'album' ? { to: '/albums', label: 'Albums' } : { to: '/inventory', label: 'Inventory' });
  const { data: item, error } = useItem(id);
  const showcase = useShowcaseToggle(item);
  const [confirming, setConfirming] = useState(false);
  const cancel = useCallback(() => setConfirming(false), []);
  const recycle = useRecycle(() => navigate('/inventory'));

  if (error) {
    return (
      <Page gap={24} top={32} back={back}>
        <EmptyState title="This item isn’t available">
          <Button variant="secondary" size={44} to={back.to}>
            Back to {back.label}
          </Button>
        </EmptyState>
      </Page>
    );
  }
  if (!item) return <Page gap={24} top={32} back={back}>{null}</Page>;

  const value = `${formatCredits(item.recycleValue)} CR`;
  const ask = () => (item.recycleConfirm ? setConfirming(true) : recycle.mutate({ itemIds: [item.id], confirm: false }));
  const confirm = () => recycle.mutate({ itemIds: [item.id], confirm: true });
  const [min, max] = range(item);

  const confirmBox = (
    <ConfirmInline
      onCancel={cancel}
      style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 12 : 14, padding: mobile ? 0 : 18, border: mobile ? 0 : '1px solid var(--border-strong)', borderRadius: 'var(--radius-card)', background: mobile ? undefined : 'var(--page)' }}
      message={
        <p style={{ fontSize: mobile ? 14 : 15, lineHeight: 1.5 }}>
          Recycle <strong>{fullName(item.skin)}</strong> for <span className="mono">{value}</span>? It is destroyed for good.
        </p>
      }
    >
      <div style={mobile ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 } : { display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Button variant="secondary" size={mobile ? 48 : 44} onClick={cancel}>
          Cancel
        </Button>
        <Button size={mobile ? 48 : 44} bevel="none" onClick={confirm} disabled={recycle.isPending}>
          {`Recycle for ${value}`}
        </Button>
      </div>
    </ConfirmInline>
  );

  const pills = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: mobile ? 6 : 8, marginTop: mobile ? 6 : 8 }}>
      {!mobile && <RarityPill tier={item.skin.tier} />}
      {item.stattrak && <StatTrakPill mobile={mobile} />}
      <WearPill wear={item.wear} mobile={mobile} />
    </div>
  );

  const floatSection = item.float !== null && (
    <section aria-labelledby="float-title" style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 10 : 12, padding: mobile ? 16 : 22, border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <h2 id="float-title" className="lbl">
          // Float
        </h2>
        <span className="mono" style={{ fontSize: mobile ? 20 : 26, fontWeight: 500 }}>
          {formatFloat(item.float, 9)}
        </span>
      </div>
      <FloatBar float={item.float} min={item.minFloat} max={item.maxFloat} size={mobile ? 'pageMobile' : 'page'} />
      <p style={{ fontSize: mobile ? 12 : 13, color: 'var(--text-2)' }}>
        This skin drops between <span className="mono">{min}</span> and <span className="mono">{max}</span>. Floats in the hatched part can’t drop.
      </p>
    </section>
  );

  const sales = item.sales;
  const stat = (k: string, v: string) => (
    <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 2 : 4 }}>
      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{k}</span>
      <span className="mono" style={{ fontSize: mobile ? 18 : 22, fontWeight: mobile ? undefined : 500 }}>
        {v}
      </span>
    </div>
  );
  // Recent sales of this skin in this wear (StatTrak or not), then the recycle value to compare.
  const valueSection = (
    <section aria-labelledby="value-title" style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 14 : 18, padding: mobile ? 16 : 22, border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <h2 id="value-title" className="lbl">
          {`// Recent sales · ${salesLabel(sales)}`}
        </h2>
        <span className="mono" style={{ fontSize: mobile ? 11 : 12, color: 'var(--text-3)' }}>
          {economy.salesWindow}
        </span>
      </div>
      {sales.count > 0 ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
            {stat('Average', `${formatCredits(sales.average ?? 0)} CR`)}
            {stat('Last sale', `${formatCredits(sales.last ?? 0)} CR`)}
            {stat('Sales', formatCredits(sales.count))}
          </div>
          <SalesChart sales={sales} height={mobile ? 80 : 120} label={salesAria(sales, `Sale prices over the last ${economy.salesWindow}`)} caption={mobile ? undefined : salesDates(sales)} />
        </>
      ) : (
        <p style={{ fontSize: mobile ? 13 : 14, color: 'var(--text-2)' }}>No sales of this skin and wear in the last {economy.salesWindow}.</p>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, paddingTop: mobile ? 12 : 16, borderTop: '1px solid var(--separator)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: mobile ? 13 : 14, color: 'var(--text-2)' }}>Recycle value</span>
          {!mobile && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {formula(item)}
            </span>
          )}
        </div>
        <span className="mono" style={{ fontSize: mobile ? 15 : 18 }}>
          {value}
        </span>
      </div>
    </section>
  );
  const sell = `/sell?items=${item.id}`;
  const listing = item.listing && item.owner.isYou && (
    <Button variant="secondary" size={48} block={mobile} to={`/market/${item.listing.auctionId}`} style={mobile ? { fontSize: 14 } : { alignSelf: 'flex-start', paddingInline: 20 }}>
      Listed · see the auction
    </Button>
  );

  if (mobile) {
    return (
      <Page gap={20} back={back} mobilePadding="0 20px 104px" mobileRight={showcase ? <MoreMenu showcase={showcase} /> : undefined}>
        <ItemStage item={item} mobile />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{item.skin.weaponName}</span>
          <h1 style={{ fontSize: 34, lineHeight: 1.02, fontWeight: 600, letterSpacing: '-0.02em' }}>{finishLabel(item.skin)}</h1>
          {pills}
        </div>
        {floatSection}
        {valueSection}
        <FactsList facts={facts(item)} mobile />
        {(item.canRecycle || listing) && (
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'var(--tabbar)', zIndex: 5, padding: '12px 16px', background: 'var(--page)', borderTop: '1px solid var(--border)' }}>
            {listing ||
              (confirming ? (
                confirmBox
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: item.canList ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 10 }}>
                  <Button variant="secondary" size={48} block onClick={ask} disabled={recycle.isPending} style={{ fontSize: 14 }}>
                    Recycle +{formatCredits(item.recycleValue)} CR
                  </Button>
                  {item.canList && (
                    <Button size={48} block to={sell} style={{ fontSize: 15 }}>
                      List on market
                    </Button>
                  )}
                </div>
              ))}
          </div>
        )}
      </Page>
    );
  }

  return (
    <Page gap={24} top={32}>
      <Link to={back.to} className="mono" style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--text-2)', textDecoration: 'none' }}>
        ← {back.label}
      </Link>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ItemStage item={item} />
          <FactsList facts={facts(item)} />
        </div>
        <div style={{ flex: '1 1 400px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 16, color: 'var(--text-2)' }}>{item.skin.weaponName}</span>
            <h1 style={{ fontSize: 52, lineHeight: 1, fontWeight: 600, letterSpacing: '-0.025em' }}>{finishLabel(item.skin)}</h1>
            {pills}
          </div>
          {floatSection}
          {valueSection}
          {listing}
          {item.canRecycle &&
            (confirming ? (
              confirmBox
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {item.canList && (
                    <Button size={48} to={sell} style={{ paddingInline: 28 }}>
                      List on market
                    </Button>
                  )}
                  <Button variant="secondary" size={48} onClick={ask} disabled={recycle.isPending} style={{ paddingInline: 20 }}>
                    Recycle <ButtonNote>+{value}</ButtonNote>
                  </Button>
                </div>
                {showcase && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    <Button variant="secondary" size={44} onClick={showcase.toggle} disabled={showcase.full || showcase.pending} style={{ paddingInline: 16 }}>
                      {showcase.inShowcase ? 'Remove from showcase' : showcase.full ? `Showcase is full (${SHOWCASE_SIZE})` : 'Add to showcase'}
                    </Button>
                    <Button variant="secondary" size={44} to={`/trades/new?give=${item.id}`} style={{ paddingInline: 16 }}>
                      Offer in a trade
                    </Button>
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>
    </Page>
  );
}
