import { Link } from 'react-router';
import { Page } from '../components/layout/AppShell';
import { CaseTile } from '../components/items/items';
import { FriendsFeed } from '../components/social/feed';
import { Button } from '../components/ui/Button';
import { Credits, HudCorners, HudLabel } from '../components/ui/primitives';
import { ScrollArea } from '../components/ui/Scrollbar';
import { useFreeCase } from '../lib/freeCase';
import { useCrates, useEconomyText, useMe } from '../lib/queries';
import { useIsMobile } from '../lib/useMediaQuery';
import type { CrateSummary, Me } from '../../../shared/api';
import s from './screens.module.css';

const FEED_ICON = 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a7 7 0 0 0-4-6.3';

function FreeNote() {
  const economy = useEconomyText();
  return (
    <>
      1 free case every {economy.freeShort} · up to {economy.freeMax}
    </>
  );
}

type FreeStack = ReturnType<typeof useFreeCase>;

/** "Your free case is ready." / "You have 3 free cases ready." */
const readyTitle = (count: number) => (count === 1 ? 'Your free case is ready.' : `You have ${count} free cases ready.`);

/** Free case rows: the stack ("3 / 5") and, while it isn't full, the time to the next case. */
const freeRows = (free: FreeStack): [string, string][] => (free.next ? [['Free cases', free.stock], ['Next free case', free.next]] : [['Free cases', free.stock]]);

function useDailyCrate() {
  const { data: me } = useMe();
  const { data: crates } = useCrates();
  const free = useFreeCase(me?.freeCase);
  const daily = crates?.find((c) => c.id === free.crateId) ?? null;
  return { me, crates, free, daily };
}

function HeroText({ me, free, daily }: { me: Me | undefined; free: FreeStack; daily: CrateSummary | null }) {
  const guest = me?.isGuest ?? true;
  const economy = useEconomyText();
  return (
    <>
      <HudLabel>// Free case</HudLabel>
      {free.ready ? (
        <h1 id="hero-title" className={s.heroTitle}>
          {readyTitle(free.count)}
        </h1>
      ) : (
        <h1 id="hero-title" className={s.heroTitle}>
          Next free case in <span className="mono">{free.next}</span>
        </h1>
      )}
      <p className={s.heroSub}>
        {guest
          ? `A free case every ${economy.freeLong}, up to ${economy.freeMax} saved, on the house. Sign in with Discord to trade, sell and add friends.`
          : `A free case every ${economy.freeLong}, up to ${economy.freeMax} saved, on the house. Open them, keep them, recycle them or put them up for auction.`}
      </p>
      <div className={s.heroActions}>
        {free.ready && daily ? (
          <>
            <Button size={48} to={`/cases/${daily.id}`} style={{ paddingInline: 28 }}>
              Open free case
            </Button>
            <Button variant="secondary" size={48} to="/cases">
              Browse cases
            </Button>
          </>
        ) : (
          <Button size={48} to="/cases" style={{ paddingInline: 28 }}>
            Browse cases
          </Button>
        )}
      </div>
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
        <FreeNote />
      </span>
    </>
  );
}

function DesktopHome() {
  const { me, crates, free, daily } = useDailyCrate();
  const guest = me?.isGuest ?? true;
  return (
    <Page gap={40}>
      <section aria-labelledby="hero-title" className={s.hero}>
        <div className={s.heroText}>
          <HeroText me={me} free={free} daily={daily} />
        </div>
        <div className={s.heroArt}>
          <HudCorners size={20} inset={28} />
          <span className="lbl" style={{ position: 'absolute', left: 44, top: 42 }}>
            {daily?.name ?? ' '}
          </span>
          <span className="lbl" style={{ position: 'absolute', right: 44, top: 42 }}>
            {free.ready ? `Free · ${free.stock}` : 'Free'}
          </span>
          {daily && <img src={daily.imageUrl} alt={daily.name} className={s.heroCase} />}
          <span className="lbl" style={{ position: 'absolute', left: 44, bottom: 42 }}>
            {daily ? `${daily.skinCount} skins + ★ Rare special` : ' '}
          </span>
        </div>
      </section>

      {/* The free case panel sets the row height; the feed fills it and scrolls (homeRow, feedPanel). */}
      <div className={s.homeRow}>
        <section aria-labelledby="feed-title" className={`${s.panel} ${s.feedPanel}`} style={{ gap: 16 }}>
          <div className={s.panelHead}>
            <h2 id="feed-title" className={s.panelTitle}>
              Friends’ activity
            </h2>
            <HudLabel>// Feed</HudLabel>
          </div>
          <ScrollArea className={s.feedScroll} viewportClassName={s.feedViewport} aria-label="Friends’ activity" tabIndex={0}>
          {guest ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, padding: '24px 0 4px' }}>
              <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'var(--text-3)', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                <path d={FEED_ICON} />
              </svg>
              <p style={{ fontSize: 16, fontWeight: 600 }}>Your friends’ pulls show up here</p>
              <p style={{ maxWidth: 440, fontSize: 14, lineHeight: 1.55, color: 'var(--text-2)' }}>
                Sign in with Discord to add friends, trade with them and follow what they unbox.
              </p>
              <Button variant="secondary" size={44} to="/connect" style={{ marginTop: 6, paddingInline: 20 }}>
                Continue with Discord
              </Button>
            </div>
          ) : (
            <FriendsFeed />
          )}
          </ScrollArea>
        </section>
        <section aria-labelledby="today-title" className={s.panel} style={{ gap: 24 }}>
          <div className={s.panelHead}>
            <h2 id="today-title" className={s.panelTitle}>
              Right now
            </h2>
            <HudLabel>// Free case</HudLabel>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <HudLabel>Balance</HudLabel>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              {me && <Credits value={me.balance} size={40} weight={500} unitSize={14} style={{ letterSpacing: '-0.02em' }} />}
            </div>
          </div>
          <dl style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
            {freeRows(free).map(([label, value]) => (
              <div key={label} className={s.row}>
                <dt style={{ color: 'var(--text-2)' }}>{label}</dt>
                <dd className="mono" style={{ margin: 0 }}>
                  {value}
                </dd>
              </div>
            ))}
            <div className={s.row}>
              <dt style={{ color: 'var(--text-2)' }}>Case of the day</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>{daily?.name ?? '—'}</dd>
            </div>
            {free.crateNext && (
              <div className={s.row}>
                <dt style={{ color: 'var(--text-2)' }}>New case of the day in</dt>
                <dd className="mono" style={{ margin: 0 }}>
                  {free.crateNext}
                </dd>
              </div>
            )}
          </dl>
        </section>
      </div>

      <section aria-labelledby="cases-title" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className={s.panelHead}>
          <h2 id="cases-title" className={s.panelTitle}>
            Cases
          </h2>
          <Link to="/cases" style={{ fontSize: 14, color: 'var(--text-2)' }}>
            View all
          </Link>
        </div>
        <div className="stagger-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))', gap: 16 }}>
          {(crates ?? []).slice(0, 4).map((c) => (
            <CaseTile key={c.id} crate={c} variant="home" free={c.id === free.crateId && free.ready} />
          ))}
        </div>
      </section>
    </Page>
  );
}

