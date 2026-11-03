import { useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, type ReactNode, useCallback, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { AlbumSummary, Item, Profile as ProfileData } from '../../../shared/api';
import { pct } from '../components/albums/albums';
import { Page } from '../components/layout/AppShell';
import { DeleteAccount } from '../components/layout/DeleteAccount';
import { EmptySlot, SHOWCASE_SIZE, ShowcaseCard, ShowcaseFeature, ShowcasePicker, SlotActions } from '../components/social/showcase';
import { Button } from '../components/ui/Button';
import { ConfirmInline } from '../components/ui/ConfirmInline';
import { Avatar, EmptyState, ProgressBar } from '../components/ui/primitives';
import { api } from '../lib/api';
import { isActivity } from '../lib/platform';
import { formatCredits, longDate, shortDate } from '../lib/format';
import { stagger } from '../lib/motion';
import { useInventory } from '../lib/queries';
import { useFriendActions, useIsAccount, useProfile, useSetShowcase } from '../lib/social';
import { ReportPlayer } from '../components/social/ReportPlayer';
import { useIsMobile } from '../lib/useMediaQuery';
import s from './screens.module.css';

/** "#18 by inventory value": links to the leaderboard. */
const RankChip = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="mono" style={{ display: 'inline-flex', alignItems: 'center', height: 28, padding: '0 10px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-control)', fontSize: 12, color: 'var(--text)', textDecoration: 'none' }}>
    {children}
  </Link>
);

function metaLine(p: ProfileData, mobile: boolean) {
  if (p.relation === 'friend' && p.friendsSince) return mobile ? `Friends since ${shortDate(p.friendsSince)}` : `Joined ${longDate(p.joinedAt)} · friends since ${shortDate(p.friendsSince)}`;
  if (p.relation === 'self') return `Joined ${longDate(p.joinedAt)} · signed in with Discord`;
  return `Joined ${longDate(p.joinedAt)}`;
}

