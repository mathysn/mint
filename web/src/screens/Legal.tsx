import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Logo } from '../components/layout/AppShell';
import { DISCLAIMER } from '../components/layout/LegalFooter';
import { HudLabel } from '../components/ui/primitives';
import s from './screens.module.css';

/** Contact for data requests, set per deployment (`VITE_CONTACT_EMAIL`). */
const CONTACT = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined)?.trim() || null;
const UPDATED = 'October 28, 2026';

function Contact() {
  return CONTACT ? (
    <>
      write to{' '}
      <a href={`mailto:${CONTACT}`} style={{ color: 'var(--text)' }}>
        {CONTACT}
      </a>
    </>
  ) : (
    <>contact the Mint staff on the Discord server where you found the game</>
  );
}

function LegalPage({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const navigate = useNavigate();
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));
  return (
    <main style={{ minHeight: '100vh', background: 'var(--page)', color: 'var(--text)' }}>
      <div className="page-enter" style={{ width: '100%', maxWidth: 760, margin: '0 auto', padding: '32px 20px 72px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <Logo />
          <button type="button" onClick={back} className={s.ghostLink} style={{ border: 0, background: 'none', font: 'inherit', fontSize: 14, cursor: 'pointer' }}>
            ← Back
          </button>
        </div>
        <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <HudLabel>// {label}</HudLabel>
          <h1 style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</h1>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Last updated {UPDATED}
          </p>
        </header>
        {children}
        <p style={{ fontSize: 13, color: 'var(--text-3)', paddingTop: 20, borderTop: '1px solid var(--separator)' }}>{DISCLAIMER}</p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ fontSize: 19, fontWeight: 600 }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 15, lineHeight: 1.6, color: 'var(--text-2)' }}>{children}</div>
    </section>
  );
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function Privacy() {
  return (
    <LegalPage label="Privacy" title="Privacy">
      <Section title="In short">
        <p>
          Mint is a free fan game. It keeps what it needs to run your collection and keep the game fair, nothing else. It has no ads, no
          analytics and never sells or shares your data.
        </p>
      </Section>
      <Section title="What Mint stores">
        <List
          items={[
            <>
              <strong style={{ color: 'var(--text)' }}>Your Discord account</strong>: its ID, name and avatar. Mint only asks Discord for
              “identify”: it can’t see your email, messages, servers or friends list.
            </>,
            <>
              <strong style={{ color: 'var(--text)' }}>Your game</strong>: items, credits and their history, cases opened, trades, bids and
              sales, friends, showcase, activity feed entries, and reports you send.
            </>,
            <>
              <strong style={{ color: 'var(--text)' }}>Your sessions</strong>: when you signed in and were last seen, the kind of device (“Chrome ·
              Windows”), a scrambled code made from your IP address (the address itself is never stored) and, when the host provides it, the
              country and city your connection comes from.
            </>,
            <>
              <strong style={{ color: 'var(--text)' }}>In your browser</strong>: one cookie that keeps you signed in, your sound setting and the
              announcements you closed. No tracking cookies.
            </>,
          ]}
        />
      </Section>
      <Section title="Why">
        <p>
          To run the game, to stop cheating (for example one person farming many accounts, or limiting how many guest accounts one network
          can create), and so the staff can answer reports. Staff can see your game data and sessions; every staff action is logged.
        </p>
      </Section>
      <Section title="How long">
        <List
          items={[
            'Guest accounts are deleted after an hour away if they never opened a case, and after 7 days away otherwise.',
            'A Discord account is kept until you delete it.',
            'Signed-out sessions stop working at once; their record stays with your account.',
          ]}
        />
      </Section>
      <Section title="Deleting your account">
        <p>
          Use <strong style={{ color: 'var(--text)' }}>Delete my account</strong> on your profile (or in More on a phone). Your Discord ID,
          name, avatar, items, friends, showcase, feed entries and sessions are removed at once. The records other players need stay, under
          “Deleted player”: past trades, sales and the credits journal.
        </p>
      </Section>
      <Section title="Who else sees it">
        <p>
          Nobody else gets your data. The game runs on a server in the European Union. Skin images load from Steam’s servers and avatars from
          Discord’s, so they see your IP address like any image you load.
        </p>
      </Section>
      <Section title="Your rights">
        <p>
          You can ask to see, correct or delete your data at any time: <Contact />. You need a Discord account to sign in, so Discord’s minimum
          age applies.
        </p>
      </Section>
    </LegalPage>
  );
}

export function Terms() {
  return (
    <LegalPage label="Terms" title="Terms">
      <Section title="A fan game, no real money">
        <p>
          Mint is a free, non-commercial fan project. It is not affiliated with or endorsed by Valve; the skin names and images belong to
          Valve.
        </p>
        <p>
          Credits (CR) and items have no real-world value. They can’t be bought, and they can’t be sold or traded for money or anything outside
          Mint. Doing so gets the accounts involved banned.
        </p>
      </Section>
      <Section title="Your account">
        <List
          items={[
            'You sign in with Discord. One account per person: alt accounts used to farm credits or items are banned.',
            'Guest progress is never carried over to a Discord account.',
            'Pick a name others are fine reading. The staff can reset offensive names.',
          ]}
        />
      </Section>
      <Section title="Play fair">
        <List
          items={[
            'No bots, scripts or automation.',
            'No scams in trades. Check every offer before you accept: an accepted trade is final.',
            'Found a bug that gives credits or items? Report it instead of using it.',
          ]}
        />
        <p>
          The staff can correct balances, remove items, cancel listings or offers and ban accounts to keep the game fair. Every such action is
          logged.
        </p>
      </Section>
      <Section title="The game can change">
        <p>
          Drop rates, prices and other numbers are shown in the game and may be rebalanced. Mint is provided as is, without any guarantee: it
          can have bugs or downtime, and it can stop. Your collection only exists inside Mint.
        </p>
      </Section>
      <Section title="Questions">
        <p>
          To ask anything about these terms, <Contact />. See also the <Link to="/privacy" style={{ color: 'var(--text)' }}>privacy page</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
