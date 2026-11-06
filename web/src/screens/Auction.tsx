import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import type { AuctionDetail } from '../../../shared/api';
import { Page } from '../components/layout/AppShell';
import { FactsList, ItemStage, RarityPill } from '../components/items/detail';
import { FloatBar, StatTrakPill, WearPill } from '../components/items/items';
import { BidRow, CompactStage, SalesChart, UrgentDot, salesAria, salesDates } from '../components/market/market';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/primitives';
import { formatCredits, formatFloat, shortDate } from '../lib/format';
import { errorText, isRunning, pageTimer, salesLabel, useAuction, useBuyNow, useCancelListing, useIsUrgent, usePlaceBid, useServerNow } from '../lib/market';
import { useEconomyText, useMe } from '../lib/queries';
import { finishLabel, fullName } from '../lib/rarity';
import { useChangeCount } from '../lib/useAnimatedNumber';
import { useIsMobile } from '../lib/useMediaQuery';

type Back = { to: string; label: string };

const CR = (n: number) => `${formatCredits(n)} CR`;

/** Outbid toast: the poll shows you lost the lead since the last look. */
function useOutbidToast(auction: AuctionDetail | undefined, say: (text: string) => void) {
  const last = useRef<AuctionDetail | undefined>(undefined);
  useEffect(() => {
    const before = last.current;
    last.current = auction;
    if (!auction || !before || before.id !== auction.id) return;
    if (before.role === 'leading' && auction.role === 'outbid' && auction.leader && before.currentBid !== null && auction.currentBid !== null) {
      say(`${auction.leader.username} outbid you with ${CR(auction.currentBid)}. Your ${CR(before.currentBid)} is back in your balance.`);
    }
  }, [auction, say]);
}

/** "Auction ended" box: what happened, from the viewer's side. */
function endText(a: AuctionDetail): { title: string; text: string } {
  const name = fullName(a.item.skin);
  if (a.status === 'cancelled') return { title: 'Listing cancelled', text: a.role === 'seller' ? `Your ${name} is back in your inventory.` : 'The seller took it off the market before anyone bid.' };
  if (a.status === 'unsold') return { title: 'Not sold', text: a.role === 'seller' ? `Nobody bid. Your ${name} is back in your inventory.` : 'Nobody bid on it.' };
  const price = a.finalPrice ?? 0;
  if (a.role === 'won') return { title: a.boughtNow ? `You bought it for ${CR(price)}` : `You won it for ${CR(price)}`, text: `${name} is in your inventory.` };
  const buyer = a.buyer?.username ?? 'another player';
  if (a.role === 'seller') return { title: `Sold to ${buyer} for ${CR(price)}`, text: `You received ${CR(price - (a.fee ?? 0))} after the ${a.feePct.toLocaleString('en-US')}% fee.` };
  if (a.role === 'lost') return { title: `Sold to ${buyer} for ${CR(price)}`, text: 'Better luck next time. Nothing was taken from your balance.' };
  return { title: `Sold to ${buyer} for ${CR(price)}`, text: a.boughtNow ? 'Bought at the buy-now price.' : 'The highest bid won.' };
}

