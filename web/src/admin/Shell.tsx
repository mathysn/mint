import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import type { AdminSearch } from '../../../shared/api';
import { useDebounced } from '../lib/useDebounced';
import { useIsMobile } from '../lib/useMediaQuery';
import { RARITY } from '../lib/rarity';
import { ROLE_LABEL, ago, useAdminSearch, useStaff, utcDay, utcTime } from './lib';
import { Avatar, Icon, SEARCH, cx, s } from './ui';

export const SECTIONS = [
  { key: 'overview', label: 'Overview', to: '/admin', end: true, icon: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z' },
  { key: 'players', label: 'Players', to: '/admin/players', end: false, icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a7 7 0 0 0-4-6.3' },
  { key: 'items', label: 'Items', to: '/admin/items', end: false, icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { key: 'economy', label: 'Economy', to: '/admin/economy', end: false, icon: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4' },
  { key: 'catalog', label: 'Catalog', to: '/admin/catalog', end: false, icon: 'M3 8h18v12H3zM3 12h18M10 12v3h4v-3M8 8V5h8v3' },
  { key: 'market', label: 'Market & trades', to: '/admin/market', end: false, icon: 'M3 12V3h9l9 9-9 9zM7 7h1v1H7z' },
  { key: 'moderation', label: 'Moderation', to: '/admin/moderation', end: false, icon: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z' },
  { key: 'logs', label: 'Logs & tools', to: '/admin/logs', end: false, icon: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01' },
] as const;

const MORE = 'M4 6h16M4 12h16M4 18h16';
const BACK = 'M15 6l-6 6 6 6';

function useBadges() {
  const staff = useStaff();
  return (key: string) => (key === 'market' ? staff.badges.flags : key === 'moderation' ? staff.badges.reports : 0);
}

/** "Oct 23 · 14:12 UTC", from the server clock. */
function useClock() {
  const staff = useStaff();
  const offset = useRef(new Date(staff.now).getTime() - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset.current);
  useEffect(() => {
    offset.current = new Date(staff.now).getTime() - Date.now();
  }, [staff.now]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + offset.current), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const iso = new Date(now).toISOString();
  return `${utcDay(iso)} · ${utcTime(iso)} UTC`;
}

function Logo({ mobile }: { mobile?: boolean }) {
  return (
    <Link to="/admin" aria-label="Mint admin, overview" className={mobile ? s.mLogo : s.logo}>
      <span aria-hidden="true" className={s.logoMark} />
      <span className={s.logoText}>MINT</span>
      <span className={s.tag}>Admin</span>
    </Link>
  );
}

const playerSub = (p: AdminSearch['players'][number]) =>
  `${p.discordId ?? 'guest'} · ${p.banned ? 'Banned' : p.online ? 'Online' : ago(p.lastSeenAt)}`;

/** Results of the global search, grouped Players / Items; arrows and Enter pick one. */
function useSearchResults(q: string, onPick: () => void) {
  const debounced = useDebounced(q.trim(), 200);
  const { data, isFetching } = useAdminSearch(debounced);
  const navigate = useNavigate();
  const ready = debounced.length >= 2 && data && !isFetching;
  const links = [
    ...(data?.players ?? []).map((p) => ({ to: `/admin/players/${p.id}` })),
    ...(data?.items ?? []).map((i) => ({ to: `/admin/items?item=${i.id}` })),
  ];
  const [active, setActive] = useState(-1);
  useEffect(() => setActive(-1), [debounced]);
  const go = (to: string) => {
    onPick();
    navigate(to);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && links.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % links.length);
    } else if (e.key === 'ArrowUp' && links.length) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? links.length - 1 : a - 1));
    } else if (e.key === 'Enter' && links.length) {
      e.preventDefault();
      go(links[Math.max(0, active)]!.to);
    }
  };
  return { data: debounced.length >= 2 ? data : undefined, ready, active, go, onKeyDown, debounced };
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const r = useSearchResults(q, () => {
    setOpen(false);
    setQ('');
    input.current?.blur();
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, []);
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const show = open && r.debounced.length >= 2 && r.data;
  let index = -1;
  return (
    <div ref={box} className={s.search} role="search">
      <label htmlFor="admin-search" className="sr-only">
        Search a player, Discord ID or item ID
      </label>
      <Icon d={SEARCH} size={16} className={s.searchIcon} />
      <input
        ref={input}
        id="admin-search"
        type="search"
        className={s.searchInput}
        placeholder="Search a player, Discord ID or item ID"
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            return;
          }
          r.onKeyDown(e);
        }}
        aria-expanded={Boolean(show)}
        aria-controls="admin-search-results"
      />
      {!q && (
        <span className={cx('mono', s.kbd)} aria-hidden="true">
          {mac ? '⌘K' : 'Ctrl K'}
        </span>
      )}
      {show && r.data && (
        <div id="admin-search-results" role="listbox" aria-label="Search results" className={s.results}>
          {r.data.players.length > 0 && <span className={cx('lbl', s.resultGroup)}>Players</span>}
          {r.data.players.map((p) => {
            index++;
            const i = index;
            return (
              <Link key={p.id} to={`/admin/players/${p.id}`} role="option" aria-selected={r.active === i} data-active={r.active === i || undefined} className={s.result} onClick={(e) => (e.preventDefault(), r.go(`/admin/players/${p.id}`))}>
                <Avatar label={p.label} url={p.avatarUrl} size={24} guest={p.isGuest} />
                <span>{p.label}</span>
                <span className={cx('mono', s.resultSub)}>{playerSub(p)}</span>
              </Link>
            );
          })}
          {r.data.items.length > 0 && (
            <span className={cx('lbl', s.resultGroup)} style={{ paddingTop: 10 }}>
              Items
            </span>
          )}
          {r.data.items.map((item) => {
            index++;
            const i = index;
            return (
              <Link key={item.id} to={`/admin/items?item=${item.id}`} role="option" aria-selected={r.active === i} data-active={r.active === i || undefined} className={s.result} onClick={(e) => (e.preventDefault(), r.go(`/admin/items?item=${item.id}`))}>
                <span aria-hidden="true" className={s.square} style={{ background: RARITY[item.tier].color }} />
                <span>{item.name}</span>
                <span className={cx('mono', s.resultSub)}>{item.serial}</span>
              </Link>
            );
          })}
          {r.data.players.length + r.data.items.length === 0 && <span className={s.resultEmpty}>Nothing for “{r.debounced}”. Try a full Discord ID or a 9-digit item ID.</span>}
        </div>
      )}
    </div>
  );
}

