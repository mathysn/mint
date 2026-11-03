import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { TradeItem } from '../../../shared/api';
import { Page } from '../components/layout/AppShell';
import { AccountRequired, TRADES_ICON } from '../components/social/social';
import { FriendPicker } from '../components/trades/FriendPicker';
import { ChosenRow, PickTile, Tabs } from '../components/trades/trades';
import { Button } from '../components/ui/Button';
import { Select, type SelectOption } from '../components/ui/fields';
import { Avatar, EmptyState } from '../components/ui/primitives';
import { useToast } from '../components/ui/Toast';
import { formatCredits } from '../lib/format';
import { useEconomyText } from '../lib/queries';
import { useFriends, useIsAccount } from '../lib/social';
import { diffLine, useSendTrade, useTradeOptions, useTradeQuote, useTrades } from '../lib/trades';
import { useDebounced } from '../lib/useDebounced';
import { useIsMobile } from '../lib/useMediaQuery';

const dayLabel = (d: number) => `${d} day${d === 1 ? '' : 's'}`;

const toCredits = (raw: string) => Math.max(0, Math.floor(Number(raw) || 0));

/** New offer to a friend. ?with=name preselects them, ?give=itemId one of your items, ?counter=tradeId answers an offer. */
export function TradeNew() {
  const mobile = useIsMobile();
  const account = useIsAccount();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const counterId = params.get('counter');
  const { data: friends } = useFriends();
  const { data: received } = useTrades('received');
  const original = counterId ? received?.find((t) => t.id === counterId) : undefined;

  // The partner comes from the URL (?with=…, set by the friend picker) or from the offer being countered.
  const to = original?.counterparty.username ?? params.get('with') ?? '';
  const [give, setGive] = useState<string[]>(params.get('give') ? [params.get('give')!] : []);
  const [ask, setAsk] = useState<string[]>([]);
  const [giveCr, setGiveCr] = useState('0');
  const [askCr, setAskCr] = useState('0');
  const expiryDays = useEconomyText().expiryDays;
  const EXPIRY: SelectOption<string>[] = expiryDays.map((d) => ({ value: String(d), label: dayLabel(d) }));
  // Mobile has no picker: 3 days when offered, else the middle choice.
  const [picked, setExpiry] = useState<number | null>(null);
  const expiry = picked !== null && expiryDays.includes(picked) ? picked : expiryDays.includes(3) ? 3 : (expiryDays[Math.floor(expiryDays.length / 2)] ?? 3);
  const [side, setSide] = useState<'give' | 'ask'>('give');

  // Counter-offer: same friend, what they asked from you goes back as your offer, their items stay asked.
  useEffect(() => {
    if (!original) return;
    setGive(original.give.items.map((i) => i.id));
    setAsk(original.get.items.map((i) => i.id));
    setGiveCr(String(original.give.credits));
    setAskCr(String(original.get.credits));
  }, [original]);

  const options = useTradeOptions(to);
  const send = useSendTrade();
  const body = { to, giveItemIds: give, askItemIds: ask, giveCredits: toCredits(giveCr), askCredits: toCredits(askCr) };
  // Debounce the serialized body: a new object every render would never settle.
  const quote = useTradeQuote(JSON.parse(useDebounced(JSON.stringify(body))) as typeof body);
  const byId = useMemo(() => new Map([...(options.data?.mine ?? []), ...(options.data?.theirs ?? [])].map((i) => [i.id, i])), [options.data]);
  const chosen = (list: string[]) => list.map((id) => byId.get(id)).filter((i): i is TradeItem => Boolean(i));
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const pickPartner = (name: string) => {
    setParams(
      (p) => {
        p.set('with', name);
        return p;
      },
      { replace: true },
    );
    setAsk([]);
  };

  if (!account) {
    return (
      <Page gap={24} top={32} back={{ to: '/trades', label: 'Trades' }} mobilePadding="8px 20px 32px">
        <h1 style={{ fontSize: mobile ? 28 : 40, fontWeight: 600, letterSpacing: '-0.02em' }}>New offer</h1>
        <AccountRequired icon={TRADES_ICON} title="Trade with your friends" text="Sign in with Discord to send and receive trade offers: items and credits, both ways." />
      </Page>
    );
  }
  if (friends && friends.friends.length === 0) {
    return (
      <Page gap={24} top={32} back={{ to: '/trades', label: 'Trades' }} mobilePadding="8px 20px 32px">
        <h1 style={{ fontSize: mobile ? 28 : 40, fontWeight: 600, letterSpacing: '-0.02em' }}>New offer</h1>
        <EmptyState title="Trades are between friends">
          <Button variant="secondary" size={44} to="/friends">
            Find friends
          </Button>
        </EmptyState>
      </Page>
    );
  }

  // No partner yet ("New offer" opened directly): ask for one first.
  if (!to && !counterId) {
    return (
      <Page gap={24} top={32} back={{ to: '/trades', label: 'Trades' }} mobilePadding="8px 20px 32px">
        <h1 style={{ fontSize: mobile ? 28 : 40, fontWeight: 600, letterSpacing: '-0.02em' }}>New offer</h1>
        <FriendPicker mobile={mobile} onClose={() => navigate('/trades')} />
      </Page>
    );
  }

  const balance = options.data?.balance ?? 0;
  const partnerBalance = options.data?.partnerBalance ?? 0;
  const tooMuch = Boolean(options.data) && toCredits(giveCr) > balance;
  const askTooMuch = Boolean(options.data) && toCredits(askCr) > partnerBalance;
  const cantSend = give.length + ask.length === 0 || tooMuch || askTooMuch || send.isPending || !to;
  const q = quote.data;
  const albumLine = q && q.albumSlots > 0 ? `Fills ${q.albumSlots} empty album slot${q.albumSlots > 1 ? 's' : ''}` : 'Values are recent average sale prices';
  const expiryLabel = dayLabel(expiry);
  // Sent: back to the Trades page, on the Sent tab where the offer now waits.
  const submit = () =>
    send.mutate(
      { ...body, expiresInDays: expiry, counterOf: original?.id },
      {
        onSuccess: () => {
          toast(`Offer sent to ${to} · expires in ${expiryLabel}`);
          navigate('/trades?box=sent');
        },
      },
    );

  const cols = [
    {
      key: 'give' as const,
      title: 'You give',
      total: q?.giveTotal ?? 0,
      items: chosen(give),
      emptyText: 'Pick items from your inventory below',
      crLabel: mobile ? 'Add credits' : `Add credits from your balance (${formatCredits(balance)} CR)`,
      cr: giveCr,
      setCr: setGiveCr,
      pickerTitle: 'Your inventory',
      pickerHint: 'Listed and traded items are locked',
      pool: options.data?.mine ?? [],
      list: give,
      set: setGive,
    },
    {
      key: 'ask' as const,
      title: 'You ask for',
      total: q?.getTotal ?? 0,
      items: chosen(ask),
      emptyText: `Pick items from ${to}’s inventory below`,
      crLabel: mobile ? `Ask ${to} · has ${formatCredits(partnerBalance)} CR` : `Ask ${to} for credits (${formatCredits(partnerBalance)} CR)`,
      cr: askCr,
      setCr: setAskCr,
      pickerTitle: `${to}’s inventory`,
      pickerHint: '“Album +1” fills one of your empty slots',
      pool: options.data?.theirs ?? [],
      list: ask,
      set: setAsk,
    },
  ];

  const creditsInput = (c: (typeof cols)[number]) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: mobile ? 10 : 12, ...(mobile ? { paddingTop: 4 } : { padding: '14px 20px', borderTop: '1px solid var(--separator)' }) }}>
      <span style={{ flex: 1, fontSize: 14, color: 'var(--text-2)' }}>{c.crLabel}</span>
      <input
        type="number"
        min={0}
        step={10}
        inputMode="numeric"
        className="mono"
        value={c.cr}
        onChange={(e) => c.setCr(e.target.value)}
        style={{ width: mobile ? 110 : 140, height: mobile ? 44 : 40, padding: '0 12px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-control)', background: mobile ? 'var(--surface)' : 'var(--page)', color: 'var(--text)', fontSize: mobile ? 15 : 14, textAlign: 'right' }}
      />
      <span className="mono" style={{ fontSize: mobile ? 12 : 13, color: 'var(--text-2)' }}>
        CR
      </span>
    </label>
  );

  const pool = (c: (typeof cols)[number]) => (
    <div className="stagger-list" style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(3, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(min(124px, 100%), 1fr))', gap: 8 }}>
      {c.pool.map((item) => (
        <PickTile key={item.id} item={item} on={c.list.includes(item.id)} mobile={mobile} onToggle={() => toggle(c.list, c.set, item.id)} />
      ))}
    </div>
  );

  const partnerOptions: SelectOption<string>[] = (friends?.friends ?? []).map((f) => ({
    value: f.username,
    label: f.username,
    icon: <Avatar name={f.username} url={f.avatarUrl} size={20} />,
  }));

  const lockNote = tooMuch
    ? 'You can’t offer more credits than your balance.'
    : askTooMuch
      ? `${to} only has ${formatCredits(partnerBalance)} CR.`
      : `Your items and credits are locked until ${to} answers or the offer expires. Both sides swap in one go.`;

  if (mobile) {
    const c = cols[side === 'give' ? 0 : 1]!;
    return (
      <Page gap={16} back={{ to: '/trades', label: 'Trades' }} mobilePadding="8px 20px 200px" mobileRight={<span />}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h1 style={{ fontSize: 28, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>{original ? 'Counter-offer' : 'New offer'}</h1>
          {friends && friends.friends.length > 1 && !original ? (
            <Select variant="inline" prefix="to" ariaLabel="Trade with" value={to} options={partnerOptions} onChange={pickPartner} searchable searchPlaceholder="Search your friends" />
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-2)' }}>
              to <Avatar name={to} url={options.data?.partner.avatarUrl} size={24} />
              <strong style={{ color: 'var(--text)' }}>{to}</strong>
            </span>
          )}
        </div>
        <Tabs<'give' | 'ask'>
          label="Side"
          mobile
          value={side}
          onChange={setSide}
          tabs={[
            { value: 'give', label: 'You give' },
            { value: 'ask', label: 'You ask for' },
          ]}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {c.items.length === 0 && (
            <div style={{ display: 'grid', placeItems: 'center', minHeight: 60, border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-card)', fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: '0 12px' }}>{c.emptyText}</div>
          )}
          {c.items.map((item) => (
            <ChosenRow key={item.id} item={item} mobile onRemove={() => toggle(c.list, c.set, item.id)} />
          ))}
          {creditsInput(c)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 6 }}>
          <span className="lbl">{c.pickerTitle}</span>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.key === 'give' ? 'Locked items are greyed' : '“Album +1” fills a slot'}</span>
        </div>
        {pool(c)}
        <section aria-label="Offer summary" style={{ position: 'fixed', left: 0, right: 0, bottom: 'var(--tabbar)', zIndex: 5, height: 88, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--surface-bar)', borderTop: '1px solid var(--border-strong)' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span className="mono" style={{ fontSize: 13 }}>
              {formatCredits(q?.giveTotal ?? 0)} <span style={{ color: 'var(--text-3)' }}>⇄</span> {formatCredits(q?.getTotal ?? 0)} CR
            </span>
            <span className="mono" style={{ fontSize: 11, color: tooMuch || askTooMuch ? 'var(--error)' : 'var(--text-2)' }}>
              {tooMuch ? 'More than your balance' : askTooMuch ? `${to} only has ${formatCredits(partnerBalance)} CR` : diffLine(q?.diff ?? 0, formatCredits)}
            </span>
          </div>
          <Button size={48} bevel={10} onClick={submit} disabled={cantSend} style={{ paddingInline: 20 }}>
            {send.isPending ? 'Sending…' : 'Send offer'}
          </Button>
        </section>
      </Page>
    );
  }

  return (
    <Page gap={24} top={32}>
      <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Link to="/trades" className="mono" style={{ fontSize: 12, color: 'var(--text-2)', textDecoration: 'none' }}>
            ← Trades
          </Link>
          <h1 style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>{original ? 'Counter-offer' : 'New offer'}</h1>
        </div>
        {friends && !original && (
          <Select label="Trade with" value={to} options={partnerOptions} onChange={pickPartner} searchable searchPlaceholder="Search your friends" size={44} style={{ minWidth: 220 }} />
        )}
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        {cols.map((c) => (
          <section key={c.key} aria-label={c.title} style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', background: 'var(--surface)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '20px 20px 14px' }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>{c.title}</h2>
              <span className="mono" style={{ fontSize: 14, color: 'var(--text-2)' }}>
                ≈ {formatCredits(c.total)} CR
              </span>
            </div>
            <div style={{ padding: '0 20px 16px' }}>
              {c.items.length === 0 && (
                <div style={{ display: 'grid', placeItems: 'center', minHeight: 96, border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-card)', fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: '0 16px' }}>{c.emptyText}</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(180px, 100%), 1fr))', gap: 8 }}>
                {c.items.map((item) => (
                  <ChosenRow key={item.id} item={item} onRemove={() => toggle(c.list, c.set, item.id)} />
                ))}
              </div>
            </div>
            {creditsInput(c)}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 20px 20px', borderTop: '1px solid var(--separator)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="lbl">{c.pickerTitle}</span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{c.pickerHint}</span>
              </div>
              {pool(c)}
            </div>
          </section>
        ))}
      </div>

      <section aria-label="Offer summary" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 28px', padding: '18px 22px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-panel)', background: 'var(--surface-bar)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="lbl">You give</span>
          <span className="mono" style={{ fontSize: 18 }}>
            {formatCredits(q?.giveTotal ?? 0)} CR
          </span>
        </div>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'var(--text-3)', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
          <path d="M4 8h15l-4-4M20 16H5l4 4" />
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="lbl">You get</span>
          <span className="mono" style={{ fontSize: 18 }}>
            {formatCredits(q?.getTotal ?? 0)} CR
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="mono" style={{ fontSize: 13, color: 'var(--text)' }}>
            {diffLine(q?.diff ?? 0, formatCredits)}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{albumLine}</span>
        </div>
        <span style={{ flex: '1 1 0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden="true" style={{ fontSize: 13, color: 'var(--text-2)' }}>Expires in</span>
          <Select ariaLabel="Expires in" value={String(expiry)} options={EXPIRY} onChange={(v) => setExpiry(Number(v))} size={44} />
        </div>
        <Button size={48} onClick={submit} disabled={cantSend} style={{ paddingInline: 28 }}>
          {send.isPending ? 'Sending…' : 'Send offer'}
        </Button>
        <p style={{ flexBasis: '100%', fontSize: 12, color: tooMuch || askTooMuch ? 'var(--error)' : 'var(--text-3)' }}>{lockNote}</p>
      </section>
    </Page>
  );
}
