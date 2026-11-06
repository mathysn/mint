import type { ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { formatCredits } from '../../lib/format';
import { useFreeCase } from '../../lib/freeCase';
import { useMe } from '../../lib/queries';
import { useIsMobile } from '../../lib/useMediaQuery';
import { Button } from '../ui/Button';
import { AnimatedCredits, Avatar, HudLabel } from '../ui/primitives';
import { PageScrollbar, ScrollArea } from '../ui/Scrollbar';
import { GlobalDropBanner } from './GlobalDrop';
import { AnnouncementBanner } from './Announcement';
import { LegalFooter } from './LegalFooter';
import { BanCard } from './PlayerGate';
import s from './layout.module.css';

// The 9 sections of DESIGN.md §1, in the order of the mockups.
const NAV = [
  { to: '/', label: 'Home', icon: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z', end: true },
  { to: '/cases', label: 'Cases', icon: 'M3 8h18v12H3zM3 12h18M10 12v3h4v-3M8 8V5h8v3', end: false },
  { to: '/inventory', label: 'Inventory', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', end: false },
  { to: '/albums', label: 'Albums', icon: 'M8 3h12v14H8zM4 7v14h12', end: false },
  { to: '/market', label: 'Market', icon: 'M3 12V3h9l9 9-9 9zM7 7h1v1H7z', end: false },
  { to: '/trades', label: 'Trades', icon: 'M4 8h15l-4-4M20 16H5l4 4', end: false },
  { to: '/tradeup', label: 'Trade-up', icon: 'M12 20V5M6 11l6-6 6 6M5 20h14', end: false },
  { to: '/friends', label: 'Friends', icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a7 7 0 0 0-4-6.3', end: false },
  { to: '/leaderboard', label: 'Leaderboard', icon: 'M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7', end: false },
];

// Mobile tab bar (DESIGN.md §1): Home, Cases, Inventory, Albums, More; the rest lives in More.
const TABS = [...NAV.slice(0, 4), { to: '/more', label: 'More', icon: 'M4 6h16M4 12h16M4 18h16', end: false }];

export function Logo({ mobile }: { mobile?: boolean }) {
  return (
    <Link to="/" aria-label="Mint, home" className={mobile ? s.mobileLogo : s.logo}>
      <span aria-hidden="true" className={s.logoMark} />
      <span className={s.logoText}>MINT</span>
    </Link>
  );
}

function NavIcon({ d, size }: { d: string; size: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" className={s.icon}>
      <path d={d} />
    </svg>
  );
}

function Sidebar() {
  const { data: me } = useMe();
  const free = useFreeCase(me?.freeCase);
  return (
    <ScrollArea as="nav" aria-label="Main" className={s.sidebarFrame} viewportClassName={s.sidebar}>
      <div className={s.sideTop}>
        <Logo />
        <div className={s.nav}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={s.navLink}>
              <NavIcon d={n.icon} size={18} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </div>
      </div>
      <div className={s.sideBottom}>
        <div className={s.balanceCard}>
          <HudLabel>Balance</HudLabel>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            {me ? <AnimatedCredits value={me.balance} size={24} weight={600} unitSize={12} /> : <span className="mono" style={{ fontSize: 24 }}>—</span>}
          </div>
          <div className={s.balanceRow}>
            <span>Free cases</span>
            <span className="mono" style={{ color: 'var(--text)' }}>
              {free.stock}
            </span>
          </div>
          {free.next && (
            <div className={s.balanceRow}>
              <span>Next free case</span>
              <span className="mono" style={{ color: 'var(--text)' }}>
                {free.next}
              </span>
            </div>
          )}
          {me && me.heldInBids > 0 && (
            <div className={s.balanceRow}>
              <span>Held in bids</span>
              <span className="mono" style={{ color: 'var(--text)' }}>
                {formatCredits(me.heldInBids)} CR
              </span>
            </div>
          )}
        </div>
        {me?.isGuest && (
          <div className={s.player}>
            <div className={s.playerRow}>
              <Avatar name={null} guest />
              <div className={s.playerText}>
                <span className={s.playerName}>Guest</span>
                <span className={s.playerSub}>Sign in to trade, sell and add friends</span>
              </div>
            </div>
            <Button variant="secondary" size={44} to="/connect" block>
              Continue with Discord
            </Button>
          </div>
        )}
        {me && !me.isGuest && me.username && (
          <Link to={`/players/${encodeURIComponent(me.username)}`} className={s.player} style={{ textDecoration: 'none', color: 'var(--text)' }}>
            <span className={s.playerRow}>
              <Avatar name={me.username} url={me.avatarUrl} />
              <span className={s.playerText}>
                <span className={s.playerName}>{me.username}</span>
                {/* Sign out is on the profile (desktop) and in More (mobile). */}
                <span className={s.playerSub}>View profile</span>
              </span>
            </span>
          </Link>
        )}
        <LegalFooter style={{ padding: '0 4px' }} />
      </div>
    </ScrollArea>
  );
}

function TabBar() {
  return (
    <nav aria-label="Main" className={s.tabbar} style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}>
      {TABS.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={s.tab}>
          <NavIcon d={n.icon} size={22} />
          <span>{n.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** A banned player plays read-only: the ban stays visible on every screen. */
function BanBanner({ mobile }: { mobile?: boolean }) {
  const { data: me } = useMe();
  if (!me?.ban) return null;
  return (
    <div style={{ width: '100%', maxWidth: 'var(--content-max)', margin: '0 auto', padding: mobile ? '12px 20px 0' : '16px var(--content-pad) 0' }}>
      <BanCard ban={me.ban} />
    </div>
  );
}

export function AppShell() {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <div className={s.mobileShell}>
        <BanBanner mobile />
        <Outlet />
        <TabBar />
        <PageScrollbar mobile />
      </div>
    );
  }
  return (
    <div className={s.shell}>
      <Sidebar />
      <main className={s.main}>
        <AnnouncementBanner />
        <GlobalDropBanner />
        <BanBanner />
        <Outlet />
      </main>
      <PageScrollbar />
    </div>
  );
}

function BalancePill() {
  const { data: me } = useMe();
  return <span className={`mono ${s.balancePill}`}>{me ? <AnimatedCredits value={me.balance} /> : '—'}</span>;
}

/**
 * Content of a screen inside the shell. Desktop: centred column (max 1680 px, 48 px sides).
 * Mobile: 52 px header (logo or back link + balance) then the content.
 */
export function Page({
  children,
  gap,
  top = 40,
  bottom,
  back,
  mobilePadding,
  mobileRight,
}: {
  children: ReactNode;
  gap: number;
  top?: number;
  /** Desktop bottom padding (72 px by default). */
  bottom?: number;
  back?: { to: string; label: string };
  mobilePadding?: string;
  mobileRight?: ReactNode;
}) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <>
        <header className={`${s.mobileHeader} ${back ? s.mobileHeaderBack : ''}`}>
          {back ? (
            <Link to={back.to} className={s.back}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" className={s.icon}>
                <path d="M15 6l-6 6 6 6" />
              </svg>
              {back.label}
            </Link>
          ) : (
            <Logo mobile />
          )}
          {mobileRight ?? <BalancePill />}
        </header>
        <AnnouncementBanner mobile />
        <div className={`page-enter ${s.mobileContent}`} style={{ gap: Math.min(gap, 20), padding: mobilePadding }}>
          {children}
        </div>
      </>
    );
  }
  return (
    <div className={`page-enter ${s.content}`} style={{ gap, paddingTop: top, paddingBottom: bottom }}>
      {children}
    </div>
  );
}

export function PageHeader({ label, title, sub, right }: { label?: string; title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className={s.pageHeader}>
      <div className={s.pageHeaderText}>
        {label && <HudLabel>{label}</HudLabel>}
        <h1 className={s.pageTitle}>{title}</h1>
        {sub && <p className={s.pageSub}>{sub}</p>}
      </div>
      {right}
    </header>
  );
}
