import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import type { AuctionBid, AuctionCard, SalesHistory } from '../../../../shared/api';
import { formatCredits, formatFloat, shortDate, timeAgo } from '../../lib/format';
import { cardTimer, isRunning, roleLabel, useIsUrgent } from '../../lib/market';
import { RARITY, finishLabel, fullName } from '../../lib/rarity';
import { SkinArt } from '../items/items';
import { Avatar, Halo, StatTrakBadge } from '../ui/primitives';

const overlay = 'color-mix(in srgb, var(--page) 85%, transparent)';

/** Blinking red dot of the last 2 minutes. */
export const UrgentDot = ({ size = 6 }: { size?: number }) => (
  <span aria-hidden="true" className="anim" style={{ flex: 'none', width: size, height: size, borderRadius: '50%', background: 'var(--urgent)', animation: 'mint-blink 1s ease-in-out infinite' }} />
);

/** Timer chip over the card art: dark, inverted with the red dot when urgent, dashed once ended. */
export function TimerChip({ auction, now, style }: { auction: AuctionCard; now: Date; style?: CSSProperties }) {
  const urgent = useIsUrgent()(auction, now);
  const ended = !isRunning(auction, now);
  const look: CSSProperties = urgent
    ? { background: 'var(--primary-bg)', color: 'var(--primary-text)' }
    : ended
      ? { background: overlay, color: 'var(--text-3)', border: '1px dashed var(--border-strong)' }
      : { background: overlay, color: 'var(--text)', border: '1px solid var(--border-strong)' };
  return (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px', borderRadius: 'var(--radius-control)', fontSize: 12, fontWeight: 500, ...look, ...style }}>
      {urgent && <UrgentDot />}
      {cardTimer(auction, now)}
    </span>
  );
}

function RoleTag({ auction, style }: { auction: AuctionCard; style?: CSSProperties }) {
  const role = roleLabel(auction);
  if (!role) return null;
  return (
    <span
      className="lbl"
      style={{
        padding: '4px 7px',
        borderRadius: 'var(--radius-control)',
        fontSize: 10,
        ...(role.solid ? { background: 'var(--primary-bg)', color: 'var(--primary-text)' } : { background: overlay, color: 'var(--text)', border: '1px dashed var(--border-hover)' }),
        ...style,
      }}
    >
      {role.text}
    </span>
  );
}

const price = (a: AuctionCard) => a.finalPrice ?? a.currentBid ?? a.startPrice;
const priceLabel = (a: AuctionCard) => (a.status === 'sold' ? 'Sold for' : a.bidCount > 0 ? 'Current bid' : 'Starting price');
const bidsLabel = (a: AuctionCard) => (a.bidCount === 0 ? 'No bids yet' : `${a.bidCount} ${a.bidCount > 1 ? 'bids' : 'bid'}`);
const wearText = (a: AuctionCard) => (a.item.wear && a.item.float !== null ? `${a.item.wear.code} · ${formatFloat(a.item.float, 4)}` : 'Vanilla');

/** Market grid card (desktop): timer, ST™, your role, current bid, bids and buy-now price. */
export function AuctionTile({ auction, now }: { auction: AuctionCard; now: Date }) {
  const rarity = RARITY[auction.item.skin.tier];
  const ended = !isRunning(auction, now);
  return (
    <Link
      to={`/market/${auction.id}`}
      className="tile-link"
      style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--surface)', overflow: 'hidden', color: 'var(--text)', textDecoration: 'none', opacity: ended ? 0.55 : 1 }}
    >
      <span style={{ position: 'relative', aspectRatio: '4 / 3', display: 'grid', placeItems: 'center' }}>
        <Halo color={rarity.halo} inset="10% 12%" />
        <SkinArt skin={auction.item.skin} width="76%" style={{ position: 'relative' }} />
        <TimerChip auction={auction} now={now} style={{ position: 'absolute', left: 10, top: 10 }} />
        {auction.item.stattrak && <StatTrakBadge style={{ position: 'absolute', right: 10, top: 12 }} />}
        <RoleTag auction={auction} style={{ position: 'absolute', left: 10, bottom: 10 }} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '12px 16px 0' }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{auction.item.skin.weaponName}</span>
        <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{finishLabel(auction.item.skin)}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
          {wearText(auction)}
        </span>
      </span>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, padding: '12px 16px 14px' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="lbl" style={{ fontSize: 10 }}>
            {priceLabel(auction)}
          </span>
          <span className="mono" style={{ fontSize: 17, fontWeight: 500 }}>
            {formatCredits(price(auction))} CR
          </span>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {bidsLabel(auction)}
          </span>
          {auction.buyNowPrice !== null && auction.status === 'active' && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
              Buy now {formatCredits(auction.buyNowPrice)} CR
            </span>
          )}
        </span>
      </span>
      <span aria-hidden="true" style={{ height: 3, background: rarity.color }} />
    </Link>
  );
}

