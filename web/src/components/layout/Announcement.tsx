import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Announcement } from '../../../../shared/api';
import { api } from '../../lib/api';

const KEY = 'mint.announcements.hidden';

function readHidden(): number[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(ids) ? ids.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

function writeHidden(ids: number[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids.slice(-20)));
  } catch {
    // Private mode or blocked storage: it just comes back on the next visit.
  }
}

export const useAnnouncement = () =>
  useQuery({ queryKey: ['announcement'], queryFn: () => api<Announcement | null>('/announcements/current'), staleTime: 30_000, refetchInterval: 60_000 });

/** The staff announcement (40 px): desktop above the global drop, mobile under the header. Each one can be hidden. */
export function AnnouncementBanner({ mobile }: { mobile?: boolean }) {
  const { data } = useAnnouncement();
  const [hidden, setHidden] = useState(readHidden);
  if (!data || hidden.includes(data.id)) return null;
  const hide = () => {
    const next = [...hidden, data.id];
    setHidden(next);
    writeHidden(next);
  };
  return (
    <div
      role="status"
      aria-label="Announcement"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minHeight: 40,
        padding: mobile ? '6px 12px 6px 20px' : '0 20px 0 32px',
        borderTop: mobile ? '1px solid var(--border)' : undefined,
        borderBottom: '1px solid var(--border)',
        background: 'var(--rail)',
        animation: 'mint-slide-down 420ms var(--ease-out) both',
      }}
    >
      <span className="lbl" style={{ flex: 'none', fontSize: 10 }}>
        // Announcement
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.4, ...(mobile ? {} : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }}>{data.text}</span>
      <button type="button" aria-label="Hide the announcement" onClick={hide} style={{ flex: 'none', width: 32, height: 32, display: 'grid', placeItems: 'center', border: 0, background: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
