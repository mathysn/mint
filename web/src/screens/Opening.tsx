import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { CrateDetail, Me, OpenResult, StripCard } from '../../../shared/api';
import { Page } from '../components/layout/AppShell';
import { GoldReveal, RevealPanel, Roulette, SoundToggle, StageGlow, WhatsInside, finderMatch } from '../components/opening/opening';
import s from '../components/opening/opening.module.css';
import { Button, ButtonNote } from '../components/ui/Button';
import { ConfirmInline } from '../components/ui/ConfirmInline';
import { EmptyState, HudLabel } from '../components/ui/primitives';
import { useToast } from '../components/ui/Toast';
import { ApiRequestError, api } from '../lib/api';
import { formatCredits } from '../lib/format';
import { keys, useCaseFinder, useCrate, useMe, useRefreshPlayerData } from '../lib/queries';
import { fullName } from '../lib/rarity';
import { useRecycle } from '../lib/recycle';
import { sound } from '../lib/sound';
import { useIsMobile } from '../lib/useMediaQuery';
import { prefersReducedMotion } from '../lib/usePresence';

type Phase = 'ready' | 'spinning' | 'revealed';

const NOTICE_MS = 4000;
const REVEAL_EXIT_MS = 160;

/** Decorative strip shown before the first opening: the case's own skins, in order. */
function idleStrip(detail: CrateDetail): StripCard[] {
  const skins = detail.groups.flatMap((g) => g.skins).reverse();
  if (!skins.length) return [];
  return Array.from({ length: 48 }, (_, i) => skins[i % skins.length]!);
}

