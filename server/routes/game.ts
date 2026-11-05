import { currentAnnouncement } from '../admin/moderation.js';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Config } from '../../shared/api.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { econ, RECYCLE_MAX_ITEMS } from '../game/economy.js';
import { discordEnabled, env } from '../env.js';
import { banFailure, fail, requireCron, requireUser, type AppEnv } from '../http.js';
import { runJob } from '../admin/jobs.js';
import { deleteOwnAccount, deleteOwnSchema } from '../admin/playerActions.js';
import { clearSessionCookie } from '../auth/sessions.js';
import { toMe } from '../services/accounts.js';
import { crateDetail, listCrates, sharedOdds } from '../services/crates.js';
import { guestSummary } from '../services/guestSummary.js';
import { inventoryPage, inventoryQuerySchema } from '../services/inventory.js';
import { openCrate } from '../services/openCrate.js';
import { quoteRecycle, recycleIdsSchema, recycleItems } from '../services/recycle.js';
import { settleDue } from '../services/market.js';
import { expireDue } from '../services/trades.js';
import { albumDetail, listAlbums } from '../services/albums.js';
import { itemDetail } from '../services/itemDetail.js';
import { findCases } from '../services/search.js';
import { parseJson } from '../validate.js';

export const gameRoutes = new Hono<AppEnv>();

gameRoutes.get('/health', async (c) => {
  await db().execute(sql`select 1`);
  return c.json({ ok: true });
});

gameRoutes.get('/config', (c) =>
  c.json<Config>({
    odds: sharedOdds(),
    cratePrice: econ().casePrice,
    startingBalance: econ().startingBalance,
    discordEnabled: discordEnabled(),
    antiSnipeMs: econ().antiSnipeMinutes * 60_000,
    recycleMaxItems: RECYCLE_MAX_ITEMS,
    freeCaseMinutes: econ().freeCaseMinutes,
    freeCaseMax: econ().freeCaseMax,
    marketFeePct: econ().marketFeeBp / 100,
    bidStepPct: econ().bidStepBp / 100,
    antiSnipeMinutes: econ().antiSnipeMinutes,
    tradeExpiryDays: econ().tradeExpiryDays,
    tradeupSize: econ().tradeupSize,
  }),
);

/** The staff announcement players see now (null when none). */
gameRoutes.get('/announcements/current', async (c) => c.json(await currentAnnouncement()));

gameRoutes.get('/me', async (c) => {
  const revoked = c.get('revokedBan');
  if (!c.get('user') && revoked) throw banFailure(revoked);
  const user = requireUser(c);
  // Offers and auctions whose time is up are settled on read (the Hobby cron only runs once a day).
  const changed = (user.isGuest ? 0 : await expireDue([user.id])) + (await settleDue());
  const fresh = changed ? ((await db().select().from(users).where(eq(users.id, user.id)))[0] ?? user) : user;
  return c.json(await toMe(fresh));
});

/** After a staff rename: the player picks a new name (same rules as Discord usernames). */
const nameBody = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.]{2,32}$/, 'Use 2 to 32 letters, digits, dots or underscores.'),
});

gameRoutes.post('/me/username', async (c) => {
  const user = requireUser(c);
  if (!user.nameResetAt) fail(409, 'conflict', 'Your name can’t be changed here.');
  const { username } = parseJson(nameBody, await c.req.json().catch(() => null));
  const [taken] = await db().select({ id: users.id }).from(users).where(eq(users.username, username));
  if (taken && taken.id !== user.id) fail(409, 'conflict', `“${username}” is taken. Try another name.`);
  const [fresh] = await db().update(users).set({ username, nameResetAt: null }).where(eq(users.id, user.id)).returning();
  return c.json(await toMe(fresh!));
});

/** "Delete my account": anonymised like a staff deletion, the browser goes back to a fresh guest. */
gameRoutes.post('/me/delete', async (c) => {
  const user = requireUser(c);
  await deleteOwnAccount(user.id, parseJson(deleteOwnSchema, await c.req.json().catch(() => null)));
  clearSessionCookie(c);
  return c.body(null, 204);
});

gameRoutes.get('/me/summary', async (c) => c.json(await guestSummary(db(), requireUser(c).id)));

gameRoutes.get('/crates', async (c) => c.json(await listCrates(c.get('user'))));

// Before `/crates/:id`, which would take "find" for a case id.
const findQuery = z.object({ q: z.string().max(80).default(''), crate: z.string().max(80).optional() });
gameRoutes.get('/crates/find', async (c) => {
  const { q, crate } = parseJson(findQuery, c.req.query());
  return c.json(await findCases(q, crate));
});

gameRoutes.get('/crates/:id', async (c) => {
  const detail = await crateDetail(c.req.param('id'), c.get('user'));
  return detail ? c.json(detail) : fail(404, 'not_found', 'Unknown case.');
});

const openBody = z.object({ free: z.boolean().default(false) });
const requestId = z.uuid();

gameRoutes.post('/crates/:id/open', async (c) => {
  const user = requireUser(c);
  const key = requestId.safeParse(c.req.header('idempotency-key'));
  if (!key.success) fail(400, 'bad_request', 'Idempotency-Key must be a UUID.');
  const { free } = parseJson(openBody, await c.req.json().catch(() => ({})));
  return c.json(await openCrate({ userId: user.id, crateId: c.req.param('id'), free, requestId: key.data! }));
});

gameRoutes.get('/inventory', async (c) => {
  const user = requireUser(c);
  if (!user.isGuest) await expireDue([user.id]);
  await settleDue();
  const query = parseJson(inventoryQuerySchema, c.req.query());
  return c.json(await inventoryPage(user.id, query));
});

const itemId = z.uuid();

/** Visible to its owner, the owner's friends, and anyone when it is showcased. */
gameRoutes.get('/items/:id', async (c) => {
  const id = itemId.safeParse(c.req.param('id'));
  if (id.success) await settleDue();
  const detail = id.success ? await itemDetail(c.get('user'), id.data) : null;
  return detail ? c.json(detail) : fail(404, 'not_found', 'This item does not exist or you cannot see it.');
});

gameRoutes.get('/albums', async (c) => c.json(await listAlbums(requireUser(c).id)));

gameRoutes.get('/albums/:id', async (c) => {
  const detail = await albumDetail(requireUser(c).id, c.req.param('id'));
  return detail ? c.json(detail) : fail(404, 'not_found', 'Unknown album.');
});

gameRoutes.post('/items/recycle/quote', async (c) => {
  const user = requireUser(c);
  const { itemIds } = parseJson(recycleIdsSchema, await c.req.json().catch(() => null));
  return c.json(await quoteRecycle(user.id, itemIds));
});

gameRoutes.post('/items/recycle', async (c) => {
  const user = requireUser(c);
  const { itemIds, confirm } = parseJson(recycleIdsSchema, await c.req.json().catch(() => null));
  return c.json(await recycleItems(user.id, itemIds, confirm));
});

/** Vercel cron (daily): delete guests nobody has used for 30 days. Their items never left them. */
gameRoutes.get('/cron/purge-guests', async (c) => {
  requireCron(c);
  return c.json({ deleted: (await runJob('purge_guests', 'cron')).count });
});

/** Vercel cron (daily): ledger invariants (also "Run now" in the admin panel). */
gameRoutes.get('/cron/check-ledger', async (c) => {
  requireCron(c);
  const run = await runJob('check_ledger', 'cron');
  return c.json({ ok: run.ok, result: run.result });
});
