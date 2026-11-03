import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { fail, requireAccount, requireUser, type AppEnv, type UserRow } from '../http.js';
import { albumDetail, listAlbums } from '../services/albums.js';
import { inventoryPage, inventoryQuerySchema } from '../services/inventory.js';
import { settleDue } from '../services/market.js';
import { suggestSkins } from '../services/search.js';
import { friendsFeed, profileOf, setShowcase } from '../services/profile.js';
import { acceptRequest, dropRequest, friendsOverview, relationBetween, removeFriend, searchPlayers, sendRequest } from '../services/social.js';
import { parseJson } from '../validate.js';
import { fileReport, reportSchema } from '../admin/moderation.js';

export const socialRoutes = new Hono<AppEnv>();

const userId = z.uuid();
const otherId = (raw: string) => {
  const parsed = userId.safeParse(raw);
  return parsed.success ? parsed.data : fail(404, 'not_found', 'Unknown player.');
};

/** A player's inventory and album details: themselves and their friends only. */
async function collectionOwner(viewer: UserRow, username: string): Promise<string> {
  const [owner] = await db().select({ id: users.id }).from(users).where(and(eq(users.username, username), eq(users.isGuest, false)));
  if (!owner) return fail(404, 'not_found', 'Unknown player.');
  const relation = await relationBetween(viewer.id, owner.id);
  if (relation !== 'self' && relation !== 'friend') fail(403, 'forbidden', 'Only friends can see this collection.');
  return owner.id;
}

socialRoutes.get('/players/search', async (c) => {
  const me = requireAccount(c);
  return c.json(await searchPlayers(me.id, c.req.query('q') ?? ''));
});

socialRoutes.get('/players/:username', async (c) => {
  const profile = await profileOf(c.get('user')?.id ?? null, c.req.param('username'));
  return profile ? c.json(profile) : fail(404, 'not_found', 'Unknown player.');
});

socialRoutes.get('/players/:username/inventory', async (c) => {
  const owner = await collectionOwner(requireUser(c), c.req.param('username'));
  return c.json(await inventoryPage(owner, parseJson(inventoryQuerySchema, c.req.query())));
});

const suggestQuery = z.object({
  q: z.string().max(80).default(''),
  scope: z.enum(['inventory', 'market']).default('inventory'),
  /** Someone else's inventory (friends only, like the inventory itself). */
  player: z.string().trim().min(1).max(64).optional(),
});

/** Search box suggestions: skins of an inventory, or skins listed on the market. */
socialRoutes.get('/skins/suggest', async (c) => {
  const viewer = requireUser(c);
  const { q, scope, player } = parseJson(suggestQuery, c.req.query());
  const owner = scope === 'inventory' && player ? await collectionOwner(viewer, player) : viewer.id;
  return c.json(await suggestSkins(scope, owner, q));
});

socialRoutes.get('/players/:username/albums', async (c) => {
  const owner = await collectionOwner(requireUser(c), c.req.param('username'));
  return c.json(await listAlbums(owner));
});

socialRoutes.get('/players/:username/albums/:id', async (c) => {
  const owner = await collectionOwner(requireUser(c), c.req.param('username'));
  const detail = await albumDetail(owner, c.req.param('id'));
  return detail ? c.json(detail) : fail(404, 'not_found', 'Unknown album.');
});

socialRoutes.get('/friends', async (c) => c.json(await friendsOverview(requireAccount(c).id)));

const requestBody = z.object({ username: z.string().trim().min(1).max(64) });

socialRoutes.post('/friends/requests', async (c) => {
  const me = requireAccount(c);
  const { username } = parseJson(requestBody, await c.req.json().catch(() => null));
  return c.json({ relation: await sendRequest(me, username) });
});

socialRoutes.post('/friends/requests/:userId/accept', async (c) => {
  const me = requireAccount(c);
  return c.json({ relation: await acceptRequest(me.id, otherId(c.req.param('userId'))) });
});

/** Decline (received) or cancel (sent). */
socialRoutes.delete('/friends/requests/:userId', async (c) => {
  const me = requireAccount(c);
  await dropRequest(me.id, otherId(c.req.param('userId')));
  return c.body(null, 204);
});

socialRoutes.delete('/friends/:userId', async (c) => {
  const me = requireAccount(c);
  await removeFriend(me.id, otherId(c.req.param('userId')));
  return c.body(null, 204);
});

const showcaseBody = z.object({ itemIds: z.array(z.uuid()).max(5) });

socialRoutes.put('/me/showcase', async (c) => {
  const me = requireAccount(c);
  const { itemIds } = parseJson(showcaseBody, await c.req.json().catch(() => null));
  return c.json(await setShowcase(me.id, itemIds));
});

/** Report a player to staff (Offensive name, Scam, Other). */
socialRoutes.post('/players/:username/report', async (c) => {
  const me = requireAccount(c);
  return c.json(await fileReport(me, c.req.param('username'), parseJson(reportSchema, await c.req.json().catch(() => null))));
});

/** Guests have no friends: their feed is empty. */
socialRoutes.get('/feed', async (c) => {
  const me = requireUser(c);
  if (me.isGuest) return c.json([]);
  await settleDue();
  return c.json(await friendsFeed(me.id));
});