export function Auction() {
  const { id = '' } = useParams();
  const economy = useEconomyText();
  const mobile = useIsMobile();
  const location = useLocation();
  const back: Back = (location.state as { back?: Back } | null)?.back ?? { to: '/market', label: 'Market' };
  const { data: auction, error } = useAuction(id);
  const { data: me } = useMe();
  const now = useServerNow();
  const urgentOf = useIsUrgent();
  const bid = usePlaceBid();
  const buy = useBuyNow();
  const [amount, setAmount] = useState('');
  const [problem, setProblem] = useState('');
  const [toast, setToast] = useState('');
  const [confirmBuy, setConfirmBuy] = useState(false);
  useOutbidToast(auction, setToast);
  // The price flashes each time a new bid comes in (polling or your own bid).
  const bidChanges = useChangeCount(auction ? `${auction.id}:${auction.currentBid}` : undefined);
  const flash: CSSProperties | undefined = bidChanges ? { animation: 'mint-flash 900ms var(--ease-out) both', borderRadius: 'var(--radius-control)' } : undefined;

  if (error) {
    return (
      <Page gap={24} top={32} back={back}>
        <EmptyState title="This auction isn’t available">
          <Button variant="secondary" size={44} to="/market">
            Back to the market
          </Button>
        </EmptyState>
      </Page>
    );
  }
  if (!auction) return <Page gap={24} top={32} back={back}>{null}</Page>;

  const item = auction.item;
  const running = isRunning(auction, now);
  const urgent = urgentOf(auction, now);
  const hasBids = auction.currentBid !== null;
  const typed = amount === '' ? auction.minNextBid : Number(amount);
  const leaderLine = hasBids ? `${auction.role === 'leading' ? 'You lead' : `${auction.leader?.username ?? '—'} leads`} · ${auction.bidCount} ${auction.bidCount > 1 ? 'bids' : 'bid'}` : 'No bids yet';

  // Checks the server would make anyway, done first so a doomed request is never sent.
  const bidProblem = () => {
    if (!Number.isFinite(typed) || typed < auction.minNextBid) return `The lowest bid is ${CR(auction.minNextBid)}.`;
    if (me && typed > me.balance) return `You only have ${CR(me.balance)}.`;
    return '';
  };
  const buyProblem = () =>
    me && auction.buyNowPrice !== null && auction.buyNowPrice > me.balance ? `You need ${CR(auction.buyNowPrice - me.balance)} more to buy it now.` : '';

  const place = () => {
    const local = bidProblem();
    setProblem(local);
    if (local) return;
    bid.mutate(
      { id: auction.id, amount: typed },
      {
        onSuccess: (r) => {
          setAmount('');
          setToast(
            r.extended
              ? `You lead with ${CR(r.auction.currentBid ?? typed)}. Your bid landed in the last ${economy.snipe}, so the auction got ${economy.snipeMore}.`
              : `You lead with ${CR(r.auction.currentBid ?? typed)}, held from your balance.`,
          );
        },
        onError: (e) => setProblem(errorText(e, 'Couldn’t place the bid. Try again.')),
      },
    );
  };
  const askBuy = () => {
    const local = buyProblem();
    setProblem(local);
    if (!local) setConfirmBuy(true);
  };
  const buyNow = () =>
    buy.mutate(
      { id: auction.id },
      {
        onSuccess: () => {
          setConfirmBuy(false);
          setToast('');
        },
        onError: (e) => {
          setConfirmBuy(false);
          setProblem(errorText(e, 'Couldn’t buy it. Try again.'));
        },
      },
    );

  const timerBox: CSSProperties = urgent ? { background: 'var(--primary-bg)', color: 'var(--primary-text)' } : { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' };
  const timerLabel = !running ? 'Ended' : urgent ? 'Ending' : 'Ends in';
  const timerHint = !running ? 'No more bids' : urgent ? `A bid now adds ${economy.snipe}` : `Highlighted in the last ${economy.snipe}`;
  const ended = auction.status !== 'active' ? endText(auction) : null;

  const toastBox = toast && running && (
    <div role="status" className="anim" style={{ padding: mobile ? '12px 14px' : '12px 16px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-card)', background: 'var(--surface-bar)', fontSize: mobile ? 13 : 14, lineHeight: 1.45, animation: 'mint-rise 300ms ease-out both' }}>
      {toast}
    </div>
  );

  const buyRow = auction.canBuyNow && auction.buyNowPrice !== null && (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: mobile ? 0 : 16, borderTop: mobile ? undefined : '1px solid var(--separator)' }}>
      <span style={{ fontSize: 14, color: 'var(--text-2)' }}>Or end it now</span>
      {confirmBuy ? (
        <span style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" size={44} onClick={() => setConfirmBuy(false)} style={{ paddingInline: 12 }}>
            Cancel
          </Button>
          <Button size={44} bevel="none" onClick={buyNow} disabled={buy.isPending} style={{ paddingInline: 16, fontSize: 14 }}>
            Buy for {CR(auction.buyNowPrice)}
          </Button>
        </span>
      ) : (
        <Button variant="secondary" size={44} onClick={askBuy} style={{ paddingInline: 18, fontSize: 14 }}>
          <span>
            Buy now · <span className="mono">{CR(auction.buyNowPrice)}</span>
          </span>
        </Button>
      )}
    </div>
  );

  // Why you can't bid, in place of the form.
  const blocked =
    auction.role === 'seller'
      ? auction.canCancel
        ? 'This is your listing. You can take it off the market while nobody has bid.'
        : 'This is your listing. Bids are held from the bidders and the best one wins.'
      : auction.role === 'leading'
        ? `You have the highest bid. Your ${CR(auction.currentBid ?? 0)} is held until someone outbids you.`
        : me?.isGuest
          ? 'Sign in with Discord to bid and sell.'
          : null;

  const history = (
    <section aria-labelledby="hist-title" style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: mobile ? 0 : 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: mobile ? 6 : 0 }}>
        <h2 id="hist-title" className="lbl">
          {`// Bid history · ${auction.bidCount}`}
        </h2>
        {!mobile && (
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {auction.bidCount} {auction.bidCount === 1 ? 'bid' : 'bids'}
          </span>
        )}
      </div>
      {auction.bids.length ? (
        <ol className="stagger-list" style={{ listStyle: 'none', margin: 0, padding: 0, ...(mobile ? {} : { border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)', overflow: 'hidden' }) }}>
          {auction.bids.map((b, i) => (
            <BidRow key={`${b.createdAt}-${i}`} bid={b} leading={i === 0} now={now} mobile={mobile} />
          ))}
        </ol>
      ) : (
        <p style={{ padding: mobile ? '10px 0' : '18px', border: mobile ? undefined : '1px solid var(--border)', borderTop: mobile ? '1px solid var(--separator)' : undefined, borderRadius: mobile ? undefined : 'var(--radius-panel)', fontSize: 14, color: 'var(--text-2)' }}>
          No bids yet. The first one is at least the starting price.
        </p>
      )}
    </section>
  );

  if (mobile) {
    const bar = running && auction.canBid;
    return (
      <Page
        gap={0}
        back={back}
        mobilePadding={`0 20px ${bar ? 120 : 32}px`}
        mobileRight={
          <span className="mono" style={{ marginRight: 12, fontSize: 12, color: 'var(--text-2)' }}>
            Held {CR(me?.heldInBids ?? 0)}
          </span>
        }
      >
        <CompactStage item={item} height={210} mobile right={item.wear && item.float !== null ? `${item.wear.code} · ${formatFloat(item.float, 4)}` : 'Vanilla'} />
        <div role="timer" aria-live="off" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 -20px', padding: '12px 20px', ...(urgent ? timerBox : { background: 'var(--surface)', color: 'var(--text)', borderBottom: '1px solid var(--border)' }) }}>
          <span className="lbl" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'inherit' }}>
            {urgent && <UrgentDot size={7} />}
            {timerLabel}
          </span>
          <span className="mono" style={{ fontSize: 26, fontWeight: 600 }}>
            {pageTimer(auction, now)}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                {item.skin.weaponName}
                {item.stattrak ? ' · StatTrak™' : ''}
              </span>
              <h1 style={{ fontSize: 30, lineHeight: 1, fontWeight: 600, letterSpacing: '-0.02em' }}>{finishLabel(item.skin)}</h1>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <span className="lbl" style={{ fontSize: 10 }}>
                {auction.status === 'sold' ? 'Sold for' : hasBids ? 'Current bid' : 'Starting price'}
              </span>
              <span key={bidChanges} className="mono" style={{ fontSize: 22, fontWeight: 500, ...flash }}>
                {CR(auction.finalPrice ?? auction.currentBid ?? auction.startPrice)}
              </span>
            </div>
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {[leaderLine, `sold by ${auction.seller.username}`, auction.buyNowPrice !== null ? `buy now ${CR(auction.buyNowPrice)}` : null].filter(Boolean).join(' · ')}
          </span>
          {toastBox}
          {ended && (
            <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 16, border: '1px solid var(--text)', borderRadius: 'var(--radius-card)', background: 'var(--surface-bar)' }}>
              <span className="lbl" style={{ fontSize: 10, color: 'var(--text)' }}>
                Auction ended
              </span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{ended.title}</span>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{ended.text}</span>
            </div>
          )}
          {/* Timer at 00:00 before the server settles: same notice as on desktop. */}
          {!running && auction.status === 'active' && (
            <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 16, border: '1px solid var(--text)', borderRadius: 'var(--radius-card)', background: 'var(--surface-bar)' }}>
              <span className="lbl" style={{ fontSize: 10, color: 'var(--text)' }}>
                Auction ended
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Closing the sale…</span>
            </div>
          )}
          {running && blocked && <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>{blocked}</p>}
          {running && me?.isGuest && (
            <Button variant="secondary" size={48} block to="/connect">
              Continue with Discord
            </Button>
          )}
          {running && auction.canCancel && <CancelListing id={auction.id} mobile />}
          {buyRow}
          {history}
        </div>
        {bar && (
          <section aria-label="Place a bid" style={{ position: 'fixed', left: 0, right: 0, bottom: 'var(--tabbar)', zIndex: 5, minHeight: 92, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: '10px 16px', background: 'var(--surface-bar)', borderTop: '1px solid var(--border-strong)' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ position: 'relative', flex: 1, display: 'block' }}>
                <span className="lbl" style={{ position: 'absolute', left: 12, top: 6, fontSize: 9 }}>
                  Your bid · min. {CR(auction.minNextBid)}
                </span>
                <input
                  type="number"
                  className="mono"
                  inputMode="numeric"
                  min={auction.minNextBid}
                  step={10}
                  value={amount === '' ? String(auction.minNextBid) : amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setProblem('');
                  }}
                  style={{ boxSizing: 'border-box', width: '100%', height: 52, padding: '18px 44px 0 12px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-control)', background: 'var(--page)', color: 'var(--text)', fontSize: 17 }}
                />
                <span className="mono" style={{ position: 'absolute', right: 12, top: 20, fontSize: 12, color: 'var(--text-2)' }}>
                  CR
                </span>
              </label>
              <Button size={52} bevel={10} onClick={place} disabled={bid.isPending} style={{ paddingInline: 20, fontSize: 15 }}>
                Place bid
              </Button>
            </div>
            {problem && (
              <span role="alert" style={{ fontSize: 12, color: 'var(--error)' }}>
                {problem}
              </span>
            )}
          </section>
        )}
      </Page>
    );
  }

  const facts = [
    { k: 'Seller', v: auction.role === 'seller' ? `${auction.seller.username} (you)` : auction.seller.username },
    { k: 'Starting price', v: CR(auction.startPrice) },
    { k: 'Listed', v: `${shortDate(auction.createdAt)} · ${auction.durationHours} h` },
  ];

  return (
    <Page gap={28} top={32}>
      <Link to={back.to} className="mono" style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--text-2)', textDecoration: 'none' }}>
        ← {back.label}
      </Link>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 500px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ItemStage item={item} minHeight={440} />
          {item.float !== null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 20px', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="lbl">Float</span>
                <span className="mono" style={{ fontSize: 18 }}>
                  {formatFloat(item.float, 9)}
                </span>
              </div>
              <FloatBar float={item.float} min={item.minFloat} max={item.maxFloat} />
            </div>
          )}
          <FactsList facts={facts} />
        </div>

        <div style={{ flex: '1 1 400px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 16, color: 'var(--text-2)' }}>{item.skin.weaponName}</span>
            <h1 style={{ fontSize: 48, lineHeight: 1, fontWeight: 600, letterSpacing: '-0.025em' }}>{finishLabel(item.skin)}</h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              <RarityPill tier={item.skin.tier} />
              {item.stattrak && <StatTrakPill />}
              <WearPill wear={item.wear} />
            </div>
          </div>

          <div role="timer" aria-live="off" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '18px 22px', borderRadius: 'var(--radius-panel)', ...timerBox }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="lbl" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'inherit' }}>
                {urgent && <UrgentDot size={8} />}
                {timerLabel}
              </span>
              <span style={{ fontSize: 13, opacity: 0.8 }}>{timerHint}</span>
            </div>
            <span className="mono" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em' }}>
              {pageTimer(auction, now)}
            </span>
          </div>

          {toastBox}

          {running && (
            <section aria-labelledby="bid-title" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 22, border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <h2 id="bid-title" className="lbl">
                    {hasBids ? 'Current bid' : 'Starting price'}
                  </h2>
                  <span key={bidChanges} className="mono" style={{ fontSize: 30, fontWeight: 500, alignSelf: 'flex-start', ...flash }}>
                    {CR(auction.currentBid ?? auction.startPrice)}
                  </span>
                </div>
                <span style={{ fontSize: 13, color: 'var(--text-2)', textAlign: 'right' }}>{leaderLine}</span>
              </div>
              {auction.canBid ? (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-2)' }}>Your bid</span>
                      <span className="mono" style={{ color: 'var(--text-2)' }}>
                        min. {CR(auction.minNextBid)} {hasBids ? `(+${economy.bidStep})` : '(starting price)'}
                      </span>
                    </span>
                    <span style={{ position: 'relative', display: 'block' }}>
                      <input
                        type="number"
                        className="mono"
                        min={auction.minNextBid}
                        step={10}
                        value={amount === '' ? String(auction.minNextBid) : amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          setProblem('');
                        }}
                        style={{ boxSizing: 'border-box', width: '100%', height: 52, padding: '0 56px 0 16px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-control)', background: 'var(--page)', color: 'var(--text)', fontSize: 20 }}
                      />
                      <span className="mono" style={{ position: 'absolute', right: 16, top: 16, fontSize: 14, color: 'var(--text-2)' }}>
                        CR
                      </span>
                    </span>
                  </label>
                  <div role="group" aria-label="Quick bids" style={{ display: 'flex', gap: 8 }}>
                    {auction.quickBids.map((q) => (
                      <button
                        key={q.label}
                        type="button"
                        className="mono chip-quick"
                        onClick={() => {
                          setAmount(String(q.amount));
                          setProblem('');
                        }}
                        style={{ flex: 1, height: 40, border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-control)', background: 'transparent', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}
                      >
                        {q.label} · {CR(q.amount)}
                      </button>
                    ))}
                  </div>
                  {problem && (
                    <p role="alert" style={{ fontSize: 13, color: 'var(--error)' }}>
                      {problem}
                    </p>
                  )}
                  <Button size={52} block onClick={place} disabled={bid.isPending} style={{ fontSize: 16 }}>
                    Place bid
                  </Button>
                  <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-3)' }}>
                    Your bid is held from your balance and comes back the moment someone outbids you. A bid in the last {economy.snipe} adds {economy.snipe}.
                  </p>
                </>
              ) : (
                <>
                  {blocked && <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-2)' }}>{blocked}</p>}
                  {me?.isGuest && (
                    <Button variant="secondary" size={44} to="/connect" style={{ alignSelf: 'flex-start', paddingInline: 18 }}>
                      Continue with Discord
                    </Button>
                  )}
                  {auction.canCancel && <CancelListing id={auction.id} />}
                  {problem && (
                    <p role="alert" style={{ fontSize: 13, color: 'var(--error)' }}>
                      {problem}
                    </p>
                  )}
                </>
              )}
              {buyRow}
            </section>
          )}

          {ended && (
            <section role="status" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 22, border: '1px solid var(--text)', borderRadius: 'var(--radius-panel)', background: 'var(--surface-bar)' }}>
              <span className="lbl" style={{ color: 'var(--text)' }}>
                Auction ended
              </span>
              <span style={{ fontSize: 20, fontWeight: 600 }}>{ended.title}</span>
              <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{ended.text}</span>
              <Button variant="secondary" size={44} to="/market" style={{ alignSelf: 'flex-start', paddingInline: 16, fontSize: 14 }}>
                Back to the market
              </Button>
            </section>
          )}
          {!running && auction.status === 'active' && (
            <section role="status" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 22, border: '1px solid var(--text)', borderRadius: 'var(--radius-panel)', background: 'var(--surface-bar)' }}>
              <span className="lbl" style={{ color: 'var(--text)' }}>
                Auction ended
              </span>
              <span style={{ fontSize: 14, color: 'var(--text-2)' }}>Closing the sale…</span>
            </section>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        {history}
        <section aria-labelledby="sales-title" style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 id="sales-title" className="lbl">
              // Recent sales · {finishLabel(item.skin)} {salesLabel(auction.sales)}
            </h2>
            {auction.sales.average !== null && (
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                Average {CR(auction.sales.average)}
              </span>
            )}
          </div>
          <div style={{ padding: '18px 20px', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' }}>
            {auction.sales.count ? (
              <SalesChart
                sales={auction.sales}
                height={140}
                label={salesAria(auction.sales, `Last ${auction.sales.count} sales of this skin and wear`)}
                caption={salesDates(auction.sales)}
              />
            ) : (
              <p style={{ fontSize: 14, color: 'var(--text-2)' }}>No sales of this skin and wear yet.</p>
            )}
          </div>
        </section>
      </div>
    </Page>
  );
}

function CancelListing({ id, mobile }: { id: string; mobile?: boolean }) {
  const [asking, setAsking] = useState(false);
  const cancel = useCancelListing();
  if (!asking) {
    return (
      <Button variant="secondary" size={44} block={mobile} onClick={() => setAsking(true)} style={mobile ? undefined : { alignSelf: 'flex-start', paddingInline: 16 }}>
        Cancel listing
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-label="Cancel listing" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 14 }}>Take it off the market? It goes back to your inventory.</span>
      <Button variant="ghost" size={44} onClick={() => setAsking(false)} style={{ paddingInline: 12 }}>
        Keep it listed
      </Button>
      <Button size={44} bevel="none" onClick={() => cancel.mutate(id, { onSettled: () => setAsking(false) })} disabled={cancel.isPending} style={{ paddingInline: 16, fontSize: 14 }}>
        Cancel listing
      </Button>
    </div>
  );
}
