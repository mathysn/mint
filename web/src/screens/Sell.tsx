import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Item, SellInfo } from '../../../shared/api';
import { Page } from '../components/layout/AppShell';
import { RarityPill } from '../components/items/detail';
import { SkinArt, StatTrakPill } from '../components/items/items';
import { CompactStage } from '../components/market/market';
import { AccountRequired, MARKET_ICON } from '../components/social/social';
import { PickTile } from '../components/trades/trades';
import { Button } from '../components/ui/Button';
import { EmptyState, Halo, HudLabel } from '../components/ui/primitives';
import { formatCredits, formatFloat } from '../lib/format';
import { errorText, useCreateListing, useListingQuote, useSellInfo } from '../lib/market';
import { useEconomyText, useInventory } from '../lib/queries';
import { RARITY, finishLabel, fullName } from '../lib/rarity';
import { useIsAccount } from '../lib/social';
import { useDebounced } from '../lib/useDebounced';
import { useIsMobile } from '../lib/useMediaQuery';

const CR = (n: number) => `${formatCredits(n)} CR`;
const HINT: Record<number, string> = { 24: 'Ends tomorrow', 48: 'More time for bids' };
const wearText = (item: Item, sep = ' · ') => (item.wear && item.float !== null ? `${item.wear.code}${sep}${formatFloat(item.float, 4)}` : 'Vanilla');

