import type { ActivityAuthResult, Me } from '../../../shared/api';
import { api, setBearer } from '../lib/api';

/**
 * Inside the Discord activity: no guest mode. Discord asks for consent once (scope identify),
 * the server exchanges the code and returns a session used as a Bearer token.
 * URL mappings to declare in the Developer Portal (Activities → URL Mappings):
 *   /            → the Vercel production domain
 *   /steamcdn    → community.akamai.steamstatic.com   (skin and case images)
 *   /discordcdn  → cdn.discordapp.com                 (avatars)
 */
export async function bootActivity(): Promise<Me> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
  if (!clientId) throw new Error('VITE_DISCORD_CLIENT_ID is missing.');
  const { DiscordSDK, patchUrlMappings } = await import('@discord/embedded-app-sdk');

  patchUrlMappings(
    [
      { prefix: '/steamcdn', target: 'community.akamai.steamstatic.com' },
      { prefix: '/discordcdn', target: 'cdn.discordapp.com' },
    ],
    { patchSrcAttributes: true },
  );

  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });
  const result = await api<ActivityAuthResult>('/auth/activity', { method: 'POST', json: { code } });
  setBearer(result.sessionToken);
  await sdk.commands.authenticate({ access_token: result.accessToken });
  return result.me;
}
