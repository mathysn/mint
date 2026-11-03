import { useEffect } from 'react';
import { Logo } from '../components/layout/AppShell';
import { HudLabel } from '../components/ui/primitives';

/** Last page of the Discord popup: tell the tab that started the sign-in, then close. */
export function AuthDone() {
  useEffect(() => {
    const flow = new URLSearchParams(window.location.search).get('flow');
    if (window.opener) {
      window.opener.postMessage({ type: 'mint-auth', flow }, window.location.origin);
      window.close();
    }
  }, []);
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24, textAlign: 'center' }}>
      <Logo />
      <HudLabel>// Discord</HudLabel>
      <h1 style={{ fontSize: 26, fontWeight: 600 }}>You can close this window.</h1>
      <p style={{ maxWidth: 340, fontSize: 14, lineHeight: 1.5, color: 'var(--text-2)' }}>Mint carries on in the tab where you started.</p>
    </div>
  );
}
