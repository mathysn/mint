import { count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AdminMe, AdminPlayerTab } from '../../shared/api.js';
import { db } from '../db/client.js';
import { flags, reports } from '../db/schema.js';
import { fail, type AppEnv } from '../http.js';
import { avatarUrl } from '../services/accounts.js';
import { parseJson } from '../validate.js';
import { adminCatalog, applySchema, caseOfDaySchema, crateDetail, dryRunSchema, importApply, importDryRun, setActive, setCaseOfDay, setNew, toggleSchema } from '../admin/catalog.js';
import { itemDetail, itemsQuerySchema, listItems, moveItem, moveSchema, previewMove, removeFromShowcase, restoreItem, restoreSchema, unlockItem } from '../admin/items.js';
import { JOB_NAMES, JOBS, lastRuns, runJob, type JobName } from '../admin/jobs.js';
import { reasonSchema, writeAdminLog } from '../admin/log.js';
import { logCsv, logPage, logQuerySchema } from '../admin/logRead.js';
import { overview } from '../admin/overview.js';
import {
  addNote,
  adjustCredits,
  banPlayer,
  banSchema,
  creditsPreviewSchema,
  creditsSchema,
  deleteAccount,
  deleteGuests,
  deleteSchema,
  grantItem,
  grantQuoteSchema,
  grantSchema,
  guestsDeleteSchema,
  noteSchema,
  previewBan,
  previewCredits,
  previewDelete,
  quoteGrant,
  reasonOnly,
  renamePlayer,
  renameSchema,
  resetFreeCase,
  signOutEverywhere,
  unbanPlayer,
} from '../admin/playerActions.js';
import { listPlayers, playerDetail, playersQuerySchema, playerTab } from '../admin/players.js';
import { adminSearch, searchSkins } from '../admin/search.js';
import { requireStaff } from '../admin/staff.js';
import { economyPage, previewEconomy, previewSchema as economyPreviewSchema, saveEconomy, saveSchema as economySaveSchema } from '../admin/economy.js';
import {
  auctionDetail as adminAuctionDetail,
  cancelAuction,
  cancelTrade,
  dismissFlag,
  listAuctions,
  listFlags,
  listTrades as adminListTrades,
  pageSchema,
  settleAuction,
} from '../admin/market.js';
import {
  announcementSchema,
  createAnnouncement,
  dismissReport,
  endAnnouncement,
  freeCaseEveryone,
  giftEveryone,
  giftPreview,
  giftPreviewSchema,
  giftSchema,
  moderationPage,
  setDropHidden,
} from '../admin/moderation.js';
import { errorsPage, jobsPage, ledgerCheckNow, ledgerPage, ledgerQuerySchema } from '../admin/logs.js';
import { utcDateTime } from '../format.js';

/**
 * The staff panel's API. Every route starts with `requireStaff(c, role)`: the server decides,
 * the panel only mirrors it (docs/ADMIN.md §2). Roles: viewer reads; moderator bans, signs out,
 * renames, removes from showcases; admin moves credits and items, the catalog and jobs.
 */
export const adminRoutes = new Hono<AppEnv>();

const body = async <S extends z.ZodType>(c: { req: { json: () => Promise<unknown> } }, schema: S) => parseJson(schema, await c.req.json().catch(() => null));
const query = <S extends z.ZodType>(c: { req: { query: () => Record<string, string> } }, schema: S) => parseJson(schema, c.req.query());
const uuidParam = (id: string) => (z.uuid().safeParse(id).success ? id : fail(404, 'not_found', 'Not found.'));
const intParam = (id: string) => (/^\d{1,15}$/.test(id) ? Number(id) : fail(404, 'not_found', 'Not found.'));

adminRoutes.get('/admin/me', async (c) => {
  const staff = await requireStaff(c, 'viewer');
  const user = c.get('user')!;
  const [[openFlags], [openReports]] = await Promise.all([
    db().select({ n: count() }).from(flags).where(eq(flags.status, 'open')),
    db().select({ n: count() }).from(reports).where(eq(reports.status, 'open')),
  ]);
  const me: AdminMe = {
    name: staff.name,
    role: staff.role,
    avatarUrl: avatarUrl(user),
    badges: { flags: openFlags?.n ?? 0, reports: openReports?.n ?? 0 },
    now: new Date().toISOString(),
  };
  return c.json(me);
});

adminRoutes.get('/admin/search', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await adminSearch(c.req.query('q') ?? ''));
});

adminRoutes.get('/admin/skins', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await searchSkins(c.req.query('q') ?? ''));
});

// ── Players ─────────────────────────────────────────────────────────────────

adminRoutes.get('/admin/players', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await listPlayers(query(c, playersQuerySchema)));
});

adminRoutes.get('/admin/players/:id', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await playerDetail(c.req.param('id')));
});

const TABS = ['inventory', 'openings', 'trades', 'market', 'friends', 'ledger', 'sessions', 'notes'] as const;

