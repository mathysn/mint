import { waitUntil } from '@vercel/functions';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { errorCounts, serverErrors } from '../db/schema.js';

// API failures, for admin › Logs › Errors: 4xx codes counted per hour, 5xx grouped per hour by
// code, route and message. Recorded after the response (never fails or slows the request).

const hour = sql`date_trunc('hour', now())`;

const pending = new Set<Promise<unknown>>();

/** Tests: wait for the writes still running. */
export async function flushErrorLog() {
  await Promise.all([...pending]);
}

function later(work: () => Promise<unknown>) {
  const p = work()
    .catch((error) => console.error('error log failed', error))
    .finally(() => pending.delete(p));
  pending.add(p);
  try {
    waitUntil(p);
  } catch {
    // Outside Vercel: the promise simply runs on.
  }
}

export function recordFailure(code: string) {
  later(() =>
    db()
      .insert(errorCounts)
      .values({ hour, code, count: 1 })
      .onConflictDoUpdate({ target: [errorCounts.hour, errorCounts.code], set: { count: sql`${errorCounts.count} + 1` } }),
  );
}

export function recordServerError(route: string, message: string) {
  const msg = message.slice(0, 300) || 'Unknown error';
  later(() =>
    db()
      .insert(serverErrors)
      .values({ hour, code: 'internal', route: route.slice(0, 200), message: msg })
      .onConflictDoUpdate({
        target: [serverErrors.hour, serverErrors.code, serverErrors.route, serverErrors.message],
        set: { count: sql`${serverErrors.count} + 1`, lastAt: sql`now()` },
      }),
  );
  recordFailure('internal');
}