export function Opening() {
  const { id = '' } = useParams();
  const mobile = useIsMobile();
  const toast = useToast();
  const client = useQueryClient();
  const refresh = useRefreshPlayerData();
  const { data: detail, error } = useCrate(id);
  const { data: me } = useMe();
  // Coming from the weapon finder of the Cases screen: highlight what was searched in "What's inside".
  const [params] = useSearchParams();
  const finder = useCaseFinder(params.get('find') ?? '', id);
  const match = finderMatch(finder.data?.crates[0]?.matches);

  const [phase, setPhase] = useState<Phase>('ready');
  const [result, setResult] = useState<OpenResult | null>(null);
  // "You need 250 CR…": shown in a fixed-height slot under the button, then faded out.
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  const [noticeOn, setNoticeOn] = useState(false);
  const showNotice = (text: string) => {
    setNotice({ text, at: Date.now() });
    setNoticeOn(true);
  };
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNoticeOn(false), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [confirming, setConfirming] = useState(false);
  // Same key while a request is retried after a network failure: the server never charges twice.
  const requestKey = useRef<string | null>(null);

  const freeHere = Boolean(me?.freeCase.available && me.freeCase.crateId === id);
  const price = detail?.crate.price ?? 250;

  const open = useMutation({
    mutationFn: () => {
      requestKey.current ??= crypto.randomUUID();
      return api<OpenResult>(`/crates/${id}/open`, {
        method: 'POST',
        headers: { 'idempotency-key': requestKey.current },
        json: { free: freeHere },
      });
    },
    onSuccess: (res) => {
      requestKey.current = null;
      setNoticeOn(false);
      client.setQueryData<Me>(keys.me, (m) => (m ? { ...m, balance: res.balance, freeCase: res.freeCase } : m));
      setResult(res);
      setLanding(false);
      setPhase('spinning');
      sound.open();
    },
    onError: (err) => {
      if (err instanceof ApiRequestError) {
        requestKey.current = null;
        if (err.code === 'insufficient_balance') {
          setPhase('ready');
          return showNotice(err.message);
        }
        if (err.code === 'free_case_unavailable') void client.invalidateQueries({ queryKey: keys.me });
      }
      toast(err instanceof Error ? err.message : 'Could not open the case.', { error: true });
      setPhase('ready');
    },
  });

  // The reveal fades out before the roulette comes back (Keep, Recycle, Open another).
  const [leaving, setLeaving] = useState(false);
  const leaveReveal = useCallback(() => {
    const back = () => {
      setLeaving(false);
      // A new roll may have started meanwhile ("Open another"): only a reveal goes back to ready.
      setPhase((p) => (p === 'revealed' ? 'ready' : p));
    };
    if (prefersReducedMotion()) return back();
    setLeaving(true);
    window.setTimeout(back, REVEAL_EXIT_MS);
  }, []);
  // The strip has stopped on the result: the lock-in plays, then the reveal.
  const [landing, setLanding] = useState(false);

  const start = () => {
    if (open.isPending || phase === 'spinning') return;
    // First sound of the page: the context starts inside this click, as browsers require.
    sound.unlock();
    setConfirming(false);
    leaveReveal();
    // Not enough CR: say it without sending a request the server would refuse (402).
    // The server still checks, this only spares a failing call.
    if (!freeHere && me && me.balance < price) return showNotice(`You need ${formatCredits(price)} CR to open this case.`);
    open.mutate();
  };
  const onLand = useCallback(() => {
    setLanding(true);
    sound.stop();
  }, []);
  const onRollDone = useCallback(() => {
    setLanding(false);
    setPhase('revealed');
    if (result) sound.reveal(result.item.skin.tier);
    refresh();
  }, [refresh, result]);
  const keep = useCallback(() => {
    setConfirming(false);
    leaveReveal();
  }, [leaveReveal]);
  // Recycling from the reveal: back to the roulette once the server has credited the value.
  const recycle = useRecycle(keep);
  const cancelConfirm = useCallback(() => setConfirming(false), []);

  const strip = useMemo(() => (result ? result.strip : detail ? idleStrip(detail) : []), [result, detail]);

  if (error) {
    return (
      <Page gap={28} back={{ to: '/cases', label: 'Cases' }}>
        <EmptyState title="This case cannot be opened">
          <Button variant="secondary" size={44} to="/cases">
            Back to cases
          </Button>
        </EmptyState>
      </Page>
    );
  }

  const revealed = phase === 'revealed' && result !== null;
  const gold = revealed && result.item.skin.tier === 'gold';
  const busy = open.isPending || phase === 'spinning';
  const openLabel = busy ? 'Opening…' : freeHere ? 'Open free case' : `Open case · ${formatCredits(price)} CR`;
  // `me.freeCase` is updated by each opening, so this stays free while the stack lasts.
  const againLabel = freeHere ? 'Open another · Free' : `Open another · ${formatCredits(price)} CR`;
  const priceLabel = freeHere ? `Free · ${me!.freeCase.count} left` : `${formatCredits(price)} CR`;
  const item = revealed ? result.item : null;
  const value = item ? `${formatCredits(item.recycleValue)} CR` : '';
  const askRecycle = () => {
    if (!item) return;
    if (item.recycleConfirm) setConfirming(true);
    else recycle.mutate({ itemIds: [item.id], confirm: false });
  };
  const confirmRecycle = () => item && recycle.mutate({ itemIds: [item.id], confirm: true });
  // Selling needs an account (guests only open cases).
  const canSell = Boolean(item && me && !me.isGuest);
  const sellLink = item ? `/sell?items=${item.id}` : '/sell';
  // Behind the gold full screen the page would show through its transparent centre.
  const behindGold = gold ? ({ visibility: 'hidden' } as const) : undefined;

  return (
    <Page gap={mobile ? 20 : 28} top={32} back={{ to: '/cases', label: 'Cases' }} mobilePadding="8px 20px 32px">
      {mobile ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, ...behindGold }}>
          <h1 style={{ fontSize: 28, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>{detail?.crate.name ?? ' '}</h1>
          <span className="mono" style={{ fontSize: 14, color: 'var(--text-2)' }}>
            {priceLabel}
          </span>
        </div>
      ) : (
        <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, ...behindGold }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Link to="/cases" className="mono" style={{ fontSize: 12, color: 'var(--text-2)', textDecoration: 'none' }}>
              ← Cases
            </Link>
            <h1 style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.02em' }}>{detail?.crate.name ?? ' '}</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <HudLabel>Price</HudLabel>
            <span className="mono" style={{ fontSize: 20, fontWeight: 500 }}>
              {priceLabel}
            </span>
          </div>
        </header>
      )}

      <section aria-label="Case opening" className={`${s.stage} ${mobile ? s.stageMobile : ''}`} style={behindGold}>
        <StageGlow item={result?.item ?? null} on={revealed && !gold && !leaving} mobile={mobile} />
        <SoundToggle />
        {(!revealed || gold) && (
          <div className={`${s.rollArea} ${landing ? s.rollLeaving : ''}`}>
            <Roulette
              cards={strip}
              resultIndex={result?.resultIndex ?? 40}
              rollKey={phase === 'spinning' ? (result?.openingId ?? null) : null}
              mobile={mobile}
              onDone={onRollDone}
              onTick={sound.tick}
              onLand={onLand}
            />
            <div style={mobile ? { width: '100%', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 } : { display: 'contents' }}>
              <Button size={52} block={mobile} onClick={start} disabled={busy || !detail}>
                {openLabel}
              </Button>
              <span role="status" aria-live="polite" className={s.rollStatus} style={{ opacity: noticeOn ? 1 : 0 }}>
                {notice?.text ?? ''}
              </span>
            </div>
          </div>
        )}
        {revealed && !gold && (
          <RevealPanel
            item={result.item}
            mobile={mobile}
            closing={leaving}
            actions={
              confirming ? (
                <ConfirmInline
                  onCancel={cancelConfirm}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: mobile ? 12 : 14, padding: mobile ? 16 : 18, border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-card)', background: 'var(--page)' }}
                  message={
                    mobile ? (
                      <p style={{ fontSize: 14, lineHeight: 1.5 }}>
                        Recycle <strong>{fullName(result.item.skin)}</strong> for <span className="mono">{value}</span>? It is destroyed for good.
                      </p>
                    ) : (
                      <p style={{ fontSize: 15, lineHeight: 1.5 }}>
                        Recycle <strong>{fullName(result.item.skin)}</strong>? It is destroyed for good and you get <span className="mono">{value}</span>.
                      </p>
                    )
                  }
                >
                  <div style={mobile ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 } : { display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    <Button variant="secondary" size={mobile ? 48 : 44} onClick={cancelConfirm}>
                      Cancel
                    </Button>
                    <Button size={mobile ? 48 : 44} bevel="none" onClick={confirmRecycle} disabled={recycle.isPending}>
                      {mobile ? 'Recycle' : `Recycle for ${value}`}
                    </Button>
                  </div>
                </ConfirmInline>
              ) : (
                <>
                  <Button size={mobile ? 52 : 48} block={mobile} onClick={keep} style={mobile ? undefined : { paddingInline: 30 }}>
                    Keep
                  </Button>
                  {mobile ? (
                    <div style={{ display: 'grid', gridTemplateColumns: canSell ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 10 }}>
                      <Button variant="secondary" size={48} block onClick={askRecycle} disabled={recycle.isPending} style={{ fontSize: 14 }}>
                        Recycle +{formatCredits(result.item.recycleValue)}
                      </Button>
                      {canSell && (
                        <Button variant="secondary" size={48} block to={sellLink} style={{ fontSize: 14 }}>
                          List on market
                        </Button>
                      )}
                    </div>
                  ) : (
                    <>
                      <Button variant="secondary" size={48} onClick={askRecycle} disabled={recycle.isPending} style={{ paddingInline: 20 }}>
                        Recycle <ButtonNote>+{value}</ButtonNote>
                      </Button>
                      {canSell && (
                        <Button variant="secondary" size={48} to={sellLink} style={{ paddingInline: 20, fontSize: 15 }}>
                          List on market
                        </Button>
                      )}
                    </>
                  )}
                </>
              )
            }
            footer={
              confirming ? null : (
                <Button variant="tertiary" size={44} onClick={start} style={{ alignSelf: mobile ? 'center' : 'flex-start' }}>
                  {againLabel}
                </Button>
              )
            }
          />
        )}
      </section>

      {detail && (
        <section aria-labelledby="inside-title" style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 20 : 28, paddingTop: mobile ? 8 : 12, ...behindGold }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
            <h2 id="inside-title" style={{ fontSize: mobile ? 17 : 20, fontWeight: 600 }}>
              What's inside
            </h2>
            <HudLabel style={mobile ? { fontSize: 10 } : undefined}>
              {mobile ? `${detail.crate.skinCount} + ★` : `${detail.crate.skinCount} skins + ★ rare special`}
            </HudLabel>
          </div>
          <WhatsInside detail={detail} mobile={mobile} match={match} />
        </section>
      )}

      {gold && (
        <GoldReveal
          item={result.item}
          mobile={mobile}
          closing={leaving}
          onKeep={confirming ? cancelConfirm : keep}
          actions={
            confirming ? (
              <ConfirmInline
                onCancel={cancelConfirm}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '18px 22px', border: '1px solid var(--disabled-bg)', borderRadius: 'var(--radius-card)', background: 'var(--page)' }}
                message={
                  <p style={{ fontSize: 15, textAlign: 'center' }}>
                    Recycle <strong>{fullName(result.item.skin)}</strong> for <span className="mono">{value}</span>? It is destroyed for good.
                  </p>
                }
              >
                <div style={{ display: 'flex', gap: 10 }}>
                  <Button variant="secondary" size={44} onClick={cancelConfirm} style={{ borderColor: 'var(--disabled-bg)' }}>
                    Cancel
                  </Button>
                  <Button size={44} bevel="none" onClick={confirmRecycle} disabled={recycle.isPending}>
                    Recycle
                  </Button>
                </div>
              </ConfirmInline>
            ) : (
              <>
                <Button size={52} block={mobile} onClick={keep}>
                  Keep
                </Button>
                {canSell && (
                  <Button variant="secondary" size={mobile ? 48 : 52} block={mobile} to={sellLink} style={{ borderColor: 'var(--disabled-bg)', paddingInline: 22, fontSize: 15 }}>
                    List on market
                  </Button>
                )}
                {/* The mobile mockup has no Recycle on the gold screen. */}
                {!mobile && (
                  <Button variant="secondary" size={52} onClick={askRecycle} disabled={recycle.isPending} style={{ borderColor: 'var(--disabled-bg)', paddingInline: 20 }}>
                    Recycle <ButtonNote>+{value}</ButtonNote>
                  </Button>
                )}
              </>
            )
          }
        />
      )}
    </Page>
  );
}