function Sidebar() {
  const staff = useStaff();
  const badge = useBadges();
  return (
    <nav aria-label="Admin" className={s.side}>
      <div className={s.sideInner}>
        <div className={s.sideTop}>
          <Logo />
          <div className={s.nav}>
            {SECTIONS.map((n) => (
              <NavLink key={n.key} to={n.to} end={n.end} className={s.navLink}>
                <Icon d={n.icon} />
                <span>{n.label}</span>
                {badge(n.key) > 0 && <span className={s.badge}>{badge(n.key)}</span>}
              </NavLink>
            ))}
          </div>
        </div>
        <div className={s.sideBottom}>
          <div className={s.staffCard}>
            <Avatar label={staff.name} url={staff.avatarUrl} size={32} fontSize={13} />
            <span className={s.staffText}>
              {staff.name}
              <span className={s.tag}>{ROLE_LABEL[staff.role]}</span>
            </span>
          </div>
          <Link to="/" className={s.backLink}>
            <Icon d={BACK} size={16} />
            Back to the game
          </Link>
        </div>
      </div>
    </nav>
  );
}

function MobileSearch({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const r = useSearchResults(q, onClose);
  return (
    <div role="dialog" aria-modal="true" aria-label="Search" className={s.searchScreen}>
      <div className={s.searchBar}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Icon d={SEARCH} size={16} className={s.searchIcon} />
          <input
            type="search"
            autoFocus
            className={s.searchInput}
            style={{ paddingRight: 12, paddingLeft: 36, fontSize: 16 }}
            aria-label="Search a player, Discord ID or item ID"
            placeholder="Player, Discord ID or item ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={r.onKeyDown}
          />
        </div>
        <button type="button" onClick={onClose} className={cx(s.btn, s.quiet)} style={{ height: 44, color: 'var(--text)', fontSize: 15 }}>
          Cancel
        </button>
      </div>
      <div className={s.searchList}>
        {r.data && (
          <>
            {r.data.players.length > 0 && (
              <span className={cx('lbl', s.lbl10)} style={{ display: 'block', padding: '12px 0 4px' }}>
                Players
              </span>
            )}
            {r.data.players.map((p) => (
              <Link key={p.id} to={`/admin/players/${p.id}`} className={s.mRow} style={{ padding: 0, gap: 12 }} onClick={(e) => (e.preventDefault(), r.go(`/admin/players/${p.id}`))}>
                <Avatar label={p.label} url={p.avatarUrl} size={32} guest={p.isGuest} fontSize={13} />
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span>{p.label}</span>
                  <span className={cx('mono', s.resultSub)}>{playerSub(p)}</span>
                </span>
              </Link>
            ))}
            {r.data.items.length > 0 && (
              <span className={cx('lbl', s.lbl10)} style={{ display: 'block', padding: '16px 0 4px' }}>
                Items
              </span>
            )}
            {r.data.items.map((i) => (
              <Link key={i.id} to={`/admin/items?item=${i.id}`} className={s.mRow} style={{ padding: 0, gap: 12 }} onClick={(e) => (e.preventDefault(), r.go(`/admin/items?item=${i.id}`))}>
                <span aria-hidden="true" className={s.square} style={{ background: RARITY[i.tier].color }} />
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <span>{i.name}</span>
                  <span className={cx('mono', s.resultSub)}>{i.serial}</span>
                </span>
              </Link>
            ))}
            {r.data.players.length + r.data.items.length === 0 && (
              <p style={{ margin: '24px 0', fontSize: 14, color: 'var(--text-2)', textAlign: 'center' }}>Nothing matches “{r.debounced}”.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const badge = useBadges();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className={cx(s.backdrop, s.moreBackdrop)} onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="More sections" className={s.moreSheet}>
        <span aria-hidden="true" className={s.handle} style={{ marginBottom: 12 }} />
        {SECTIONS.slice(3).map((n) => (
          <Link key={n.key} to={n.to} className={s.mRow} onClick={onClose}>
            <Icon d={n.icon} size={20} />
            <span style={{ flex: 1 }}>{n.label}</span>
            {badge(n.key) > 0 && <span className={s.badge}>{badge(n.key)}</span>}
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
              desktop
            </span>
          </Link>
        ))}
        <Link to="/" className={s.mRow} style={{ borderBottom: 0, color: 'var(--text-2)' }}>
          Back to the game
        </Link>
      </div>
    </>
  );
}

function MobileShell() {
  const [more, setMore] = useState(false);
  const [search, setSearch] = useState(false);
  const badge = useBadges();
  const location = useLocation();
  useEffect(() => {
    setMore(false);
    setSearch(false);
  }, [location.pathname, location.search]);
  const alert = badge('market') + badge('moderation') > 0;
  return (
    <div className={s.mShell}>
      <header className={s.mHeader}>
        <Logo mobile />
        <button type="button" aria-label="Search players and items" className={s.mIconBtn} onClick={() => setSearch(true)}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
            <path d={SEARCH} />
          </svg>
        </button>
      </header>
      <Outlet />
      <nav aria-label="Admin" className={s.mTabbar}>
        {SECTIONS.slice(0, 3).map((t) => (
          <NavLink key={t.key} to={t.to} end={t.end} className={s.mTab}>
            <Icon d={t.icon} size={22} />
            <span>{t.label}</span>
          </NavLink>
        ))}
        <button type="button" className={s.mTab} aria-expanded={more} onClick={() => setMore(true)}>
          <Icon d={MORE} size={22} />
          <span>More</span>
          {alert && <span aria-hidden="true" className={s.mTabDot} />}
        </button>
      </nav>
      {more && <MoreSheet onClose={() => setMore(false)} />}
      {search && <MobileSearch onClose={() => setSearch(false)} />}
    </div>
  );
}

export function AdminShell() {
  const mobile = useIsMobile();
  const clock = useClock();
  if (mobile) return <MobileShell />;
  return (
    <div className={s.shell}>
      <Sidebar />
      <main className={s.main}>
        <div className={s.topbar}>
          <GlobalSearch />
          <span className={cx('mono', s.clock)}>{clock}</span>
        </div>
        <Outlet />
      </main>
    </div>
  );
}

