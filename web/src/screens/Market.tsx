import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { MarketSort, MarketTab, Tier } from '../../../shared/api';
import { Page } from '../components/layout/AppShell';
import { SkinSearch } from '../components/items/SkinSearch';
import { AuctionRow, AuctionTile } from '../components/market/market';
import { Tabs } from '../components/trades/trades';
import { Button } from '../components/ui/Button';
import { RarityChip, Select, type SelectOption } from '../components/ui/fields';
import { HudLabel } from '../components/ui/primitives';
import { useMarket, useServerNow } from '../lib/market';
import { useEconomyText } from '../lib/queries';
import { RARITY, TIER_ORDER } from '../lib/rarity';
import { useIsAccount } from '../lib/social';
import { useDebounced } from '../lib/useDebounced';
import { useIsMobile } from '../lib/useMediaQuery';

const SORTS: SelectOption<MarketSort>[] = [
  { value: 'ending', label: 'Ending soon' },
  { value: 'newest', label: 'Newly listed' },
  { value: 'price', label: 'Lowest bid' },
  { value: 'bids', label: 'Most bids' },
];

const EMPTY: Record<MarketTab, string> = {
  browse: 'No auctions right now. List an item to start one.',
  mine: 'You have nothing listed. Your listings show up here, and stay a week after they end.',
  bids: 'Auctions you bid on show up here, and stay a week after they end.',
};

export function Market() {
  const mobile = useIsMobile();
  const economy = useEconomyText();
  const account = useIsAccount();
  const [params, setParams] = useSearchParams();
  const tab = (['browse', 'mine', 'bids'].includes(params.get('tab') ?? '') ? params.get('tab') : 'browse') as MarketTab;
  const tier = (params.get('tier') ?? 'all') as Tier | 'all';
  const sort = (SORTS.some((s) => s.value === params.get('sort')) ? params.get('sort') : 'ending') as MarketSort;
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim(), 250);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || (k === 'tab' && v === 'browse') || (k === 'tier' && v === 'all') || (k === 'sort' && v === 'ending')) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if (q !== (params.get('q') ?? '')) update({ q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = new URLSearchParams({ tab, sort, ...(q ? { q } : {}), ...(tier !== 'all' ? { tier } : {}) });
  const market = useMarket(query.toString());
  const data = market.data?.pages[0];
  const auctions = market.data?.pages.flatMap((p) => p.auctions) ?? [];
  const now = useServerNow();
  const filtered = Boolean(q) || tier !== 'all';

  const tabs = (
    <Tabs<MarketTab>
      label="Market views"
      mobile={mobile}
      plain
      value={tab}
      onChange={(t) => update({ tab: t })}
      tabs={
        mobile
          ? [
              { value: 'browse', label: 'Browse' },
              { value: 'mine', label: 'Mine', count: data?.counts.mine || undefined },
              { value: 'bids', label: 'Bids', count: data?.counts.bids || undefined },
            ]
          : [
              { value: 'browse', label: 'Browse', count: data?.counts.browse },
              { value: 'mine', label: 'My listings', count: data ? `${data.counts.mine} / ${data.maxListings}` : undefined },
              { value: 'bids', label: 'My bids', count: data?.counts.bids },
            ]
      }
    />
  );

  const chips = [
    <RarityChip key="all" pressed={tier === 'all'} color="var(--text)" onClick={() => update({ tier: 'all' })}>
      All
    </RarityChip>,
    ...TIER_ORDER.map((t) => (
      <RarityChip key={t} pressed={tier === t} color={RARITY[t].color} onClick={() => update({ tier: t })}>
        {t === 'gold' ? '★' : RARITY[t].name}
      </RarityChip>
    )),
  ];

  const empty = data && auctions.length === 0 && (
    <div style={{ padding: mobile ? '40px 20px' : '64px 24px', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-panel)', textAlign: 'center', fontSize: mobile ? 14 : 15, color: 'var(--text-2)' }}>
      {filtered ? 'Nothing matches these filters right now.' : EMPTY[tab]}
    </div>
  );

  const more = market.hasNextPage && (
    <Button variant="secondary" size={44} onClick={() => void market.fetchNextPage()} disabled={market.isFetchingNextPage} style={{ alignSelf: 'center', paddingInline: 20 }}>
      Show more
    </Button>
  );

  const listButton = account ? (
    <Button size={mobile ? 44 : 48} bevel={mobile ? 'none' : 12} to="/sell" style={mobile ? { height: 36, fontSize: 14, paddingInline: 14, marginRight: 12 } : { paddingInline: 26 }}>
      List an item
    </Button>
  ) : null;

  if (mobile) {
    return (
      <Page gap={16} back={{ to: '/more', label: 'More' }} mobilePadding="8px 20px 32px" mobileRight={listButton ?? undefined}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <HudLabel>// Auction house</HudLabel>
          <h1 style={{ fontSize: 32, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>Market</h1>
        </div>
        {tabs}
        <SkinSearch label="Search" value={search} onChange={setSearch} scope="market" />
        <div className="hscroll" role="group" aria-label="Rarity" style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -20px', padding: '0 20px' }}>
          {chips}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {data ? `${auctions.length}${market.hasNextPage ? '+' : ''} auction${auctions.length === 1 ? '' : 's'}` : ''}
          </span>
          <Select<MarketSort> variant="inline" prefix="Sort:" ariaLabel="Sort" value={sort} options={SORTS} onChange={(v) => update({ sort: v })} />
        </div>
        {empty}
        <ul className="stagger-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {auctions.map((a) => (
            <AuctionRow key={a.id} auction={a} now={now} />
          ))}
        </ul>
        {more}
      </Page>
    );
  }

  return (
    <Page gap={24}>
      <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <HudLabel>// Auction house</HudLabel>
          <h1 style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>Market</h1>
          <p style={{ maxWidth: 600, fontSize: 14, lineHeight: 1.5, color: 'var(--text-2)' }}>
            Bids are held from your balance and returned the moment someone outbids you. The seller pays a {economy.fee} fee when the sale closes.
          </p>
        </div>
        {listButton}
      </header>
      {tabs}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '14px 20px' }}>
        <SkinSearch label="Search" value={search} onChange={setSearch} scope="market" style={{ flex: '0 1 340px' }} />
        <div role="group" aria-label="Rarity" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chips}
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <Select<MarketSort> label="Sort" value={sort} options={SORTS} onChange={(v) => update({ sort: v })} style={{ minWidth: 170 }} />
        </div>
      </div>
      {empty}
      <div className="stagger-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(250px, 100%), 1fr))', gap: 18 }}>
        {auctions.map((a) => (
          <AuctionTile key={a.id} auction={a} now={now} />
        ))}
      </div>
      {more}
    </Page>
  );
}
