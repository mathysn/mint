import { Hono } from 'hono';
import { z } from 'zod';
import { runJob } from '../admin/jobs.js';
import { fail, requireAccount, requireCron, type AppEnv } from '../http.js';
import { acceptTrade, createTrade, createTradeSchema, endTrade, expireDue, listTrades, quoteTrade, quoteTradeSchema, tradeOptions } from '../services/trades.js';
import { parseJson } from '../validate.js';

export const tradeRoutes = new Hono<AppEnv>();

const box = z.enum(['received', 'sent', 'history']).default('received');
const tradeId = (raw: string) => {
  const parsed = z.uuid().safeParse(raw);
  return parsed.success ? parsed.data : fail(404, 'not_found', 'Unknown offer.');
};

tradeRoutes.get('/trades', async (c) => {
  const me = requireAccount(c);
  return c.json(await listTrades(me, parseJson(box, c.req.query('box'))));
});

/** Both inventories for "New offer" with a friend. */
tradeRoutes.get('/trades/options', async (c) => {
  const me = requireAccount(c);
  return c.json(await tradeOptions(me, c.req.query('with') ?? ''));
});

tradeRoutes.post('/trades/quote', async (c) => {
  const me = requireAccount(c);
  return c.json(await quoteTrade(me, parseJson(quoteTradeSchema, await c.req.json().catch(() => null))));
});

tradeRoutes.post('/trades', async (c) => {
  const me = requireAccount(c);
  const id = await createTrade(me, parseJson(createTradeSchema, await c.req.json().catch(() => null)));
  return c.json({ id }, 201);
});

tradeRoutes.post('/trades/:id/accept', async (c) => c.json(await acceptTrade(requireAccount(c), tradeId(c.req.param('id')))));

tradeRoutes.post('/trades/:id/decline', async (c) => c.json(await endTrade(requireAccount(c), tradeId(c.req.param('id')), 'decline')));

tradeRoutes.post('/trades/:id/cancel', async (c) => c.json(await endTrade(requireAccount(c), tradeId(c.req.param('id')), 'cancel')));

/** Vercel cron (daily on Hobby): expire every offer whose time is up. Reads also expire them. */
tradeRoutes.get('/cron/expire-trades', async (c) => {
  requireCron(c);
  return c.json({ expired: (await runJob('expire_trades', 'cron')).count });
});
