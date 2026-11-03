import { Hono } from 'hono';
import { z } from 'zod';
import { runJob } from '../admin/jobs.js';
import { fail, requireAccount, requireCron, requireUser, type AppEnv } from '../http.js';
import {
  auctionDetail,
  bidSchema,
  buyNow,
  cancelListing,
  createListing,
  createListingSchema,
  listMarket,
  marketQuerySchema,
  placeBid,
  quoteListing,
  quoteListingSchema,
  sellInfo,
  settleDue,
} from '../services/market.js';
import { parseJson } from '../validate.js';

export const marketRoutes = new Hono<AppEnv>();

const uuidOr404 = (raw: string | undefined, what: string) => {
  const parsed = z.uuid().safeParse(raw);
  return parsed.success ? parsed.data : fail(404, 'not_found', `Unknown ${what}.`);
};
const body = async (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => null);

/** Browse is open to guests (read only); listing and bidding need an account. */
marketRoutes.get('/market', async (c) => c.json(await listMarket(requireUser(c), parseJson(marketQuerySchema, c.req.query()))));

marketRoutes.get('/market/auctions/:id', async (c) => {
  const id = uuidOr404(c.req.param('id'), 'auction');
  await settleDue();
  const detail = await auctionDetail(requireUser(c), id);
  return detail ? c.json(detail) : fail(404, 'not_found', 'Unknown auction.');
});

marketRoutes.post('/market/auctions/:id/bid', async (c) => {
  const me = requireAccount(c);
  const { amount } = parseJson(bidSchema, await body(c));
  return c.json(await placeBid(me, uuidOr404(c.req.param('id'), 'auction'), amount));
});

marketRoutes.post('/market/auctions/:id/buy', async (c) => c.json(await buyNow(requireAccount(c), uuidOr404(c.req.param('id'), 'auction'))));

marketRoutes.post('/market/auctions/:id/cancel', async (c) => c.json(await cancelListing(requireAccount(c), uuidOr404(c.req.param('id'), 'auction'))));

marketRoutes.get('/market/sell', async (c) => c.json(await sellInfo(requireAccount(c), uuidOr404(c.req.query('item'), 'item'))));

marketRoutes.post('/market/quote', async (c) => c.json(await quoteListing(requireAccount(c), parseJson(quoteListingSchema, await body(c)))));

marketRoutes.post('/market/listings', async (c) => c.json(await createListing(requireAccount(c), parseJson(createListingSchema, await body(c))), 201));

/** Vercel cron (daily on Hobby) or an external per-minute trigger: settle every auction whose time is up. */
marketRoutes.get('/cron/settle-auctions', async (c) => {
  requireCron(c);
  return c.json({ settled: (await runJob('settle_auctions', 'cron')).count });
});
