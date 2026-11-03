import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { InventoryPage, InventorySort, RecycleQuote, Tier, WearCode } from '../../../shared/api';
import { SelectionBar, type AllState } from '../components/inventory/SelectionBar';
import { Page, PageHeader } from '../components/layout/AppShell';
import { SkinSearch } from '../components/items/SkinSearch';
import { ItemCard } from '../components/items/items';
import { Button } from '../components/ui/Button';
import { Chip, RarityChip, Select, type SelectOption } from '../components/ui/fields';
import { EmptyState } from '../components/ui/primitives';
import { api } from '../lib/api';
import { formatCredits } from '../lib/format';
import { keys, useConfig } from '../lib/queries';
import { RARITY, TIER_ORDER } from '../lib/rarity';
import { useRecycle } from '../lib/recycle';
import { fetchPlayerInventory, useIsAccount } from '../lib/social';
import { useDebounced } from '../lib/useDebounced';
import { useIsMobile } from '../lib/useMediaQuery';
import { usePresence } from '../lib/usePresence';
import s from './screens.module.css';

const WEAR_OPTIONS: SelectOption<WearCode | 'all'>[] = [
  { value: 'all', label: 'All wears' },
  { value: 'FN', label: 'Factory New' },
  { value: 'MW', label: 'Minimal Wear' },
  { value: 'FT', label: 'Field-Tested' },
  { value: 'WW', label: 'Well-Worn' },
  { value: 'BS', label: 'Battle-Scarred' },
];

const SORT_OPTIONS: { value: InventorySort; label: string; short: string }[] = [
  { value: 'value', label: 'Value, high to low', short: 'Value ↓' },
  { value: 'recent', label: 'Newest first', short: 'Newest' },
  { value: 'float', label: 'Float, low to high', short: 'Float ↑' },
];

interface Filters {
  rarity: Tier | 'all';
  stattrak: boolean;
  wear: WearCode | 'all';
  crate: string;
  sort: InventorySort;
  q: string;
}

const EMPTY: Filters = { rarity: 'all', stattrak: false, wear: 'all', crate: 'all', sort: 'value', q: '' };

function toQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.rarity !== 'all') p.set('rarity', f.rarity);
  if (f.stattrak) p.set('stattrak', '1');
  if (f.wear !== 'all') p.set('wear', f.wear);
  if (f.crate !== 'all') p.set('crate', f.crate);
  if (f.q.trim()) p.set('q', f.q.trim());
  p.set('sort', f.sort);
  return p.toString();
}

// Server page size: the entrance stagger restarts with each loaded page.
const PAGE_SIZE = 60;

const quoteKey = (ids: string[]) => ['recycleQuote', ids] as const;
const fetchQuote = (ids: string[]) => () => api<RecycleQuote>('/items/recycle/quote', { method: 'POST', json: { itemIds: ids } });

