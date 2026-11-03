import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { findSession, readToken } from './auth/sessions.js';
import { ApiFailure, banFailure, banInfo, type AppEnv } from './http.js';
import { allowedOrigins } from './origins.js';
import { authRoutes } from './routes/auth.js';
import { gameRoutes } from './routes/game.js';
import { socialRoutes } from './routes/social.js';
import { marketRoutes } from './routes/market.js';
import { tradeRoutes } from './routes/trades.js';
import { tradeUpRoutes } from './routes/tradeups.js';
import { adminRoutes } from './routes/admin.js';
import { refreshEconomy } from './services/economySettings.js';
import { recordFailure, recordServerError } from './services/errors.js';

export const app = new Hono<AppEnv>().basePath('/api');

app.onError((err, c) => {
  if (err instanceof ApiFailure) {
    recordFailure(err.code);
    return c.json(err.body(), err.status);
  }
  console.error(err);
  recordServerError(`${c.req.method} ${c.req.routePath}`, err instanceof Error ? err.message : String(err));
  return c.json({ error: { code: 'internal', message: 'Something went wrong on our side.' } }, 500);
});

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Unknown endpoint.' } }, 404));

// No request of the game comes near this; a huge body would only cost memory.
app.use(
  bodyLimit({
    maxSize: 256 * 1024,
    onError: (c) => c.json({ error: { code: 'bad_request', message: 'Request too large.' } }, 413),
  }),
);

// State-changing requests must come from the app itself (or its Discord activity).
app.use(async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && !allowedOrigins().has(origin)) {
      return c.json({ error: { code: 'forbidden', message: 'Cross-origin request refused.' } }, 403);
    }
  }
  await next();
});

// The economy in force (staff can change it): reloaded when it changed, at most every 10 s.
app.use(async (_c, next) => {
  await refreshEconomy();
  await next();
});

app.use(async (c, next) => {
  const token = readToken(c);
  const session = token ? await findSession(token) : null;
  const live = session && 'user' in session ? session : null;
  c.set('user', live?.user ?? null);
  c.set('sessionId', live?.sessionId ?? null);
  c.set('revokedBan', session && 'revokedBan' in session ? session.revokedBan : null);
  c.header('Cache-Control', 'no-store');
  await next();
});

// A banned player can still look around (read-only) and sign in or out, nothing else.
app.use(async (c, next) => {
  const user = c.get('user');
  const ban = user ? banInfo(user) : null;
  if (ban && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !c.req.path.startsWith('/api/auth/')) throw banFailure(ban);
  await next();
});

app.route('/', gameRoutes);
app.route('/', authRoutes);
app.route('/', socialRoutes);
app.route('/', tradeRoutes);
app.route('/', marketRoutes);
app.route('/', tradeUpRoutes);
app.route('/', adminRoutes);
