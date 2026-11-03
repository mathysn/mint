// Production server (self-hosted): the API, the built game from dist/, and the job scheduler, in
// one Node process. Local development uses server/dev.ts + Vite instead; Vercel uses api/index.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { app as api } from './app.js';
import { closeDb } from './db/client.js';
import { env } from './env.js';
import { baseUrl } from './origins.js';
import { startScheduler } from './scheduler.js';

// Refuse to start half-configured: without these, sessions, guest limits or crons are unsafe.
const missing: string[] = (['APP_BASE_URL', 'CRON_SECRET'] as const).filter((key) => !env()[key]);
if (env().IP_HASH_SALT === 'dev-salt') missing.push('IP_HASH_SALT');
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}. See .env.production.example.`);
  process.exit(1);
}

const DIST = process.env.STATIC_DIR ?? 'dist';
const port = Number(process.env.PORT ?? 3000);

// Link previews need absolute URLs; index.html carries relative ones (it is built once for any domain).
const base = baseUrl();
const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8')
  .replace('property="og:url" content="/"', `property="og:url" content="${base}/"`)
  .replace('property="og:image" content="/og.png"', `property="og:image" content="${base}/og.png"`);

const server = new Hono();

// Same headers as vercel.json, whichever proxy sits in front. Discord must be able to frame the activity.
server.use(async (c, next) => {
  await next();
  c.header('Content-Security-Policy', "frame-ancestors 'self' https://discord.com https://*.discord.com https://*.discordsays.com");
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (base.startsWith('https://')) c.header('Strict-Transport-Security', 'max-age=31536000');
});

server.all('/api', (c) => api.fetch(c.req.raw));
server.all('/api/*', (c) => api.fetch(c.req.raw));

// Hashed build files never change: cache them for a year. A missing one is a 404 (an old tab
// after a deploy), never index.html, so the client knows to reload.
server.use(
  '/assets/*',
  serveStatic({ root: DIST, onFound: (_path, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }),
);
server.get('/assets/*', (c) => c.text('Not found', 404));

// Other public files (og.png, favicon.svg): short cache.
server.use('*', serveStatic({ root: DIST, onFound: (_path, c) => c.header('Cache-Control', 'public, max-age=3600') }));

// Every other path is a screen of the single-page app.
server.get('*', (c) => {
  c.header('Cache-Control', 'no-cache');
  return c.html(indexHtml);
});

const stopScheduler = startScheduler();
const http = serve({ fetch: server.fetch, port, hostname: '0.0.0.0' }, () => console.log(`Mint on :${port} (${base})`));

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`${signal}: shutting down`);
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  http.close();
  await stopScheduler();
  await closeDb();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