/** Market list row (mobile): art, name, price · bids, timer. */
export function AuctionRow({ auction, now }: { auction: AuctionCard; now: Date }) {
  const rarity = RARITY[auction.item.skin.tier];
  const urgent = useIsUrgent()(auction, now);
  const ended = !isRunning(auction, now);
  const role = roleLabel(auction);
  return (
    <li>
      <Link
        to={`/market/${auction.id}`}
        style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px 12px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', background: 'var(--surface)', color: 'var(--text)', textDecoration: 'none', overflow: 'hidden', opacity: ended ? 0.55 : 1 }}
      >
        <span style={{ position: 'relative', flex: 'none', width: 84, height: 54, display: 'grid', placeItems: 'center' }}>
          <Halo color={rarity.halo} inset="0" />
          <SkinArt skin={auction.item.skin} width="100%" style={{ position: 'relative', maxHeight: '100%' }} />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
            {auction.item.skin.weaponName}
            {auction.item.stattrak ? ' · ST™' : ''}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{finishLabel(auction.item.skin)}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {formatCredits(price(auction))} CR · {role ? (auction.role === 'leading' ? 'You lead' : role.text) : bidsLabel(auction)}
          </span>
        </span>
        <span
          className="mono"
          style={{
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 26,
            padding: '0 7px',
            borderRadius: 'var(--radius-control)',
            fontSize: 11,
            fontWeight: 500,
            ...(urgent
              ? { background: 'var(--primary-bg)', color: 'var(--primary-text)' }
              : ended
                ? { color: 'var(--text-3)', border: '1px dashed var(--border-strong)' }
                : { color: 'var(--text)', border: '1px solid var(--border-strong)' }),
          }}
        >
          {urgent && <UrgentDot size={5} />}
          {cardTimer(auction, now)}
        </span>
        <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: rarity.color }} />
      </Link>
    </li>
  );
}

