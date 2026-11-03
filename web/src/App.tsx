import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { PlayerGate } from './components/layout/PlayerGate';
import { Button } from './components/ui/Button';
import { HudLabel, Spinner } from './components/ui/primitives';
import { ToastProvider } from './components/ui/Toast';
import { bootActivity } from './discord/activity';
import { ApiRequestError } from './lib/api';
import { isActivity } from './lib/platform';
import { keys } from './lib/queries';
import { Album, AlbumsIndex } from './screens/Album';
import { Auction } from './screens/Auction';
import { AuthDone } from './screens/AuthDone';
import { Cases } from './screens/Cases';
import { Connect } from './screens/Connect';
import { CrashPage } from './screens/Crash';
import { Friends } from './screens/Friends';
import { Home } from './screens/Home';
import { Inventory } from './screens/Inventory';
import { Item } from './screens/Item';
import { Leaderboard } from './screens/Leaderboard';
import { Privacy, Terms } from './screens/Legal';
import { Market } from './screens/Market';
import { More } from './screens/More';
import { Opening } from './screens/Opening';
import { Profile } from './screens/Profile';
import { Sell } from './screens/Sell';
import { TradeNew } from './screens/TradeNew';
import { TradeUp } from './screens/TradeUp';
import { Trades } from './screens/Trades';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiRequestError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createBrowserRouter([
  {
    element: (
      <PlayerGate>
        <AppShell />
      </PlayerGate>
    ),
    errorElement: <CrashPage />,
    children: [
      {
        // Pathless: a crashed screen shows the error inside the shell, sidebar and tabs still work.
        errorElement: <CrashPage inShell />,
        children: [
          { path: '/', element: <Home /> },
          { path: '/cases', element: <Cases /> },
          { path: '/cases/:id', element: <Opening /> },
          { path: '/inventory', element: <Inventory /> },
          { path: '/items/:id', element: <Item /> },
          { path: '/albums', element: <AlbumsIndex /> },
          { path: '/albums/:id', element: <Album /> },
          { path: '/market', element: <Market /> },
          { path: '/market/:id', element: <Auction /> },
          { path: '/sell', element: <Sell /> },
          { path: '/tradeup', element: <TradeUp /> },
          { path: '/leaderboard', element: <Leaderboard /> },
          { path: '/friends', element: <Friends /> },
          { path: '/trades', element: <Trades /> },
          { path: '/trades/new', element: <TradeNew /> },
          { path: '/more', element: <More /> },
          { path: '/players/:username', element: <Profile /> },
          { path: '/players/:username/inventory', element: <Inventory /> },
          { path: '/players/:username/albums', element: <AlbumsIndex /> },
          { path: '/players/:username/albums/:id', element: <Album /> },
        ],
      },
    ],
  },
  { path: '/connect', element: isActivity ? <Navigate to="/" replace /> : <Connect />, errorElement: <CrashPage /> },
  // The staff panel: its own shell, loaded only when opened, never inside the Discord activity.
  isActivity
    ? { path: '/admin/*', element: <Navigate to="/" replace /> }
    : { path: '/admin/*', lazy: () => import('./admin/AdminApp').then((m) => ({ Component: m.AdminApp })), errorElement: <CrashPage /> },
  { path: '/auth/done', element: <AuthDone />, errorElement: <CrashPage /> },
  { path: '/privacy', element: <Privacy />, errorElement: <CrashPage /> },
  { path: '/terms', element: <Terms />, errorElement: <CrashPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

/** In the Discord activity, sign in through the SDK before showing anything. */
function ActivityGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(isActivity ? 'loading' : 'ready');
  useEffect(() => {
    if (!isActivity) return;
    bootActivity()
      .then((me) => {
        queryClient.setQueryData(keys.me, me);
        setState('ready');
      })
      .catch((error) => {
        console.error(error);
        setState('error');
      });
  }, []);
  if (state === 'ready') return children;
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
      {state === 'loading' ? (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          <Spinner />
          <HudLabel>Connecting to Discord…</HudLabel>
        </div>
      ) : (
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <h1 style={{ fontSize: 26, fontWeight: 600 }}>Discord didn't confirm.</h1>
          <Button size={48} onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ActivityGate>
          <RouterProvider router={router} />
        </ActivityGate>
      </ToastProvider>
    </QueryClientProvider>
  );
}
