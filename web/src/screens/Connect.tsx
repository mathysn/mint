import { Link, Navigate } from 'react-router';
import type { GuestSummary } from '../../../shared/api';
import { Logo } from '../components/layout/AppShell';
import { LegalFooter } from '../components/layout/LegalFooter';
import { Button } from '../components/ui/Button';
import { Halo, HudCorners, HudLabel, Spinner } from '../components/ui/primitives';
import { formatCredits } from '../lib/format';
import { useConfig, useEconomyText, useGuestSummary, useMe } from '../lib/queries';
import { RARITY, finishLabel, fullName } from '../lib/rarity';
import { useIsMobile } from '../lib/useMediaQuery';
import { useDiscordSignIn } from '../lib/useDiscordSignIn';
import s from './screens.module.css';

const UNLOCKS = [
  { title: 'Friends and trades', text: 'Add friends by name and swap skins with them.', icon: 'M4 8h15l-4-4M20 16H5l4 4' },
  { title: 'The market', text: 'Bid on other players’ skins and sell yours.', icon: 'M3 12V3h9l9 9-9 9zM7 7h1v1H7z' },
  { title: 'Showcase and leaderboard', text: 'Pick 5 items for your profile and climb the rankings.', icon: 'M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7' },
];

const PRIVACY = [
  'Mint only gets your Discord name and avatar.',
  'It can’t read your messages, servers or friends list.',
  'Mint never sells anything for real money.',
];

const CHECK = 'M5 12.5l4.5 4.5L19 7.5';

/** "3 items · 750 CR · Kilowatt 3/17" */
function summaryLine(g: GuestSummary, opts: { cases?: boolean } = {}) {
  const parts = [`${formatCredits(g.balance)} CR`];
  if (opts.cases) parts.push(`${g.casesOpened} ${g.casesOpened === 1 ? 'case' : 'cases'} opened`);
  if (g.bestAlbum) parts.push(`${g.bestAlbum.crateName.replace(/ Case$/, '')} ${g.bestAlbum.owned}/${g.bestAlbum.total}`);
  return parts.join(' · ');
}

function MiniItem({ item, mobile }: { item: GuestSummary['recentItems'][number]; mobile?: boolean }) {
  const rarity = RARITY[item.skin.tier];
  const meta = [item.stattrak ? 'ST™' : null, item.wear?.code ?? 'Vanilla', item.float !== null ? item.float.toFixed(4) : null].filter(Boolean).join(' · ');
  return (
    <div className={s.mini}>
      <span className={s.miniArt} style={mobile ? { height: 52 } : undefined}>
        <Halo color={rarity.halo} inset={mobile ? '6% 8%' : '8% 10%'} />
        <img src={item.skin.imageUrl} alt={fullName(item.skin)} loading="lazy" />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: mobile ? '0 7px 7px' : '0 10px 10px', minWidth: 0 }}>
        {!mobile && <span style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.skin.weaponName}</span>}
        <span style={{ fontSize: mobile ? 11 : 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{finishLabel(item.skin)}</span>
        {!mobile && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-2)' }}>
            {meta}
          </span>
        )}
      </span>
      <span aria-hidden="true" style={{ height: mobile ? 2 : 3, background: rarity.color }} />
    </div>
  );
}