/** Sale prices as a line with the average dashed (item page, auction page). The server sends the points. */
export function SalesChart({ sales, height, label, caption }: { sales: SalesHistory; height: number; label: string; caption?: [string, string, string] }) {
  const prices = sales.points.map((p) => p.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo || Math.max(1, hi * 0.1);
  const base = hi === lo ? lo - span / 2 : lo;
  const y = (p: number) => (110 - ((p - base) / span) * 100).toFixed(1);
  const x = (i: number) => (prices.length === 1 ? 200 : (i * 400) / (prices.length - 1)).toFixed(1);
  const points = prices.length === 1 ? `0,${y(prices[0]!)} 400,${y(prices[0]!)}` : prices.map((p, i) => `${x(i)},${y(p)}`).join(' ');
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <svg role="img" aria-label={label} viewBox="0 0 400 120" preserveAspectRatio="none" style={{ width: '100%', height, overflow: 'visible' }}>
        {sales.average !== null && <line x1="0" y1={y(sales.average)} x2="400" y2={y(sales.average)} style={{ stroke: 'var(--hud)', strokeWidth: 1, strokeDasharray: '3 4', vectorEffect: 'non-scaling-stroke' }} />}
        <polyline points={points} style={{ fill: 'none', stroke: 'var(--text)', strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke' }} />
      </svg>
      {caption && (
        <figcaption className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)' }}>
          {caption.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

/** "Sale prices over the last 30 days, between 6,800 and 7,600 CR" */
export function salesAria(sales: SalesHistory, period: string) {
  const prices = sales.points.map((p) => p.price);
  return `${period}, between ${formatCredits(Math.min(...prices))} and ${formatCredits(Math.max(...prices))} CR`;
}

export const salesDates = (sales: SalesHistory): [string, string, string] => [shortDate(sales.from), 'dashed line · average', shortDate(sales.to)];

/** Bid history rows: initial, name (bold for the leader), time, amount; yours highlighted. */
export function BidRow({ bid, leading, now, mobile }: { bid: AuctionBid; leading: boolean; now: Date; mobile?: boolean }) {
  const name = bid.isYou ? `${bid.player.username} (you)` : bid.player.username;
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: mobile ? 12 : 14,
        padding: mobile ? '10px 0' : '12px 18px',
        borderBottom: mobile ? undefined : '1px solid var(--separator)',
        borderTop: mobile ? '1px solid var(--separator)' : undefined,
        background: bid.isYou && !mobile ? 'var(--nav-hover)' : undefined,
      }}
    >
      <Avatar name={bid.player.username} url={bid.player.avatarUrl} size={mobile ? 26 : 28} />
      <span style={{ flex: 1, minWidth: 0, fontSize: mobile ? 13 : 14, fontWeight: leading ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      <span className="mono" style={{ fontSize: mobile ? 11 : 12, color: 'var(--text-3)' }}>
        {timeAgo(bid.createdAt, now, mobile)}
        {mobile ? '' : ' ago'}
      </span>
      <span className="mono" style={{ minWidth: mobile ? 70 : 90, textAlign: 'right', fontSize: mobile ? 13 : 14 }}>
        {formatCredits(bid.amount)}
        {mobile ? '' : ' CR'}
      </span>
    </li>
  );
}

export const auctionTitle = (a: AuctionCard) => fullName(a.item.skin);

/** Smaller art panel with two HUD corners (mobile auction, sell page). */
export function CompactStage({ item, height, mobile, right }: { item: AuctionCard['item']; height: number; mobile?: boolean; right?: string }) {
  const rarity = RARITY[item.skin.tier];
  const c = mobile ? 16 : 18;
  const corner = (pos: CSSProperties, sides: CSSProperties) => <span aria-hidden="true" style={{ position: 'absolute', width: c, height: c, ...pos, ...sides }} />;
  const line = '1px solid var(--hud)';
  return (
    <div
      style={{
        position: 'relative',
        height,
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        background: `radial-gradient(ellipse at 50% 50%, color-mix(in srgb, ${rarity.color} ${mobile ? 12 : 10}%, transparent), color-mix(in srgb, var(--surface) 0%, transparent) 70%)${mobile ? ', var(--surface)' : ''}`,
        ...(mobile ? { margin: '0 -20px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' } : {}),
      }}
    >
      <Halo color={rarity.halo} inset={mobile ? '6% 4%' : '8% 6%'} />
      {corner({ left: c, top: c }, { borderLeft: line, borderTop: line })}
      {corner({ right: c, bottom: c }, { borderRight: line, borderBottom: line })}
      {mobile && (
        <span className="lbl" style={{ position: 'absolute', left: 28, top: 26, fontSize: 10, color: rarity.text }}>
          {rarity.name}
        </span>
      )}
      {mobile && right && (
        <span className="lbl" style={{ position: 'absolute', right: 28, top: 26, fontSize: 10 }}>
          {right}
        </span>
      )}
      <SkinArt skin={item.skin} style={{ position: 'relative', width: mobile ? '88%' : '84%', maxHeight: height - 40 }} />
    </div>
  );
}
