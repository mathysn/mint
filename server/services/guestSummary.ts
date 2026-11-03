import { and, count, desc, eq, ne } from 'drizzle-orm';
import type { GuestSummary } from '../../shared/api.js';
import type { DbOrTx } from '../db/client.js';
import { caseOpenings, items, users } from '../db/schema.js';
import { listCrates } from './crates.js';
import { selectItems, toItem } from './items.js';

/** What the Connect screen shows: "3 items · 750 CR · Kilowatt 3/17". */
export async function guestSummary(tx: DbOrTx, userId: string): Promise<GuestSummary> {
  const [user] = await tx.select().from(users).where(eq(users.id, userId));
  const owned = and(eq(items.ownerId, userId), ne(items.status, 'destroyed'));
  const [recent, [itemCount], [opened], crates] = await Promise.all([
    selectItems(tx).where(owned).orderBy(desc(items.obtainedAt)).limit(3),
    tx.select({ n: count() }).from(items).where(owned),
    tx.select({ n: count() }).from(caseOpenings).where(eq(caseOpenings.userId, userId)),
    user ? listCrates(user) : Promise.resolve([]),
  ]);
  const best = crates
    .filter((c) => c.completion.owned > 0)
    .sort((a, b) => b.completion.owned / b.completion.total - a.completion.owned / a.completion.total)[0];
  return {
    recentItems: recent.map(toItem),
    itemCount: itemCount?.n ?? 0,
    balance: user?.balance ?? 0,
    casesOpened: opened?.n ?? 0,
    bestAlbum: best ? { crateName: best.name, owned: best.completion.owned, total: best.completion.total } : null,
  };
}
