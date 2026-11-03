import { z } from 'zod';
import { env } from '../env.js';
import { fail } from '../http.js';
import type { DiscordProfile } from '../services/accounts.js';

const API = 'https://discord.com/api/v10';

const tokenSchema = z.object({ access_token: z.string(), token_type: z.string() });
const profileSchema = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullable().default(null),
  avatar: z.string().nullable().default(null),
});

export function authorizeUrl(params: { state: string; redirectUri: string; prompt: 'none' | 'consent' }): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', env().DISCORD_CLIENT_ID ?? '');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', params.state);
  url.searchParams.set('prompt', params.prompt);
  return url.toString();
}

/** Code → access token. The activity flow has no redirect_uri. */
export async function exchangeCode(code: string, redirectUri?: string): Promise<string> {
  const e = env();
  const body = new URLSearchParams({
    client_id: e.DISCORD_CLIENT_ID ?? '',
    client_secret: e.DISCORD_CLIENT_SECRET ?? '',
    grant_type: 'authorization_code',
    code,
  });
  if (redirectUri) body.set('redirect_uri', redirectUri);
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) fail(401, 'unauthorized', `Discord refused the code (${res.status}).`);
  return tokenSchema.parse(await res.json()).access_token;
}

/** Scope `identify` only: id, username, display name, avatar. */
export async function fetchProfile(accessToken: string): Promise<DiscordProfile> {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) fail(401, 'unauthorized', `Discord profile unavailable (${res.status}).`);
  return profileSchema.parse(await res.json());
}
