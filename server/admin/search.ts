import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import type { AdminSearch, AdminSkinHit, Tier } from '../../shared/api.js';
import { db } from '../db/client.js';
import { crateItems, items, skins, users } from '../db/schema.js';
import { serial } from '../format.js';
import { banInfo } from '../http.js';
import { avatarUrl } from '../services/accounts.js';
import { nameMatches } from '../services/search.js';
import { playerLabel } from './labels.js';
import { isOnline } from './players.js';

const LIMIT = 5;
const escapeLike = (q: string) => q.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Top bar: "Search a player, Discord ID or item ID". */
export async function adminSearch(query: string): Promise<AdminSearch> {
  const q = query.trim();
  if (q.length < 2) return { players: [], items: [] };
  const digits = /^\d+$/.test(q);
  const guestId = q.replace(/^guest\s*#?/i, '').toLowerCase();
  const playerRows = await db()
    .select()
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        or(
          ilike(users.username, `%${escapeLike(q)}%`),
          digits ? ilike(users.discordId, `${q}%`) : undefined,
          /^[0-9a-f]{2,}$/.test(guestId) ? and(eq(users.isGuest, true), ilike(sql`${users.id}::text`, `${guestId}%`)) : undefined,
        ),
      ),
    )
    .orderBy(sql`${users.username} ILIKE ${`${escapeLike(q)}%`} DESC NULLS LAST`, desc(users.lastSeenAt))
    .limit(LIMIT);
  const itemRows = await db()
    .select({ id: items.id, serial: items.serial, name: skins.name, tier: items.tier })
    .from(items)
    .innerJoin(skins, eq(skins.id, items.skinId))
    .where(digits && q.length <= 12 ? eq(items.serial, Number(q)) : nameMatches(skins.name, q))
    .orderBy(desc(items.obtainedAt))
    .limit(LIMIT);
  const now = Date.now();
  return {
    players: playerRows.map((u) => ({
      id: u.id,
      label: playerLabel(u),
      discordId: u.discordId,
      isGuest: u.isGuest,
      avatarUrl: avatarUrl(u),
      banned: !!banInfo(u),
      online: isOnline(u, now),
      lastSeenAt: u.lastSeenAt.toISOString(),
    })),
    items: itemRows.map((i) => ({ id: i.id, serial: serial(i.serial), name: i.name, tier: i.tier })),
  };
}

/** Grant item: skins that drop from a case, by words of their name. */
export async function searchSkins(query: string): Promise<AdminSkinHit[]> {
  const where = nameMatches(skins.name, query);
  if (!where) return [];
  const rows = await db()
    .select({ skin: skins, tier: sql<Tier>`(SELECT ci.tier FROM ${crateItems} ci WHERE ci.skin_id = "skins"."id" LIMIT 1)` })
    .from(skins)
    .where(and(where, sql`EXISTS (SELECT 1 FROM ${crateItems} ci WHERE ci.skin_id = "skins"."id")`))
    .orderBy(skins.name, skins.id)
    .limit(5);
  return rows.map(({ skin, tier }) => ({
    id: skin.id,
    name: skin.name,
    weaponName: skin.weaponName,
    finishName: skin.finishName,
    tier,
    imageUrl: skin.imageUrl,
    minFloat: skin.minFloat,
    maxFloat: skin.maxFloat,
    stattrakAvailable: skin.stattrakAvailable,
  }));
}
