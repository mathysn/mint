import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiError, BanInfo, ErrorCode } from '../shared/api.js';
import type { users } from './db/schema.js';
import { utcDateTime } from './format.js';
import { env } from './env.js';

export type UserRow = typeof users.$inferSelect;

export interface AppEnv {
  Variables: {
    user: UserRow | null;
    sessionId: string | null;
    /** The cookie or token belongs to a session ended by a ban that still runs. */
    revokedBan: BanInfo | null;
  };
}

export type AppContext = Context<AppEnv>;

/** Thrown anywhere in a route; turned into `{ error: { code, message } }` by app.onError. */
export class ApiFailure extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }

  /** Extra fields sent next to `code` and `message` (the ban for `banned`). */
  extra?: Record<string, unknown>;

  body(): ApiError {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const fail = (status: ContentfulStatusCode, code: ErrorCode, message: string): never => {
  throw new ApiFailure(status, code, message);
};

export function requireUser(c: AppContext): UserRow {
  const user = c.get('user');
  if (!user) fail(401, 'unauthorized', 'Sign in or start a guest session first.');
  return user!;
}

type BanFields = Pick<UserRow, 'bannedAt' | 'banUntil' | 'banReason'>;

export const isBanned = (u: BanFields, now = new Date()) => !!u.bannedAt && (u.banUntil === null || u.banUntil > now);

export function banInfo(u: BanFields, now = new Date()): BanInfo | null {
  if (!isBanned(u, now)) return null;
  const message = u.banUntil ? `You’re banned until ${utcDateTime(u.banUntil)}.` : 'You’re banned from Mint.';
  return { until: u.banUntil?.toISOString() ?? null, reason: u.banReason ?? '', message };
}

/** 403 `banned` with the ban attached: the game is read-only for a banned player. */
export function banFailure(ban: BanInfo): ApiFailure {
  const failure = new ApiFailure(403, 'banned', `${ban.message} Reason: ${ban.reason}`);
  failure.extra = { ban };
  return failure;
}

export function assertNotBanned(u: BanFields) {
  const ban = banInfo(u);
  if (ban) throw banFailure(ban);
}

/** Cron routes: Vercel sends `Authorization: Bearer CRON_SECRET`. */
export function requireCron(c: AppContext) {
  const secret = env().CRON_SECRET;
  // Hashed first: timingSafeEqual needs equal lengths, and the comparison must not leak the secret.
  const digest = (s: string) => createHash('sha256').update(s).digest();
  const given = c.req.header('authorization') ?? '';
  if (!secret || !timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) fail(401, 'unauthorized', 'Cron only.');
}

/** Friends, trades and the market need a Discord account (DESIGN.md §7.2: guests only open cases). */
export function requireAccount(c: AppContext): UserRow {
  const user = requireUser(c);
  if (user.isGuest) fail(403, 'account_required', 'Sign in with Discord to use this.');
  return user;
}