adminRoutes.get('/admin/players/:id/tabs/:tab', async (c) => {
  await requireStaff(c, 'viewer');
  const tab = c.req.param('tab') as AdminPlayerTab;
  if (!TABS.includes(tab)) fail(404, 'not_found', 'Unknown tab.');
  return c.json(await playerTab(c.req.param('id'), tab));
});

adminRoutes.post('/admin/players/:id/credits/preview', async (c) => {
  await requireStaff(c, 'admin');
  return c.json(await previewCredits(c.req.param('id'), await body(c, creditsPreviewSchema)));
});

adminRoutes.post('/admin/players/:id/credits', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await adjustCredits(staff, c.req.param('id'), await body(c, creditsSchema)));
});

adminRoutes.post('/admin/players/:id/grant/quote', async (c) => {
  await requireStaff(c, 'admin');
  return c.json(await quoteGrant(c.req.param('id'), await body(c, grantQuoteSchema)));
});

adminRoutes.post('/admin/players/:id/grant', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await grantItem(staff, c.req.param('id'), await body(c, grantSchema)));
});

adminRoutes.post('/admin/players/:id/free-case/reset', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await resetFreeCase(staff, c.req.param('id'), (await body(c, reasonOnly)).reason));
});

adminRoutes.post('/admin/players/:id/sign-out', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await signOutEverywhere(staff, c.req.param('id'), (await body(c, reasonOnly)).reason));
});

adminRoutes.get('/admin/players/:id/ban/preview', async (c) => {
  await requireStaff(c, 'moderator');
  return c.json(await previewBan(c.req.param('id')));
});

adminRoutes.post('/admin/players/:id/ban', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await banPlayer(staff, c.req.param('id'), await body(c, banSchema)));
});

adminRoutes.post('/admin/players/:id/unban', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await unbanPlayer(staff, c.req.param('id'), (await body(c, reasonOnly)).reason));
});

adminRoutes.post('/admin/players/:id/rename', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await renamePlayer(staff, c.req.param('id'), await body(c, renameSchema)));
});

adminRoutes.post('/admin/players/:id/notes', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await addNote(staff, c.req.param('id'), (await body(c, noteSchema)).text));
});

adminRoutes.get('/admin/players/:id/delete/preview', async (c) => {
  await requireStaff(c, 'admin');
  return c.json(await previewDelete(c.req.param('id')));
});

adminRoutes.post('/admin/players/:id/delete', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await deleteAccount(staff, c.req.param('id'), await body(c, deleteSchema)));
});

adminRoutes.post('/admin/guests/delete', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await deleteGuests(staff, await body(c, guestsDeleteSchema)));
});

// ── Items ───────────────────────────────────────────────────────────────────

adminRoutes.get('/admin/items', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await listItems(query(c, itemsQuerySchema)));
});

adminRoutes.get('/admin/items/:id', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await itemDetail(c.req.param('id')));
});

adminRoutes.post('/admin/items/:id/unlock', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await unlockItem(staff, c.req.param('id'), (await body(c, reasonOnly)).reason));
});

adminRoutes.post('/admin/items/:id/restore', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await restoreItem(staff, c.req.param('id'), await body(c, restoreSchema)));
});

adminRoutes.post('/admin/items/:id/move/preview', async (c) => {
  await requireStaff(c, 'admin');
  return c.json(await previewMove(c.req.param('id'), (await body(c, z.object({ to: z.string().max(64) }))).to));
});

adminRoutes.post('/admin/items/:id/move', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await moveItem(staff, c.req.param('id'), await body(c, moveSchema)));
});

adminRoutes.post('/admin/items/:id/showcase-remove', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await removeFromShowcase(staff, c.req.param('id'), (await body(c, reasonOnly)).reason));
});

// ── Overview and jobs ───────────────────────────────────────────────────────

adminRoutes.get('/admin/overview', async (c) => {
  await requireStaff(c, 'viewer');
  const { period } = query(c, z.object({ period: z.enum(['24h', '7d', '30d']).default('7d') }));
  return c.json(await overview(period));
});

adminRoutes.post('/admin/jobs/:job/run', async (c) => {
  const staff = await requireStaff(c, 'admin');
  const job = c.req.param('job') as JobName;
  if (!JOB_NAMES.includes(job)) fail(404, 'not_found', 'Unknown job.');
  const { reason } = await body(c, z.object({ reason: reasonSchema }));
  const previous = (await lastRuns()).get(job);
  const run = await runJob(job, staff.name);
  await writeAdminLog(db(), staff, {
    action: 'job.run',
    target: { type: 'job', id: job, label: JOBS[job].name },
    change: run.result,
    before: { 'last run': previous ? `${utcDateTime(previous.startedAt)} · ${previous.result ?? '—'}` : 'never' },
    after: { 'last run': `${utcDateTime(run.startedAt)} · ${run.result}`, duration: `${(run.durationMs / 1000).toFixed(1)} s` },
    reason,
  });
  return c.json({ toast: `Ran ${JOBS[job].name.toLowerCase()} · logged` });
});

// ── Catalog ─────────────────────────────────────────────────────────────────

adminRoutes.get('/admin/catalog', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await adminCatalog());
});

