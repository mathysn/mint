import { useEffect, useState } from 'react';
import { useRouteError } from 'react-router';
import { Button } from '../components/ui/Button';
import { HudLabel, Spinner } from '../components/ui/primitives';
import { isStaleChunkError, reloadOnce } from '../lib/reload';

/**
 * Shown instead of a screen that crashed. Inside the shell (`inShell`) the sidebar and tabs stay,
 * so the player can go elsewhere; at the top level it takes the whole page.
 */
export function CrashPage({ inShell = false }: { inShell?: boolean }) {
  const error = useRouteError();
  const stale = isStaleChunkError(error);
  const [reloading, setReloading] = useState(stale);

  useEffect(() => {
    console.error(error);
    if (stale && !reloadOnce()) setReloading(false);
  }, [error, stale]);

  const body = reloading ? (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
      <Spinner />
      <HudLabel>Loading the new version…</HudLabel>
    </div>
  ) : (
    <div role="alert" style={{ width: 'min(480px, 100%)', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <HudLabel>// Error</HudLabel>
      <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>Something went wrong.</h1>
      <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--text-2)' }}>
        This screen hit an error. Your items and credits are safe. Reload the page, or go back home.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
        <Button size={48} onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button size={48} variant="secondary" onClick={() => window.location.assign('/')}>
          Go home
        </Button>
      </div>
    </div>
  );

  // The shell already has a <main>.
  const Tag = inShell ? 'div' : 'main';
  return (
    <Tag
      style={{
        minHeight: inShell ? '60vh' : '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: inShell ? undefined : 'var(--page)',
        color: 'var(--text)',
      }}
    >
      {body}
    </Tag>
  );
}
