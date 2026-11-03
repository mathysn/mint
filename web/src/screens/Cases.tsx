import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Page, PageHeader } from '../components/layout/AppShell';
import { CaseTile } from '../components/items/items';
import { SEARCH_MIN_CHARS, SkinSearchField } from '../components/items/SkinSearch';
import { OddsStrip } from '../components/opening/opening';
import { Chip } from '../components/ui/fields';
import { EmptyState } from '../components/ui/primitives';
import { useCaseFinder, useConfig, useCrates, useMe } from '../lib/queries';
import { useDebounced } from '../lib/useDebounced';
import { useIsMobile } from '../lib/useMediaQuery';
import type { CrateSummary } from '../../../shared/api';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'progress', label: 'Album in progress' },
  { key: 'none', label: 'Not started' },
] as const;

type Filter = (typeof FILTERS)[number]['key'];

// Display filter over flags and counts the server already computed.
const matches = (crate: CrateSummary, filter: Filter) =>
  filter === 'all' ||
  (filter === 'new' && crate.isNew) ||
  (filter === 'progress' && crate.completion.owned > 0) ||
  (filter === 'none' && crate.completion.owned === 0);

export function Cases() {
  const mobile = useIsMobile();
  const [filter, setFilter] = useState<Filter>('all');
  const { data: crates } = useCrates();
  const { data: config } = useConfig();
  const price = (config?.cratePrice ?? 250).toLocaleString('en-US');
  const { data: me } = useMe();
  const freeAvailable = Boolean(me?.freeCase.available);

  // Weapon finder: the search stays in the URL, so it is still there when coming back from a case.
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const setQ = (next: string) =>
    setParams(
      (p) => {
        if (next) p.set('q', next);
        else p.delete('q');
        return p;
      },
      { replace: true },
    );
  const [open, setOpen] = useState(false);
  const typed = useDebounced(q, 150);
  const finder = useCaseFinder(typed);
  const searching = q.trim().length >= SEARCH_MIN_CHARS;
  const found = searching ? finder.data : undefined;
  const drops = new Map(found?.crates.map((c) => [c.id, c]));
  const names = new Map(crates?.map((c) => [c.id, c.name]));
  const shown = (crates ?? []).filter((c) => matches(c, filter) && (!found || drops.has(c.id)));
  const caseLink = (id: string) => (found ? `/cases/${id}?${new URLSearchParams({ find: q.trim() })}` : undefined);

  const chips = (
    <div role="group" aria-label="Filter cases" className={mobile ? 'hscroll' : undefined} style={mobile ? { display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -20px', padding: '0 20px' } : { display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {FILTERS.map((f) => (
        <Chip key={f.key} pressed={filter === f.key} onClick={() => setFilter(f.key)}>
          {f.label}
        </Chip>
      ))}
    </div>
  );

  const search = (
    <SkinSearchField
      label="Find a skin"
      value={q}
      onChange={setQ}
      open={open}
      onOpenChange={setOpen}
      suggestions={found?.skins}
      settled={finder.isFetched && !finder.isPlaceholderData}
      hint={(s) => (s.crateIds.length > 1 ? `${s.crateIds.length} cases` : null)}
      detail={(s) => (s.crateIds.length === 1 ? names.get(s.crateIds[0]!) : null)}
      style={mobile ? undefined : { width: 340, maxWidth: '100%' }}
    />
  );

  return (
    <Page gap={36}>
      <PageHeader
        label="// Cases"
        title="Cases"
        sub={mobile ? `${price} CR each, same odds everywhere.` : `Every case costs ${price} CR and shares the same odds. Inside a rarity, every skin is equally likely.`}
        right={mobile ? undefined : chips}
      />
      {config && <OddsStrip odds={config.odds} mobile={mobile} />}
      {search}
      {mobile && chips}
      {crates && shown.length === 0 && <EmptyState title={found && found.crates.length === 0 ? `No case drops “${q.trim()}”` : 'No cases match this filter'} />}
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(min(250px, 100%), 1fr))', gap: mobile ? 12 : 20 }}>
        {shown.map((crate, i) => (
          <CaseTile key={crate.id} crate={crate} variant={mobile ? 'mobileGrid' : 'grid'} free={crate.isFreeToday && freeAvailable} drops={drops.get(crate.id)} to={caseLink(crate.id)} index={i} />
        ))}
      </div>
    </Page>
  );
}