function MobileHome() {
  const { me, crates, free, daily } = useDailyCrate();
  const guest = me?.isGuest ?? true;
  return (
    <Page gap={20} mobilePadding="20px 20px 32px">
      <section aria-labelledby="hero-title" className={s.panel} style={{ padding: 0, overflow: 'hidden' }}>
        <div className={s.mobileHeroArt}>
          <HudCorners size={16} inset={16} />
          <span className="lbl" style={{ position: 'absolute', left: 28, top: 28, fontSize: 10 }}>
            {daily?.name ?? ' '}
          </span>
          <span className="lbl" style={{ position: 'absolute', right: 28, top: 28, fontSize: 10 }}>
            Free
          </span>
          {daily && <img src={daily.imageUrl} alt={daily.name} className={s.heroCase} style={{ width: '62%' }} />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '22px 20px 20px' }}>
          <HudLabel>// Free case</HudLabel>
          <h1 id="hero-title" style={{ fontSize: 32, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {free.ready ? (
              readyTitle(free.count)
            ) : (
              <>
                Next free case in <span className="mono">{free.next}</span>
              </>
            )}
          </h1>
          <Button size={52} block to={free.ready && daily ? `/cases/${daily.id}` : '/cases'} style={{ marginTop: 4 }}>
            {free.ready ? 'Open free case' : 'Browse cases'}
          </Button>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>
            <FreeNote />
          </span>
        </div>
      </section>

      {guest && (
        <section aria-labelledby="m-guest" className={s.panel} style={{ gap: 12, padding: '18px 20px' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span aria-hidden="true" style={{ flex: 'none', width: 32, height: 32, borderRadius: '50%', background: 'var(--avatar)', display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--text-2)' }}>
              ?
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <h2 id="m-guest" style={{ fontSize: 15, fontWeight: 600 }}>
                Playing as a guest
              </h2>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Sign in with Discord to trade, sell and add friends.</span>
            </div>
          </div>
          <Button variant="secondary" size={48} block to="/connect">
            Continue with Discord
          </Button>
        </section>
      )}

      {!guest && (
        <section aria-labelledby="m-feed" className={s.panel} style={{ gap: 4, padding: '18px 20px 8px' }}>
          <div className={s.panelHead} style={{ paddingBottom: 8 }}>
            <h2 id="m-feed" style={{ fontSize: 16, fontWeight: 600 }}>
              Friends’ activity
            </h2>
            <HudLabel>// Feed</HudLabel>
          </div>
          <FriendsFeed mobile />
        </section>
      )}

      <section aria-labelledby="m-today" className={s.panel} style={{ padding: '18px 20px 6px', gap: 0 }}>
        <h2 id="m-today" className="lbl" style={{ margin: '0 0 10px' }}>
          // Right now
        </h2>
        {freeRows(free).map(([label, value]) => (
          <div key={label} className={s.row}>
            <span style={{ color: 'var(--text-2)' }}>{label}</span>
            <span className="mono">{value}</span>
          </div>
        ))}
        <div className={s.row}>
          <span style={{ color: 'var(--text-2)' }}>Case of the day</span>
          <span style={{ textAlign: 'right' }}>{daily?.name ?? '—'}</span>
        </div>
        {free.crateNext && (
          <div className={s.row}>
            <span style={{ color: 'var(--text-2)' }}>New case of the day in</span>
            <span className="mono">{free.crateNext}</span>
          </div>
        )}
      </section>

      <section aria-labelledby="m-cases" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className={s.panelHead}>
          <h2 id="m-cases" style={{ fontSize: 16, fontWeight: 600 }}>
            Cases
          </h2>
          <Link to="/cases" style={{ fontSize: 14, color: 'var(--text-2)' }}>
            View all
          </Link>
        </div>
        <div className="hscroll stagger-list" style={{ display: 'flex', gap: 12, overflowX: 'auto', margin: '0 -20px', padding: '0 20px' }}>
          {(crates ?? []).slice(0, 4).map((c) => (
            <CaseTile key={c.id} crate={c} variant="scroll" free={c.id === free.crateId && free.ready} />
          ))}
        </div>
      </section>
    </Page>
  );
}

export function Home() {
  return useIsMobile() ? <MobileHome /> : <DesktopHome />;
}
