import { Hono } from 'hono';
import { z } from 'zod';
import { discordEnabled } from '../env.js';
import { activitySignIn, handleCallback, pollFlow, startFlow } from '../auth/flows.js';
import { sessionMeta } from '../auth/client.js';
import { clearSessionCookie, createSession, revokeSession, setSessionCookie } from '../auth/sessions.js';
import { db } from '../db/client.js';
import { fail, type AppEnv } from '../http.js';
import { clientIpHash, createGuest, toMe } from '../services/accounts.js';
import { parseJson } from '../validate.js';

export const authRoutes = new Hono<AppEnv>();

const requireDiscord = () => {
  if (!discordEnabled()) fail(503, 'discord_disabled', 'Discord sign-in isn’t set up on this deployment.');
};

/** First visit on the web: a real guest account, so every draw stays server-side. */
authRoutes.post('/auth/guest', async (c) => {
  const current = c.get('user');
  if (current) return c.json(await toMe(current));
  const { user, token } = await db().transaction(async (tx) => {
    const guest = await createGuest(tx, clientIpHash(c));
    const session = await createSession(tx, guest.id, 'web', sessionMeta(c));
    return { user: guest, token: session.token };
  });
  setSessionCookie(c, token);
  return c.json(await toMe(user), 201);
});

authRoutes.post('/auth/logout', async (c) => {
  const sessionId = c.get('sessionId');
  if (sessionId) await revokeSession(db(), sessionId);
  clearSessionCookie(c);
  return c.body(null, 204);
});

const flowBody = z.object({ prompt: z.enum(['none', 'consent']).default('none') });

authRoutes.post('/auth/discord/flows', async (c) => {
  requireDiscord();
  const { prompt } = parseJson(flowBody, await c.req.json().catch(() => ({})));
  return c.json(await startFlow(c.get('user'), prompt), 201);
});

/** Discord redirects here; the result is stored on the flow, then the popup shows a closing page. */
authRoutes.get('/auth/discord/callback', async (c) => {
  const flowId = await handleCallback({
    state: c.req.query('state'),
    code: c.req.query('code'),
    error: c.req.query('error'),
  });
  return c.redirect(`/auth/done${flowId ? `?flow=${encodeURIComponent(flowId)}` : ''}`);
});

const pollSecret = (header: string | undefined) => header ?? fail(400, 'bad_request', 'Missing X-Poll-Secret.');

authRoutes.get('/auth/discord/flows/:id', async (c) => {
  const result = await pollFlow(c.req.param('id'), pollSecret(c.req.header('x-poll-secret')), c.get('sessionId'), sessionMeta(c));
  if (result.sessionToken) setSessionCookie(c, result.sessionToken);
  return c.json(result.state);
});

const activityBody = z.object({ code: z.string().min(1).max(200) });

authRoutes.post('/auth/activity', async (c) => {
  requireDiscord();
  const { code } = parseJson(activityBody, await c.req.json().catch(() => null));
  return c.json(await activitySignIn(code, sessionMeta(c)));
});
