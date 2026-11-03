import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { Spinner } from '../components/ui/primitives';
import { useIsMobile } from '../lib/useMediaQuery';
import { useDiscordSignIn } from '../lib/useDiscordSignIn';
import { useAdminMe } from './lib';
import { Catalog } from './screens/Catalog';
import { Economy } from './screens/Economy';
import { Market } from './screens/Market';
import { Moderation } from './screens/Moderation';
import { Items } from './screens/Items';
import { Logs } from './screens/Logs';
import { Overview } from './screens/Overview';
import { Player } from './screens/Player';
import { Players } from './screens/Players';
import { AdminShell, SECTIONS } from './Shell';
import { cx, s } from './ui';

/** Content of a staff screen: 1680 px column with 48 px sides (desktop), 16 px (mobile). */
export function AdminPage({ gap = 24, top, children }: { gap?: number; top?: number; children: ReactNode }) {
  const mobile = useIsMobile();
  return (
    <div className={cx('page-enter', mobile ? s.mContent : s.content)} style={{ gap: mobile ? Math.min(gap, 20) : gap, paddingTop: mobile ? undefined : top }}>
      {children}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--page)', color: 'var(--text)' }}>
      <div style={{ width: 'min(440px, 100%)', display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
    </main>
  );
}

function StaffOnly() {
  const signIn = useDiscordSignIn();
  return (
    <Centered>
      <span className="lbl">// Admin</span>
      <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>Staff only</h1>
      <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--text-2)' }}>
        This space is for the Mint staff. Sign in with the Discord account that has a staff role.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={cx(s.btn, s.primary, s.h44)} onClick={() => void signIn.start()} disabled={signIn.state === 'waiting'}>
          {signIn.state === 'waiting' ? 'Waiting for Discord…' : 'Sign in with Discord'}
        </button>
        <Link to="/" className={cx(s.btn, s.h44)}>
          Back to the game
        </Link>
      </div>
    </Centered>
  );
}

const TITLES: Record<string, string> = Object.fromEntries(SECTIONS.map((x) => [x.to, x.label]));

export function AdminApp() {
  const me = useAdminMe();
  const location = useLocation();
  useEffect(() => {
    const path = location.pathname.replace(/\/$/, '');
    const section = TITLES[path] ?? (path.startsWith('/admin/players/') ? 'Player' : 'Admin');
    document.title = `Mint Admin — ${section}`;
    return () => {
      document.title = 'Mint';
    };
  }, [location.pathname]);

  if (me.isPending) {
    return (
      <Centered>
        <div role="status" style={{ display: 'grid', placeItems: 'center' }}>
          <Spinner />
        </div>
      </Centered>
    );
  }
  if (me.error) return <StaffOnly />;
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<Overview />} />
        <Route path="players" element={<Players />} />
        <Route path="players/:id" element={<Player />} />
        <Route path="items" element={<Items />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="logs" element={<Logs />} />
        <Route path="economy" element={<Economy />} />
        <Route path="market" element={<Market />} />
        <Route path="moderation" element={<Moderation />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
