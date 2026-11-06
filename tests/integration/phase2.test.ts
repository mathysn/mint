import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../server/db/client.js';
import { items, ledger, users } from '../../server/db/schema.js';
import { Client, newGuest, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

type Tier = 'milspec' | 'restricted' | 'classified' | 'covert' | 'gold';

async function give(client: Client, list: { tier: Tier; float?: number | null; stattrak?: boolean; status?: 'available' | 'listed' }[]) {
  const me = (await client.json('/me')).body;
  const skinOf: Record<Tier, string> = { milspec: 'm1', restricted: 'r1', classified: 'c1', covert: 'k1', gold: 'vanilla' };
  const rows = await db()
    .insert(items)
    .values(
      list.map((x) => ({
        skinId: skinOf[x.tier],
        ownerId: me.id,
        float: x.float === undefined ? 0.2 : x.float,
        pattern: 1,
        stattrak: x.stattrak ?? false,
        tier: x.tier,
        source: 'case' as const,
        sourceCrateId: 'crate-a',
        status: x.status ?? 'available',
      })),
    )
    .returning({ id: items.id });
  return { me, ids: rows.map((r) => r.id) };
}

async function ledgerMatchesBalance(userId: string) {
  const [user] = await db().select().from(users).where(eq(users.id, userId));
  const entries = await db().select().from(ledger).where(eq(ledger.userId, userId));
  return entries.reduce((s, e) => s + e.amount, 0) === user!.balance;
}

const recycle = (client: Client, itemIds: string[], confirm = false) =>
  client.json('/items/recycle', { method: 'POST', json: { itemIds, confirm } });

describe('no daily credits', () => {
  it('has no daily reward any more: the free case stack replaces it', async () => {
    const client = await newGuest();
    const me = (await client.json('/me')).body;
    expect(me).not.toHaveProperty('dailyReward');
    expect((await client.json('/rewards/daily', { method: 'POST' })).status).toBe(404);
    expect((await client.json('/me')).body.balance).toBe(1000);
    expect(await ledgerMatchesBalance(me.id)).toBe(true);
  });
});

describe('recycling', () => {
  it('destroys the items, credits their value and writes one ledger line each', async () => {
    const client = await newGuest();
    // milspec FT 30, milspec FN ST 30×2×1.5 = 90, restricted BS 120×0.8 = 96
    const { me, ids } = await give(client, [{ tier: 'milspec' }, { tier: 'milspec', float: 0.01, stattrak: true }, { tier: 'restricted', float: 0.5 }]);
    const quote = await client.json('/items/recycle/quote', { method: 'POST', json: { itemIds: ids } });
    expect(quote.body).toEqual({ count: 3, total: 216, requiresConfirmation: false, unavailable: [] });
    const res = await recycle(client, ids);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 3, credited: 216, balance: 1216 });
    const rows = await db().select().from(items).where(inArray(items.id, ids));
    expect(rows.every((r) => r.status === 'destroyed' && r.destroyedAt)).toBe(true);
    const entries = await db().select().from(ledger).where(eq(ledger.type, 'recycle'));
    expect(entries.map((e) => e.amount).sort((a, b) => a - b)).toEqual([30, 90, 96]);
    expect(entries.map((e) => e.balanceAfter).sort((a, b) => a - b)).toEqual(expect.arrayContaining([1216]));
    expect(await ledgerMatchesBalance(me.id)).toBe(true);
    const inv = (await client.json('/inventory')).body;
    expect(inv.totalCount).toBe(0);
  });

  it('asks for a confirmation from Classified, enforced by the server', async () => {
    const client = await newGuest();
    const { ids } = await give(client, [{ tier: 'milspec' }, { tier: 'classified' }]);
    expect((await client.json('/items/recycle/quote', { method: 'POST', json: { itemIds: ids } })).body.requiresConfirmation).toBe(true);
    const refused = await recycle(client, ids);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('confirmation_required');
    expect((await client.json('/me')).body.balance).toBe(1000);
    expect((await recycle(client, ids, true)).body).toMatchObject({ count: 2, credited: 530 });
  });

  it('pays 10 000 CR for a vanilla knife (no wear, ×1)', async () => {
    const client = await newGuest();
    const { ids } = await give(client, [{ tier: 'gold', float: null }]);
    const inv = (await client.json('/inventory')).body;
    expect(inv.items[0]).toMatchObject({ recycleValue: 10000, recycleConfirm: true, wear: null });
    expect((await recycle(client, ids, true)).body).toMatchObject({ credited: 10000, balance: 11000 });
  });

  it('recycles nothing when one item is not available or not yours', async () => {
    const owner = await newGuest('192.0.2.20');
    const other = await newGuest('192.0.2.21');
    const { ids } = await give(owner, [{ tier: 'milspec' }, { tier: 'milspec', status: 'listed' }]);
    const listed = await recycle(owner, ids);
    expect(listed.status).toBe(409);
    expect(listed.body.error.code).toBe('items_unavailable');
    const quote = (await owner.json('/items/recycle/quote', { method: 'POST', json: { itemIds: ids } })).body;
    expect(quote).toMatchObject({ count: 1, total: 30, unavailable: [ids[1]] });
    expect((await recycle(other, [ids[0]!])).status).toBe(409);
    const rows = await db().select().from(items).where(inArray(items.id, ids));
    expect(rows.every((r) => r.status !== 'destroyed')).toBe(true);
    expect((await owner.json('/me')).body.balance).toBe(1000);
  });

  it('pays once when the same item is recycled twice at the same moment', async () => {
    const client = await newGuest();
    const { me, ids } = await give(client, [{ tier: 'covert' }]);
    const results = await Promise.all(Array.from({ length: 4 }, () => recycle(client, ids, true)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect((await client.json('/me')).body.balance).toBe(1000 + 2500);
    expect(await ledgerMatchesBalance(me.id)).toBe(true);
  });

  it('validates the request', async () => {
    const client = await newGuest();
    expect((await recycle(client, [])).status).toBe(400);
    expect((await recycle(client, ['not-a-uuid'])).status).toBe(400);
    const tooMany = Array.from({ length: 201 }, () => crypto.randomUUID());
    expect((await recycle(client, tooMany)).status).toBe(400);
    expect((await new Client().json('/items/recycle', { method: 'POST', json: { itemIds: [crypto.randomUUID()] } })).status).toBe(401);
  });

  it('recycles a freshly opened item from the reveal', async () => {
    const client = await newGuest();
    const opened = (await client.open('crate-a')).body;
    const res = await recycle(client, [opened.item.id], opened.item.recycleConfirm);
    expect(res.body).toMatchObject({ count: 1, credited: opened.item.recycleValue, balance: 750 + opened.item.recycleValue });
  });
});
