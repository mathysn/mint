import { flushErrorLog } from '../../server/services/errors.js';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { app } from '../../server/app.js';
import { db } from '../../server/db/client.js';
import { collections, crateItems, crates, skins } from '../../server/db/schema.js';
import { clearCatalogCache } from '../../server/services/catalog.js';

let migrated = false;

/** Empty database with a tiny catalog: two cases ("crate-a" is today's free case only on some days). */
export async function resetDb() {
  // Error-log writes of the previous test finish before the tables are emptied.
  await flushErrorLog();
  if (!migrated) {
    await migrate(db(), { migrationsFolder: 'db/migrations' });
    migrated = true;
  }
  await db().execute(sql`TRUNCATE ledger, case_openings, items, sessions, auth_flows, users, crate_items, crates, skins, collections, catalog_imports, admin_log, staff, game_settings, job_runs, flags, reports, economy_settings, announcements, error_counts, server_errors RESTART IDENTITY CASCADE`);
  await db().insert(collections).values({ id: 'col-1', name: 'Test Collection' });
  const skin = (id: string, extra: Partial<typeof skins.$inferInsert> = {}) => ({
    id,
    name: `Gun | ${id}`,
    weaponName: 'Gun',
    finishName: id,
    category: 'Rifles',
    apiRarityId: 'rarity_rare_weapon',
    minFloat: 0,
    maxFloat: 1,
    stattrakAvailable: true,
    imageUrl: `https://img.test/${id}.png`,
    collectionId: 'col-1',
    ...extra,
  });
  await db().insert(skins).values([
    skin('m1'),
    skin('m2', { maxFloat: 0.8 }),
    skin('r1'),
    skin('c1'),
    skin('k1'),
    skin('vanilla', { name: '★ Knife', weaponName: '★ Knife', finishName: null, category: 'Knives', minFloat: null, maxFloat: null }),
    skin('glove', { name: '★ Gloves | Test', weaponName: '★ Gloves', category: 'Gloves', stattrakAvailable: false }),
  ]);
  await db().insert(crates).values([
    { id: 'crate-a', name: 'Alpha Case', imageUrl: 'https://img.test/a.png', price: 250, releasedOn: '2024-01-01' },
    { id: 'crate-b', name: 'Beta Case', imageUrl: 'https://img.test/b.png', price: 250, releasedOn: '2025-01-01', isNew: true },
  ]);
  const content = (crateId: string) => [
    { crateId, skinId: 'm1', tier: 'milspec' as const, special: false },
    { crateId, skinId: 'm2', tier: 'milspec' as const, special: false },
    { crateId, skinId: 'r1', tier: 'restricted' as const, special: false },
    { crateId, skinId: 'c1', tier: 'classified' as const, special: false },
    { crateId, skinId: 'k1', tier: 'covert' as const, special: false },
    { crateId, skinId: 'vanilla', tier: 'gold' as const, special: true },
    { crateId, skinId: 'glove', tier: 'gold' as const, special: true },
  ];
  await db().insert(crateItems).values([...content('crate-a'), ...content('crate-b')]);
  clearCatalogCache();
  const { resetEconomyCache } = await import('../../server/services/economySettings.js');
  resetEconomyCache();
}

/** Minimal browser: keeps the session cookie between requests. */
export class Client {
  cookie: string | undefined;
  constructor(readonly ip = '203.0.113.1') {}

  async request(path: string, init: RequestInit & { json?: unknown } = {}) {
    const headers = new Headers(init.headers);
    headers.set('x-forwarded-for', this.ip);
    if (this.cookie) headers.set('cookie', this.cookie);
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json');
      init.body = JSON.stringify(init.json);
    }
    const res = await app.request(`/api${path}`, { ...init, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0]!;
      this.cookie = pair.endsWith('=') ? undefined : pair;
    }
    return res;
  }

  async json<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; body: T }> {
    const res = await this.request(path, init);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }

  open(crateId: string, opts: { free?: boolean; key?: string } = {}) {
    return this.json(`/crates/${crateId}/open`, {
      method: 'POST',
      headers: { 'idempotency-key': opts.key ?? crypto.randomUUID() },
      json: { free: opts.free ?? false },
    });
  }
}

export async function newGuest(ip?: string) {
  const client = new Client(ip);
  const res = await client.json('/auth/guest', { method: 'POST' });
  if (res.status !== 201) throw new Error(`guest creation failed: ${res.status}`);
  return client;
}

// ── Signed-in accounts (Discord accounts created directly, no OAuth) ───────────

let accounts = 0;

export async function newAccount(username: string) {
  const { createDiscordAccount } = await import('../../server/services/accounts.js');
  const { createSession } = await import('../../server/auth/sessions.js');
  const user = await createDiscordAccount(db(), { id: `d-${username}-${accounts++}`, username, global_name: null, avatar: null });
  const { token } = await createSession(db(), user.id, 'web');
  const client = new Client(`198.18.0.${accounts}`);
  client.cookie = `mint_session=${token}`;
  return { user, client };
}

export type Account = Awaited<ReturnType<typeof newAccount>>;

/** A signed-in Discord account that is also staff with this role. */
export async function newStaff(username: string, role: 'viewer' | 'moderator' | 'admin') {
  const account = await newAccount(username);
  const { staff } = await import('../../server/db/schema.js');
  await db().insert(staff).values({ discordId: account.user.discordId!, role });
  return account;
}

type Tier = 'milspec' | 'restricted' | 'classified' | 'covert' | 'gold';
const skinOf: Record<Tier, string> = { milspec: 'm1', restricted: 'r1', classified: 'c1', covert: 'k1', gold: 'glove' };

/** Puts an item straight in a player's inventory (skins of the test catalog). */
export async function giveItem(ownerId: string, tier: Tier, extra: { skinId?: string; status?: 'available' | 'listed' } = {}) {
  const { items } = await import('../../server/db/schema.js');
  const [row] = await db()
    .insert(items)
    .values({
      skinId: extra.skinId ?? skinOf[tier],
      ownerId,
      originalOwnerId: ownerId,
      float: 0.2,
      pattern: 1,
      stattrak: false,
      tier,
      source: 'case',
      sourceCrateId: 'crate-a',
      status: extra.status ?? 'available',
    })
    .returning();
  return row!;
}

export async function befriend(a: Account, b: Account) {
  await a.client.json('/friends/requests', { method: 'POST', json: { username: b.user.username } });
  await b.client.json(`/friends/requests/${a.user.id}/accept`, { method: 'POST' });
}