adminRoutes.get('/admin/catalog/cases/:id', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await crateDetail(c.req.param('id')));
});

adminRoutes.post('/admin/catalog/cases/:id/active', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await setActive(staff, c.req.param('id'), await body(c, toggleSchema)));
});

adminRoutes.post('/admin/catalog/cases/:id/new', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await setNew(staff, c.req.param('id'), await body(c, toggleSchema)));
});

adminRoutes.post('/admin/catalog/case-of-day', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await setCaseOfDay(staff, await body(c, caseOfDaySchema)));
});

/** A dry run changes nothing (it only stores its report), so any staff member may run it. */
adminRoutes.post('/admin/catalog/import/dry-run', async (c) => {
  const staff = await requireStaff(c, 'viewer');
  return c.json(await importDryRun(staff, (await body(c, dryRunSchema)).commit));
});

adminRoutes.post('/admin/catalog/import/apply', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await importApply(staff, await body(c, applySchema)));
});

// ── Admin log ───────────────────────────────────────────────────────────────

adminRoutes.get('/admin/log', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await logPage(query(c, logQuerySchema)));
});

adminRoutes.get('/admin/log.csv', async (c) => {
  await requireStaff(c, 'viewer');
  const csv = await logCsv(query(c, logQuerySchema));
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="mint-admin-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  return c.body(csv);
});

// ── Economy ─────────────────────────────────────────────────────────────────

adminRoutes.get('/admin/economy', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await economyPage());
});

/** Checks what staff typed (errors, diff, simulator): changes nothing, so any role may call it. */
adminRoutes.post('/admin/economy/preview', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await previewEconomy((await body(c, economyPreviewSchema)).edits));
});

adminRoutes.post('/admin/economy', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await saveEconomy(staff, await body(c, economySaveSchema)));
});

// ── Market & trades ─────────────────────────────────────────────────────────

adminRoutes.get('/admin/market/auctions', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await listAuctions(query(c, pageSchema).offset));
});

adminRoutes.get('/admin/market/auctions/:id', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await adminAuctionDetail(uuidParam(c.req.param('id'))));
});

adminRoutes.post('/admin/market/auctions/:id/cancel', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await cancelAuction(staff, uuidParam(c.req.param('id')), (await body(c, reasonOnly)).reason));
});

adminRoutes.post('/admin/market/auctions/:id/settle', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await settleAuction(staff, uuidParam(c.req.param('id')), (await body(c, reasonOnly)).reason));
});

adminRoutes.get('/admin/market/trades', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await adminListTrades(query(c, pageSchema).offset));
});

adminRoutes.post('/admin/market/trades/:id/cancel', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await cancelTrade(staff, uuidParam(c.req.param('id')), (await body(c, reasonOnly)).reason));
});

adminRoutes.get('/admin/flags', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await listFlags());
});

adminRoutes.post('/admin/flags/:id/dismiss', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await dismissFlag(staff, intParam(c.req.param('id')), (await body(c, reasonOnly)).reason));
});

// ── Moderation ──────────────────────────────────────────────────────────────

adminRoutes.get('/admin/moderation', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await moderationPage());
});

adminRoutes.post('/admin/reports/:id/dismiss', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await dismissReport(staff, intParam(c.req.param('id')), (await body(c, reasonOnly)).reason));
});

adminRoutes.post('/admin/drops/:id/hide', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await setDropHidden(staff, intParam(c.req.param('id')), true, (await body(c, reasonOnly)).reason));
});

adminRoutes.post('/admin/drops/:id/show', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await setDropHidden(staff, intParam(c.req.param('id')), false, (await body(c, reasonOnly)).reason));
});

adminRoutes.post('/admin/announcements', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await createAnnouncement(staff, await body(c, announcementSchema)));
});

adminRoutes.post('/admin/announcements/:id/end', async (c) => {
  const staff = await requireStaff(c, 'moderator');
  return c.json(await endAnnouncement(staff, intParam(c.req.param('id')), (await body(c, reasonOnly)).reason));
});

/** The cost of a gift: read-only, so any role may see it. */
adminRoutes.post('/admin/events/gift/preview', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await giftPreview((await body(c, giftPreviewSchema)).amount));
});

adminRoutes.post('/admin/events/gift', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await giftEveryone(staff, await body(c, giftSchema)));
});

adminRoutes.post('/admin/events/free-case', async (c) => {
  const staff = await requireStaff(c, 'admin');
  return c.json(await freeCaseEveryone(staff, (await body(c, reasonOnly)).reason));
});

// ── Ledger, jobs, errors ────────────────────────────────────────────────────

adminRoutes.get('/admin/ledger', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await ledgerPage(query(c, ledgerQuerySchema)));
});

/** Read-only and not logged: any role may run it. */
adminRoutes.post('/admin/ledger/check', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await ledgerCheckNow());
});

adminRoutes.get('/admin/jobs', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await jobsPage());
});

adminRoutes.get('/admin/errors', async (c) => {
  await requireStaff(c, 'viewer');
  return c.json(await errorsPage());
});
