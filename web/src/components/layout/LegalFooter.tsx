import type { CSSProperties } from 'react';
import { Link } from 'react-router';

export const DISCLAIMER = 'Fan project. Not affiliated with Valve. Skin images © Valve.';

/** "Fan project… Privacy · Terms": under the sidebar, in More and on Connect. */
export function LegalFooter({ style }: { style?: CSSProperties }) {
  const link = { color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 } as const;
  return (
    <p style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-3)', ...style }}>
      {DISCLAIMER}{' '}
      <Link to="/privacy" style={link}>
        Privacy
      </Link>
      {' · '}
      <Link to="/terms" style={link}>
        Terms
      </Link>
    </p>
  );
}