/** Your inventory, or a friend's in read-only mode (/players/:username/inventory). */
export function Inventory() {
  const mobile = useIsMobile();
  const { username: player } = useParams();
  const account = useIsAccount();
  const playerBack = player ? { to: `/players/${encodeURIComponent(player)}`, label: player } : undefined;
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sheet, setSheet] = useState(false);
  const sheetPresence = usePresence(sheet, 180);
  const [selected, setSelected] = useState<string[]>([]);
  // Mobile: checkboxes only show in selection mode ("Selecting"); desktop always shows them.
  const [selecting, setSelecting] = useState(false);
  const set = (patch: Partial<Filters>) => {
    setSelected([]);
    setFilters((f) => ({ ...f, ...patch }));
  };
  const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const clearSelection = () => setSelected([]);
  const client = useQueryClient();
  const maxSelect = useConfig().data?.recycleMaxItems ?? 200;

  // The selection value comes from the server, the client never adds item values up.
  // While a new quote loads the previous one stays on screen (no "…" flicker on each tick).
  const ids = [...selected].sort();
  const quote = useQuery({
    queryKey: quoteKey(ids),
    queryFn: fetchQuote(ids),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  });
  const recycle = useRecycle(() => {
    setSelected([]);
    setSelecting(false);
  });
  const query = toQuery({ ...filters, q: useDebounced(filters.q, 250) });

  // Filtering, sorting and totals happen on the server; pages of 60.
  const inventory = useInfiniteQuery({
    queryKey: player ? ['playerInventory', player, query] : keys.inventoryPages(query),
    queryFn: ({ pageParam }) => (player ? fetchPlayerInventory(player, query, pageParam) : api<InventoryPage>(`/inventory?${query}&offset=${pageParam}`)),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.reduce((n, p) => n + p.items.length, 0) : undefined),
    placeholderData: keepPreviousData,
  });
  const first = inventory.data?.pages[0];
  const items = inventory.data?.pages.flatMap((p) => p.items) ?? [];
  const caseOptions: SelectOption<string>[] = [{ value: 'all', label: 'All cases' }, ...(first?.crates ?? []).map((c) => ({ value: c.id, label: c.name }))];

  // "Select all": every loaded item that isn't locked (listed, in a trade), up to the recycle limit.
  const selectable = items.filter((i) => i.status === 'available').map((i) => i.id);
  const target = selectable.slice(0, maxSelect);
  const allState: AllState = selected.length === 0 ? 'none' : target.length > 0 && target.every((id) => selected.includes(id)) ? 'all' : 'some';
  const toggleAll = () => setSelected(allState === 'all' ? [] : target);
  const selectionBar = !player && (
    <SelectionBar
      selected={selected.length}
      quote={selected.length > 0 ? quote.data : undefined}
      stale={quote.isPlaceholderData}
      freshQuote={() => client.fetchQuery({ queryKey: quoteKey(ids), queryFn: fetchQuote(ids) })}
      pending={recycle.isPending}
      mobile={mobile}
      onClear={clearSelection}
      onRecycle={(confirm) => recycle.mutate({ itemIds: selected, confirm })}
      sellLink={account ? `/sell?items=${selected.join(',')}` : undefined}
      allState={allState}
      onToggleAll={toggleAll}
      nothingToSelect={target.length === 0}
      cap={allState === 'all' && selectable.length > maxSelect ? maxSelect : null}
    />
  );
  const search = (
    <SkinSearch label="Search" value={filters.q} onChange={(q) => set({ q })} scope="inventory" player={player} style={mobile ? undefined : { flex: '0 1 340px' }} />
  );
  const countLabel = first ? `${first.totalCount} ${first.totalCount === 1 ? 'item' : 'items'} · ≈ ${formatCredits(first.totalValue)} CR` : ' ';

  const rarityChips = [
    <RarityChip key="all" pressed={filters.rarity === 'all'} color="var(--text)" onClick={() => set({ rarity: 'all' })}>
      All
    </RarityChip>,
    ...TIER_ORDER.map((tier) => (
      <RarityChip key={tier} pressed={filters.rarity === tier} color={RARITY[tier].color} onClick={() => set({ rarity: tier })}>
        {RARITY[tier].name}
      </RarityChip>
    )),
  ];
  const stattrakChip = (
    <Chip pressed={filters.stattrak} onClick={() => set({ stattrak: !filters.stattrak })} style={filters.stattrak ? undefined : { color: 'var(--text-2)', paddingInline: 12 }}>
      StatTrak™ only
    </Chip>
  );
  const selects = (
    <>
      <Select label="Wear" value={filters.wear} options={WEAR_OPTIONS} onChange={(wear) => set({ wear })} block={mobile} size={mobile ? 44 : 40} style={mobile ? undefined : { minWidth: 160 }} />
      <Select label="Case" value={filters.crate} options={caseOptions} onChange={(crate) => set({ crate })} searchable searchPlaceholder="Search cases" block={mobile} size={mobile ? 44 : 40} style={mobile ? undefined : { minWidth: 200 }} />
      <Select label="Sort" value={filters.sort} options={SORT_OPTIONS} onChange={(sort) => set({ sort })} block={mobile} size={mobile ? 44 : 40} style={mobile ? undefined : { minWidth: 180 }} />
    </>
  );

  const grid = (
    <>
      {first && items.length === 0 && (
        <EmptyState title={first.totalCount === 0 ? 'Nothing here yet' : 'No items match these filters'}>
          {first.totalCount === 0 ? (
            !player && (
            <Button variant="secondary" size={44} to="/cases">
              Browse cases
            </Button>
            )
          ) : (
            <Button variant="secondary" size={44} onClick={() => set(EMPTY)}>
              Clear filters
            </Button>
          )}
        </EmptyState>
      )}
      <div className={mobile ? s.gridMobile : s.grid}>
        {items.map((item, i) => (
          <ItemCard key={item.id} item={item} mobile={mobile} selectable={!player && (!mobile || selecting)} selected={selected.includes(item.id)} onToggle={() => toggle(item.id)} back={playerBack} index={i % PAGE_SIZE} />
        ))}
      </div>
      {inventory.hasNextPage && (
        <Button variant="secondary" size={44} onClick={() => void inventory.fetchNextPage()} disabled={inventory.isFetchingNextPage} style={{ alignSelf: 'center' }}>
          Load more
        </Button>
      )}
    </>
  );

  if (mobile) {
    const sort = SORT_OPTIONS.find((o) => o.value === filters.sort)!;
    return (
      <Page gap={16} mobilePadding="16px 20px 32px" back={playerBack}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {player && <span className="lbl">// {player}</span>}
          <h1 style={{ fontSize: 32, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>Inventory</h1>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {countLabel}
          </p>
        </div>
        {search}
        <div className="hscroll" role="group" aria-label="Rarity" style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -20px', padding: '0 20px' }}>
          {rarityChips}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setSheet(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: 0, border: 0, background: 'none', color: 'var(--text)', fontSize: 14, cursor: 'pointer' }}
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }}>
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4" />
            </svg>
            Filters · {sort.short}
          </button>
          {!player && (
            <span style={{ display: 'flex', gap: 8 }}>
              {selecting && target.length > 0 && (
                <Chip pressed={allState === 'all'} onClick={toggleAll} style={{ paddingInline: 12 }}>
                  {allState === 'all' ? 'Unselect all' : 'Select all'}
                </Chip>
              )}
              <Chip
                pressed={selecting}
                onClick={() => {
                  setSelecting(!selecting);
                  setSelected([]);
                }}
                style={selecting ? { background: 'transparent', color: 'var(--text)', borderColor: 'var(--text)', paddingInline: 12 } : { paddingInline: 12 }}
              >
                {selecting ? 'Selecting' : 'Select'}
              </Chip>
            </span>
          )}
        </div>
        {grid}
        {/* Room for the floating selection panel above the tab bar. */}
        {selected.length > 0 && <div aria-hidden="true" style={{ height: 120 }} />}
        {selectionBar}
        {sheetPresence.mounted && (
          <>
            <div className={s.sheetBackdrop} data-closing={sheetPresence.closing || undefined} onClick={() => setSheet(false)} />
            <div role="dialog" aria-modal="true" aria-label="Filters" className={s.sheet} data-closing={sheetPresence.closing || undefined}>
              <div className={s.panelHead}>
                <span className="lbl">Filters</span>
                <Button variant="ghost" size={44} onClick={() => set({ ...EMPTY, q: filters.q })}>
                  Reset
                </Button>
              </div>
              {stattrakChip}
              {selects}
              <Button size={52} block onClick={() => setSheet(false)}>
                {first ? `Show ${first.matched} ${first.matched === 1 ? 'item' : 'items'}` : 'Show items'}
              </Button>
            </div>
          </>
        )}
      </Page>
    );
  }

  return (
    <Page gap={28}>
      {playerBack && (
        <Link to={playerBack.to} className="mono" style={{ alignSelf: 'flex-start', marginBottom: -12, fontSize: 12, color: 'var(--text-2)', textDecoration: 'none' }}>
          ← {playerBack.label}
        </Link>
      )}
      <PageHeader
        label={player ? `// ${player}` : '// Inventory'}
        title="Inventory"
        sub={
          <span className="mono" style={{ fontSize: 13 }}>
            {countLabel}
          </span>
        }
        right={search}
      />
      <div className={s.filterBar}>
        <div role="group" aria-label="Rarity" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {rarityChips}
          {stattrakChip}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{selects}</div>
      </div>
      {selectionBar}
      {grid}
    </Page>
  );
}
