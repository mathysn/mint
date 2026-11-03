import { randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { AuthFlowStart, AuthFlowState } from '../../shared/api.js';
import { db } from '../db/client.js';
import { authFlows, users } from '../db/schema.js';
import { fail, type UserRow } from '../http.js';
import { baseUrl } from '../origins.js';
import { createDiscordAccount, deleteGuest, refreshDiscordProfile, toMe, type DiscordProfile } from '../services/accounts.js';
import { authorizeUrl, exchangeCode, fetchProfile } from './discord.js';
import type { SessionMeta } from './client.js';
import { createSession, hashToken, revokeSession } from './sessions.js';

const FLOW_MS = 10 * 60 * 1000;

export const redirectUri = () => `${baseUrl()}/api/auth/discord/callback`;

/**
 * Web sign-in, step 1. The tab that starts the flow keeps the poll secret; only that tab
 * receives the session, even if Discord finishes in another window or browser.
 */
export async function startFlow(guest: UserRow | null, prompt: 'none' | 'consent'): Promise<AuthFlowStart> {
  const state = randomBytes(24).toString('base64url');
  const pollSecret = randomBytes(24).toString('base64url');
  const [flow] = await db()
    .insert(authFlows)
    .values({
      state,
      pollSecretHash: hashToken(pollSecret),
      guestUserId: guest?.isGuest ? guest.id : null,
      expiresAt: new Date(Date.now() + FLOW_MS),
    })
    .returning({ id: authFlows.id });
  return { flowId: flow!.id, pollSecret, authorizeUrl: authorizeUrl({ state, redirectUri: redirectUri(), prompt }) };
}

/**
 * Web sign-in, step 2 (Discord redirect): known Discord account → sign in, unknown → new account.
 * Guest progress never moves to an account (anti-farm): the guest is deleted once the session is handed over.
 */
export async function handleCallback(params: { state?: string; code?: string; error?: string }): Promise<string | null> {
  if (!params.state) return null;
  const [flow] = await db()
    .select()
    .from(authFlows)
    .where(and(eq(authFlows.state, params.state), eq(authFlows.status, 'pending'), gt(authFlows.expiresAt, sql`now()`)));
  if (!flow) return null;

  const setStatus = (values: Partial<typeof authFlows.$inferInsert>) =>
    db().update(authFlows).set(values).where(and(eq(authFlows.id, flow.id), eq(authFlows.status, 'pending')));

  if (params.error || !params.code) {
    await setStatus({ status: 'error', error: params.error ?? 'missing_code' });
    return flow.id;
  }

  let profile: DiscordProfile;
  try {
    profile = await fetchProfile(await exchangeCode(params.code, redirectUri()));
  } catch {
    await setStatus({ status: 'error', error: 'exchange_failed' });
    return flow.id;
  }

  const [existing] = await db().select().from(users).where(eq(users.discordId, profile.id));
  if (existing) {
    await refreshDiscordProfile(db(), existing, profile);
    await setStatus({ status: 'success', discordId: profile.id, discordProfile: profile, resultUserId: existing.id });
    return flow.id;
  }

  try {
    const user = await db().transaction((tx) => createDiscordAccount(tx, profile));
    await setStatus({ status: 'success', discordId: profile.id, discordProfile: profile, resultUserId: user.id });
  } catch {
    // Same Discord account finishing twice at once: the unique discord_id makes one of them fail.
    await setStatus({ status: 'error', error: 'account_race' });
  }
  return flow.id;
}

async function loadFlow(flowId: string, pollSecret: string) {
  const [flow] = await db().select().from(authFlows).where(eq(authFlows.id, flowId));
  const expected = flow?.pollSecretHash;
  const given = hashToken(pollSecret);
  if (!flow || !expected || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return fail(404, 'not_found', 'Unknown sign-in attempt.');
  }
  return flow;
}

/**
 * Web sign-in, step 3 (polled by the tab that started it). On success the flow is consumed
 * and a session is returned for the caller to put in its cookie.
 */
export async function pollFlow(
  flowId: string,
  pollSecret: string,
  currentSessionId: string | null,
  meta?: SessionMeta,
): Promise<{ state: AuthFlowState; sessionToken?: string }> {
  const flow = await loadFlow(flowId, pollSecret);
  if (flow.status === 'pending') {
    return { state: { status: flow.expiresAt < new Date() ? 'error' : 'pending', error: flow.expiresAt < new Date() ? 'expired' : undefined } };
  }
  if (flow.status === 'error' || flow.status === 'consumed') {
    return { state: { status: 'error', error: flow.error ?? 'already_used' } };
  }
  return consume(flow.id, flow.resultUserId!, flow.guestUserId, currentSessionId, meta);
}

async function consume(flowId: string, userId: string, guestId: string | null, currentSessionId: string | null, meta?: SessionMeta) {
  return db().transaction(async (tx) => {
    const [taken] = await tx
      .update(authFlows)
      .set({ status: 'consumed' })
      .where(and(eq(authFlows.id, flowId), eq(authFlows.status, 'success')))
      .returning({ id: authFlows.id });
    if (!taken) fail(409, 'bad_request', 'This sign-in was already used.');
    if (currentSessionId) await revokeSession(tx, currentSessionId);
    // The guest that started the flow is left behind for good (its sessions go with it).
    if (guestId && guestId !== userId) await deleteGuest(tx, guestId);
    const session = await createSession(tx, userId, 'web', meta);
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    return { state: { status: 'success' as const, me: await toMe(user!) }, sessionToken: session.token };
  });
}

/** Discord activity: the SDK hands us a code; no guest mode inside Discord. */
export async function activitySignIn(code: string, meta?: SessionMeta) {
  const accessToken = await exchangeCode(code);
  const profile = await fetchProfile(accessToken);
  return db().transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.discordId, profile.id)).for('update');
    const user = existing ? await refreshDiscordProfile(tx, existing, profile) : await createDiscordAccount(tx, profile);
    const session = await createSession(tx, user.id, 'activity', meta);
    return { sessionToken: session.token, accessToken, me: await toMe(user) };
  });
}