export function Connect() {
  const mobile = useIsMobile();
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const economy = useEconomyText();
  const signIn = useDiscordSignIn();
  const summary = useGuestSummary(Boolean(me?.isGuest));

  // Already signed in (and not in the middle of this flow): nothing to do here.
  if (me && !me.isGuest && signIn.state === 'idle') return <Navigate to="/" replace />;

  const saved = signIn.state === 'success';
  const name = signIn.me?.displayName ?? signIn.me?.username ?? '';
  const disabled = config ? !config.discordEnabled : false;
  const start = `${formatCredits(config?.startingBalance ?? 1000)} CR`;
  // Guest progress never moves to the account (anti-farm): say so before anyone signs in.
  const g = me?.isGuest && !saved ? summary.data : undefined;

  const progressCard = g && g.casesOpened > 0 && (
    <div className={s.panel} style={{ padding: mobile ? 14 : 22, gap: mobile ? 12 : 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <HudLabel style={mobile ? { fontSize: 10 } : undefined}>{mobile ? 'Guest progress' : 'Your guest progress'}</HudLabel>
        <span className="mono" style={{ fontSize: mobile ? 11 : 12, color: 'var(--text-3)' }}>
          Not carried over
        </span>
      </div>
      {g.recentItems.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: mobile ? 8 : 10 }}>
          {g.recentItems.map((item) => (
            <MiniItem key={item.id} item={item} mobile={mobile} />
          ))}
        </div>
      )}
      {mobile ? (
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {summaryLine(g, { cases: true })}
        </span>
      ) : (
        <dl className={s.stats}>
          <div className={s.stat}>
            <dt style={{ fontSize: 12, color: 'var(--text-2)' }}>Balance</dt>
            <dd className="mono" style={{ margin: 0, fontSize: 18 }}>
              {formatCredits(g.balance)} CR
            </dd>
          </div>
          <div className={s.stat}>
            <dt style={{ fontSize: 12, color: 'var(--text-2)' }}>Cases opened</dt>
            <dd className="mono" style={{ margin: 0, fontSize: 18 }}>
              {g.casesOpened}
            </dd>
          </div>
          <div className={s.stat}>
            <dt style={{ fontSize: 12, color: 'var(--text-2)' }}>{g.bestAlbum ? `${g.bestAlbum.crateName.replace(/ Case$/, '')} album` : 'Album'}</dt>
            <dd className="mono" style={{ margin: 0, fontSize: 18 }}>
              {g.bestAlbum ? `${g.bestAlbum.owned} / ${g.bestAlbum.total}` : '—'}
            </dd>
          </div>
        </dl>
      )}
      <p style={{ fontSize: mobile ? 12 : 13, lineHeight: 1.5, color: 'var(--text-2)' }}>
        Signing in starts a fresh collection. This guest and everything on it are deleted.
      </p>
    </div>
  );

  const unlocks = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <HudLabel style={{ paddingBottom: mobile ? 6 : 10, fontSize: mobile ? 10 : undefined }}>{mobile ? 'Also unlocks' : '// Also unlocks'}</HudLabel>
      {UNLOCKS.map((u) => (
        <div key={u.title} style={{ display: 'flex', alignItems: 'center', gap: mobile ? 12 : 14, padding: mobile ? '11px 0' : '14px 0', borderTop: '1px solid var(--separator)' }}>
          <svg aria-hidden="true" width={mobile ? 18 : 20} height={mobile ? 18 : 20} viewBox="0 0 24 24" style={{ flex: 'none', fill: 'none', stroke: 'var(--text-2)', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            <path d={u.icon} />
          </svg>
          {mobile ? (
            <span style={{ fontSize: 14 }}>{u.title}</span>
          ) : (
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{u.title}</span>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{u.text}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );

  const keepPlaying = (
    <Link to="/" className={s.ghostLink} style={{ alignSelf: 'center' }}>
      Keep playing as a guest
    </Link>
  );

  const states = {
    idle: mobile ? (
      <div className={s.state} style={{ gap: 12 }}>
        <p style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-2)' }}>Mint only gets your Discord name and avatar. No password to create.</p>
        <Button size={56} bevel={14} block onClick={() => void signIn.start()} disabled={disabled}>
          Continue with Discord
        </Button>
        {keepPlaying}
      </div>
    ) : (
      <div className={s.state}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <HudLabel>Sign in</HudLabel>
          <h2 className={s.cardTitle}>One click, no password to remember.</h2>
        </div>
        <Button size={56} bevel={14} block onClick={() => void signIn.start()} disabled={disabled}>
          Continue with Discord
        </Button>
        {disabled && <p style={{ fontSize: 13, color: 'var(--error)' }}>Discord sign-in is not set up on this deployment.</p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {PRIVACY.map((p) => (
            <li key={p} style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.45, color: 'var(--text-2)' }}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" style={{ flex: 'none', marginTop: 2, fill: 'none', stroke: 'var(--text)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                <path d={CHECK} />
              </svg>
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 18, borderTop: '1px solid var(--separator)' }}>
          <HudLabel style={{ fontSize: 10 }}>Inside the Discord activity</HudLabel>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>Discord asks you once when you launch Mint, then you're in. No separate step.</span>
        </div>
        {keepPlaying}
      </div>
    ),
    waiting: (
      <div role="status" className={s.state} style={{ alignItems: 'center', gap: mobile ? 14 : 20, padding: mobile ? 0 : '24px 0', textAlign: 'center' }}>
        <Spinner size={mobile ? 36 : 44} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ fontSize: mobile ? 18 : 26, fontWeight: 600 }}>Waiting for Discord…</h2>
          <p style={{ maxWidth: 320, fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>
            {mobile ? 'Approve Mint in the Discord app, then come back.' : 'Approve Mint in the Discord window. This page carries on by itself.'}
          </p>
        </div>
        <Button variant="secondary" size={44} onClick={signIn.cancel}>
          Cancel
        </Button>
        {!mobile && (
          <Button variant="tertiary" size={44} onClick={signIn.reopen} style={{ fontSize: 13 }}>
            No window? Open it again
          </Button>
        )}
      </div>
    ),
    success: (
      <div role="status" className={s.state} style={{ gap: mobile ? 12 : 20 }}>
        <div style={{ display: 'flex', alignItems: mobile ? 'center' : 'flex-start', gap: 12, flexDirection: mobile ? 'row' : 'column' }}>
          <span className="anim" style={{ position: 'relative', width: mobile ? 48 : 72, height: mobile ? 48 : 72, animation: 'mint-pop 450ms var(--pop-ease) both' }}>
            <span aria-hidden="true" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--avatar)', display: 'grid', placeItems: 'center', fontSize: mobile ? 19 : 28, fontWeight: 600, overflow: 'hidden' }}>
              {signIn.me?.avatarUrl ? <img src={signIn.me.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : name.slice(0, 1).toUpperCase()}
            </span>
            <span aria-hidden="true" style={{ position: 'absolute', right: -4, bottom: -4, width: mobile ? 20 : 28, height: mobile ? 20 : 28, borderRadius: '50%', background: 'var(--text)', border: '3px solid var(--surface)', display: 'grid', placeItems: 'center' }}>
              <svg width={mobile ? 10 : 14} height={mobile ? 10 : 14} viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'var(--primary-text)', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                <path d={CHECK} />
              </svg>
            </span>
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 2 : 10 }}>
            {!mobile && <HudLabel style={{ color: 'var(--text)' }}>Signed in</HudLabel>}
            <h2 style={{ fontSize: mobile ? 20 : 34, lineHeight: 1.05, fontWeight: 600, letterSpacing: mobile ? undefined : '-0.02em' }}>Welcome, {name}.</h2>
            <p style={{ fontSize: mobile ? 13 : 15, lineHeight: 1.55, color: 'var(--text-2)' }}>Friends, trades and the market are open.</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <Button size={mobile ? 52 : 48} block={mobile} to="/inventory" style={mobile ? undefined : { paddingInline: 22 }}>
            Go to my inventory
          </Button>
          {mobile ? (
            <Link to="/friends" style={{ alignSelf: 'center', display: 'inline-flex', alignItems: 'center', height: 44, margin: '0 auto', color: 'var(--text-2)', fontSize: 14 }}>
              Find friends
            </Link>
          ) : (
            <Button variant="secondary" size={48} to="/friends" style={{ paddingInline: 18 }}>
              Find friends
            </Button>
          )}
        </div>
      </div>
    ),
    error: (
      <div role="alert" className={s.state} style={{ gap: mobile ? 12 : 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!mobile && <HudLabel>Not signed in</HudLabel>}
          <h2 className={mobile ? undefined : s.cardTitle} style={mobile ? { fontSize: 18, fontWeight: 600 } : undefined}>
            Discord didn't confirm.
          </h2>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-2)' }}>
            {mobile ? 'Nothing is lost. Your guest progress is still here.' : 'The window was closed or the request was declined. Nothing is lost: your guest progress is still here.'}
          </p>
        </div>
        <Button size={52} bevel={mobile ? 'none' : 12} block onClick={() => void signIn.start()}>
          Try again
        </Button>
        {keepPlaying}
      </div>
    ),
  };

  if (mobile) {
    return (
      <div className={s.connectPage}>
        <div style={{ paddingBottom: 260 }}>
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, padding: '0 8px 0 20px' }}>
            <Logo mobile />
            <Link to="/" aria-label="Close" style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', color: 'var(--text-2)' }}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }}>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </Link>
          </header>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: '16px 20px 24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <HudLabel>// Sign in with Discord</HudLabel>
              <h1 style={{ fontSize: 36, lineHeight: 1.02, fontWeight: 600, letterSpacing: '-0.03em' }}>Start your collection.</h1>
              <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-2)' }}>Your own collection, {start} to start, on every device. Guest pulls stay with the guest.</p>
            </div>
            {progressCard}
            {unlocks}
            <LegalFooter style={{ fontSize: 12 }} />
          </div>
        </div>
        <section aria-live="polite" className={s.mobileSheet}>
          {states[signIn.state]}
        </section>
      </div>
    );
  }

  return (
    <div className={s.connectPage}>
      <header className={s.connectHeader}>
        <Logo />
        <Link to="/" className={s.ghostLink}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Back to the game
        </Link>
      </header>
      <main className={s.connectMain}>
        <section aria-labelledby="c-title" style={{ flex: '1 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <HudLabel>// Sign in with Discord</HudLabel>
            <h1 id="c-title" className={s.connectTitle}>
              Start your collection.
            </h1>
            <p style={{ maxWidth: 480, fontSize: 16, lineHeight: 1.55, color: 'var(--text-2)' }}>
              Your Discord account gets its own collection: {start} to start and a free case every {economy.freeLong}, on every device and inside the Discord activity. Guest pulls stay with the guest, so free cases stay fair.
            </p>
          </div>
          {progressCard}
          {unlocks}
        </section>
        <aside aria-live="polite" className={s.connectCard} style={saved ? { background: 'radial-gradient(ellipse at 30% 0%, rgba(236,237,239,0.06), rgba(14,16,19,0) 60%), var(--surface)' } : undefined}>
          <HudCorners size={18} inset={12} />
          {states[signIn.state]}
        </aside>
      </main>
      <footer style={{ width: '100%', maxWidth: 1180, margin: '0 auto', padding: '0 48px 40px' }}>
        <LegalFooter style={{ fontSize: 12 }} />
      </footer>
    </div>
  );
}
