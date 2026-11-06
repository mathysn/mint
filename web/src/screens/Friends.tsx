import { useState } from 'react';
import { Page } from '../components/layout/AppShell';
import { AccountRequired, FriendCardMobile, FriendRow, IncomingRow, OutgoingRow, SearchResults } from '../components/social/social';
import { SearchField } from '../components/ui/fields';
import { HudLabel } from '../components/ui/primitives';
import { useFriends, useIsAccount, usePlayerSearch } from '../lib/social';
import { useDebounced } from '../lib/useDebounced';
import { useIsMobile } from '../lib/useMediaQuery';
import s from './screens.module.css';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function Friends() {
  const mobile = useIsMobile();
  const account = useIsAccount();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const { data } = useFriends();
  const search = usePlayerSearch(q);
  const back = mobile ? { to: '/more', label: 'More' } : undefined;

  if (!account) {
    return (
      <Page gap={mobile ? 22 : 32} back={back} mobilePadding="8px 20px 32px">
        <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!mobile && <HudLabel>// Friends</HudLabel>}
          <h1 style={{ fontSize: mobile ? 32 : 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>Friends</h1>
        </header>
        <AccountRequired title="Add friends to see their pulls" text="Sign in with Discord to add friends by name, visit their profiles and follow what they unbox." />
      </Page>
    );
  }

  const friends = data?.friends ?? [];
  const incoming = data?.incoming ?? [];
  const outgoing = data?.outgoing ?? [];
  const countLine = `${plural(friends.length, 'friend')} · ${plural(incoming.length, 'request')} waiting`;

  const input = (
    <SearchField
      label="Add a friend"
      value={query}
      onChange={setQuery}
      placeholder="Search by name"
      inputProps={{ style: { background: mobile ? 'var(--surface)' : 'var(--page)', fontSize: mobile ? 15 : 14 } }}
    />
  );
  const results = q.length >= 2 && search.data && (search.data.length ? <SearchResults results={search.data} /> : <p style={{ fontSize: 13, color: 'var(--text-2)' }}>No player called “{q}”.</p>);

  if (mobile) {
    return (
      <Page gap={22} back={back} mobilePadding="8px 20px 32px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ fontSize: 32, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>Friends</h1>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {countLine}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {input}
          {results}
        </div>
        {incoming.length > 0 && (
          <section aria-labelledby="mf-req" style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 id="mf-req" className="lbl" style={{ margin: '0 0 8px' }}>
              // Requests · {incoming.length}
            </h2>
            <ul className="stagger-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {incoming.map((p) => (
                <IncomingRow key={p.id} player={p} mobile />
              ))}
            </ul>
          </section>
        )}
        {outgoing.length > 0 && (
          <section aria-labelledby="mf-sent" style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 id="mf-sent" className="lbl" style={{ margin: '0 0 8px' }}>
              // Sent
            </h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {outgoing.map((p) => (
                <OutgoingRow key={p.id} player={p} />
              ))}
            </ul>
          </section>
        )}
        <section aria-labelledby="mf-list" className="stagger-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 id="mf-list" className="lbl" style={{ margin: '0 0 2px' }}>
            // Your friends
          </h2>
          {friends.map((f) => (
            <FriendCardMobile key={f.id} friend={f} />
          ))}
          {data && friends.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-2)' }}>No friends yet. Search for a player by name to send a request.</p>}
        </section>
      </Page>
    );
  }

  return (
    <Page gap={32}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <HudLabel>// Friends</HudLabel>
        <h1 style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>Friends</h1>
        <p className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {data ? countLine : ' '}
        </p>
      </header>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <section aria-label="Your friends" style={{ flex: '999 1 520px', minWidth: 0 }}>
          <ul className="stagger-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {friends.map((f) => (
              <FriendRow key={f.id} friend={f} />
            ))}
          </ul>
          {data && friends.length === 0 && (
            <div className={s.panel} style={{ borderStyle: 'dashed', background: 'transparent', alignItems: 'flex-start', gap: 8 }}>
              <p style={{ fontSize: 16, fontWeight: 600 }}>No friends yet</p>
              <p style={{ fontSize: 14, color: 'var(--text-2)' }}>Search for a player by name to send a request.</p>
            </div>
          )}
        </section>
        <aside style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section aria-labelledby="add-title" className={s.panel} style={{ padding: 22, gap: 14 }}>
            <h2 id="add-title" style={{ fontSize: 16, fontWeight: 600 }}>
              Add a friend
            </h2>
            {input}
            {results}
          </section>
          <section aria-labelledby="req-title" className={s.panel} style={{ padding: 22, gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2 id="req-title" style={{ fontSize: 16, fontWeight: 600 }}>
                Requests
              </h2>
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {incoming.length}
              </span>
            </div>
            {incoming.length === 0 && <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-2)' }}>No requests waiting.</p>}
            <ul className="stagger-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
              {incoming.map((p) => (
                <IncomingRow key={p.id} player={p} />
              ))}
            </ul>
            {outgoing.length > 0 && (
              <>
                <span className="lbl" style={{ marginTop: 12 }}>
                  Sent
                </span>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
                  {outgoing.map((p) => (
                    <OutgoingRow key={p.id} player={p} />
                  ))}
                </ul>
              </>
            )}
          </section>
        </aside>
      </div>
    </Page>
  );
}
