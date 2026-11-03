import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../server/db/client.js';
import { crateItems, items } from '../../server/db/schema.js';
import { clearCatalogCache } from '../../server/services/catalog.js';
import { Client, newGuest, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

type Tier = 'milspec' | 'restricted' | 'classified' | 'covert' | 'gold';

async function give(client: Client, list: { skin: string; tier: Tier; float?: number | null; stattrak?: boolean; destroyed?: boolean }[]) {
  const me = (await client.json('/me')).body;
  const rows = await db()
    .insert(items)
    .values(
      list.map((x) => ({
        skinId: x.skin,
        ownerId: me.id,
        originalOwnerId: me.id,
        float: x.float === undefined ? 0.2 : x.float,
        pattern: 412,
        stattrak: x.stattrak ?? false,
        tier: x.tier,
        source: 'case' as const,
        sourceCrateId: 'crate-a',
        status: x.destroyed ? ('destroyed' as const) : ('available' as const),
        destroyedAt: x.destroyed ? new Date() : null,
      })),
    )
    .returning({ id: items.id, serial: items.serial });
  return { me, rows };
}

describe('item page', () => {
  it('shows your own item with its number, collection, owner and recycle breakdown', async () => {
    const client = await newGuest();
    const { rows } = await give(client, [{ skin: 'k1', tier: 'covert', float: 0.1, stattrak: true }]);
    const res = await client.json(`/items/${rows[0]!.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      serial: rows[0]!.serial,
      collection: { id: 'col-1', name: 'Test Collection' },
      source: 'case',
      originalOwner: { name: 'Guest', isYou: true },
      recycleValue: 6000,
      recycleBreakdown: { base: 2500, stattrakMultiplier: 2, wear: { code: 'MW', multiplier: 1.2 } },
      wear: { code: 'MW' },
      pattern: 412,
    });
  });

  it('has no wear multiplier for a vanilla knife', async () => {
    const client = await newGuest();
    const { rows } = await give(client, [{ skin: 'vanilla', tier: 'gold', float: null }]);
    const res = await client.json(`/items/${rows[0]!.id}`);
    expect(res.body.recycleBreakdown).toEqual({ base: 10000, stattrakMultiplier: null, wear: null });
  });

  it('is 404 for someone else’s item, a destroyed item or a bad id', async () => {
    const owner = await newGuest('192.0.2.30');
    const other = await newGuest('192.0.2.31');
    const { rows } = await give(owner, [{ skin: 'm1', tier: 'milspec' }, { skin: 'm2', tier: 'milspec', destroyed: true }]);
    expect((await other.json(`/items/${rows[0]!.id}`)).status).toBe(404);
    expect((await owner.json(`/items/${rows[1]!.id}`)).status).toBe(404);
    expect((await owner.json('/items/not-a-uuid')).status).toBe(404);
  });

  it('numbers items in order of creation', async () => {
    const client = await newGuest();
    const first = (await client.open('crate-a')).body.item.id;
    const second = (await client.open('crate-a')).body.item.id;
    const a = (await client.json(`/items/${first}`)).body.serial;
    const b = (await client.json(`/items/${second}`)).body.serial;
    expect(b).toBeGreaterThan(a);
  });
});

describe('albums', () => {
  async function splitCases() {
    // Give the two test cases different normal skins so their albums differ.
    await db().delete(crateItems).where(eq(crateItems.crateId, 'crate-b'));
    await db().insert(crateItems).values([
      { crateId: 'crate-b', skinId: 'm2', tier: 'milspec', special: false },
      { crateId: 'crate-b', skinId: 'glove', tier: 'gold', special: true },
    ]);
    clearCatalogCache();
  }

  it('lists every case album, started ones first, with the same count as the Cases screen', async () => {
    await splitCases();
    const client = await newGuest();
    await give(client, [{ skin: 'm1', tier: 'milspec' }, { skin: 'c1', tier: 'classified' }]);
    const albums = (await client.json('/albums')).body;
    expect(albums.map((a: { id: string }) => a.id)).toEqual(['crate-a', 'crate-b']);
    expect(albums[0]).toMatchObject({ name: 'Test Collection', crate: { name: 'Alpha Case' }, owned: 2, total: 5 });
    expect(albums[1]).toMatchObject({ owned: 0, total: 1 });
    const crates = (await client.json('/crates')).body;
    expect(crates.find((c: { id: string }) => c.id === 'crate-a').completion).toEqual({ owned: 2, total: 5 });
  });

  it('puts the started album before newer untouched ones', async () => {
    await splitCases();
    const client = await newGuest();
    await give(client, [{ skin: 'm2', tier: 'milspec' }]);
    const albums = (await client.json('/albums')).body;
    expect(albums[0].id).toBe('crate-b');
  });

  it('shows the best copy (lowest float), skips destroyed items and lists ★ finds apart', async () => {
    const client = await newGuest();
    const { rows } = await give(client, [
      { skin: 'm1', tier: 'milspec', float: 0.3 },
      { skin: 'm1', tier: 'milspec', float: 0.05, stattrak: true },
      { skin: 'r1', tier: 'restricted', float: 0.01, destroyed: true },
      { skin: 'glove', tier: 'gold', float: 0.4 },
    ]);
    const detail = (await client.json('/albums/crate-a')).body;
    expect(detail.groups.map((g: { tier: string }) => g.tier)).toEqual(['covert', 'classified', 'restricted', 'milspec']);
    const milspec = detail.groups.find((g: { tier: string }) => g.tier === 'milspec');
    expect(milspec).toMatchObject({ owned: 1, total: 2 });
    const m1 = milspec.skins.find((s: { id: string }) => s.id === 'm1');
    expect(m1.best).toEqual({ itemId: rows[1]!.id, float: 0.05, wear: { code: 'FN', name: 'Factory New' }, stattrak: true });
    expect(milspec.skins.find((s: { id: string }) => s.id === 'm2').best).toBeNull();
    expect(detail.groups.find((g: { tier: string }) => g.tier === 'restricted').owned).toBe(0);
    expect(detail.special.map((s: { id: string }) => s.id)).toEqual(['glove']);
    expect(detail.album).toMatchObject({ owned: 1, total: 5 });
  });

  it('is 404 for an unknown album', async () => {
    const client = await newGuest();
    expect((await client.json('/albums/crate-zzz')).status).toBe(404);
  });
});
