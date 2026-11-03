import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { TradeOffer } from '../../../shared/api';
import { Page } from '../components/layout/AppShell';
import { AccountRequired, TRADES_ICON } from '../components/social/social';
import { FriendPicker } from '../components/trades/FriendPicker';
import { DoneBanner, OfferCard, Tabs } from '../components/trades/trades';
import { Button } from '../components/ui/Button';
import { EmptyState, HudLabel } from '../components/ui/primitives';
import { formatCredits } from '../lib/format';
import { useMe, useNow } from '../lib/queries';
import { fullName } from '../lib/rarity';
import { useIsAccount } from '../lib/social';
import { type Box, useTradeAction, useTrades } from '../lib/trades';
import { useIsMobile } from '../lib/useMediaQuery';

const EMPTY: Record<Box, string> = {
  received: 'No offers waiting for you.',
  sent: 'You have no offers waiting for an answer.',
  history: 'Answered, cancelled and expired offers show up here.',
};

export function Trades() {
  const mobile = useIsMobile();
  const account = useIsAccount();
  // The tab lives in the URL: sending an offer lands on /trades?box=sent.
  const [params, setParams] = useSearchParams();
  const box: Box = params.get('box') === 'sent' || params.get('box') === 'history' ? (params.get('box') as Box) : 'received';
  const setBox = (next: Box) => setParams(next === 'received' ? {} : { box: next }, { replace: true });
  const [banner, setBanner] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const { data: me } = useMe();
  const received = useTrades('received');
  const sent = useTrades('sent');
  const history = useTrades('history');
  const offers = { received, sent, history }[box].data;
  const now = useNow(true);
  const action = useTradeAction();

  const run = (offer: TradeOffer, kind: 'accept' | 'decline' | 'cancel') =>
    action.mutate(
      { id: offer.id, action: kind },
      {
        onSuccess: (result) => {
          const who = offer.counterparty.username;
          if (result.status === 'accepted') {
            const got = offer.get.items.map((i) => fullName(i.skin));
            setBanner(`Trade done with ${who}.${got.length ? ` ${got.join(', ')} added to your inventory.` : ''}`);
          } else if (kind === 'accept') setBanner(result.reason ?? 'This offer can no longer go through.');
          else if (kind === 'decline') setBanner(`Offer from ${who} declined. Their items are unlocked.`);
          else setBanner(`Offer to ${who} cancelled. Your items are unlocked.`);
        },
      },
    );

  const actionsFor = (offer: TradeOffer) => {
    if (offer.status !== 'pending') return undefined;
    if (offer.direction === 'sent') {
      return (
        <Button variant="secondary" size={44} block={mobile} onClick={() => run(offer, 'cancel')} disabled={action.isPending} style={{ paddingInline: 16 }}>
          Cancel offer
        </Button>
      );
    }
    const counter = `/trades/new?counter=${offer.id}`;
    // Asked for more CR than you have: the server would refuse it (402), so don't offer the click.
    const short = me ? offer.give.credits - me.balance : 0;
    const accept = mobile ? (
      <Button size={44} bevel="none" onClick={() => run(offer, 'accept')} disabled={action.isPending || short > 0}>
        Accept
      </Button>
    ) : (
      <Button size={44} bevel={10} onClick={() => run(offer, 'accept')} disabled={action.isPending || short > 0} style={{ paddingInline: 22 }}>
        Accept trade
      </Button>
    );
    const shortNote = short > 0 && (
      <span style={{ fontSize: 13, color: 'var(--error)' }}>You need {formatCredits(short)} more CR to accept.</span>
    );
    return mobile ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shortNote}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          <Button variant="ghost" size={44} onClick={() => run(offer, 'decline')} disabled={action.isPending}>
            Decline
          </Button>
          <Button variant="secondary" size={44} to={counter}>
            Counter
          </Button>
          {accept}
        </div>
      </div>
    ) : (
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {shortNote}
        <Button variant="ghost" size={44} onClick={() => run(offer, 'decline')} disabled={action.isPending} style={{ paddingInline: 14 }}>
          Decline
        </Button>
        <Button variant="secondary" size={44} to={counter} style={{ paddingInline: 16 }}>
          Counter
        </Button>
        {accept}
      </div>
    );
  };

  const tabs = (
    <Tabs<Box>
      label="Offers"
      mobile={mobile}
      value={box}
      onChange={(b) => {
        setBox(b);
        setBanner(null);
      }}
      tabs={[
        { value: 'received', label: 'Received', count: received.data?.length },
        { value: 'sent', label: 'Sent', count: sent.data?.length },
        { value: 'history', label: 'History' },
      ]}
    />
  );

  const list = (
    <div className="stagger-list" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {offers?.map((offer) => (
        <OfferCard key={offer.id} offer={offer} now={now} mobile={mobile} actions={actionsFor(offer)} />
      ))}
      {offers && offers.length === 0 && <EmptyState title={EMPTY[box]} />}
    </div>
  );

  if (!account) {
    return (
      <Page gap={28} back={mobile ? { to: '/more', label: 'More' } : undefined} mobilePadding="8px 20px 32px">
        <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!mobile && <HudLabel>// Trades</HudLabel>}
          <h1 style={{ fontSize: mobile ? 32 : 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>Trades</h1>
        </header>
        <AccountRequired icon={TRADES_ICON} title="Trade with your friends" text="Sign in with Discord to send and receive trade offers: items and credits, both ways." />
      </Page>
    );
  }

  if (mobile) {
    return (
      <Page
        gap={18}
        back={{ to: '/more', label: 'More' }}
        mobilePadding="8px 20px 32px"
        mobileRight={
          <Button size={44} bevel="none" onClick={() => setPicking(true)} style={{ height: 36, fontSize: 14, paddingInline: 14, marginRight: 12 }}>
            New offer
          </Button>
        }
      >
        <h1 style={{ fontSize: 32, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>Trades</h1>
        {tabs}
        {banner && <DoneBanner text={banner} />}
        {list}
        {picking && <FriendPicker mobile onClose={() => setPicking(false)} />}
      </Page>
    );
  }

  return (
    <Page gap={28}>
      <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <HudLabel>// Trades</HudLabel>
          <h1 style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>Trades</h1>
          <p style={{ maxWidth: 560, fontSize: 14, lineHeight: 1.5, color: 'var(--text-2)' }}>
            Items in an open offer are locked: they can't be sold, recycled or put in another offer until it's answered.
          </p>
        </div>
        <Button size={48} onClick={() => setPicking(true)} style={{ paddingInline: 26 }}>
          New offer
        </Button>
      </header>
      {tabs}
      {banner && <DoneBanner text={banner} />}
      {list}
      {picking && <FriendPicker onClose={() => setPicking(false)} />}
    </Page>
  );
}
