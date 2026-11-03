import { env } from './env.js';

const strip = (url: string) => url.replace(/\/+$/, '');

/** Public base URL: APP_BASE_URL, else the branch or deployment URL Vercel provides. */
export function baseUrl(): string {
  const e = env();
  if (e.APP_BASE_URL) return strip(e.APP_BASE_URL);
  const host = e.VERCEL_BRANCH_URL ?? e.VERCEL_URL;
  return host ? `https://${host}` : 'http://localhost:5173';
}

/** Origins allowed to send state-changing requests (checked against the Origin header). */
export function allowedOrigins(): Set<string> {
  const e = env();
  const origins = new Set<string>([new URL(baseUrl()).origin]);
  for (const host of [e.VERCEL_URL, e.VERCEL_BRANCH_URL, e.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host) origins.add(`https://${host}`);
  }
  // The Discord activity runs on {clientId}.discordsays.com, proxied to this app.
  if (e.DISCORD_CLIENT_ID) origins.add(`https://${e.DISCORD_CLIENT_ID}.discordsays.com`);
  return origins;
}
