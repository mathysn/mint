import { Hono } from 'hono';
import { z } from 'zod';
import { fail, requireUser, type AppEnv } from '../http.js';
import { latestDrop, leaderboard } from '../services/leaderboard.js';
import { quoteTradeUp, signTradeUp, tradeUpItemsSchema, tradeUpOptions, tradeUpOptionsSchema } from '../services/tradeups.js';
import { parseJson } from '../validate.js';

/** Trade-up contracts, leaderboard and the global drop banner. */
export const tradeUpRoutes = new Hono<AppEnv>();

// Contracts are solo, like recycling: guests can sign them too.
tradeUpRoutes.get('/tradeup/options', async (c) => {
  const { tier, stattrak } = parseJson(tradeUpOptionsSchema, c.req.query());
  return c.json(await tradeUpOptions(requireUser(c), tier, stattrak === '1'));
});

tradeUpRoutes.post('/tradeup/quote', async (c) => {
  const { itemIds } = parseJson(tradeUpItemsSchema, await c.req.json().catch(() => null));
  return c.json(await quoteTradeUp(requireUser(c), itemIds));
});

tradeUpRoutes.post('/tradeup', async (c) => {
  const user = requireUser(c);
  const key = z.uuid().safeParse(c.req.header('idempotency-key'));
  if (!key.success) fail(400, 'bad_request', 'Idempotency-Key must be a UUID.');
  const { itemIds } = parseJson(tradeUpItemsSchema, await c.req.json().catch(() => null));
  return c.json(await signTradeUp(user, itemIds, key.data!));
});

const boardQuery = z.object({ board: z.enum(['value', 'albums']).default('value'), scope: z.enum(['all', 'friends']).default('all') });

/** Open to guests (they look, they are not ranked). */
tradeUpRoutes.get('/leaderboard', async (c) => {
  const { board, scope } = parseJson(boardQuery, c.req.query());
  return c.json(await leaderboard(requireUser(c), board, scope));
});

tradeUpRoutes.get('/drops/latest', async (c) => {
  requireUser(c);
  return c.json({ drop: await latestDrop() });
});
