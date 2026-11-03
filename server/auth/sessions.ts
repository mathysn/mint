import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { BanInfo } from '../../shared/api.js';
import { db, type DbOrTx } from '../db/client.js';
import { playerDays, sessions, users } from '../db/schema.js';
import { baseUrl } from '../origins.js';
import { banInfo, type AppContext, type UserRow } from '../http.js';
import type { SessionMeta } from './client.js';
import { afterSessionCreated } from '../admin/monitors.js';

export const SESSION_COOKIE = 'mint_session';
const SESSION_DAYS = 180;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
/** last_used_at / expires_at are refreshed at most once an hour per session. */
const TOUCH_EVERY_MS = 60 * 60 * 1000;
/** last_seen_at is refreshed at most every 2 minutes: "Online" = seen in the last 5 minutes. */
const SEEN_EVERY_MS = 2 * 60 * 1000;

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest();

/** Marks the player as seen today (Overview: active players). */
export async function markSeen(tx: DbOrTx, userId: string, now = new Date()) {
  await tx
    .insert(playerDays)
    .values({ day: now.toISOString().slice(0, 10), userId })
    .onConflictDoNothing();
}

export async function createSession(
  tx: DbOrTx,
  userId: string,
  kind: 'web' | 'activity',
  meta?: SessionMeta,
): Promise<{ id: string; token: string }> {
  const token = newToken();
  const device = kind === 'activity' ? 'Discord activity' : (meta?.device ?? null);
  const [row] = await tx
    .insert(sessions)
    .values({
      userId,
      kind,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_MS),
      device,
      ipHash: meta?.ipHash ?? null,
      city: meta?.city ?? null,
      country: meta?.country ?? null,
    })
    .returning({ id: sessions.id });
  await markSeen(tx, userId);
  await afterSessionCreated(tx, meta?.ipHash ?? null);
  return { id: row!.id, token };
}

/** Bearer token (Discord activity) or cookie (web). */
export function readToken(c: AppContext): string | undefined {
  const header = c.req.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || undefined;
  return getCookie(c, SESSION_COOKIE);
}

export type SessionLookup =
  | { sessionId: string; user: UserRow }
  /** The session was ended by a ban that still runs: the player sees why instead of a fresh guest. */
  | { revokedBan: BanInfo }
  | null;

export async function findSession(token: string): Promise<SessionLookup> {
  const [row] = await db()
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  if (!row) return null;
  if (row.session.revokedAt) {
    const ban = row.session.revokedReason === 'ban' ? banInfo(row.user) : null;
    return ban ? { revokedBan: ban } : null;
  }
  const now = new Date();
  if (now.getTime() - row.session.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await db().update(sessions).set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_MS) }).where(eq(sessions.id, row.session.id));
  }
  if (now.getTime() - row.user.lastSeenAt.getTime() > SEEN_EVERY_MS) {
    await db().update(users).set({ lastSeenAt: now }).where(eq(users.id, row.user.id));
    await markSeen(db(), row.user.id, now);
  }
  return { sessionId: row.session.id, user: row.user };
}

export async function revokeSession(tx: DbOrTx, sessionId: string) {
  await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: 'sign_out' }).where(eq(sessions.id, sessionId));
}

/** Ends every live session of a player; returns how many were ended. */
export async function revokeAllSessions(tx: DbOrTx, userId: string, reason: 'admin' | 'ban' | 'deleted'): Promise<number> {
  const ended = await tx
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
    .returning({ id: sessions.id });
  return ended.length;
}

export function setSessionCookie(c: AppContext, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: baseUrl().startsWith('https://'),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(c: AppContext) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}