/** Add friend / Accept / Requested, for a player who is not a friend yet. */
function RelationAction({ profile, mobile }: { profile: ProfileData; mobile: boolean }) {
  const { add, accept, drop } = useFriendActions();
  const size = mobile ? 48 : 44;
  if (profile.relation === 'none') {
    return (
      <Button size={size} bevel={mobile ? 12 : 10} block={mobile} onClick={() => add.mutate(profile.player.username)} disabled={add.isPending} style={mobile ? undefined : { paddingInline: 22 }}>
        Add friend
      </Button>
    );
  }
  if (profile.relation === 'incoming') {
    return (
      <div style={{ display: 'flex', gap: 10 }}>
        <Button size={size} bevel={10} onClick={() => accept.mutate(profile.player.id)} disabled={accept.isPending} style={{ paddingInline: 22 }}>
          Accept request
        </Button>
        <Button variant="ghost" size={44} onClick={() => drop.mutate(profile.player.id)} style={{ paddingInline: 10 }}>
          Decline
        </Button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <Button variant="secondary" size={44} disabled>
        Requested
      </Button>
      <Button variant="ghost" size={44} onClick={() => drop.mutate(profile.player.id)} style={{ paddingInline: 10 }}>
        Cancel
      </Button>
    </div>
  );
}

export function Profile() {
  const { username = '' } = useParams();
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  // "← Friends" by default; links from the leaderboard, the feed or the global drop pass their own.
  const from = (location.state as { back?: { to: string; label: string } } | null)?.back;
  const client = useQueryClient();
  const { data: profile, error } = useProfile(username);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const save = useSetShowcase();
  const { remove } = useFriendActions();
  const self = profile?.relation === 'self';
  const account = useIsAccount();
  const inventory = useInventory('sort=value', self && picking);
  const closePicker = useCallback(() => setPicking(false), []);
  const cancelRemove = useCallback(() => setConfirmRemove(false), []);

  if (error) {
    return (
      <Page gap={24}>
        <EmptyState title="No player with this name">
          <Button variant="secondary" size={44} to="/friends">
            Back to friends
          </Button>
        </EmptyState>
      </Page>
    );
  }
  if (!profile) return <Page gap={24}>{null}</Page>;

  const name = profile.player.username;
  const back = { to: `/players/${encodeURIComponent(name)}`, label: name };
  const exit = from ?? (self ? null : { to: '/friends', label: 'Friends' });
  const ids = profile.showcase.map((i) => i.id);
  const saveIds = (next: string[]) => save.mutate(next);
  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' });
    await client.resetQueries();
    navigate('/');
  };

  const footerFor = (item: Item, index: number) =>
    editing ? (
      <SlotActions
        main={index === 0}
        onRemove={() => saveIds(ids.filter((id) => id !== item.id))}
        onMain={() => saveIds([item.id, ...ids.filter((id) => id !== item.id)])}
      />
    ) : undefined;

  const [main, ...rest] = profile.showcase;
  const emptySlots = editing ? Math.max(0, SHOWCASE_SIZE - profile.showcase.length) : 0;
  const pickerItems = inventory.data?.items.filter((i) => !ids.includes(i.id) && i.status === 'available') ?? [];

  const showcaseBody =
    profile.showcase.length === 0 && !editing ? (
      <div className={s.panel} style={{ borderStyle: 'dashed', background: 'transparent', alignItems: 'flex-start', gap: 12 }}>
        <p style={{ fontSize: 15, color: 'var(--text-2)' }}>{self ? 'Your showcase is empty. Pick up to 5 items for every player to see.' : 'Nothing in the showcase yet.'}</p>
        {self && (
          <Button variant="secondary" size={44} onClick={() => setEditing(true)}>
            Edit showcase
          </Button>
        )}
      </div>
    ) : mobile ? (
      <>
        {main ? <ShowcaseFeature item={main} mobile back={back} footer={footerFor(main, 0)} /> : <EmptySlot big mobile onAdd={() => setPicking(true)} />}
        <div className="hscroll stagger-list" style={{ display: 'flex', gap: 10, overflowX: 'auto', margin: '0 -20px', padding: '0 20px' }}>
          {rest.map((item, i) => (
            <ShowcaseCard key={item.id} item={item} index={i + 2} mobile back={back} footer={footerFor(item, i + 1)} />
          ))}
          {main && Array.from({ length: emptySlots }, (_, i) => <EmptySlot key={i} mobile onAdd={() => setPicking(true)} />)}
        </div>
      </>
    ) : (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {main ? <ShowcaseFeature item={main} back={back} footer={footerFor(main, 0)} /> : <EmptySlot big onAdd={() => setPicking(true)} />}
        <div className="stagger-list" style={{ flex: '1 1 380px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, alignContent: 'start' }}>
          {rest.map((item, i) => (
            <ShowcaseCard key={item.id} item={item} index={i + 2} back={back} footer={footerFor(item, i + 1)} />
          ))}
          {main && Array.from({ length: emptySlots }, (_, i) => <EmptySlot key={i} onAdd={() => setPicking(true)} />)}
        </div>
      </div>
    );

  const editButton = self && (
    <Button variant="secondary" size={44} block={mobile} onClick={() => setEditing(!editing)}>
      {editing ? 'Done' : 'Edit showcase'}
    </Button>
  );

  const friendActions =
    profile.relation === 'friend' &&
    (confirmRemove ? (
      <ConfirmInline
        onCancel={cancelRemove}
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}
        message={<span style={{ fontSize: 14 }}>Remove {name} from your friends?</span>}
      >
        <Button variant="secondary" size={44} onClick={cancelRemove}>
          Cancel
        </Button>
        <Button size={44} bevel="none" onClick={() => remove.mutate(profile.player.id, { onSuccess: cancelRemove })} disabled={remove.isPending}>
          Remove
        </Button>
      </ConfirmInline>
    ) : (
      <div style={mobile ? { display: 'flex', flexDirection: 'column', gap: 8 } : { display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Button size={mobile ? 48 : 44} bevel={mobile ? 12 : 10} block={mobile} to={`/trades/new?with=${encodeURIComponent(name)}`} style={mobile ? undefined : { paddingInline: 22 }}>
          Propose a trade
        </Button>
        <div style={mobile ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 } : { display: 'flex', gap: 10 }}>
          <Button variant="secondary" size={44} to={`/players/${encodeURIComponent(name)}/inventory`}>
            Inventory
          </Button>
          <Button variant="secondary" size={44} to={`/players/${encodeURIComponent(name)}/albums`}>
            Albums
          </Button>
        </div>
        <Button variant="ghost" size={44} onClick={() => setConfirmRemove(true)} style={{ paddingInline: 10, alignSelf: mobile ? 'center' : undefined }}>
          Remove friend
        </Button>
      </div>
    ));

  const actions = self ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
      {editButton}
      {!mobile && !isActivity && (
        <Button variant="ghost" size={44} onClick={() => void signOut()} style={{ paddingInline: 10 }}>
          Sign out
        </Button>
      )}
      {!mobile && !isActivity && (
        <DeleteAccount
          username={name}
          trigger={(open) => (
            <Button variant="ghost" size={44} onClick={open} style={{ paddingInline: 10, color: 'var(--text-3)' }}>
              Delete account
            </Button>
          )}
        />
      )}
    </div>
  ) : (
    <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', flexWrap: 'wrap', gap: 10, alignItems: mobile ? 'stretch' : 'center' }}>
      {profile.relation === 'friend' ? friendActions : <RelationAction profile={profile} mobile={mobile} />}
      {account && <ReportPlayer username={name} mobile={mobile} />}
    </div>
  );

  const stats = [
    { k: 'Cases opened', v: formatCredits(profile.stats.casesOpened) },
    { k: 'Inventory value', v: `${formatCredits(profile.stats.inventoryValue)} CR` },
    { k: 'Trades completed', v: formatCredits(profile.stats.tradesCompleted) },
    { k: 'Skins collected', v: formatCredits(profile.stats.skinsCollected) },
  ];
  const albumsLink = profile.canViewCollection ? (self ? '/albums' : `/players/${encodeURIComponent(name)}/albums`) : null;

  // Started albums only (server). Rows open the album for yourself and friends; others get a 403 there.
  const albumRow = (a: AlbumSummary, i: number) => {
    const rowStyle: CSSProperties = mobile
      ? { display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: '1px solid var(--separator)' }
      : { display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px 16px 16px', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' };
    const body = (
      <>
        <span aria-hidden="true" style={{ flex: 'none', width: mobile ? 48 : 64, height: mobile ? 36 : 48, display: 'grid', placeItems: 'center', background: 'radial-gradient(closest-side, rgba(236,237,239,0.08), rgba(236,237,239,0))' }}>
          <img src={a.crate.imageUrl} alt="" loading="lazy" draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: mobile ? 8 : 12 }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: 14 }}>
            <span title={a.name} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: mobile ? 400 : 600 }}>
              {a.name}
            </span>
            <span className="mono" style={{ flex: 'none', whiteSpace: 'nowrap', fontSize: 13, color: 'var(--text-2)' }}>
              {mobile ? `${a.owned}/${a.total}` : `${a.owned} / ${a.total}`}
            </span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ProgressBar pct={pct(a)} style={{ height: 3 }} />
            <span className="mono" style={{ flex: 'none', width: '4ch', textAlign: 'right', fontSize: 12, color: 'var(--text-2)' }}>
              {pct(a)}%
            </span>
          </span>
        </span>
      </>
    );
    return albumsLink ? (
      <Link key={a.id} to={`${albumsLink}/${a.id}`} className={`stagger ${mobile ? 'row-link' : 'tile-link'}`} style={{ ...rowStyle, ...stagger(i), color: 'var(--text)', textDecoration: 'none' }}>
        {body}
      </Link>
    ) : (
      <div key={a.id} className="stagger" style={{ ...rowStyle, ...stagger(i) }}>
        {body}
      </div>
    );
  };

  const statsSection = (
    <section aria-labelledby="st-title" style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 12 : 16 }}>
      <h2 id="st-title" className="lbl">
        // Stats
      </h2>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', overflow: 'hidden' }}>
        {stats.map((st, i) => (
          <div
            key={st.k}
            // An odd last stat spans the row on mobile, so no empty cell shows the grid background.
            style={{ display: 'flex', flexDirection: 'column-reverse', gap: mobile ? 6 : 8, padding: mobile ? 16 : '22px 24px', background: 'var(--surface)', gridColumn: mobile && i === stats.length - 1 && stats.length % 2 ? '1 / -1' : undefined }}
          >
            <dt style={{ fontSize: mobile ? 12 : 13, color: 'var(--text-2)' }}>{st.k}</dt>
            <dd className="mono" style={{ margin: 0, fontSize: mobile ? 20 : 26, fontWeight: 500 }}>
              {st.v}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );

  const albumsSection = (
    <section aria-labelledby="al-title" style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 4 : 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: mobile ? 8 : 0 }}>
        <h2 id="al-title" className="lbl">
          // Albums
        </h2>
        {albumsLink && (
          <Link to={albumsLink} style={{ fontSize: 14, color: 'var(--text-2)' }}>
            Open albums
          </Link>
        )}
      </div>
      {profile.albums.length === 0 ? (
        <div className={s.panel} style={{ borderStyle: 'dashed', background: 'transparent', alignItems: 'flex-start', gap: 12 }}>
          <p style={{ fontSize: 15, color: 'var(--text-2)' }}>{self ? 'No album started yet. Every case you open fills its album.' : `${name} hasn't started an album yet.`}</p>
          {self && (
            <Button variant="secondary" size={44} to="/cases">
              Browse cases
            </Button>
          )}
        </div>
      ) : (
        // Desktop: 3 columns at most, so the 6 albums always end on full rows.
        <div style={mobile ? { display: 'flex', flexDirection: 'column' } : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, max(300px, calc((100% - 24px) / 3))), 1fr))', gap: 12 }}>
          {profile.albums.map(albumRow)}
        </div>
      )}
    </section>
  );

  const showcaseSection = (
    <section aria-labelledby="sc-title" style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 12 : 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
        <h2 id="sc-title" className="lbl">
          // Showcase
        </h2>
        {!mobile && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{self ? 'Picked by you · visible to every player' : `Picked by ${name}`}</span>}
      </div>
      {showcaseBody}
    </section>
  );

  const picker = picking && <ShowcasePicker items={pickerItems} mobile={mobile} onClose={closePicker} onPick={(item) => saveIds([...ids, item.id].slice(0, SHOWCASE_SIZE))} />;

  if (mobile) {
    return (
      <Page gap={24} back={exit ?? { to: '/more', label: 'More' }} mobilePadding="8px 20px 32px">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Avatar name={name} url={profile.player.avatarUrl} size={64} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 style={{ fontSize: 30, lineHeight: 1, fontWeight: 600, letterSpacing: '-0.02em' }}>{name}</h1>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{metaLine(profile, true)}</span>
            <Link to="/leaderboard" className="mono" style={{ fontSize: 12, color: 'var(--text)', textDecoration: 'none' }}>
              #{profile.ranks.value} by value · #{profile.ranks.albums} by albums
            </Link>
          </div>
        </div>
        {actions}
        {showcaseSection}
        {statsSection}
        {albumsSection}
        {picker}
      </Page>
    );
  }

  return (
    <Page gap={40} top={exit ? 32 : 40}>
      {exit && (
        <Link to={exit.to} className="mono" style={{ alignSelf: 'flex-start', marginBottom: -20, fontSize: 12, color: 'var(--text-2)', textDecoration: 'none' }}>
          ← {exit.label}
        </Link>
      )}
      <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <Avatar name={name} url={profile.player.avatarUrl} size={80} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h1 style={{ fontSize: 40, lineHeight: 1, fontWeight: 600, letterSpacing: '-0.02em' }}>{name}</h1>
            <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{metaLine(profile, false)}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <RankChip to="/leaderboard">#{profile.ranks.value} by inventory value</RankChip>
              <RankChip to="/leaderboard?board=albums">#{profile.ranks.albums} by albums</RankChip>
            </div>
          </div>
        </div>
        {actions}
      </header>
      {showcaseSection}
      {statsSection}
      {albumsSection}
      {picker}
    </Page>
  );
}