/** "List on market": one item, or a queue of selected items ("1 of 3"), each with its own prices. */
export function Sell() {
  const account = useIsAccount();
  const mobile = useIsMobile();
  const [params] = useSearchParams();
  const queue = (params.get('items') ?? '').split(',').filter(Boolean);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [params]);

  if (!account) {
    return (
      <Page gap={28} back={{ to: '/market', label: 'Market' }} mobilePadding="8px 20px 32px">
        <h1 style={{ fontSize: mobile ? 28 : 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>List on market</h1>
        <AccountRequired icon={MARKET_ICON} title="Sell on the market" text="Sign in with Discord to put your items up for auction and bid on other players’ skins." />
      </Page>
    );
  }
  if (!queue.length) return <PickItem />;
  const itemId = queue[Math.min(index, queue.length - 1)]!;
  return <SellForm key={itemId} itemId={itemId} position={queue.length > 1 ? { at: index + 1, of: queue.length } : null} onNext={index + 1 < queue.length ? () => setIndex(index + 1) : null} />;
}

/** "List an item" from the market: pick one of your items first. */
function PickItem() {
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const { data } = useInventory('sort=value');
  return (
    <Page gap={24} top={32} back={{ to: '/market', label: 'Market' }} mobilePadding="8px 20px 32px">
      {!mobile && (
        <Link to="/market" className="mono" style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--text-2)', textDecoration: 'none' }}>
          ← Market
        </Link>
      )}
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ fontSize: mobile ? 28 : 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>List on market</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)' }}>Pick the item to put up for auction. Listed and traded items are locked.</p>
      </header>
      {data && data.items.length === 0 && (
        <EmptyState title="Your inventory is empty">
          <Button variant="secondary" size={44} to="/cases">
            Open a case
          </Button>
        </EmptyState>
      )}
      <div className="stagger-list" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${mobile ? 104 : 150}px, 1fr))`, gap: 8 }}>
        {data?.items.map((item) => (
          <PickTile key={item.id} item={{ ...item, albumGain: false }} on={false} mobile={mobile} onToggle={() => navigate(`/sell?items=${item.id}`)} />
        ))}
      </div>
    </Page>
  );
}

function SellForm({ itemId, position, onNext }: { itemId: string; position: { at: number; of: number } | null; onNext: (() => void) | null }) {
  const mobile = useIsMobile();
  const { data: info, error } = useSellInfo(itemId);
  const back = { to: `/items/${itemId}`, label: info ? fullName(info.item.skin) : 'Item' };

  if (error) {
    return (
      <Page gap={24} top={32} back={{ to: '/inventory', label: 'Inventory' }}>
        <EmptyState title="This item can't be listed">
          <Button variant="secondary" size={44} to="/inventory">
            Back to inventory
          </Button>
        </EmptyState>
      </Page>
    );
  }
  if (!info) return <Page gap={24} top={32} back={mobile ? { to: back.to, label: 'Cancel' } : undefined}>{null}</Page>;
  return <Form info={info} back={back} position={position} onNext={onNext} mobile={mobile} />;
}

function Form({ info, back, position, onNext, mobile }: { info: SellInfo; back: { to: string; label: string }; position: { at: number; of: number } | null; onNext: (() => void) | null; mobile: boolean }) {
  const item = info.item;
  const [start, setStart] = useState(String(info.sales.average ?? item.recycleValue));
  const [buyOn, setBuyOn] = useState(false);
  const [buy, setBuy] = useState('');
  const [duration, setDuration] = useState<number>(info.durations[info.durations.length - 1] ?? 48);
  const economy = useEconomyText();
  const [listed, setListed] = useState<{ start: number; buy: number | null; hours: number } | null>(null);
  const [problem, setProblem] = useState('');
  const create = useCreateListing();

  const startN = Math.max(0, Math.floor(Number(start) || 0));
  const buyN = buyOn ? Math.max(0, Math.floor(Number(buy) || 0)) : null;
  const buyError = buyN !== null && buyN <= startN;
  const full = info.activeListings >= info.maxListings;
  const available = item.status === 'available';
  const invalid = startN < 1 || buyError || full || !available;
  const body = useDebounced(JSON.stringify({ itemId: item.id, startPrice: startN, buyNowPrice: buyN }), 250);
  const { data: quote } = useListingQuote(JSON.parse(body) as { itemId: string; startPrice: number; buyNowPrice: number | null });

  const submit = () => {
    if (invalid) return;
    setProblem('');
    create.mutate(
      { itemId: item.id, startPrice: startN, buyNowPrice: buyN, durationHours: duration },
      { onSuccess: () => setListed({ start: startN, buy: buyN, hours: duration }), onError: (e) => setProblem(errorText(e, 'Could not list it.')) },
    );
  };

  const field = (value: string, onChange: (v: string) => void, opts: { label?: string; disabled?: boolean } = {}) => (
    <span style={{ position: 'relative', display: 'block' }}>
      <input
        type="number"
        className="mono"
        inputMode="numeric"
        aria-label={opts.label}
        min={1}
        step={1}
        value={value}
        disabled={opts.disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ boxSizing: 'border-box', width: '100%', height: 52, padding: mobile ? '0 48px 0 14px' : '0 56px 0 16px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-control)', background: 'var(--surface)', color: 'var(--text)', fontSize: mobile ? 19 : 20, opacity: opts.disabled ? 0.5 : 1 }}
      />
      <span className="mono" style={{ position: 'absolute', right: mobile ? 14 : 16, top: mobile ? 17 : 16, fontSize: mobile ? 13 : 14, color: 'var(--text-2)' }}>
        CR
      </span>
    </span>
  );

  const row = (k: string, v: string, muted?: boolean) => (
    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: mobile ? '10px 0' : '12px 0', borderTop: '1px solid var(--separator)', fontSize: muted ? (mobile ? 12 : 13) : 14, color: muted ? 'var(--text-3)' : undefined }}>
      <span style={{ color: muted ? undefined : 'var(--text-2)' }}>{k}</span>
      <span className="mono">{v}</span>
    </div>
  );

  const summary = (
    <section aria-labelledby="sum-title" style={{ display: 'flex', flexDirection: 'column', padding: mobile ? '14px 16px 4px' : '18px 20px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' }}>
      <h2 id="sum-title" className="lbl" style={{ marginBottom: mobile ? 6 : 8 }}>
        // What you get
      </h2>
      {quote && (
        <>
          {row(mobile ? 'At the starting price' : 'Sold at the starting price', CR(quote.atStart))}
          {quote.atBuyNow !== null && row('Bought now', CR(quote.atBuyNow))}
          {row(mobile ? `${economy.fee} fee from the final price` : `${economy.fee} market fee, taken from the final price`, `−${CR(quote.feeAtStart)}`, true)}
          {row(mobile ? 'Recycling instead' : 'Recycling it instead', CR(quote.recycleValue), true)}
        </>
      )}
    </section>
  );

  const durations = (
    <fieldset style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: mobile ? 8 : 10 }}>
      <legend style={{ padding: 0, marginBottom: mobile ? 8 : 10, fontSize: 15, fontWeight: 600 }}>Duration</legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {info.durations.map((h) => {
          const on = duration === h;
          const look: CSSProperties = on ? { background: 'var(--primary-bg)', color: 'var(--primary-text)', border: '1px solid var(--primary-bg)' } : { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-strong)' };
          return (
            <label key={h} style={{ position: 'relative', display: mobile ? 'grid' : 'flex', placeItems: mobile ? 'center' : undefined, flexDirection: 'column', gap: 2, height: mobile ? 48 : undefined, padding: mobile ? 0 : '14px 16px', borderRadius: 'var(--radius-control)', cursor: 'pointer', ...look }}>
              <input type="radio" className="sr-only" name="duration" value={h} checked={on} onChange={() => setDuration(h)} />
              <span className="mono" style={{ fontSize: mobile ? 16 : 18, fontWeight: on && mobile ? 600 : 500 }}>
                {h} h
              </span>
              {!mobile && <span style={{ fontSize: 12, opacity: 0.75 }}>{HINT[h] ?? `Ends in ${h} hours`}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );

  const startField = (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>Starting price</span>
      {field(start, setStart)}
      <span style={{ fontSize: mobile ? 12 : 13, color: 'var(--text-2)' }}>{mobile ? `Each bid must beat the last by ${economy.bidStep}.` : `Each new bid has to beat the previous one by at least ${economy.bidStep}.`}</span>
    </label>
  );

  const buyField = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 8 : 10 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', minHeight: 44 }}>
        <input
          type="checkbox"
          checked={buyOn}
          onChange={() => {
            if (!buyOn && !buy) setBuy(String(Math.max(startN * 2, startN + 1)));
            setBuyOn(!buyOn);
          }}
          style={{ width: 20, height: 20, margin: 0, accentColor: 'var(--text)' }}
        />
        <span style={{ fontSize: 15, fontWeight: 600 }}>{mobile ? 'Buy-now price' : 'Add a buy-now price'}</span>
        <span style={{ fontSize: mobile ? 12 : 13, color: 'var(--text-2)' }}>Optional</span>
      </label>
      {field(buy, setBuy, { label: 'Buy-now price', disabled: !buyOn })}
      {buyError && (
        <span role="alert" style={{ fontSize: 13, color: 'var(--error)' }}>
          The buy-now price has to be above the starting price.
        </span>
      )}
    </div>
  );

  const notes = [
    !available && 'This item is listed or in a trade: it can’t be listed again.',
    full && `You already have ${info.maxListings} active listings. Wait for one to end, or cancel one nobody bid on.`,
    problem,
  ].filter(Boolean) as string[];

  const queueLabel = position && <HudLabel>{`Item ${position.at} of ${position.of}`}</HudLabel>;

  const done = listed && (
    <section role="status" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: mobile ? 20 : 28, border: '1px solid var(--text)', borderRadius: 'var(--radius-panel)', background: 'var(--surface-bar)' }}>
      <span className="lbl" style={{ color: 'var(--text)' }}>
        Listed
      </span>
      <span style={{ fontSize: mobile ? 18 : 22, fontWeight: 600 }}>
        Your {fullName(item.skin)} is up for {listed.hours} h.
      </span>
      <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-2)' }}>
        Starting at {CR(listed.start)}
        {listed.buy !== null ? `, or ${CR(listed.buy)} to buy it now` : ''}. It stays locked in your inventory until the sale closes.
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
        {onNext && position ? (
          <Button size={44} bevel="none" onClick={onNext} style={{ paddingInline: 20, fontSize: 14 }}>
            Next item · {position.at + 1} of {position.of}
          </Button>
        ) : (
          <Button size={44} bevel="none" to="/market?tab=mine" style={{ paddingInline: 20, fontSize: 14 }}>
            See my listings
          </Button>
        )}
        {onNext ? (
          <Button variant="secondary" size={44} to="/market?tab=mine" style={{ paddingInline: 16, fontSize: 14 }}>
            See my listings
          </Button>
        ) : (
          <Button variant="secondary" size={44} to="/inventory" style={{ paddingInline: 16, fontSize: 14 }}>
            Back to inventory
          </Button>
        )}
      </div>
    </section>
  );

  if (mobile) {
    const rarity = RARITY[item.skin.tier];
    return (
      <Page gap={20} back={{ to: back.to, label: 'Cancel' }} mobilePadding={`8px 20px ${listed ? 32 : 104}px`} mobileRight={<span />}>
        {queueLabel}
        <h1 style={{ fontSize: 28, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>List on market</h1>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px 12px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--surface)', overflow: 'hidden' }}>
          <span style={{ position: 'relative', flex: 'none', width: 92, height: 56, display: 'grid', placeItems: 'center' }}>
            <Halo color={rarity.halo} inset="0" />
            <SkinArt skin={item.skin} width="100%" style={{ position: 'relative', maxHeight: '100%' }} />
          </span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
              {item.skin.weaponName}
              {item.stattrak ? ' · StatTrak™' : ''}
            </span>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{finishLabel(item.skin)}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
              {wearText(item, ' ')}
              {info.sales.average !== null ? ` · avg sale ${formatCredits(info.sales.average)} CR` : ''}
            </span>
          </span>
          <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: rarity.color }} />
        </div>
        {done || (
          <>
            {startField}
            {buyField}
            {durations}
            {summary}
            {notes.map((n) => (
              <p key={n} role="alert" style={{ fontSize: 13, color: 'var(--error)' }}>
                {n}
              </p>
            ))}
            <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'var(--tabbar)', zIndex: 5, minHeight: 76, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '10px 16px', background: 'var(--page)', borderTop: '1px solid var(--border)' }}>
              <Button size={48} block onClick={submit} disabled={invalid || create.isPending} style={{ fontSize: 16 }}>
                List for {duration} h
              </Button>
            </div>
          </>
        )}
      </Page>
    );
  }

  return (
    <Page gap={24} top={32}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Link to={back.to} className="mono" style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--text-2)', textDecoration: 'none' }}>
          ← {back.label}
        </Link>
        {queueLabel}
        <h1 style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>List on market</h1>
      </header>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <aside style={{ flex: '1 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)', overflow: 'hidden' }}>
          <CompactStage item={item} height={260} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 22px 22px', borderTop: '1px solid var(--separator)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{item.skin.weaponName}</span>
              <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>{finishLabel(item.skin)}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {item.stattrak && <StatTrakPill />}
              <RarityPill tier={item.skin.tier} />
              <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', height: 28, padding: '0 8px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-control)', fontSize: 11 }}>
                {wearText(item)}
              </span>
            </div>
            <dl style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
              {[
                ['Average sale, 30 d', info.sales.average !== null ? CR(info.sales.average) : '—'],
                ['Last sale', info.sales.last !== null ? CR(info.sales.last) : '—'],
                ['Recycle value', CR(item.recycleValue)],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid var(--separator)', fontSize: 14 }}>
                  <dt style={{ color: 'var(--text-2)' }}>{k}</dt>
                  <dd className="mono" style={{ margin: 0 }}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>

        <div style={{ flex: '1 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {done || (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              noValidate
              style={{ display: 'flex', flexDirection: 'column', gap: 22 }}
            >
              {startField}
              {buyField}
              {durations}
              {summary}
              {notes.map((n) => (
                <p key={n} role="alert" style={{ fontSize: 13, color: 'var(--error)' }}>
                  {n}
                </p>
              ))}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                <Button type="submit" size={52} disabled={invalid || create.isPending} style={{ paddingInline: 30, fontSize: 16 }}>
                  List for {duration} h
                </Button>
                <Link to={back.to} style={{ display: 'inline-flex', alignItems: 'center', height: 44, padding: '0 8px', color: 'var(--text-2)', fontSize: 14 }}>
                  Cancel
                </Link>
                <span style={{ flexBasis: '100%', fontSize: 12, color: 'var(--text-3)' }}>
                  Locked while listed: no trades, recycling or contracts. Active listings: {info.activeListings} of {info.maxListings}.
                </span>
              </div>
            </form>
          )}
        </div>
      </div>
    </Page>
  );
}
